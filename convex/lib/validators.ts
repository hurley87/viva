import { v } from "convex/values";

export const roleValidator = v.union(
  v.literal("teacher"),
  v.literal("student"),
  v.literal("operator"),
);

export const userStatusValidator = v.union(
  v.literal("active"),
  v.literal("voided"),
);

export const userPublicValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  privyDid: v.string(),
  email: v.string(),
  displayName: v.string(),
  role: roleValidator,
  status: userStatusValidator,
});

export const sessionEndToolReasonValidator = v.union(
  v.literal("timebox"),
  v.literal("dead_threads"),
  v.literal("student_request"),
  v.literal("disconnected"),
);

export const sessionEndReasonValidator = v.union(
  v.literal("student_hangup"),
  v.literal("timebox"),
  v.literal("examiner_ended"),
  v.literal("disconnected"),
);

export const sessionStatusValidator = v.union(
  v.literal("minted"),
  v.literal("live"),
  v.literal("ended"),
);

export const mintRefusalCodeValidator = v.union(
  v.literal("breaker"),
  v.literal("daily_cap"),
  v.literal("weekly_cap"),
);

export const mintResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    sessionId: v.id("sessions"),
    startedAt: v.number(),
    timeboxSec: v.number(),
    warningAtSec: v.number(),
    minDurationSec: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    code: mintRefusalCodeValidator,
    message: v.string(),
  }),
);

export const transcriptSpeakerValidator = v.union(
  v.literal("student"),
  v.literal("examiner"),
);

export const transcriptTextStatusValidator = v.union(
  v.literal("final"),
  v.literal("failed"),
  v.literal("truncated"),
);

export const transcriptSnapshotItemValidator = v.object({
  itemId: v.string(),
  orderKey: v.number(),
  speaker: transcriptSpeakerValidator,
  text: v.string(),
  textStatus: transcriptTextStatusValidator,
});

export const transcriptUpsertResultValidator = v.object({
  accepted: v.boolean(),
});

export const criterionRatingValidator = v.union(
  v.literal("established"),
  v.literal("partially_established"),
  v.literal("not_established"),
  v.literal("not_probed"),
);

export const assessmentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("complete"),
  v.literal("failed"),
);

export const assessmentCriterionValidator = v.object({
  name: v.string(),
  rating: criterionRatingValidator,
  evidence: v.array(v.string()),
});

export const inv1FlagValidator = v.object({
  quote: v.string(),
  explanation: v.string(),
});

export const graderTranscriptTurnValidator = v.object({
  speaker: transcriptSpeakerValidator,
  text: v.string(),
  textStatus: transcriptTextStatusValidator,
});
