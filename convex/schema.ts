// Viva domain model. Lifted from the approved prototype
// (.scratch/viva-mvp/assets/05-schema.prototype.ts), syntax verified against
// Convex 1.45. Vocabulary follows CONTEXT.md exactly: Assignment, Standard,
// Criterion, Session, Transcript, Assessment, Teacher, Student, Operator.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Reusable value unions (mirror these in the shared zod schemas)
// ---------------------------------------------------------------------------

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
  // -------------------------------------------------------------------------
  // People. Hand-provisioned (MVP surface cut) — no roster upload. Identity
  // comes from Privy; `privyDid` is the bridge. Voiding a Student (leaked
  // credential, PRD §6) is flipping `status` — no UI needed.
  // -------------------------------------------------------------------------
  users: defineTable({
    privyDid: v.string(),
    email: v.string(),
    displayName: v.string(),
    role,
    status: v.union(v.literal("active"), v.literal("voided")),
  }).index("by_privyDid", ["privyDid"]),

  // -------------------------------------------------------------------------
  // Assignment = stable container; assignmentVersion = immutable published
  // snapshot. A Session pins an assignmentVersionId, never an assignmentId,
  // so later edits can never touch an existing Session (PRD §2).
  // Immutability is enforced by construction: no update mutation exists for
  // `assignmentVersions` or `standards`, and none may be added.
  // -------------------------------------------------------------------------
  assignments: defineTable({
    title: v.string(),
    teacherId: v.id("users"),
  }),

  assignmentVersions: defineTable({
    assignmentId: v.id("assignments"),
    version: v.number(), // 1, 2, 3… ; highest = active for new mints
    prompt: v.string(), // what the Examiner receives — nothing else (INV-3)
    publishedAt: v.number(),
  }).index("by_assignment", ["assignmentId", "version"]),

  // -------------------------------------------------------------------------
  // The Standard lives in its OWN table, 1:1 with an assignmentVersion — not
  // as a field on the version row. This is INV-3 made physical: the mint and
  // Examiner modules read `assignmentVersions` and can be statically checked
  // to never reference Standard storage. Only convex/standards.ts touches
  // this table; only the Grader reads it through that module.
  // -------------------------------------------------------------------------
  standards: defineTable({
    assignmentVersionId: v.id("assignmentVersions"),
    criteria: v.array(
      v.object({
        name: v.string(),
        descriptor: v.string(), // 1–3 sentences (PRD §8)
      }),
    ),
  }).index("by_version", ["assignmentVersionId"]),

  // -------------------------------------------------------------------------
  // Session: one time-boxed live voice response to a pinned Assignment
  // version. "Forgiveness" (INV-4 edge (a): under the minimum-duration floor)
  // is not a status — the Session still ended, it just doesn't count. Hence
  // countsAgainstCaps. openaiCallId is captured from the WebRTC SDP exchange
  // at connect and is what the scheduled hangup job posts to.
  // -------------------------------------------------------------------------
  sessions: defineTable({
    studentId: v.id("users"),
    assignmentVersionId: v.id("assignmentVersions"), // the pin
    status: v.union(
      v.literal("minted"),
      v.literal("live"),
      v.literal("ended"),
    ),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    endReason: v.optional(
      v.union(
        v.literal("student_hangup"),
        v.literal("timebox"), // scheduled server hangup at the time-box
        v.literal("examiner_ended"), // stall protocol, three dead threads (PRD §7)
        v.literal("disconnected"),
      ),
    ),
    openaiCallId: v.optional(v.string()),
    countsAgainstCaps: v.optional(v.boolean()), // set at end: duration >= floor
    /**
     * True when `startedAt` was established by the server rather than reported
     * by the browser: the client persisted Transcript material for a Session it
     * never called `sessions.start` for. INV-4 depends on a Session's duration,
     * and a duration that only exists when a client volunteers it is not a cap.
     * See `adoptUnreportedStart` in convex/sessions.ts.
     */
    startInferred: v.optional(v.boolean()),
    /**
     * The shape of the Transcript, frozen onto the Session once its write
     * window has closed (`internal.sessions.sealSession`). Counts of turns, not
     * content: this is what lets the Operator's aggregates report Transcript
     * volume and the ASR error rate without reading a single Transcript row
     * (INV-2), and without a query whose cost grows with every turn ever spoken.
     */
    transcriptItemCount: v.optional(v.number()),
    transcriptFailedAsrCount: v.optional(v.number()),
  }).index("by_student", ["studentId"]),

  // -------------------------------------------------------------------------
  // Transcript: sole Session record (ADR-0001). Upserted incrementally from
  // the client's reconciled history snapshots, keyed by OpenAI itemId. A
  // Student turn can permanently lack text (ASR failed) — that is a legal
  // state, not an error.
  // -------------------------------------------------------------------------
  transcriptItems: defineTable({
    sessionId: v.id("sessions"),
    itemId: v.string(), // OpenAI conversation item id — the upsert key
    orderKey: v.number(), // position in the reconciled history snapshot
    speaker: v.union(v.literal("student"), v.literal("examiner")),
    text: v.string(),
    textStatus: v.union(
      v.literal("final"),
      v.literal("failed"), // input_audio_transcription.failed — text stays ""
      v.literal("truncated"), // examiner turn cut by barge-in (by design)
    ),
  })
    .index("by_session_item", ["sessionId", "itemId"])
    .index("by_session_order", ["sessionId", "orderKey"]),

  // -------------------------------------------------------------------------
  // Assessment: 1:1 with Session. `criteria` is denormalized from the pinned
  // Standard at grading time (Criterion names copied in), so the Assessment
  // stays readable in isolation. `released` implements the shadow period:
  // auto-set true when config.releaseMode = "auto"; in "shadow" the Teacher
  // releases. The Student view projects ONLY formativeSummary (+ own
  // transcript); per-Criterion ratings and inv1Flags are Teacher-only (§8).
  // -------------------------------------------------------------------------
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
          evidence: v.array(v.string()), // verbatim transcript quotes
        }),
      ),
    ),
    formativeSummary: v.optional(v.string()),
    inv1Flags: v.optional(
      v.array(
        v.object({
          quote: v.string(), // the Examiner turn that supplied a position
          explanation: v.string(),
        }),
      ),
    ),
    graderModel: v.optional(v.string()), // pinned OpenAI model id used
    /**
     * When the Grader run this row is currently waiting on was scheduled. It is
     * the run's identity: the stall sweep carries the same number and refuses to
     * act unless it still matches, so a sweep left over from an earlier run
     * cannot mark a retry `failed` seconds after a Teacher started it.
     */
    graderRunAt: v.optional(v.number()),
    released: v.boolean(),
    releasedAt: v.optional(v.number()),
  }).index("by_session", ["sessionId"]),

  // -------------------------------------------------------------------------
  // INV-2 designed break-glass: a Teacher sharing ONE transcript with the
  // Operator is a logged, permanent row. The Operator read path checks this
  // table; rows are never deleted ("permanently visible on the transcript").
  // -------------------------------------------------------------------------
  transcriptShares: defineTable({
    sessionId: v.id("sessions"),
    grantedByTeacherId: v.id("users"),
    reason: v.string(),
  }).index("by_session", ["sessionId"]),

  // -------------------------------------------------------------------------
  // INV-4 accounting. ALL model spend counts (realtime + Grader + classifier).
  // The breaker sums the current calendar month at mint time; it blocks NEW
  // mints only, never a live Session. Values are estimates recorded at
  // Session end / Grader call.
  //
  // No declared index, and deliberately so: every read of this table is a range
  // over one calendar month, which Convex's built-in `by_creation_time` index
  // serves directly. Rows are never pruned, so the alternative — the full-table
  // scan this table used to get — grows without bound and eventually crosses
  // the per-transaction read ceiling *inside the mint path*, turning the
  // friendly cap refusal into a hard failure. See convex/spend.ts.
  // -------------------------------------------------------------------------
  spendEvents: defineTable({
    kind: v.union(v.literal("realtime"), v.literal("grader")),
    sessionId: v.optional(v.id("sessions")),
    usd: v.number(),
  }),

  // -------------------------------------------------------------------------
  // Hand-seeded singleton (MVP surface cut: config-only caps, no settings UI).
  // Read through convex/lib/config.ts, never queried directly.
  // -------------------------------------------------------------------------
  deploymentConfig: defineTable({
    sessionsPerDay: v.number(), // default 2
    sessionsPerWeek: v.number(), // default 8
    timeboxSec: v.number(), // default 900
    warningAtSec: v.number(), // default 780 (2-minute warning)
    minDurationSec: v.number(), // default 180 (forgiveness floor)
    monthlyBudgetUsd: v.number(), // breaker ceiling
    releaseMode: v.union(v.literal("shadow"), v.literal("auto")),
  }),
});
