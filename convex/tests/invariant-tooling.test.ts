// The invariant suite's own tools, tested.
//
// INV-2 and INV-3 are enforced by static gates that read the codebase as text,
// and by a sweep that calls every public function with arguments synthesized
// from its own validators. Both are silent when they stop covering something:
// a regex that no longer matches reports zero hits, which is exactly what a
// clean codebase reports, and a sweep that only tries one branch of a union
// reports that it called the function. A gate that has quietly stopped looking
// is worse than no gate at all, because the suite still reads as a guarantee.
//
// So the tools are held to the same standard as the code they check: given a
// violation, they have to find it.

import { describe, expect, test } from "vitest";
import {
  findAll,
  tableReads,
  tableWrites,
} from "../../test/invariants/sources";
import {
  synthesizeArgVariants,
  validatorTypes,
} from "../../test/invariants/publicFunctions";
import type {
  PublicFunction,
  ValidatorJson,
} from "../../test/invariants/publicFunctions";

describe("the static gates see what they claim to see", () => {
  test("a write in single quotes is a write", () => {
    const hits = tableWrites(
      { "../fake.ts": "await ctx.db.delete('transcriptShares', id);\n" },
      "transcriptShares",
    );
    expect(
      hits.map((hit) => hit.operation),
      "Nothing in this repo enforces a quote style — no Prettier, no ESLint " +
        "quote rule — so a gate that only matched double quotes would let " +
        "`ctx.db.delete('transcriptShares', id)` through while reporting that " +
        "a share is permanent.",
    ).toEqual(["delete"]);
  });

  test("a write whose arguments wrap across lines is a write", () => {
    const source = [
      "// leading comment",
      "async function retract(ctx, id) {",
      "  await ctx.db.delete(",
      '    "transcriptShares",',
      "    id,",
      "  );",
      "}",
      "",
    ].join("\n");
    const hits = tableWrites({ "../fake.ts": source }, "transcriptShares");
    expect(
      hits.map((hit) => hit.operation),
      "A line-by-line scan cannot see a call whose table argument is on the " +
        "next line, and Prettier-shaped code wraps constantly.",
    ).toEqual(["delete"]);
    expect(hits[0].line, "the reported line is where the call starts").toBe(3);
  });

  test("reads are found in both quoting styles, and only for the named table", () => {
    const source = [
      "const a = await ctx.db.query('standards').collect();",
      'const b = await ctx.db.get("standards", id);',
      'const c = await ctx.db.query("assignmentVersions").collect();',
      "",
    ].join("\n");
    expect(tableReads({ "../fake.ts": source }, "standards")).toHaveLength(2);
    expect(
      tableReads({ "../fake.ts": source }, "assignmentVersions"),
    ).toHaveLength(1);
    expect(tableReads({ "../fake.ts": source }, "sessions")).toHaveLength(0);
  });

  test("findAll reports the line a match starts on, not the file's first line", () => {
    const source = ["one", "two", "the needle is here", "four", ""].join("\n");
    const hits = findAll({ "../fake.ts": source }, /needle/);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
    expect(hits[0].text).toBe("the needle is here");
    expect(hits[0].file).toBe("convex/fake.ts");
  });

  test("a pattern that already carries the global flag is not double-compiled", () => {
    const hits = findAll({ "../fake.ts": "a a a" }, /a/g);
    expect(hits).toHaveLength(3);
  });
});

describe("the public-function sweep synthesizes every branch it could call", () => {
  const fn = (args: ValidatorJson): PublicFunction => ({
    path: "fake:probe",
    module: "fake",
    name: "probe",
    type: "query",
    args,
    returns: null,
  });

  test("both branches of a union argument are swept, not just the first", () => {
    const variants = synthesizeArgVariants(
      fn({
        type: "object",
        value: {
          detail: {
            optional: false,
            fieldType: {
              type: "union",
              value: [
                { type: "literal", value: "counts" },
                { type: "literal", value: "full" },
              ],
            },
          },
        },
      }),
      {},
    );
    expect(
      variants.map((variant) => variant.detail).sort(),
      "Synthesizing only `json.value[0]` means a leak reachable solely " +
        'through `detail: "full"` is never once called for, while the sweep ' +
        "reports that it called the function.",
    ).toEqual(["counts", "full"]);
  });

  test("unions nested inside an object argument are swept too", () => {
    const variants = synthesizeArgVariants(
      fn({
        type: "object",
        value: {
          filter: {
            optional: false,
            fieldType: {
              type: "object",
              value: {
                scope: {
                  optional: false,
                  fieldType: {
                    type: "union",
                    value: [
                      { type: "literal", value: "mine" },
                      { type: "literal", value: "all" },
                    ],
                  },
                },
              },
            },
          },
        },
      }),
      {},
    );
    expect(variants).toHaveLength(2);
  });

  test("optional arguments are still omitted, and a table id still resolves", () => {
    const variants = synthesizeArgVariants(
      fn({
        type: "object",
        value: {
          sessionId: {
            optional: false,
            fieldType: { type: "id", tableName: "sessions" },
          },
          note: { optional: true, fieldType: { type: "string" } },
        },
      }),
      { sessions: "seeded-session-id" },
    );
    expect(variants).toEqual([{ sessionId: "seeded-session-id" }]);
  });
});

describe("why the Operator return-type gate has to check for a validator", () => {
  test("a missing return validator has no types at all", () => {
    expect(
      validatorTypes(null),
      "Convex does not require a `returns` validator, and a function without " +
        "one exports `null`. Every `not.toContain` assertion holds on an " +
        "empty array, which is why the INV-2 gate asserts the validator " +
        "exists before it inspects it.",
    ).toEqual([]);
  });
});
