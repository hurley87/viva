import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  BREAKER_MESSAGE,
  DAILY_CAP_MESSAGE,
  WEEKLY_CAP_MESSAGE,
} from "../lib/caps";
import schema from "../schema";
import { identity, seedWorld } from "../test.fixtures";
import { modules } from "../test.setup";

function setup() {
  return convexTest(schema, modules);
}

async function sessionCount(
  t: ReturnType<typeof convexTest>,
  studentId: Id<"users">,
): Promise<number> {
  return await t.run(async (ctx) => {
    return (
      await ctx.db
        .query("sessions")
        .withIndex("by_student", (q) => q.eq("studentId", studentId))
        .take(256)
    ).length;
  });
}

test("daily cap exceeded returns a friendly refusal and does not mint", async () => {
  const t = setup();
  const studentId = await t.run(async (ctx) => {
    const world = await seedWorld(ctx);
    const now = Date.now();
    for (let i = 0; i < 2; i += 1) {
      await ctx.db.insert("sessions", {
        studentId: world.studentId,
        assignmentVersionId: world.assignmentVersionId,
        status: "ended",
        startedAt: now - 60_000,
        endedAt: now,
        endReason: "student_hangup",
        openaiCallId: `call_day_${i}`,
        countsAgainstCaps: true,
      });
    }
    return world.studentId;
  });

  const asStudent = t.withIdentity(identity.student);
  const before = await sessionCount(t, studentId);
  const result = await asStudent.mutation(api.sessions.mint, {});
  expect(result).toEqual({
    ok: false,
    code: "daily_cap",
    message: DAILY_CAP_MESSAGE,
  });
  expect(await sessionCount(t, studentId)).toBe(before);
});

test("weekly cap exceeded returns a friendly refusal", async () => {
  const t = setup();
  await t.run(async (ctx) => {
    const world = await seedWorld(ctx, {
      config: { sessionsPerDay: 20, sessionsPerWeek: 8 },
    });
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 8; i += 1) {
      await ctx.db.insert("sessions", {
        studentId: world.studentId,
        assignmentVersionId: world.assignmentVersionId,
        status: "ended",
        startedAt: twoDaysAgo,
        endedAt: twoDaysAgo + 240_000,
        endReason: "student_hangup",
        openaiCallId: `call_week_${i}`,
        countsAgainstCaps: true,
      });
    }
  });

  const asStudent = t.withIdentity(identity.student);
  const result = await asStudent.mutation(api.sessions.mint, {});
  expect(result).toEqual({
    ok: false,
    code: "weekly_cap",
    message: WEEKLY_CAP_MESSAGE,
  });
});

test("breaker blocks new mints only and never ends a live Session", async () => {
  const t = setup();
  const liveSessionId = await t.run(async (ctx) => {
    const world = await seedWorld(ctx);
    const liveId = await ctx.db.insert("sessions", {
      studentId: world.studentId,
      assignmentVersionId: world.assignmentVersionId,
      status: "live",
      startedAt: Date.now() - 30_000,
      openaiCallId: "call_live",
    });
    await ctx.db.insert("spendEvents", {
      kind: "realtime",
      sessionId: liveId,
      usd: 2500,
    });
    await ctx.db.insert("spendEvents", {
      kind: "grader",
      sessionId: liveId,
      usd: 2500,
    });
    return liveId;
  });

  const asStudent = t.withIdentity(identity.student);
  const result = await asStudent.mutation(api.sessions.mint, {});
  expect(result).toEqual({
    ok: false,
    code: "breaker",
    message: BREAKER_MESSAGE,
  });

  const live = await t.run(async (ctx) => {
    return await ctx.db.get("sessions", liveSessionId);
  });
  expect(live?.status).toBe("live");
  expect(live?.endedAt).toBeUndefined();
});

test("sub-floor Sessions do not count against caps", async () => {
  const t = setup();
  const sessionId = await t.run(async (ctx) => {
    const world = await seedWorld(ctx);
    return await ctx.db.insert("sessions", {
      studentId: world.studentId,
      assignmentVersionId: world.assignmentVersionId,
      status: "live",
      startedAt: Date.now() - 179_000,
      openaiCallId: "call_short",
    });
  });

  const asStudent = t.withIdentity(identity.student);
  await asStudent.mutation(api.sessions.end, {
    sessionId,
    reason: "disconnected",
  });

  const session = await t.run(async (ctx) => {
    return await ctx.db.get("sessions", sessionId);
  });
  expect(session?.status).toBe("ended");
  expect(session?.countsAgainstCaps).toBe(false);

  const mint = await asStudent.mutation(api.sessions.mint, {});
  expect(mint.ok).toBe(true);
});

test("Sessions at or above the duration floor count against caps", async () => {
  const t = setup();
  const sessionId = await t.run(async (ctx) => {
    const world = await seedWorld(ctx);
    return await ctx.db.insert("sessions", {
      studentId: world.studentId,
      assignmentVersionId: world.assignmentVersionId,
      status: "live",
      startedAt: Date.now() - 180_000,
      openaiCallId: "call_floor",
    });
  });

  const asStudent = t.withIdentity(identity.student);
  await asStudent.mutation(api.sessions.end, {
    sessionId,
    reason: "student_request",
  });

  const session = await t.run(async (ctx) => {
    return await ctx.db.get("sessions", sessionId);
  });
  expect(session?.countsAgainstCaps).toBe(true);
});

test("realtime and grader spend both count against the monthly breaker", async () => {
  const t = setup();
  await t.run(async (ctx) => {
    await seedWorld(ctx, { config: { monthlyBudgetUsd: 10 } });
    await ctx.db.insert("spendEvents", { kind: "realtime", usd: 4 });
    await ctx.db.insert("spendEvents", { kind: "grader", usd: 4 });
  });

  const asStudent = t.withIdentity(identity.student);
  const under = await asStudent.mutation(api.sessions.mint, {});
  expect(under.ok).toBe(true);

  await t.run(async (ctx) => {
    await ctx.db.insert("spendEvents", { kind: "grader", usd: 3 });
  });

  const over = await asStudent.mutation(api.sessions.mint, {});
  expect(over).toEqual({
    ok: false,
    code: "breaker",
    message: BREAKER_MESSAGE,
  });
});
