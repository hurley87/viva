// The Teacher dashboard's backend: convex/teacher.ts, plus the two functions
// in convex/assessments.ts the dashboard reuses (`getForTeacher` for the full
// Assessment, `release` for the shadow-period control).
//
// The acceptance criterion this file exists for is the third one on ticket #7:
// "Teacher-only: Student and Operator identities are rejected by every
// dashboard function." That is asserted exhaustively rather than for a
// representative sample — every dashboard function is checked against a
// Student, an Operator, an unauthenticated caller, and a voided Teacher, and
// checked to succeed for an active Teacher.
//
// It is asserted here rather than by hand because `npx convex run` carries an
// admin key and no user identity, so the one property that most needs proving
// is not reachable against a real deployment at all.

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const TEACHER = "did:privy:test-teacher";
const STUDENT = "did:privy:test-student";
const OPERATOR = "did:privy:test-operator";
const VOIDED_TEACHER = "did:privy:test-voided-teacher";

/**
 * A Standard descriptor that exists only so the tests can prove it never
 * reaches the dashboard. INV-3: the Teacher owns the Standard, but no
 * dashboard read has any reason to load it.
 */
const STANDARD_DESCRIPTOR =
  "The response names the trade-off and defends a side of it.";

const TRANSCRIPT = [
  { itemId: "item-1", orderKey: 0, speaker: "examiner", text: "In two minutes, what is your response to this Assignment, and why?" },
  { itemId: "item-2", orderKey: 1, speaker: "student", text: "I think the claim fails on its own terms." },
  { itemId: "item-3", orderKey: 2, speaker: "examiner", text: "On what grounds?" },
] as const;

type Setup = {
  releaseMode: "shadow" | "auto";
  assessment: "pending" | "complete" | "failed" | "none";
  seeded?: boolean;
};

async function setup(opts: Setup) {
  const t = convexTest(schema, modules);
  const seeded = opts.seeded ?? true;
  const ids = await t.run(async (ctx) => {
    if (seeded) {
      await ctx.db.insert("deploymentConfig", {
        sessionsPerDay: 2,
        sessionsPerWeek: 8,
        timeboxSec: 900,
        warningAtSec: 780,
        minDurationSec: 180,
        monthlyBudgetUsd: 5000,
        releaseMode: opts.releaseMode,
      });
    }

    const teacherId = await ctx.db.insert("users", {
      privyDid: TEACHER,
      email: "teacher@viva.local",
      displayName: "Dr Aldiss",
      role: "teacher",
      status: "active",
    });
    const studentId = await ctx.db.insert("users", {
      privyDid: STUDENT,
      email: "student@viva.local",
      displayName: "Rae Okonkwo",
      role: "student",
      status: "active",
    });
    await ctx.db.insert("users", {
      privyDid: OPERATOR,
      email: "operator@viva.local",
      displayName: "Operator",
      role: "operator",
      status: "active",
    });
    // A Teacher whose account was voided. Voiding is what closes the window in
    // which an already-issued access token still verifies, so it has to be
    // rejected exactly as hard as the wrong role is.
    await ctx.db.insert("users", {
      privyDid: VOIDED_TEACHER,
      email: "former-teacher@viva.local",
      displayName: "Former Teacher",
      role: "teacher",
      status: "voided",
    });

    const assignmentId = await ctx.db.insert("assignments", {
      title: "The trade-off in the second reading",
      teacherId,
    });
    const versionId = await ctx.db.insert("assignmentVersions", {
      assignmentId,
      version: 3,
      prompt: "Defend a position on the trade-off the second reading sets up.",
      publishedAt: Date.now(),
    });
    // Seeded so the INV-3 assertions have something that could leak.
    await ctx.db.insert("standards", {
      assignmentVersionId: versionId,
      criteria: [{ name: "Names the trade-off", descriptor: STANDARD_DESCRIPTOR }],
    });

    const endedAt = Date.now();
    const sessionId = await ctx.db.insert("sessions", {
      studentId,
      assignmentVersionId: versionId,
      status: "ended",
      startedAt: endedAt - 600_000,
      endedAt,
      endReason: "timebox",
      countsAgainstCaps: true,
    });
    for (const item of TRANSCRIPT) {
      await ctx.db.insert("transcriptItems", {
        sessionId,
        itemId: item.itemId,
        orderKey: item.orderKey,
        speaker: item.speaker,
        text: item.text,
        textStatus: "final",
      });
    }

    // A second Session that never connected: minted, forgiven by the
    // duration floor, and with no Assessment at all. The list has to render
    // it honestly rather than hide it.
    const abandonedId = await ctx.db.insert("sessions", {
      studentId,
      assignmentVersionId: versionId,
      status: "ended",
      endedAt: endedAt + 1_000,
      endReason: "disconnected",
      countsAgainstCaps: false,
    });

    let assessmentId: Id<"assessments"> | null = null;
    if (opts.assessment !== "none") {
      assessmentId = await ctx.db.insert("assessments", {
        sessionId,
        status: opts.assessment,
        released: opts.releaseMode === "auto",
        ...(opts.assessment === "complete"
          ? {
              criteria: [
                {
                  name: "Names the trade-off",
                  rating: "established" as const,
                  evidence: ["I think the claim fails on its own terms."],
                },
                {
                  name: "Handles the counter-case",
                  rating: "not_probed" as const,
                  evidence: [],
                },
              ],
              formativeSummary: "You held your position under pressure.",
              inv1Flags: [
                {
                  quote: "The usual answer here is that the trade-off is false.",
                  explanation:
                    "The Examiner supplied a position rather than probing for one.",
                },
              ],
              graderModel: "gpt-5.6-sol",
            }
          : {}),
      });
    }

    return { sessionId, abandonedId, assessmentId, studentId };
  });
  return { t, ...ids };
}

type Tester = Awaited<ReturnType<typeof setup>>["t"];

/**
 * Anything that can invoke a function: the tester itself (an unauthenticated
 * caller) or one of its identity-scoped clones.
 */
type Caller = Pick<Tester, "query" | "mutation">;

/**
 * Every function the dashboard calls, as a callable closure. The rejection
 * suite runs the whole list against every identity that must not reach it, so
 * a function added to the dashboard without being added here is a function
 * whose access is not proven.
 */
function dashboardCalls(sessionId: Id<"sessions">) {
  return [
    {
      name: "teacher.listSessions",
      call: (as: Caller) => as.query(api.teacher.listSessions, {}),
    },
    {
      name: "teacher.getSession",
      call: (as: Caller) => as.query(api.teacher.getSession, { sessionId }),
    },
    {
      name: "assessments.getForTeacher",
      call: (as: Caller) =>
        as.query(api.assessments.getForTeacher, { sessionId }),
    },
    {
      name: "assessments.release",
      call: (as: Caller) => as.mutation(api.assessments.release, { sessionId }),
    },
    {
      name: "assessments.retry",
      call: (as: Caller) => as.mutation(api.assessments.retry, { sessionId }),
    },
  ] as const;
}

// ---------------------------------------------------------------------------
// Acceptance criterion: Teacher-only
// ---------------------------------------------------------------------------

describe("every dashboard function is Teacher-only", () => {
  test("a Student is rejected by all of them", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const as = t.withIdentity({ subject: STUDENT });
    for (const { name, call } of dashboardCalls(sessionId)) {
      await expect(call(as), name).rejects.toThrow(/Forbidden/);
    }
  });

  test("an Operator is rejected by all of them", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const as = t.withIdentity({ subject: OPERATOR });
    for (const { name, call } of dashboardCalls(sessionId)) {
      await expect(call(as), name).rejects.toThrow(/Forbidden/);
    }
  });

  test("an unauthenticated caller is rejected by all of them", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    for (const { name, call } of dashboardCalls(sessionId)) {
      await expect(call(t), name).rejects.toThrow(/Not authenticated/);
    }
  });

  test("a voided Teacher is rejected by all of them", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const as = t.withIdentity({ subject: VOIDED_TEACHER });
    for (const { name, call } of dashboardCalls(sessionId)) {
      await expect(call(as), name).rejects.toThrow(/Not provisioned/);
    }
  });

  test("an unprovisioned but authenticated caller is rejected by all of them", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const as = t.withIdentity({ subject: "did:privy:nobody" });
    for (const { name, call } of dashboardCalls(sessionId)) {
      await expect(call(as), name).rejects.toThrow(/Not provisioned/);
    }
  });

  test("an active Teacher reaches all of them", async () => {
    // `retry` is the one call that refuses a complete Assessment on its own
    // merits, so this fixture leaves it `failed`: every call here must get
    // past the role check and do its job.
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "failed",
    });
    const as = t.withIdentity({ subject: TEACHER });
    await expect(as.query(api.teacher.listSessions, {})).resolves.toBeDefined();
    await expect(
      as.query(api.teacher.getSession, { sessionId }),
    ).resolves.toBeDefined();
    await expect(
      as.query(api.assessments.getForTeacher, { sessionId }),
    ).resolves.toBeDefined();
    await expect(
      as.mutation(api.assessments.retry, { sessionId }),
    ).resolves.toMatchObject({ status: "pending" });
  });
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

describe("teacher.listSessions", () => {
  test("lists every Session with its status, end reason and cap effect", async () => {
    const { t, sessionId, abandonedId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const result = await t
      .withIdentity({ subject: TEACHER })
      .query(api.teacher.listSessions, {});

    expect(result.releaseMode).toBe("shadow");
    expect(result.sessions).toHaveLength(2);

    const graded = result.sessions.find((row) => row._id === sessionId);
    expect(graded).toMatchObject({
      status: "ended",
      endReason: "timebox",
      countsAgainstCaps: true,
      studentName: "Rae Okonkwo",
      assignmentTitle: "The trade-off in the second reading",
      assignmentVersion: 3,
      assessment: {
        status: "complete",
        released: false,
        criterionCount: 2,
        inv1FlagCount: 1,
      },
    });
    expect(graded?.durationSec).toBeCloseTo(600, 0);

    const abandoned = result.sessions.find((row) => row._id === abandonedId);
    expect(abandoned).toMatchObject({
      endReason: "disconnected",
      countsAgainstCaps: false,
      // A Session that never connected gets no Assessment at all; the list
      // says so rather than inventing a pending one.
      assessment: null,
    });
  });

  test("newest first", async () => {
    const { t, abandonedId } = await setup({
      releaseMode: "auto",
      assessment: "complete",
    });
    const result = await t
      .withIdentity({ subject: TEACHER })
      .query(api.teacher.listSessions, {});
    expect(result.sessions[0]?._id).toBe(abandonedId);
  });

  test("a pending Assessment shows as pending with nothing counted", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      assessment: "pending",
    });
    const result = await t
      .withIdentity({ subject: TEACHER })
      .query(api.teacher.listSessions, {});
    expect(
      result.sessions.find((row) => row._id === sessionId)?.assessment,
    ).toMatchObject({ status: "pending", criterionCount: 0, inv1FlagCount: 0 });
  });

  test("a failed Assessment is reported as failed, with no invented reason", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "failed",
    });
    const result = await t
      .withIdentity({ subject: TEACHER })
      .query(api.teacher.listSessions, {});
    const row = result.sessions.find((one) => one._id === sessionId);
    expect(row?.assessment?.status).toBe("failed");
    expect(Object.keys(row?.assessment ?? {}).sort()).toEqual([
      "criterionCount",
      "inv1FlagCount",
      "released",
      "releasedAt",
      "status",
    ]);
  });

  test("an unseeded deployment reports a null release mode rather than failing", async () => {
    const { t } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
      seeded: false,
    });
    const result = await t
      .withIdentity({ subject: TEACHER })
      .query(api.teacher.listSessions, {});
    expect(result.releaseMode).toBeNull();
    expect(result.sessions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The detail view
// ---------------------------------------------------------------------------

describe("teacher.getSession", () => {
  test("returns the Session, the pinned prompt and the whole Transcript in order", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const detail = await t
      .withIdentity({ subject: TEACHER })
      .query(api.teacher.getSession, { sessionId });

    expect(detail?.session._id).toBe(sessionId);
    expect(detail?.assignmentPrompt).toBe(
      "Defend a position on the trade-off the second reading sets up.",
    );
    expect(detail?.transcript.map((row) => row.itemId)).toEqual([
      "item-1",
      "item-2",
      "item-3",
    ]);
    expect(detail?.transcript[1]).toMatchObject({
      speaker: "student",
      text: "I think the claim fails on its own terms.",
      textStatus: "final",
    });
  });

  test("the full Assessment, with evidence and the INV-1 audit, is reachable", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const assessment = await t
      .withIdentity({ subject: TEACHER })
      .query(api.assessments.getForTeacher, { sessionId });

    expect(assessment?.criteria).toEqual([
      {
        name: "Names the trade-off",
        rating: "established",
        evidence: ["I think the claim fails on its own terms."],
      },
      { name: "Handles the counter-case", rating: "not_probed", evidence: [] },
    ]);
    expect(assessment?.formativeSummary).toBe(
      "You held your position under pressure.",
    );
    expect(assessment?.inv1Flags).toHaveLength(1);
  });

  test("a Session with no Transcript returns an empty one, not an error", async () => {
    const { t, abandonedId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const detail = await t
      .withIdentity({ subject: TEACHER })
      .query(api.teacher.getSession, { sessionId: abandonedId });
    expect(detail?.transcript).toEqual([]);
    expect(detail?.session.assessment).toBeNull();
  });

  test("a Session id that does not exist returns null", async () => {
    const { t, abandonedId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("sessions", abandonedId);
    });
    const detail = await t
      .withIdentity({ subject: TEACHER })
      .query(api.teacher.getSession, { sessionId: abandonedId });
    expect(detail).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The shadow-period release control
// ---------------------------------------------------------------------------

describe("the release control", () => {
  test("shadow: the dashboard shows unreleased, and the Teacher releases it", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const as = t.withIdentity({ subject: TEACHER });

    const before = await as.query(api.teacher.listSessions, {});
    expect(before.releaseMode).toBe("shadow");
    expect(
      before.sessions.find((row) => row._id === sessionId)?.assessment,
    ).toMatchObject({ released: false, releasedAt: null });

    const result = await as.mutation(api.assessments.release, { sessionId });
    expect(result.released).toBe(true);

    const after = await as.query(api.teacher.listSessions, {});
    expect(
      after.sessions.find((row) => row._id === sessionId)?.assessment,
    ).toMatchObject({ released: true, releasedAt: result.releasedAt });

    // And it has actually reached the Student, which is the point of the
    // control.
    const student = await t
      .withIdentity({ subject: STUDENT })
      .query(api.assessments.forStudent, { sessionId });
    expect(student?.formativeSummary).toBe(
      "You held your position under pressure.",
    );
  });

  test("auto: the Assessment is already released, so there is nothing to do", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      assessment: "complete",
    });
    const result = await t
      .withIdentity({ subject: TEACHER })
      .query(api.teacher.listSessions, {});
    expect(result.releaseMode).toBe("auto");
    expect(
      result.sessions.find((row) => row._id === sessionId)?.assessment
        ?.released,
    ).toBe(true);
  });

  test("shadow: an Assessment that is not complete cannot be released", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "pending",
    });
    await expect(
      t
        .withIdentity({ subject: TEACHER })
        .mutation(api.assessments.release, { sessionId }),
    ).rejects.toThrow(/only a complete Assessment/);
  });
});

// ---------------------------------------------------------------------------
// INV-3: no Standard reaches the dashboard
// ---------------------------------------------------------------------------

describe("INV-3", () => {
  test("no dashboard read carries any Standard content", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      assessment: "complete",
    });
    const as = t.withIdentity({ subject: TEACHER });
    const payloads = [
      await as.query(api.teacher.listSessions, {}),
      await as.query(api.teacher.getSession, { sessionId }),
      await as.query(api.assessments.getForTeacher, { sessionId }),
    ];
    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toContain(STANDARD_DESCRIPTOR);
    }
  });
});
