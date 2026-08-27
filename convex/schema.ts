import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const role = v.union(
  v.literal("teacher"),
  v.literal("student"),
  v.literal("operator"),
);

const criterionRating = v.union(
  v.literal("established"),
  v.literal("partially_established"),
  v.literal("not_established"),
  v.literal("not_probed"),
);

export default defineSchema({
  users: defineTable({
    privyDid: v.string(),
    email: v.string(),
    displayName: v.string(),
    role,
    status: v.union(v.literal("active"), v.literal("voided")),
  })
    .index("by_privyDid", ["privyDid"])
    .index("by_email", ["email"]),

  assignments: defineTable({
    title: v.string(),
    teacherId: v.id("users"),
  }),

  assignmentVersions: defineTable({
    assignmentId: v.id("assignments"),
    version: v.number(),
    prompt: v.string(),
    publishedAt: v.number(),
  }).index("by_assignment", ["assignmentId", "version"]),

  // INV-3 physical split: Standard is 1:1 with an assignmentVersion, not a
  // field on that row. Only convex/standards.ts may read or write this table.
  standards: defineTable({
    assignmentVersionId: v.id("assignmentVersions"),
    criteria: v.array(
      v.object({
        name: v.string(),
        descriptor: v.string(),
      }),
    ),
  }).index("by_version", ["assignmentVersionId"]),

  sessions: defineTable({
    studentId: v.id("users"),
    assignmentVersionId: v.id("assignmentVersions"),
    status: v.union(v.literal("minted"), v.literal("live"), v.literal("ended")),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    endReason: v.optional(
      v.union(
        v.literal("student_hangup"),
        v.literal("timebox"),
        v.literal("examiner_ended"),
        v.literal("disconnected"),
      ),
    ),
    openaiCallId: v.optional(v.string()),
    countsAgainstCaps: v.optional(v.boolean()),
  })
    .index("by_student", ["studentId"])
    .index("by_student_ended", ["studentId", "endedAt"]),

  transcriptItems: defineTable({
    sessionId: v.id("sessions"),
    itemId: v.string(),
    orderKey: v.number(),
    speaker: v.union(v.literal("student"), v.literal("examiner")),
    text: v.string(),
    textStatus: v.union(
      v.literal("final"),
      v.literal("failed"),
      v.literal("truncated"),
    ),
  })
    .index("by_session_item", ["sessionId", "itemId"])
    .index("by_session_order", ["sessionId", "orderKey"]),

  assessments: defineTable({
    sessionId: v.id("sessions"),
    status: v.union(
      v.literal("pending"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    criteria: v.optional(
      v.array(
        v.object({
          name: v.string(),
          rating: criterionRating,
          evidence: v.array(v.string()),
        }),
      ),
    ),
    formativeSummary: v.optional(v.string()),
    inv1Flags: v.optional(
      v.array(
        v.object({
          quote: v.string(),
          explanation: v.string(),
        }),
      ),
    ),
    graderModel: v.optional(v.string()),
    released: v.boolean(),
    releasedAt: v.optional(v.number()),
  }).index("by_session", ["sessionId"]),

  transcriptShares: defineTable({
    sessionId: v.id("sessions"),
    grantedByTeacherId: v.id("users"),
    reason: v.string(),
  }).index("by_session", ["sessionId"]),

  spendEvents: defineTable({
    kind: v.union(v.literal("realtime"), v.literal("grader")),
    sessionId: v.optional(v.id("sessions")),
    usd: v.number(),
  }),

  deploymentConfig: defineTable({
    sessionsPerDay: v.number(),
    sessionsPerWeek: v.number(),
    timeboxSec: v.number(),
    warningAtSec: v.number(),
    minDurationSec: v.number(),
    monthlyBudgetUsd: v.number(),
    releaseMode: v.union(v.literal("shadow"), v.literal("auto")),
  }),
});
