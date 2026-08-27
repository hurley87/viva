import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export const BREAKER_MESSAGE =
  "This month's Session budget is used up. New Sessions will open when the next budget period starts.";
export const DAILY_CAP_MESSAGE =
  "You've reached today's Session limit. Try again tomorrow.";
export const WEEKLY_CAP_MESSAGE =
  "You've reached this week's Session limit. Try again next week.";

export function utcMonthStartMs(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function sessionStartMs(session: Doc<"sessions">): number {
  return session.startedAt ?? session._creationTime;
}

function countsTowardCap(session: Doc<"sessions">): boolean {
  return session.countsAgainstCaps !== false;
}

export async function loadDeploymentConfig(ctx: QueryCtx | MutationCtx) {
  const config = await ctx.db.query("deploymentConfig").first();
  if (!config) {
    throw new Error("Deployment is not configured. Run seed.");
  }
  return config;
}

export async function sumSpendThisMonth(
  ctx: QueryCtx | MutationCtx,
  now: number,
): Promise<number> {
  const monthStart = utcMonthStartMs(now);
  const events = await ctx.db.query("spendEvents").take(4096);
  let total = 0;
  for (const event of events) {
    if (event._creationTime >= monthStart) {
      total += event.usd;
    }
  }
  return total;
}

export async function countCappedSessionsInWindow(
  ctx: QueryCtx | MutationCtx,
  studentId: Id<"users">,
  now: number,
  windowMs: number,
): Promise<number> {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .take(256);
  const cutoff = now - windowMs;
  let count = 0;
  for (const session of sessions) {
    if (!countsTowardCap(session)) {
      continue;
    }
    if (sessionStartMs(session) >= cutoff) {
      count += 1;
    }
  }
  return count;
}

export async function dailyCappedCount(
  ctx: QueryCtx | MutationCtx,
  studentId: Id<"users">,
  now: number,
): Promise<number> {
  return await countCappedSessionsInWindow(ctx, studentId, now, DAY_MS);
}

export async function weeklyCappedCount(
  ctx: QueryCtx | MutationCtx,
  studentId: Id<"users">,
  now: number,
): Promise<number> {
  return await countCappedSessionsInWindow(ctx, studentId, now, WEEK_MS);
}
