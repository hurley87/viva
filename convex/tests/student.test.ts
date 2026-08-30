// The Student projection (PRD §8), proved rather than asserted.
//
// The acceptance criterion this file exists for is a negative one: no
// Student-callable function can return per-Criterion ratings, INV-1 flags,
// Standard content, or another Student's anything. A negative is not provable
// by reading the happy path, so these tests do three things a page-level check
// cannot:
//
//   1. assert on the KEYS of what actually came back, not just on the fields
//      the caller happened to look at;
//   2. walk every returned value recursively for Teacher-only key names and for
//      the verbatim text of a seeded Standard;
//   3. call the whole public Student read surface — every `query` in the
//      codebase a Student can reach — not only the new one.
//
// `npx convex run` carries an admin key and no user identity, so none of this
// is reachable against a real deployment; convex-test is the only place these
// can be stated at all.

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const TEACHER = "did:privy:test-teacher";
const STUDENT = "did:privy:test-student";
const OTHER_STUDENT = "did:privy:test-other-student";
const OPERATOR = "did:privy:test-operator";

/** Text seeded into the Standard. It must never appear in a Student's reply. */
const STANDARD_CRITERION_NAME = "SECRET-CRITERION-NAME";
const STANDARD_DESCRIPTOR = "SECRET-DESCRIPTOR-TEXT";

/** Text seeded into the Teacher-only half of the Assessment. */
const EVIDENCE_QUOTE = "SECRET-EVIDENCE-QUOTE";
const INV1_QUOTE = "SECRET-INV1-QUOTE";

const SUMMARY = "You held your position when the Examiner pressed on it.";

/**
 * Key names that belong to the Teacher's half of an Assessment or to the
 * Standard. Any of them, at any depth, in anything a Student is handed is the
 * failure this suite is looking for.
 */
const FORBIDDEN_KEYS = [
  "criteria",
  "criterion",
  "rating",
  "ratings",
  "evidence",
  "inv1Flags",
  "graderModel",
  "standard",
  "standardId",
  "descriptor",
  "studentId",
  "teacherId",
  "privyDid",
];

/** Every key path in `value` whose leaf name is Teacher-only. */
function forbiddenKeyPaths(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => forbiddenKeyPaths(item, `${path}[${i}]`));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const found: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      found.push(`${path}.${key}`);
    }
    found.push(...forbiddenKeyPaths(child, `${path}.${key}`));
  }
  return found;
}

/** Every seeded secret that turns up anywhere in the serialized value. */
function leakedSecrets(value: unknown): string[] {
  const serialized = JSON.stringify(value ?? null);
  return [
    STANDARD_CRITERION_NAME,
    STANDARD_DESCRIPTOR,
    EVIDENCE_QUOTE,
    INV1_QUOTE,
  ].filter((secret) => serialized.includes(secret));
}

type SetupOptions = {
  releaseMode: "shadow" | "auto";
  /** `null` seeds no Assessment at all — the Session that never connected. */
  assessmentStatus: "pending" | "complete" | "failed" | null;
  /** `false` leaves the Session live, so it has not been assessed yet. */
  ended?: boolean;
};

async function setup(opts: SetupOptions) {
  const t = convexTest(schema, modules);
  const ended = opts.ended ?? true;
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("deploymentConfig", {
      sessionsPerDay: 2,
      sessionsPerWeek: 8,
      timeboxSec: 900,
      warningAtSec: 780,
      minDurationSec: 180,
      monthlyBudgetUsd: 5000,
      releaseMode: opts.releaseMode,
    });
    const userIds: Record<string, Id<"users">> = {};
    for (const [did, role, name] of [
      [TEACHER, "teacher", "teacher"],
      [STUDENT, "student", "student"],
      [OTHER_STUDENT, "student", "other student"],
      [OPERATOR, "operator", "operator"],
    ] as const) {
      userIds[did] = await ctx.db.insert("users", {
        privyDid: did,
        email: `${did}@viva.local`,
        displayName: name,
        role,
        status: "active",
      });
    }
    const assignmentId = await ctx.db.insert("assignments", {
      title: "The Assignment",
      teacherId: userIds[TEACHER],
    });
    const versionId = await ctx.db.insert("assignmentVersions", {
      assignmentId,
      version: 1,
      prompt: "Defend your reading of the passage.",
      publishedAt: Date.now(),
    });
    // The private Standard. Nothing a Student calls may surface a byte of it
    // (INV-3, PRD §6). Inserted directly rather than through its module, which
    // this suite deliberately does not import.
    await ctx.db.insert("standards", {
      assignmentVersionId: versionId,
      criteria: [
        { name: STANDARD_CRITERION_NAME, descriptor: STANDARD_DESCRIPTOR },
      ],
    });

    const startedAt = Date.now() - 600_000;
    const sessionId = await ctx.db.insert("sessions", {
      studentId: userIds[STUDENT],
      assignmentVersionId: versionId,
      status: ended ? "ended" : "live",
      startedAt,
      ...(ended
        ? {
            endedAt: Date.now(),
            endReason: "student_hangup" as const,
            countsAgainstCaps: true,
          }
        : {}),
    });
    for (const [i, item] of [
      ["examiner", "In two minutes, what is your response?", "final"],
      ["student", "My reading is that the narrator is unreliable.", "final"],
      ["student", "", "failed"],
    ].entries()) {
      const [speaker, text, textStatus] = item as [
        "examiner" | "student",
        string,
        "final" | "failed" | "truncated",
      ];
      await ctx.db.insert("transcriptItems", {
        sessionId,
        itemId: `item_${i}`,
        orderKey: i,
        speaker,
        text,
        textStatus,
      });
    }

    // A second Student's Session, with its own Transcript and Assessment.
    const otherSessionId = await ctx.db.insert("sessions", {
      studentId: userIds[OTHER_STUDENT],
      assignmentVersionId: versionId,
      status: "ended",
      startedAt,
      endedAt: Date.now(),
      endReason: "timebox" as const,
      countsAgainstCaps: true,
    });
    await ctx.db.insert("transcriptItems", {
      sessionId: otherSessionId,
      itemId: "other_item_0",
      orderKey: 0,
      speaker: "student",
      text: "Somebody else's words.",
      textStatus: "final",
    });
    await ctx.db.insert("assessments", {
      sessionId: otherSessionId,
      status: "complete",
      released: true,
      formativeSummary: "Somebody else's summary.",
      criteria: [],
      inv1Flags: [],
      graderModel: "gpt-5.6-sol",
    });

    let assessmentId: Id<"assessments"> | null = null;
    if (opts.assessmentStatus !== null) {
      assessmentId = await ctx.db.insert("assessments", {
        sessionId,
        status: opts.assessmentStatus,
        released: opts.releaseMode === "auto",
        ...(opts.assessmentStatus === "complete"
          ? {
              criteria: [
                {
                  name: STANDARD_CRITERION_NAME,
                  rating: "established" as const,
                  evidence: [EVIDENCE_QUOTE],
                },
              ],
              formativeSummary: SUMMARY,
              inv1Flags: [
                { quote: INV1_QUOTE, explanation: STANDARD_DESCRIPTOR },
              ],
              graderModel: "gpt-5.6-sol",
            }
          : {}),
      });
    }
    return { sessionId, otherSessionId, assessmentId };
  });
  return { t, ...ids };
}

// ---------------------------------------------------------------------------
// The states the feedback view has to tell apart
// ---------------------------------------------------------------------------

describe("the Student's feedback view", () => {
  test("released: the formative summary and the Student's own Transcript", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      assessmentStatus: "complete",
    });
    const view = await t
      .withIdentity({ subject: STUDENT })
      .query(api.student.feedbackForSession, { sessionId });

    expect(view.state).toBe("released");
    expect(view.assessment?.formativeSummary).toBe(SUMMARY);
    expect(view.transcript.map((turn) => turn.speaker)).toEqual([
      "examiner",
      "student",
      "student",
    ]);
    // The ASR failure is carried honestly rather than dropped.
    expect(view.transcript[2]).toMatchObject({ text: "", textStatus: "failed" });
    expect(view.session.assignmentTitle).toBe("The Assignment");
    expect(view.assignmentPrompt).toBe("Defend your reading of the passage.");
  });

  test("released: the returned object's KEYS carry nothing Teacher-only", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      assessmentStatus: "complete",
    });
    const view = await t
      .withIdentity({ subject: STUDENT })
      .query(api.student.feedbackForSession, { sessionId });

    expect(Object.keys(view.assessment ?? {}).sort()).toEqual([
      "formativeSummary",
      "released",
      "status",
    ]);
    expect(Object.keys(view).sort()).toEqual([
      "assessment",
      "assignmentPrompt",
      "session",
      "state",
      "transcript",
    ]);
    expect(Object.keys(view.session).sort()).toEqual([
      "assignmentTitle",
      "assignmentVersion",
      "countsAgainstCaps",
      "createdAt",
      "durationSec",
      "endReason",
      "endedAt",
      "sessionId",
      "startedAt",
      "status",
    ]);
    expect(Object.keys(view.transcript[0]).sort()).toEqual([
      "itemId",
      "orderKey",
      "speaker",
      "text",
      "textStatus",
    ]);
    expect(forbiddenKeyPaths(view)).toEqual([]);
    expect(leakedSecrets(view)).toEqual([]);
  });

  test("unreleased (shadow period): Transcript yes, formative summary no", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessmentStatus: "complete",
    });
    const view = await t
      .withIdentity({ subject: STUDENT })
      .query(api.student.feedbackForSession, { sessionId });

    expect(view.state).toBe("awaiting_release");
    expect(view.assessment).toMatchObject({
      status: "complete",
      released: false,
      formativeSummary: null,
    });
    expect(view.transcript).toHaveLength(3);
    expect(leakedSecrets(view)).toEqual([]);
  });

  test("pending, failed, no Assessment and a live Session are distinct states", async () => {
    for (const [assessmentStatus, expected] of [
      ["pending", "pending"],
      ["failed", "failed"],
      [null, "no_assessment"],
    ] as const) {
      const { t, sessionId } = await setup({
        releaseMode: "auto",
        assessmentStatus,
      });
      const view = await t
        .withIdentity({ subject: STUDENT })
        .query(api.student.feedbackForSession, { sessionId });
      expect(view.state).toBe(expected);
      expect(view.assessment?.formativeSummary ?? null).toBeNull();
    }

    const live = await setup({
      releaseMode: "auto",
      assessmentStatus: null,
      ended: false,
    });
    const view = await live.t
      .withIdentity({ subject: STUDENT })
      .query(api.student.feedbackForSession, { sessionId: live.sessionId });
    expect(view.state).toBe("session_not_ended");
  });

  test("a released-but-pending Assessment still reads as pending", async () => {
    // `released` is decided at creation from the deployment's release mode, so
    // in "auto" a Session's Assessment is released before the Grader has
    // written anything. The state must not claim there is a summary to read.
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      assessmentStatus: "pending",
    });
    const view = await t
      .withIdentity({ subject: STUDENT })
      .query(api.student.feedbackForSession, { sessionId });
    expect(view.assessment).toMatchObject({
      status: "pending",
      released: true,
      formativeSummary: null,
    });
    expect(view.state).toBe("pending");
  });

  test("feedbackStates covers the caller's own Sessions and no others", async () => {
    const { t, sessionId, otherSessionId } = await setup({
      releaseMode: "shadow",
      assessmentStatus: "complete",
    });
    const states = await t
      .withIdentity({ subject: STUDENT })
      .query(api.student.feedbackStates, {});
    expect(states).toEqual([
      { sessionId, state: "awaiting_release" },
    ]);
    expect(states.map((row) => row.sessionId)).not.toContain(otherSessionId);
  });
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

describe("one Student cannot reach another Student's Session", () => {
  test("every Student-callable read of somebody else's Session throws", async () => {
    const { t, otherSessionId } = await setup({
      releaseMode: "auto",
      assessmentStatus: "complete",
    });
    const intruder = t.withIdentity({ subject: STUDENT });
    const reads = [
      () =>
        intruder.query(api.student.feedbackForSession, {
          sessionId: otherSessionId,
        }),
      () =>
        intruder.query(api.transcript.forSession, {
          sessionId: otherSessionId,
        }),
      () =>
        intruder.query(api.assessments.forStudent, {
          sessionId: otherSessionId,
        }),
      () =>
        intruder.query(api.sessions.getForStudent, {
          sessionId: otherSessionId,
        }),
    ];
    for (const read of reads) {
      await expect(read()).rejects.toThrow(
        /that Session does not belong to you/,
      );
    }
  });

  test("the refusal does not reveal whether a Session id exists", async () => {
    const { t, sessionId, otherSessionId } = await setup({
      releaseMode: "auto",
      assessmentStatus: "complete",
    });
    // Delete one Session so the two ids differ in existence, not in ownership.
    await t.run(async (ctx) => {
      await ctx.db.delete("sessions", otherSessionId);
    });
    const intruder = t.withIdentity({ subject: OTHER_STUDENT });
    const missing = await intruder
      .query(api.student.feedbackForSession, { sessionId: otherSessionId })
      .catch((error: Error) => error.message);
    const foreign = await intruder
      .query(api.student.feedbackForSession, { sessionId })
      .catch((error: Error) => error.message);
    expect(missing).toBe(foreign);
  });

  test("only a Student may call the Student surface", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      assessmentStatus: "complete",
    });
    for (const subject of [TEACHER, OPERATOR]) {
      await expect(
        t
          .withIdentity({ subject })
          .query(api.student.feedbackForSession, { sessionId }),
      ).rejects.toThrow(/Forbidden/);
      await expect(
        t.withIdentity({ subject }).query(api.student.feedbackStates, {}),
      ).rejects.toThrow(/Forbidden/);
    }
    await expect(
      t.query(api.student.feedbackForSession, { sessionId }),
    ).rejects.toThrow(/Not authenticated/);
  });

  test("a voided Student is refused as if they had no account", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      assessmentStatus: "complete",
    });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("users")
        .withIndex("by_privyDid", (q) => q.eq("privyDid", STUDENT))
        .unique();
      await ctx.db.patch("users", row!._id, { status: "voided" });
    });
    await expect(
      t
        .withIdentity({ subject: STUDENT })
        .query(api.student.feedbackForSession, { sessionId }),
    ).rejects.toThrow(/Not provisioned/);
  });
});

// ---------------------------------------------------------------------------
// The whole public Student read surface, swept
// ---------------------------------------------------------------------------

describe("the Student-callable read surface as a whole", () => {
  test("no public query returns Standard content, ratings or INV-1 flags", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      assessmentStatus: "complete",
    });
    const student = t.withIdentity({ subject: STUDENT });

    // Every `query` in convex/ that a signed-in Student can reach. If a new
    // one is added, add it here — this list is the enumeration the projection
    // criterion is checked against.
    const surface: Record<string, unknown> = {
      "users.me": await student.query(api.users.me, {}),
      "deployment.readiness": await student.query(api.deployment.readiness, {}),
      "assignments.listForStudent": await student.query(
        api.assignments.listForStudent,
        {},
      ),
      "sessions.mine": await student.query(api.sessions.mine, {}),
      "sessions.getForStudent": await student.query(
        api.sessions.getForStudent,
        { sessionId },
      ),
      "transcript.forSession": await student.query(api.transcript.forSession, {
        sessionId,
      }),
      "assessments.forStudent": await student.query(
        api.assessments.forStudent,
        { sessionId },
      ),
      "student.feedbackForSession": await student.query(
        api.student.feedbackForSession,
        { sessionId },
      ),
      "student.feedbackStates": await student.query(
        api.student.feedbackStates,
        {},
      ),
    };

    for (const [name, value] of Object.entries(surface)) {
      expect({ name, keys: forbiddenKeyPaths(value) }).toEqual({
        name,
        keys: [],
      });
      expect({ name, leaked: leakedSecrets(value) }).toEqual({
        name,
        leaked: [],
      });
    }
  });

  test("the Teacher-only read is closed to a Student and does carry the rest", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      assessmentStatus: "complete",
    });
    await expect(
      t
        .withIdentity({ subject: STUDENT })
        .query(api.assessments.getForTeacher, { sessionId }),
    ).rejects.toThrow(/Forbidden/);

    // The control: the Teacher-only projection really does hold the things the
    // Student's cannot, so the sweep above is testing something.
    const full = await t
      .withIdentity({ subject: TEACHER })
      .query(api.assessments.getForTeacher, { sessionId });
    expect(leakedSecrets(full).sort()).toEqual(
      [EVIDENCE_QUOTE, INV1_QUOTE, STANDARD_CRITERION_NAME, STANDARD_DESCRIPTOR]
        .sort(),
    );
    // …and the key sweep is not vacuous either: it finds them here.
    expect(forbiddenKeyPaths(full)).toEqual(
      expect.arrayContaining([
        "$.criteria",
        "$.criteria[0].rating",
        "$.criteria[0].evidence",
        "$.inv1Flags",
        "$.graderModel",
      ]),
    );
  });
});
