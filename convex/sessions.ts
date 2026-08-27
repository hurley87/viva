/**
 * INV-3: Session mint must never import convex/standards.ts.
 * Examiner instructions are assembled in convex/examiner/instructions.ts
 * and injected only when minting the ephemeral Realtime token.
 * Session end schedules the Grader via the generated `internal` API so this
 * file does not import convex/grader or convex/standards.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { requireStudent } from "./lib/auth";
import {
  BREAKER_MESSAGE,
  DAILY_CAP_MESSAGE,
  WEEKLY_CAP_MESSAGE,
  dailyCappedCount,
  loadDeploymentConfig,
  sumSpendThisMonth,
  weeklyCappedCount,
} from "./lib/caps";
import { studentMutation, studentQuery } from "./lib/customFunctions";
import {
  countsAgainstCapsAtEnd,
  estimateRealtimeSpendUsd,
  mapToolReasonToEndReason,
} from "./lib/sessionEnd";
import { TRANSCRIPT_WRITE_GRACE_MS } from "./lib/transcript";
import {
  mintResultValidator,
  sessionEndReasonValidator,
  sessionEndToolReasonValidator,
  sessionStatusValidator,
} from "./lib/validators";

const sessionViewValidator = v.union(
  v.object({
    _id: v.id("sessions"),
    status: sessionStatusValidator,
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    endReason: v.optional(sessionEndReasonValidator),
    timeboxSec: v.number(),
    warningAtSec: v.number(),
    minDurationSec: v.number(),
    assignmentTitle: v.string(),
  }),
  v.null(),
);

async function pinHighestPublishedVersion(
  ctx: MutationCtx,
): Promise<{
  assignmentId: Id<"assignments">;
  assignmentVersionId: Id<"assignmentVersions">;
}> {
  const assignment = await ctx.db.query("assignments").first();
  if (!assignment) {
    throw new Error("No Assignment is published.");
  }

  const highest = await ctx.db
    .query("assignmentVersions")
    .withIndex("by_assignment", (q) => q.eq("assignmentId", assignment._id))
    .order("desc")
    .first();

  if (!highest) {
    throw new Error("No published Assignment version is available.");
  }

  return {
    assignmentId: assignment._id,
    assignmentVersionId: highest._id,
  };
}

async function finalizeEndedSession(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  args: {
    endReason: Doc<"sessions">["endReason"];
    endedAt: number;
  },
): Promise<void> {
  if (session.status === "ended") {
    return;
  }

  const config = await loadDeploymentConfig(ctx);
  const countsAgainstCaps = countsAgainstCapsAtEnd({
    session,
    endedAt: args.endedAt,
    minDurationSec: config.minDurationSec,
  });

  await ctx.db.patch("sessions", session._id, {
    status: "ended",
    endedAt: args.endedAt,
    endReason: args.endReason,
    countsAgainstCaps,
  });

  if (session.openaiCallId !== undefined) {
    const startedAt = session.startedAt ?? session._creationTime;
    await ctx.db.insert("spendEvents", {
      kind: "realtime",
      sessionId: session._id,
      usd: estimateRealtimeSpendUsd(args.endedAt - startedAt),
    });
  }

  const existingAssessment = await ctx.db
    .query("assessments")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .unique();

  if (!existingAssessment) {
    await ctx.db.insert("assessments", {
      sessionId: session._id,
      status: "pending",
      released: false,
    });
  }

  if (!existingAssessment || existingAssessment.status !== "complete") {
    await ctx.scheduler.runAfter(
      TRANSCRIPT_WRITE_GRACE_MS,
      internal.grader.actions.gradeSession,
      { sessionId: session._id },
    );
  }
}

export const mint = studentMutation({
  args: {},
  returns: mintResultValidator,
  handler: async (ctx) => {
    const now = Date.now();
    const config = await loadDeploymentConfig(ctx);

    const spentThisMonth = await sumSpendThisMonth(ctx, now);
    if (spentThisMonth >= config.monthlyBudgetUsd) {
      return {
        ok: false as const,
        code: "breaker" as const,
        message: BREAKER_MESSAGE,
      };
    }

    const dailyCount = await dailyCappedCount(ctx, ctx.user._id, now);
    if (dailyCount >= config.sessionsPerDay) {
      return {
        ok: false as const,
        code: "daily_cap" as const,
        message: DAILY_CAP_MESSAGE,
      };
    }

    const weeklyCount = await weeklyCappedCount(ctx, ctx.user._id, now);
    if (weeklyCount >= config.sessionsPerWeek) {
      return {
        ok: false as const,
        code: "weekly_cap" as const,
        message: WEEKLY_CAP_MESSAGE,
      };
    }

    const { assignmentVersionId } = await pinHighestPublishedVersion(ctx);

    const sessionId = await ctx.db.insert("sessions", {
      studentId: ctx.user._id,
      assignmentVersionId,
      status: "minted",
      startedAt: now,
    });

    await ctx.scheduler.runAfter(
      config.timeboxSec * 1000,
      internal.realtime.hangupSession,
      { sessionId },
    );

    return {
      ok: true as const,
      sessionId,
      startedAt: now,
      timeboxSec: config.timeboxSec,
      warningAtSec: config.warningAtSec,
      minDurationSec: config.minDurationSec,
    };
  },
});

export const get = studentQuery({
  args: { sessionId: v.id("sessions") },
  returns: sessionViewValidator,
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.studentId !== ctx.user._id) {
      return null;
    }

    const config = await loadDeploymentConfig(ctx);
    const version = await ctx.db.get(
      "assignmentVersions",
      session.assignmentVersionId,
    );
    const assignment = version
      ? await ctx.db.get("assignments", version.assignmentId)
      : null;

    return {
      _id: session._id,
      status: session.status,
      startedAt: session.startedAt ?? session._creationTime,
      timeboxSec: config.timeboxSec,
      warningAtSec: config.warningAtSec,
      minDurationSec: config.minDurationSec,
      assignmentTitle: assignment?.title ?? "Assignment",
      ...(session.endedAt !== undefined ? { endedAt: session.endedAt } : {}),
      ...(session.endReason !== undefined
        ? { endReason: session.endReason }
        : {}),
    };
  },
});

export const reportCallId = studentMutation({
  args: {
    sessionId: v.id("sessions"),
    openaiCallId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.studentId !== ctx.user._id) {
      throw new Error("Session not found");
    }
    if (session.status === "ended") {
      return null;
    }

    await ctx.db.patch("sessions", session._id, {
      openaiCallId: args.openaiCallId,
      status: "live",
    });
    return null;
  },
});

export const end = studentMutation({
  args: {
    sessionId: v.id("sessions"),
    reason: sessionEndToolReasonValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.studentId !== ctx.user._id) {
      throw new Error("Session not found");
    }

    await finalizeEndedSession(ctx, session, {
      endReason: mapToolReasonToEndReason(args.reason),
      endedAt: Date.now(),
    });
    return null;
  },
});

export const examinerContext = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.object({
    userId: v.id("users"),
    prompt: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await requireStudent(ctx);
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.studentId !== user._id) {
      throw new Error("Session not found");
    }
    if (session.status === "ended") {
      throw new Error("This Session has already ended");
    }

    const version = await ctx.db.get(
      "assignmentVersions",
      session.assignmentVersionId,
    );
    if (!version) {
      throw new Error("Pinned Assignment version is missing");
    }

    return {
      userId: user._id,
      prompt: version.prompt,
    };
  },
});

export const finalizeTimebox = internalMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) {
      return null;
    }

    await finalizeEndedSession(ctx, session, {
      endReason: "timebox",
      endedAt: Date.now(),
    });
    return null;
  },
});

export const getCallId = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    return session?.openaiCallId ?? null;
  },
});
