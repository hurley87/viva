// INV-3 — The Standard never enters the live Session.
//
// PRD §4: "The Standard is used only by the post-session grader. The live
// examiner receives the Assignment prompt and generic probing behavior —
// nothing extractable that changes the exam if leaked." Mechanism: "separate
// context assembly paths for examiner vs. grader; lint/test that the
// session-mint code path cannot reference Standard storage."
//
// So this file is mostly a static check that runs as a test. The claim is not
// "the Standard does not reach the Examiner today" — that would be a red-team
// exercise — but "the code that runs a Session cannot reach the Standard at
// all". That is a claim about which modules may name which storage, and the
// only way to assert it is to read the sources.
//
// Directories are globbed rather than listed. A module added to
// `convex/examiner/` next month, or a new Student-callable projection module,
// is covered without anybody remembering to extend a list here.
//
// The last section is the trap ticket #3 found: an `@openai/agents`
// `RealtimeAgent` built without `instructions` gets `""` from the SDK, and the
// `session.update` it sends on connect would overwrite the Examiner
// instructions that were baked into the client secret server-side. Losing that
// protection would breach INV-1's "assembled server-side only" silently — the
// Session would still run, just with an Examiner that has no instructions.

import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import {
  convexModules,
  convexPath,
  describeHit,
  findAll,
  matching,
  tableReads,
  tableWrites,
} from "../../test/invariants/sources";
import type { SourceMap } from "../../test/invariants/sources";
import { SENTINELS, STUDENT_DID, seedWorld } from "../../test/invariants/world";

const INV3 = "INV-3 (the Standard never enters the live Session)";

const modules = import.meta.glob("../**/*.ts");

const convexSources = convexModules(
  import.meta.glob("../**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as SourceMap,
);

const appSources = import.meta.glob("../../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as SourceMap;

/**
 * The lowercase token `standards` — the table name and the module name. The
 * glossary term is written "Standard"/"Standards" in prose, so this catches
 * `ctx.db.query("standards")` and `from "./standards"` without tripping over a
 * comment that merely mentions the concept.
 */
const STANDARDS_TOKEN = /\bstandards\b/;

// Either quoting style: nothing in this repo enforces one, so a gate that
// assumed double quotes would simply stop seeing new imports.
const STANDARDS_IMPORT = /from\s+["'](\.{1,2}\/)+standards["']/;

/**
 * The modules allowed to name the Standard at all:
 *   - the island itself, which is the only module that touches the table;
 *   - the Grader, the only consumer, which reads it through the island;
 *   - the schema, which has to define the table;
 *   - the seed, which writes a deployment's first Standard through the island
 *     (it handles no Standard id and no Standard content of its own).
 */
const STANDARD_AWARE = [
  /^convex\/standards\.ts$/,
  /^convex\/grader\//,
  /^convex\/schema\.ts$/,
  /^convex\/seed\.ts$/,
];

/**
 * The live-Session path: everything that runs while a Student is being
 * examined, or that projects Session material to one.
 *
 * Globbed, not listed. `convex/examiner/**` picks up new modules automatically,
 * and anything that authenticates a Student (`requireStudent`) is a
 * Student-callable surface by definition and joins the set on its own.
 */
function liveSessionPath(sources: SourceMap): SourceMap {
  const named = matching(sources, [
    /^convex\/sessions\.ts$/,
    /^convex\/assignments\.ts$/,
    /^convex\/transcript\.ts$/,
    /^convex\/examiner\//,
  ]);
  const studentCallable = Object.fromEntries(
    Object.entries(sources).filter(([, source]) =>
      source.includes("requireStudent"),
    ),
  );
  return { ...named, ...studentCallable };
}

describe("INV-3 — the mint and Examiner path cannot reference the Standard", () => {
  test("the live-Session path is what we think it is", () => {
    const covered = Object.keys(liveSessionPath(convexSources)).map(convexPath);
    expect(
      covered,
      `${INV3}: the scan is not covering the mint path. Check the globs.`,
    ).toEqual(
      expect.arrayContaining([
        "convex/sessions.ts",
        "convex/assignments.ts",
        "convex/transcript.ts",
        "convex/examiner/instructions.ts",
        "convex/examiner/realtime.ts",
      ]),
    );
  });

  test("no module on the live-Session path imports the Standards module", () => {
    const hits = findAll(liveSessionPath(convexSources), STANDARDS_IMPORT);
    expect(
      hits.map(describeHit),
      `${INV3} BROKEN: a module that runs during a Session imports the ` +
        "Grader-only Standards island. The separation is physical, not a " +
        "convention — the live path reads assignmentVersions and nothing " +
        `else.\n${hits.map(describeHit).join("\n")}`,
    ).toEqual([]);
  });

  test("no module on the live-Session path so much as names Standard storage", () => {
    const hits = findAll(liveSessionPath(convexSources), STANDARDS_TOKEN);
    expect(
      hits.map(describeHit),
      `${INV3} BROKEN: a module on the live-Session path names the ` +
        "`standards` table or module. The Examiner receives the pinned " +
        "Assignment prompt and generic probing behaviour — nothing " +
        "extractable that would change the exam if leaked (PRD §4, §7).\n" +
        hits.map(describeHit).join("\n"),
    ).toEqual([]);
  });

  test("only the Grader island and its two writers name the Standard anywhere in convex/", () => {
    const offenders = findAll(convexSources, STANDARDS_TOKEN).filter(
      (hit) => !STANDARD_AWARE.some((allowed) => allowed.test(hit.file)),
    );
    expect(
      offenders.map(describeHit),
      `${INV3} BROKEN: a module outside the Grader island names the Standard. ` +
        "Allowed: convex/standards.ts (the island), convex/grader/** (the " +
        "only consumer), convex/schema.ts (the table definition), " +
        "convex/seed.ts (writes a deployment's first Standard through the " +
        `island).\n${offenders.map(describeHit).join("\n")}`,
    ).toEqual([]);
  });

  test("convex/standards.ts is the only module that touches the standards table", () => {
    const touches = [
      ...tableReads(convexSources, "standards"),
      ...tableWrites(convexSources, "standards"),
    ].filter((hit) => hit.file !== "convex/standards.ts");
    expect(
      touches.map(describeHit),
      `${INV3} BROKEN: Standard storage is read or written outside the ` +
        "island. Every access goes through convex/standards.ts, whose exports " +
        `are all internal, so no client can reach one.\n${touches
          .map(describeHit)
          .join("\n")}`,
    ).toEqual([]);
  });

  test("the Grader is the only reader of the Standard", () => {
    const readers = findAll(
      convexSources,
      /internal\.standards\.getStandardForVersion/,
    ).filter((hit) => !hit.file.startsWith("convex/grader/"));
    expect(
      readers.map(describeHit),
      `${INV3} BROKEN: something other than the Grader reads a Standard. The ` +
        "Grader may, because it runs strictly after the Session has ended, in " +
        "a different model with a different context, and returns nothing to " +
        `any live path.\n${readers.map(describeHit).join("\n")}`,
    ).toEqual([]);
  });

  test("every export of the Standards island is internal, so no client can call one", () => {
    const island = matching(convexSources, [/^convex\/standards\.ts$/]);
    const publicRegistrations = findAll(
      island,
      /export const \w+ = (query|mutation|action)\(/,
    );
    expect(
      publicRegistrations.map(describeHit),
      `${INV3} BROKEN: convex/standards.ts exports a client-callable ` +
        "function. Every export there is internalQuery/internalMutation so " +
        "that no Student and no Operator can ever project Standard content.",
    ).toEqual([]);
  });
});

describe("INV-3 — the Examiner's assembled instructions carry no Standard", () => {
  test("the instructions minted for a Session contain the Assignment prompt and nothing from the Standard", async () => {
    const { t, ids } = await seedWorld(modules);
    const prepared = await t
      .withIdentity({ subject: STUDENT_DID })
      .mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    // The assembly really happened: the pinned Assignment prompt is in there.
    expect(prepared.instructions).toContain("deterrence requires credibility");

    for (const sentinel of SENTINELS.standardContent) {
      expect(
        prepared.instructions,
        `${INV3} BROKEN: the instructions handed to the live Examiner ` +
          `contain Standard content ("${sentinel}"). The Examiner receives ` +
          "the pinned Assignment prompt and generic probing behaviour only.",
      ).not.toContain(sentinel);
    }
  });
});

// ---------------------------------------------------------------------------
// The regression ticket #3 asked for: an Examiner agent with no instructions
// ---------------------------------------------------------------------------

const SESSION_PAGE = "../../src/app/session/[sessionId]/page.tsx";

function sessionPageSource(): string {
  const entry = Object.entries(appSources).find(([path]) =>
    path.endsWith("src/app/session/[sessionId]/page.tsx"),
  );
  if (entry === undefined) {
    throw new Error(
      `Could not read ${SESSION_PAGE}. If the live Session screen moved, move ` +
        "this check with it — it is the only thing standing between the " +
        "server-baked Examiner instructions and an empty string.",
    );
  }
  return entry[1];
}

describe("INV-1/INV-3 — the client cannot overwrite the server-baked Examiner instructions", () => {
  test("the SDK really does turn a missing `instructions` into an empty string", async () => {
    const { RealtimeAgent, RealtimeSession } = await import(
      "@openai/agents/realtime"
    );
    const unguarded = new RealtimeAgent({ name: "Examiner" });
    expect(
      unguarded.instructions,
      "The premise of this whole check: @openai/agents defaults a missing " +
        "`instructions` to an empty string rather than leaving it undefined.",
    ).toBe("");

    const config = await new RealtimeSession(unguarded, {
      model: "gpt-realtime-2.1",
    }).getInitialSessionConfig();
    expect(
      config.instructions,
      "…and it puts that empty string on the wire in the session.update sent " +
        "at connect, which is what would overwrite the instructions baked " +
        "into the client secret server-side.",
    ).toBe("");
  });

  test("an instructions getter returning undefined keeps the key off the wire", async () => {
    const { RealtimeAgent, RealtimeSession } = await import(
      "@openai/agents/realtime"
    );
    const guarded = new RealtimeAgent({
      name: "Examiner",
      instructions: (() => undefined) as unknown as () => string,
    });
    const config = await new RealtimeSession(guarded, {
      model: "gpt-realtime-2.1",
    }).getInitialSessionConfig();
    expect(config.instructions).toBeUndefined();
    expect(
      JSON.stringify(config),
      "An undefined value is dropped by JSON serialization, so the field " +
        "never reaches the server and the baked-in instructions stand.",
    ).not.toContain('"instructions"');
  });

  test("the live Session screen still builds its Examiner with that guard", () => {
    const source = sessionPageSource();
    const construction = /new RealtimeAgent\(\{([\s\S]*?)\}\)/.exec(source);
    expect(
      construction,
      `INV-1 BROKEN: no \`new RealtimeAgent({...})\` found in ${SESSION_PAGE}.`,
    ).not.toBeNull();

    const instructionsKey = /instructions:\s*([A-Za-z_$][\w$]*)/.exec(
      construction?.[1] ?? "",
    );
    expect(
      instructionsKey,
      "INV-1 BROKEN: the Examiner agent on the live Session screen no longer " +
        "passes an `instructions` guard. Without it the SDK sends " +
        '`instructions: ""` in the session.update it fires on connect, ' +
        "silently replacing the instructions that were assembled server-side " +
        "and baked into the client secret (PRD §4 INV-1 mechanism a). The " +
        "Session would still run — with an Examiner that has no instructions " +
        "at all. Restore `instructions: <a getter returning undefined>`.",
    ).not.toBeNull();

    const guardName = instructionsKey?.[1] ?? "";
    const guardDefinition = new RegExp(
      `const ${guardName}\\s*=[\\s\\S]{0,200}?\\(\\s*\\)\\s*=>\\s*undefined`,
    );
    expect(
      guardDefinition.test(source),
      `INV-1 BROKEN: \`${guardName}\` in ${SESSION_PAGE} no longer resolves ` +
        "to undefined. It must be a getter that returns undefined — that is " +
        "what makes the SDK omit `instructions` from the wire payload " +
        "instead of sending an empty string over the server-baked ones.",
    ).toBe(true);
  });

  test("the Examiner's instructions exist only on the server", () => {
    const clientHits = findAll(appSources, /You are the Examiner/);
    expect(
      clientHits.map((hit) => hit.file),
      "INV-1 BROKEN: the Examiner's instruction text appears in client code. " +
        "It is assembled in convex/examiner/instructions.ts, injected into " +
        "the short-lived client secret server-side, and never constructed or " +
        "visible client-side (PRD §4 INV-1 mechanism a).",
    ).toEqual([]);
  });
});
