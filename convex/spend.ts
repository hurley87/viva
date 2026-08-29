// INV-4 accounting: the `spendEvents` writes, plus the two gates that decide
// whether a Session may be minted.
//
// Two different mechanisms live here on purpose, because they fail
// differently:
//
//   - the BREAKER is global and about money. It sums every `spendEvents` row
//     in the current calendar month and compares it with the deployment's
//     monthly ceiling. **It gates mints only.** There is deliberately no
//     export from this module that ends, cancels, or touches a live Session —
//     PRD §4 INV-4 edge (b): the breaker never terminates a Session that is
//     already running.
//   - the CAPS are per Student and about fairness. They count the Student's
//     own Sessions in a rolling day and week window.
//
// All model spend counts against the budget: realtime, Grader, classifier
// (INV-4 edge (c)).

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import type { DeploymentConfig } from "./lib/config";
import {
  GRADER_USD_PER_INPUT_MTOK,
  GRADER_USD_PER_OUTPUT_MTOK,
  REALTIME_USD_PER_MINUTE,
} from "./lib/constants";
import {
  DAY_WINDOW_MS,
  WEEK_WINDOW_MS,
  startOfCalendarMonthUtc,
} from "./lib/time";

/** The kinds of spend that count against the monthly budget. */
export type SpendKind = Doc<"spendEvents">["kind"];

const spendKind = v.union(v.literal("realtime"), v.literal("grader"));

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record one spend estimate. Called in the same transaction as whatever
 * produced the spend, so a Session can never end without its cost being
 * accounted for.
 */
export async function recordSpendEvent(
  ctx: MutationCtx,
  event: { kind: SpendKind; sessionId?: Id<"sessions">; usd: number },
): Promise<Id<"spendEvents">> {
  return await ctx.db.insert("spendEvents", {
    kind: event.kind,
    sessionId: event.sessionId,
    usd: event.usd,
  });
}

/**
 * Record spend from an action, which has no `ctx.db` of its own.
 *
 * The Grader (ticket #5) runs in a Node action and writes its own `grader`
 * spend through here; `realtime` spend is written inline by
 * `sessions.finalize` and does not need this hop.
 */
export const record = internalMutation({
  args: {
    kind: spendKind,
    sessionId: v.optional(v.id("sessions")),
    usd: v.number(),
  },
  returns: v.id("spendEvents"),
  handler: async (ctx, args) => {
    return await recordSpendEvent(ctx, {
      kind: args.kind,
      sessionId: args.sessionId,
      usd: args.usd,
    });
  },
});

// ---------------------------------------------------------------------------
// The breaker — mints only
// ---------------------------------------------------------------------------

/**
 * Every spend event in the current calendar month (UTC), newest last.
 *
 * Read through Convex's built-in `by_creation_time` index rather than as a
 * full-table scan. That is not an optimisation, it is a correctness fix: this
 * read happens inside `sessions.prepareMint`, `spendEvents` is never pruned,
 * and a scan of every row ever written crosses Convex's per-transaction read
 * ceiling within months at the pilot's own arithmetic (two rows per Session,
 * ~3,600 rows a month at 30 Students x 2 Sessions a day). Past that point the
 * INV-4 gate would not refuse a mint kindly — it would throw, and no Session
 * could be minted at all.
 *
 * Scoped to the month, the read is bounded by one month's rows and resets at
 * every month boundary, so it cannot grow into the same wall.
 */
export async function monthToDateSpendEvents(
  ctx: QueryCtx | MutationCtx,
  now: number,
): Promise<Doc<"spendEvents">[]> {
  const monthStart = startOfCalendarMonthUtc(now);
  return await ctx.db
    .query("spendEvents")
    .withIndex("by_creation_time", (q) =>
      q.gte("_creationTime", monthStart),
    )
    .collect();
}

/** Total estimated spend, in USD, for the current calendar month (UTC). */
export async function monthToDateSpendUsd(
  ctx: QueryCtx | MutationCtx,
  now: number,
): Promise<number> {
  const events = await monthToDateSpendEvents(ctx, now);
  return sumUsd(events);
}

/** The USD total of a set of spend events. */
export function sumUsd(events: readonly Doc<"spendEvents">[]): number {
  return events.reduce((total, event) => total + event.usd, 0);
}

/** What the breaker decided, and the numbers it decided it from. */
export type BreakerState = {
  tripped: boolean;
  spentUsd: number;
  budgetUsd: number;
};

/**
 * Whether the monthly budget blocks NEW mints.
 *
 * Named for what it is allowed to do. Nothing in this module can end a live
 * Session, and nothing outside the mint path calls this.
 */
export async function breakerBlocksNewMints(
  ctx: QueryCtx | MutationCtx,
  config: DeploymentConfig,
  now: number,
): Promise<BreakerState> {
  const spentUsd = await monthToDateSpendUsd(ctx, now);
  return {
    tripped: spentUsd >= config.monthlyBudgetUsd,
    spentUsd,
    budgetUsd: config.monthlyBudgetUsd,
  };
}

// ---------------------------------------------------------------------------
// The caps — per Student, rolling windows
// ---------------------------------------------------------------------------

/** A Student's Session counts in the two rolling cap windows. */
export type CapCounts = { day: number; week: number };

/**
 * Count the Student's Sessions inside the rolling day and week windows.
 *
 * A Session counts unless it has been explicitly forgiven: `countsAgainstCaps`
 * is `undefined` until the Session is finalized, so a Session that is still
 * `minted` or `live` counts. Without that, a Student could mint without limit
 * simply by never finishing anything.
 */
export async function sessionCapCounts(
  ctx: QueryCtx | MutationCtx,
  studentId: Id<"users">,
  now: number,
): Promise<CapCounts> {
  const weekStart = now - WEEK_WINDOW_MS;
  const dayStart = now - DAY_WINDOW_MS;
  const recent = await ctx.db
    .query("sessions")
    .withIndex("by_student", (q) =>
      q.eq("studentId", studentId).gte("_creationTime", weekStart),
    )
    .collect();
  const counted = recent.filter(
    (session) => session.countsAgainstCaps !== false,
  );
  return {
    week: counted.length,
    day: counted.filter((session) => session._creationTime >= dayStart).length,
  };
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

/**
 * Estimated realtime spend for a Session of `durationInSec` wall-clock
 * seconds. A placeholder rate until the cost-model ticket lands — see
 * {@link REALTIME_USD_PER_MINUTE}.
 */
export function realtimeSpendUsd(durationInSec: number): number {
  return (durationInSec / 60) * REALTIME_USD_PER_MINUTE;
}

const TOKENS_PER_MTOK = 1_000_000;

/**
 * Estimated Grader spend for one call, from the token counts OpenAI reported
 * for it.
 *
 * All model spend counts against the INV-4 budget (PRD §4 edge (c)), and the
 * Grader is model spend: one call per Session, a few cents against the dollars
 * of realtime audio, but it is counted rather than waved through because "small
 * enough to ignore" is how a budget stops meaning anything.
 */
export function graderSpendUsd(
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens / TOKENS_PER_MTOK) * GRADER_USD_PER_INPUT_MTOK +
    (outputTokens / TOKENS_PER_MTOK) * GRADER_USD_PER_OUTPUT_MTOK
  );
}
