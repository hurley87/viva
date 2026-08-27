// ============================================================================
// PROTOTYPE — wayfinder ticket [Convex schema prototype]. NOT merged code.
//
// Question: does this Convex schema represent PRD v1.4's domain model —
// Assignment/Standard versioning + pinning, INV-2/INV-3 separations, INV-4
// cap accounting, shadow release — well enough to start the build from?
//
// React to the shape, not the syntax. Convex API details get verified at
// build time; the decisions this file encodes are listed at the bottom.
// ============================================================================

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Reusable value unions (mirror these in the shared Zod schemas)
// ---------------------------------------------------------------------------

const role = v.union(v.literal("teacher"), v.literal("student"), v.literal("operator"));

const criterionRating = v.union(
  v.literal("established"),
  v.literal("partially_established"),
  v.literal("not_established"),
  v.literal("not_probed"),
);

export default defineSchema({
  // -------------------------------------------------------------------------
  // People. Hand-minted (MVP surface cut) — no roster upload. Identity comes
  // from Privy; `privyDid` is the bridge. "Voiding" a Student (leaked link,
  // §6) is flipping `status` — no UI needed.
  // -------------------------------------------------------------------------
  users: defineTable({
    privyDid: v.string(),
    email: v.string(),
    displayName: v.string(),
    role,
    status: v.union(v.literal("active"), v.literal("voided")),
  }).index("by_privyDid", ["privyDid"]),

  // -------------------------------------------------------------------------
  // Assignment = stable container; AssignmentVersion = immutable published
  // snapshot. A Session pins an assignmentVersionId, never an assignmentId,
  // so later edits can never touch an existing Session (PRD §2).
  // Immutability is enforced by having no update mutation for versions.
  // -------------------------------------------------------------------------
  assignments: defineTable({
    title: v.string(),
    teacherId: v.id("users"),
  }),

  assignmentVersions: defineTable({
    assignmentId: v.id("assignments"),
    version: v.number(), // 1, 2, 3… ; highest = active for new mints
    prompt: v.string(),  // what the Examiner receives — nothing else (INV-3)
    publishedAt: v.number(),
  }).index("by_assignment", ["assignmentId", "version"]),

  // -------------------------------------------------------------------------
  // Standard lives in its OWN table, 1:1 with an assignmentVersion — not as a
  // field on the version row. This is INV-3 made physical: the session-mint
  // module reads assignmentVersions and can be lint/test-checked to never
  // import the standards module. Only the grader module touches this table.
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
  // Session: one time-boxed live voice response to a pinned version.
  // "Forgiveness" (INV-4 edge (a): under the 3-min floor) is not a status —
  // the session still ended; it just doesn't count. Hence countsAgainstCaps.
  // openaiCallId is captured from the WebRTC SDP exchange at connect and is
  // what the scheduled hangup job posts to (research ticket 03).
  // -------------------------------------------------------------------------
  sessions: defineTable({
    studentId: v.id("users"),
    assignmentVersionId: v.id("assignmentVersions"), // the pin
    status: v.union(v.literal("minted"), v.literal("live"), v.literal("ended")),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    endReason: v.optional(
      v.union(
        v.literal("student_hangup"),
        v.literal("timebox"),          // scheduled server hangup at 15:00
        v.literal("examiner_ended"),   // stall protocol, three dead threads (§7)
        v.literal("disconnected"),
      ),
    ),
    openaiCallId: v.optional(v.string()),
    countsAgainstCaps: v.optional(v.boolean()), // set at end: duration ≥ floor
  })
    .index("by_student", ["studentId"])
    .index("by_student_ended", ["studentId", "endedAt"]), // cap-window queries

  // -------------------------------------------------------------------------
  // Transcript: sole Session record (ADR-0001). Upserted incrementally from
  // the client's history_updated snapshots, keyed by OpenAI itemId (research
  // ticket 03). A Student turn can permanently lack text (ASR failed) — that
  // is a legal state, not an error.
  // -------------------------------------------------------------------------
  transcriptItems: defineTable({
    sessionId: v.id("sessions"),
    itemId: v.string(),   // OpenAI conversation item id — the upsert key
    orderKey: v.number(), // position in the reconciled history snapshot
    speaker: v.union(v.literal("student"), v.literal("examiner")),
    text: v.string(),
    textStatus: v.union(
      v.literal("final"),
      v.literal("failed"),    // input_audio_transcription.failed — text stays ""
      v.literal("truncated"), // examiner turn cut by barge-in (by design)
    ),
  })
    .index("by_session_item", ["sessionId", "itemId"])
    .index("by_session_order", ["sessionId", "orderKey"]),

  // -------------------------------------------------------------------------
  // Assessment: 1:1 with Session. `criteria` is denormalized from the pinned
  // Standard at grading time (names copied in), so the Assessment stays
  // readable even in isolation. `released` implements the shadow period:
  // auto-set true when config.releaseMode = "auto"; in "shadow" the Teacher
  // releases. Student view projects ONLY formativeSummary (+ own transcript);
  // per-criterion ratings and inv1Flags are Teacher-only (PRD §8).
  // -------------------------------------------------------------------------
  assessments: defineTable({
    sessionId: v.id("sessions"),
    status: v.union(v.literal("pending"), v.literal("complete"), v.literal("failed")),
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
          quote: v.string(),       // the examiner turn that supplied a position
          explanation: v.string(),
        }),
      ),
    ),
    graderModel: v.optional(v.string()), // pinned OpenAI model id used
    released: v.boolean(),
    releasedAt: v.optional(v.number()),
  }).index("by_session", ["sessionId"]),

  // -------------------------------------------------------------------------
  // INV-2 designed break-glass: a Teacher sharing ONE transcript with the
  // Operator is a logged, permanent row. The operator read path checks this
  // table; rows are never deleted ("permanently visible on the transcript").
  // -------------------------------------------------------------------------
  transcriptShares: defineTable({
    sessionId: v.id("sessions"),
    grantedByTeacherId: v.id("users"),
    reason: v.string(),
  }).index("by_session", ["sessionId"]),

  // -------------------------------------------------------------------------
  // INV-4 accounting. ALL model spend counts (realtime + grader). The breaker
  // sums the current month at mint time; it blocks NEW mints only, never a
  // live Session. Values are estimates recorded at session end / grader call.
  // -------------------------------------------------------------------------
  spendEvents: defineTable({
    kind: v.union(v.literal("realtime"), v.literal("grader")),
    sessionId: v.optional(v.id("sessions")),
    usd: v.number(),
  }),

  // -------------------------------------------------------------------------
  // Hand-seeded singleton (MVP surface cut: config-only caps, no settings UI).
  // -------------------------------------------------------------------------
  deploymentConfig: defineTable({
    sessionsPerDay: v.number(),      // default 2
    sessionsPerWeek: v.number(),     // default 8
    timeboxSec: v.number(),          // default 900
    warningAtSec: v.number(),        // default 780 (2-min warning)
    minDurationSec: v.number(),      // default 180 (forgiveness floor)
    monthlyBudgetUsd: v.number(),    // breaker ceiling
    releaseMode: v.union(v.literal("shadow"), v.literal("auto")),
  }),
});

// ============================================================================
// ACCESS-RULE CONVENTIONS (enforced in Convex functions — sketch, not code)
//
// Identity: every function resolves the caller via the Privy JWT
//   (ctx.auth.getUserIdentity() → users.by_privyDid), rejecting `voided`.
//   Helpers: requireTeacher / requireStudentSelf(sessionId) / requireOperator.
//
// INV-2 (operator blindness), as code not convention:
//   - No operator-callable function returns transcriptItems.text, assessment
//     content, or student identity — operator queries return aggregates only
//     (counts, spend sums, flag rates, error logs).
//   - The single operator transcript-read function requires a transcriptShares
//     row for that session; absent row → hard reject. The access rule itself
//     is never bypassed. Done-means test: operator identity cannot obtain a
//     transcript body through any exported function without a share row.
//
// INV-3 (Standard never enters the live Session), physical enforcement:
//   - convex/examiner/* (mint, instruction assembly) may import assignments +
//     assignmentVersions, NEVER the standards module. Lint/test asserts the
//     mint code path has no reference to standards storage.
//   - convex/grader/* is the only module reading `standards`.
//
// INV-4 mint check, in one mutation:
//   1. breaker: sum(spendEvents, current month) < monthlyBudgetUsd else refuse
//   2. caps: count sessions (by_student_ended, countsAgainstCaps=true) in
//      day/week windows vs config, else friendly refusal
//   3. pin: resolve highest published assignmentVersion, create session
//   4. schedule: ctx.scheduler.runAfter(timeboxSec, hangup(sessionId)) — the
//      job POSTs /v1/realtime/calls/{openaiCallId}/hangup, marks endReason
//      "timebox"; transcript writes and grading refuse past endedAt + grace.
//
// Student view projection: { ownTranscript, assessment.formativeSummary } —
//   never per-criterion ratings, never inv1Flags, never the Standard.
// ============================================================================
