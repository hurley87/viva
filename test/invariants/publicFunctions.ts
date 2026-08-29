// Every function a browser can call, discovered rather than listed.
//
// INV-2's done-means is "the Operator role cannot query transcript bodies" —
// a claim about the whole public surface, not about the functions somebody
// remembered to check. So the surface is enumerated: each Convex module is
// imported, each export that carries Convex's `isPublic` marker is collected,
// and the invariant test calls all of them. A public function added next month
// is in the sweep the moment it exists, with no test edit.
//
// Args are synthesized from each function's own declared arg validator, so the
// sweep can call functions it has never heard of. The synthesis resolves
// `v.id("table")` to a real seeded id, which matters: an id that points at
// nothing makes most handlers return early, and a sweep that only ever
// exercises the not-found path proves nothing.

import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { ConvexModules } from "./world";

// ---------------------------------------------------------------------------
// The shape Convex exports its validators in
// ---------------------------------------------------------------------------

type ObjectField = { fieldType: ValidatorJson; optional: boolean };

export type ValidatorJson =
  | { type: "null" }
  | { type: "number" }
  | { type: "bigint" }
  | { type: "boolean" }
  | { type: "string" }
  | { type: "bytes" }
  | { type: "any" }
  | { type: "literal"; value: unknown }
  | { type: "id"; tableName: string }
  | { type: "array"; value: ValidatorJson }
  | { type: "object"; value: Record<string, ObjectField> }
  | { type: "record"; keys: ValidatorJson; values: ObjectField }
  | { type: "union"; value: ValidatorJson[] };

/** Every `type` string that appears anywhere inside a validator's JSON. */
export function validatorTypes(json: ValidatorJson | null): string[] {
  if (json === null) {
    return [];
  }
  const found: string[] = [json.type];
  switch (json.type) {
    case "array":
      return [...found, ...validatorTypes(json.value)];
    case "object":
      return [
        ...found,
        ...Object.values(json.value).flatMap((field) =>
          validatorTypes(field.fieldType),
        ),
      ];
    case "record":
      return [
        ...found,
        ...validatorTypes(json.keys),
        ...validatorTypes(json.values.fieldType),
      ];
    case "union":
      return [...found, ...json.value.flatMap(validatorTypes)];
    default:
      return found;
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export type FunctionType = "query" | "mutation" | "action";

export type PublicFunction = {
  /** `"sessions:mintSession"` — the name Convex resolves a reference by. */
  path: string;
  module: string;
  name: string;
  type: FunctionType;
  args: ValidatorJson | null;
  returns: ValidatorJson | null;
};

type RegisteredFunction = {
  isPublic?: boolean;
  isInternal?: boolean;
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  exportArgs?: () => string;
  exportReturns?: () => string;
};

/**
 * Modules the sweep does not import.
 *
 * `auth.config.ts` is Convex deployment configuration rather than a function
 * module, and it throws on import when `PRIVY_APP_ID` is unset — which is
 * exactly the case in CI, where the suite runs without secrets by design.
 * Nothing else is skipped: skipping a function module is how a leak escapes.
 */
const NOT_FUNCTION_MODULES = ["auth.config", "schema"];

function isSkipped(path: string): boolean {
  return (
    path.includes("_generated") ||
    path.endsWith(".test.ts") ||
    NOT_FUNCTION_MODULES.some((name) => path.endsWith(`/${name}.ts`))
  );
}

function parseValidator(json: string | undefined): ValidatorJson | null {
  if (json === undefined) {
    return null;
  }
  const parsed: unknown = JSON.parse(json);
  return parsed === null ? null : (parsed as ValidatorJson);
}

/**
 * Every public query, mutation, and action in `convex/`.
 *
 * @param modules the same `import.meta.glob` map convex-test is given, so the
 * sweep and the runtime resolve identical module paths.
 */
export async function publicFunctions(
  modules: ConvexModules,
): Promise<PublicFunction[]> {
  const found: PublicFunction[] = [];
  for (const [path, load] of Object.entries(modules)) {
    if (isSkipped(path)) {
      continue;
    }
    const exports = (await load()) as Record<string, unknown>;
    // "../examiner/realtime.ts" -> "examiner/realtime"
    const modulePath = path.replace(/^(\.\.\/)+/, "").replace(/\.ts$/, "");
    for (const [name, value] of Object.entries(exports)) {
      if (
        value === null ||
        (typeof value !== "object" && typeof value !== "function")
      ) {
        continue;
      }
      const fn = value as RegisteredFunction;
      if (fn.isPublic !== true) {
        continue;
      }
      const type: FunctionType | null = fn.isQuery
        ? "query"
        : fn.isMutation
          ? "mutation"
          : fn.isAction
            ? "action"
            : null;
      if (type === null) {
        continue;
      }
      found.push({
        path: `${modulePath}:${name}`,
        module: modulePath,
        name,
        type,
        args: parseValidator(fn.exportArgs?.()),
        returns: parseValidator(fn.exportReturns?.()),
      });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Calling them
// ---------------------------------------------------------------------------

/**
 * References by name, one helper per function type.
 *
 * Three narrow helpers rather than one polymorphic one: convex-test's `query`,
 * `mutation` and `action` each demand a reference of their own type, and a
 * union would only be cast apart again at the call site.
 */
export const queryRef = (path: string): FunctionReference<"query"> =>
  makeFunctionReference<"query">(path);

export const mutationRef = (path: string): FunctionReference<"mutation"> =>
  makeFunctionReference<"mutation">(path);

export const actionRef = (path: string): FunctionReference<"action"> =>
  makeFunctionReference<"action">(path);

/**
 * Build a plausible argument object from a declared arg validator.
 *
 * `ids` maps a table name to a real seeded id. A table with no entry is a hard
 * error rather than a fabricated id: the sweep is only as good as the data it
 * points at, so a new table must be seeded in `world.ts` before a function
 * taking one of its ids can be meaningfully called.
 */
export function synthesizeArgs(
  fn: PublicFunction,
  ids: Record<string, string>,
): Record<string, unknown> {
  return synthesizeArgVariants(fn, ids)[0] ?? {};
}

/**
 * How many argument combinations one function may contribute to the sweep.
 *
 * A cap rather than an exhaustive product: the point is to reach every branch
 * of every union, not to multiply out a combinatorial explosion if a function
 * ever grows several union-typed arguments at once.
 */
const MAX_VARIANTS = 32;

/**
 * Every plausible argument object for a function — one per combination of its
 * unions' branches.
 *
 * Synthesizing only the first branch of a union is how a leak hides: given
 * `args: { detail: v.union(v.literal("counts"), v.literal("full")) }` the sweep
 * would only ever ask for `"counts"`, and a function that returns Transcript
 * content under `"full"` would never be called with it. The file's premise is
 * exhaustive discovery, so the discovery has to be exhaustive.
 */
export function synthesizeArgVariants(
  fn: PublicFunction,
  ids: Record<string, string>,
): Record<string, unknown>[] {
  const json = fn.args;
  if (json === null || json.type !== "object") {
    return [{}];
  }
  let variants: Record<string, unknown>[] = [{}];
  for (const [field, spec] of Object.entries(json.value)) {
    if (spec.optional) {
      continue;
    }
    const values = synthesizeValues(
      spec.fieldType,
      ids,
      `${fn.path}.${field}`,
    );
    const grown: Record<string, unknown>[] = [];
    for (const base of variants) {
      for (const value of values) {
        if (grown.length >= MAX_VARIANTS) {
          break;
        }
        grown.push({ ...base, [field]: value });
      }
    }
    variants = grown;
  }
  return variants.length === 0 ? [{}] : variants;
}

/** Every value a validator admits, one per union branch. */
function synthesizeValues(
  json: ValidatorJson,
  ids: Record<string, string>,
  where: string,
): unknown[] {
  switch (json.type) {
    case "null":
    case "any":
      return [null];
    case "number":
      return [0];
    case "bigint":
      return [BigInt(0)];
    case "boolean":
      return [false];
    case "string":
      return [""];
    case "bytes":
      return [new ArrayBuffer(0)];
    case "literal":
      return [json.value];
    case "array":
      return [[]];
    case "record":
      return [{}];
    case "union":
      return json.value
        .flatMap((branch) => synthesizeValues(branch, ids, where))
        .slice(0, MAX_VARIANTS);
    case "object": {
      let nested: Record<string, unknown>[] = [{}];
      for (const [field, spec] of Object.entries(json.value)) {
        if (spec.optional) {
          continue;
        }
        const values = synthesizeValues(
          spec.fieldType,
          ids,
          `${where}.${field}`,
        );
        const grown: Record<string, unknown>[] = [];
        for (const base of nested) {
          for (const value of values) {
            if (grown.length >= MAX_VARIANTS) {
              break;
            }
            grown.push({ ...base, [field]: value });
          }
        }
        nested = grown;
      }
      return nested.length === 0 ? [{}] : nested;
    }
    case "id": {
      const id = ids[json.tableName];
      if (id === undefined) {
        throw new Error(
          `The invariant sweep has no seeded id for table "${json.tableName}" ` +
            `(needed by ${where}). Seed one in test/invariants/world.ts so the ` +
            "sweep calls this function against real data rather than a " +
            "not-found early return.",
        );
      }
      return [id];
    }
  }
}
