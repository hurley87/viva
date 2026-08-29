// The Teacher-authenticated half of convex/assessments.ts: the shadow-period
// release, the retry path, and who may see what.
//
// These live here rather than in a manual check because `npx convex run`
// carries an admin key and no user identity, so the one thing that most needs
// proving — that release is a *Teacher* action and the Student projection
// cannot be widened by asking differently — is not reachable against a real
// deployment at all.
//
// Scope note: this is not the INV-1..4 invariant suite (ticket #8 owns that,
// including the static INV-3 check that `convex/grader/**` is the only reader
// of the Standard). Fold these in there if it helps.

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const TEACHER = "did:privy:test-teacher";
const STUDENT = "did:privy:test-student";
const OPERATOR = "did:privy:test-operator";

async function setup(opts: {
  releaseMode: "shadow" | "auto";
  status: "pending" | "complete" | "failed";
}) {
  const t = convexTest(schema, modules);
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
    for (const [did, role] of [
      [TEACHER, "teacher"],
      [STUDENT, "student"],
      [OPERATOR, "operator"],
    ] as const) {
      await ctx.db.insert("users", {
        privyDid: did,
        email: `${role}@viva.local`,
        displayName: role,
        role,
        status: "active",
      });
    }
    const studentRow = await ctx.db
      .query("users")
      .withIndex("by_privyDid", (q) => q.eq("privyDid", STUDENT))
      .unique();
    const teacherRow = await ctx.db
      .query("users")
      .withIndex("by_privyDid", (q) => q.eq("privyDid", TEACHER))
      .unique();
    const assignmentId = await ctx.db.insert("assignments", {
      title: "Probe",
      teacherId: teacherRow!._id,
    });
    const versionId = await ctx.db.insert("assignmentVersions", {
      assignmentId,
      version: 1,
      prompt: "Probe prompt",
      publishedAt: Date.now(),
    });
    const sessionId = await ctx.db.insert("sessions", {
      studentId: studentRow!._id,
      assignmentVersionId: versionId,
      status: "ended",
      startedAt: Date.now() - 600_000,
      endedAt: Date.now(),
      endReason: "student_hangup",
      countsAgainstCaps: true,
    });
    const assessmentId = await ctx.db.insert("assessments", {
      sessionId,
      status: opts.status,
      released: opts.releaseMode === "auto",
      ...(opts.status === "complete"
        ? {
            criteria: [
              {
                name: "Clear position",
                rating: "established" as const,
                evidence: ["I disagree with the claim."],
              },
            ],
            formativeSummary: "You held your position under pressure.",
            inv1Flags: [],
            graderModel: "gpt-5.6-sol",
          }
        : {}),
    });
    return { sessionId, assessmentId };
  });
  return { t, ...ids };
}

async function released(
  t: Awaited<ReturnType<typeof setup>>["t"],
  assessmentId: Id<"assessments">,
) {
  return await t.run(async (ctx) => {
    const row = await ctx.db.get("assessments", assessmentId);
    return {
      released: row!.released,
      releasedAt: row!.releasedAt ?? null,
      status: row!.status,
    };
  });
}

describe("shadow period release", () => {
  test("shadow: released=false until the Teacher releases", async () => {
    const { t, sessionId, assessmentId } = await setup({
      releaseMode: "shadow",
      status: "complete",
    });
    expect(await released(t, assessmentId)).toMatchObject({
      released: false,
      releasedAt: null,
    });

    // The Student sees nothing while it is unreleased.
    const before = await t
      .withIdentity({ subject: STUDENT })
      .query(api.assessments.forStudent, { sessionId });
    expect(before).toMatchObject({
      status: "complete",
      released: false,
      formativeSummary: null,
    });

    const result = await t
      .withIdentity({ subject: TEACHER })
      .mutation(api.assessments.release, { sessionId });
    expect(result.released).toBe(true);
    expect(result.releasedAt).toBeGreaterThan(0);

    const after = await released(t, assessmentId);
    expect(after.released).toBe(true);
    expect(after.releasedAt).toBe(result.releasedAt);

    const student = await t
      .withIdentity({ subject: STUDENT })
      .query(api.assessments.forStudent, { sessionId });
    expect(student).toMatchObject({
      released: true,
      formativeSummary: "You held your position under pressure.",
    });
  });

  test("auto: released=true from creation, no Teacher action", async () => {
    const { t, sessionId, assessmentId } = await setup({
      releaseMode: "auto",
      status: "complete",
    });
    expect((await released(t, assessmentId)).released).toBe(true);
    const student = await t
      .withIdentity({ subject: STUDENT })
      .query(api.assessments.forStudent, { sessionId });
    expect(student?.formativeSummary).toBe(
      "You held your position under pressure.",
    );
  });

  test("release is idempotent", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      status: "complete",
    });
    const teacher = t.withIdentity({ subject: TEACHER });
    const first = await teacher.mutation(api.assessments.release, {
      sessionId,
    });
    const second = await teacher.mutation(api.assessments.release, {
      sessionId,
    });
    expect(second.releasedAt).toBe(first.releasedAt);
  });

  test("a Student cannot release, and neither can an Operator", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      status: "complete",
    });
    await expect(
      t
        .withIdentity({ subject: STUDENT })
        .mutation(api.assessments.release, { sessionId }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      t
        .withIdentity({ subject: OPERATOR })
        .mutation(api.assessments.release, { sessionId }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      t.mutation(api.assessments.release, { sessionId }),
    ).rejects.toThrow(/Not authenticated/);
  });

  test("a failed Assessment cannot be released", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      status: "failed",
    });
    await expect(
      t
        .withIdentity({ subject: TEACHER })
        .mutation(api.assessments.release, { sessionId }),
    ).rejects.toThrow(/only a complete Assessment/);
  });
});

describe("retry", () => {
  test("a Teacher can retry a failed Assessment; it returns to pending", async () => {
    const { t, sessionId, assessmentId } = await setup({
      releaseMode: "shadow",
      status: "failed",
    });
    const result = await t
      .withIdentity({ subject: TEACHER })
      .mutation(api.assessments.retry, { sessionId });
    expect(result).toMatchObject({ assessmentId, status: "pending" });
    expect((await released(t, assessmentId)).status).toBe("pending");
  });

  test("retry creates the row for a Session that had none", async () => {
    const { t, sessionId, assessmentId } = await setup({
      releaseMode: "shadow",
      status: "failed",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("assessments", assessmentId);
    });
    const result = await t
      .withIdentity({ subject: TEACHER })
      .mutation(api.assessments.retry, { sessionId });
    expect(result.created).toBe(true);
    expect((await released(t, result.assessmentId)).released).toBe(false);
  });

  test("a complete Assessment is not re-run, and a Student cannot retry", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "shadow",
      status: "complete",
    });
    await expect(
      t
        .withIdentity({ subject: TEACHER })
        .mutation(api.assessments.retry, { sessionId }),
    ).rejects.toThrow(/already complete/);
    await expect(
      t
        .withIdentity({ subject: STUDENT })
        .mutation(api.assessments.retry, { sessionId }),
    ).rejects.toThrow(/Forbidden/);
  });
});

describe("teacher read surface", () => {
  test("the Teacher sees ratings and INV-1 flags; the Student never can", async () => {
    const { t, sessionId } = await setup({
      releaseMode: "auto",
      status: "complete",
    });
    const full = await t
      .withIdentity({ subject: TEACHER })
      .query(api.assessments.getForTeacher, { sessionId });
    expect(full?.criteria?.[0]?.rating).toBe("established");
    expect(full?.inv1Flags).toEqual([]);
    await expect(
      t
        .withIdentity({ subject: STUDENT })
        .query(api.assessments.getForTeacher, { sessionId }),
    ).rejects.toThrow(/Forbidden/);
    const student = await t
      .withIdentity({ subject: STUDENT })
      .query(api.assessments.forStudent, { sessionId });
    expect(Object.keys(student ?? {}).sort()).toEqual([
      "formativeSummary",
      "released",
      "status",
    ]);
  });
});
