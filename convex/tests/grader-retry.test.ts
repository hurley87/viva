// A Grader retry is one run, not two, and a sweep belongs to the run that
// scheduled it.
//
// The Grader is a scheduled ACTION, which Convex runs at most once, so every run
// is shadowed by an exactly-once MUTATION that turns a silently-dropped run into
// a visible `failed`. That sweep is the piece with the sharp edge: it fires ten
// minutes later, by which time a Teacher may already have retried, and a sweep
// scoped to the Assessment rather than to the run marks a healthy run failed for
// a stall that belonged to a run that is already over.

import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { TEACHER_DID, seedWorld } from "../../test/invariants/world";

const modules = import.meta.glob("../**/*.ts");

type World = Awaited<ReturnType<typeof seedWorld>>;


describe("a Grader retry is not double-run, and not failed by a stale sweep", () => {
  async function endedSessionWithAssessment(
    world: World,
    status: "pending" | "failed",
  ) {
    return await world.t.run(async (ctx) => {
      const sessionId = await ctx.db.insert("sessions", {
        studentId: world.ids.studentId,
        assignmentVersionId: world.ids.assignmentVersionId,
        status: "ended",
        startedAt: Date.now() - 600_000,
        endedAt: Date.now(),
        endReason: "student_hangup",
        countsAgainstCaps: true,
      });
      const assessmentId = await ctx.db.insert("assessments", {
        sessionId,
        status,
        released: true,
        graderRunAt: Date.now() - 1_000,
      });
      return { sessionId, assessmentId };
    });
  }

  test("a retry while a run is in flight is refused, not run alongside it", async () => {
    const world = await seedWorld(modules);
    const { sessionId } = await endedSessionWithAssessment(world, "pending");
    await expect(
      world.t
        .withIdentity({ subject: TEACHER_DID })
        .mutation(api.assessments.retry, { sessionId }),
      "Two Grader runs on one Session are two `grader` spendEvents against " +
        "the budget and two `recordComplete` writes of which the last wins — " +
        "so the Assessment the Teacher reads need not be the one whose spend " +
        "they were shown.",
    ).rejects.toThrow(/already in flight/);
  });

  test("a sweep from an earlier run does not fail the run that replaced it", async () => {
    const world = await seedWorld(modules);
    const { sessionId, assessmentId } = await endedSessionWithAssessment(
      world,
      "failed",
    );
    const staleRunAt = await world.t.run(async (ctx) => {
      const row = await ctx.db.get("assessments", assessmentId);
      return row?.graderRunAt ?? 0;
    });

    // The Teacher retries: a new run, a new identity, a new sweep.
    await world.t
      .withIdentity({ subject: TEACHER_DID })
      .mutation(api.assessments.retry, { sessionId });

    const acted = await world.t.mutation(internal.assessments.failIfStillPending, {
      assessmentId,
      graderRunAt: staleRunAt,
    });
    expect(
      acted,
      "The first run's sweep comes due long after the Teacher's retry began. " +
        "Scoped to the Assessment rather than to the run, it marks a healthy " +
        "run `failed` seconds after it started.",
    ).toBe(false);
    const still = await world.t.run(
      async (ctx) => await ctx.db.get("assessments", assessmentId),
    );
    expect(still?.status).toBe("pending");

    // The sweep that belongs to the current run still bites.
    const own = await world.t.mutation(internal.assessments.failIfStillPending, {
      assessmentId,
      graderRunAt: still?.graderRunAt ?? 0,
    });
    expect(own).toBe(true);
  });
});
