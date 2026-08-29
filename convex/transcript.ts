// The Transcript: the persisted text record of a Session, and the sole
// Student evidence the Grader ever sees (ADR-0001, CONTEXT.md). Losing a turn
// is a product defect, not an edge case — everything below is written so that
// the record can only ever gain fidelity, never lose it.
//
// How rows get here. The browser holds the WebRTC leg, so the browser is the
// only party that sees the conversation. It derives rows from the SDK's
// *reconciled* history snapshots — keyed by OpenAI `itemId`, never by
// concatenating raw deltas — and upserts the whole snapshot, debounced, plus
// an immediate flush on the events that finish a turn (research:
// .scratch/viva-mvp/issues/03-transcript-capture-and-timebox.md §3, option a).
// That is what survives a killed tab: everything written up to the last flush
// is already durable, with no end-of-session flush to depend on.
//
// Consequences of that design, made explicit because they look like bugs and
// are not:
//
//   - The same item is re-sent many times as its text fills in. The upsert is
//     keyed on (sessionId, itemId) and writes nothing when nothing changed.
//   - A Student turn's transcript is a separate best-effort ASR pass. It can
//     arrive late, out of order, or never. A turn with no text is stored with
//     `textStatus: "failed"` and empty text — a legal, modelled state — and is
//     upgraded to `final` in place if the text turns up later.
//   - An Examiner turn cut off by barge-in loses its unspoken tail by design
//     (the platform removes the transcript of the unplayed audio). It is
//     stored `textStatus: "truncated"`, which is the truth about that turn.
//
// What the server does NOT know. It has no copy of the conversation, so
// `itemId`, `speaker`, `text` and `textStatus` are taken on the client's word:
// the Transcript is authored by the browser and a Student can fabricate one,
// invented Examiner turns included, which the Grader will then evaluate. That
// is inherent to holding the WebRTC leg in the browser and storing no audio
// (ADR-0001, ADR-0003), it is bounded by formative-only stakes (ADR-0002), and
// it is written down as accepted in
// docs/adr/0004-client-authored-transcript.md — not left implicit here. What
// the client does NOT get to decide is the accounting: see
// `adoptUnreportedStart`.
//
// Time-box integrity (PRD §4 INV-4 build note). Every write is checked against
// a cutoff computed here, on the SERVER clock, from the Session's own
// timestamps. A frozen, tampered, or replayed client cannot append to a
// Session after it is over; nothing the browser reports is an input to that
// decision.

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { getDeploymentConfig } from "./lib/config";
import { CONNECT_GRACE_SEC, TIMEBOX_GRACE_SEC } from "./lib/constants";
import { requireStudent } from "./lib/identity";
import { writeCutoffAt } from "./lib/time";
import { adoptUnreportedStart } from "./sessions";

const MS_PER_SEC = 1000;

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

const speaker = v.union(v.literal("student"), v.literal("examiner"));

const textStatus = v.union(
  v.literal("final"),
  v.literal("failed"),
  v.literal("truncated"),
);

/** One turn as the client derived it from a reconciled history snapshot. */
const transcriptItemInput = v.object({
  /** OpenAI conversation item id — the upsert key. */
  itemId: v.string(),
  /** The item's position in that snapshot. Stable: history only grows. */
  orderKey: v.number(),
  speaker,
  /** Empty is legal: an ASR failure, or a turn whose final has not landed. */
  text: v.string(),
  textStatus,
});

const transcriptRowValidator = v.object({
  itemId: v.string(),
  orderKey: v.number(),
  speaker,
  text: v.string(),
  textStatus,
});

export type Speaker = Doc<"transcriptItems">["speaker"];
export type TextStatus = Doc<"transcriptItems">["textStatus"];

/** A turn, as every reader of the Transcript sees it. */
export type TranscriptRow = {
  itemId: string;
  orderKey: number;
  speaker: Speaker;
  text: string;
  textStatus: TextStatus;
};

/** Why an upsert was refused. `null` means it was accepted. */
export type UpsertRefusal = "past_write_cutoff";

export type UpsertResult = {
  accepted: boolean;
  refusal: UpsertRefusal | null;
  inserted: number;
  updated: number;
  unchanged: number;
};

const upsertResultValidator = v.object({
  accepted: v.boolean(),
  refusal: v.union(v.null(), v.literal("past_write_cutoff")),
  inserted: v.number(),
  updated: v.number(),
  unchanged: v.number(),
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * The caller's own Session.
 *
 * Deliberately a local twin of the helper in convex/sessions.ts rather than a
 * shared import: this module and the mint path have no reason to depend on
 * each other, and an authorization check is cheap to state twice and expensive
 * to get wrong once.
 *
 * @throws when the caller is not a Student, the Session does not exist, or it
 * belongs to somebody else. Authorization failures throw; only the time-box
 * refusal is a returned value.
 */
async function requireOwnSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
): Promise<Doc<"sessions">> {
  const student = await requireStudent(ctx);
  const session = await ctx.db.get("sessions", sessionId);
  if (session === null || session.studentId !== student._id) {
    // One message for both cases: a Student may not learn whether somebody
    // else's Session id exists.
    throw new Error("Forbidden: that Session does not belong to you.");
  }
  return session;
}

// ---------------------------------------------------------------------------
// Time-box integrity
// ---------------------------------------------------------------------------

/**
 * The last instant this Session may still be written to, on the server clock.
 *
 * It is the earlier of two things, plus {@link TIMEBOX_GRACE_SEC} of slack for
 * the one write that was already in flight when the Session stopped:
 *
 *   - the time-box: `startedAt + timeboxSec`. Every Session that has produced
 *     material has a `startedAt`, because the first write starts it (see
 *     `adoptUnreportedStart`); the mint-relative deadline
 *     (`mintedAt + timeboxSec + CONNECT_GRACE_SEC`) remains as the fallback for
 *     a Session that ended without ever having one, past which no client is
 *     going to turn up.
 *   - the actual end: a Session that ended early — the Student hung up, the
 *     Examiner closed it — accepts nothing past `endedAt`.
 *
 * Nothing here reads a client-supplied timestamp, which is the whole point: a
 * frozen tab or a hand-rolled request cannot extend the window it may write
 * in.
 */
function writeCutoffFor(
  session: Doc<"sessions">,
  timeboxSec: number,
): number {
  const timeboxLimit =
    writeCutoffAt(session.startedAt, timeboxSec) ??
    session._creationTime +
      (timeboxSec + CONNECT_GRACE_SEC + TIMEBOX_GRACE_SEC) * MS_PER_SEC;
  const endLimit =
    session.endedAt === undefined
      ? Number.POSITIVE_INFINITY
      : session.endedAt + TIMEBOX_GRACE_SEC * MS_PER_SEC;
  return Math.min(timeboxLimit, endLimit);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

type IncomingItem = {
  itemId: string;
  orderKey: number;
  speaker: Speaker;
  text: string;
  textStatus: TextStatus;
};

type MergedFields = {
  orderKey: number;
  speaker: Speaker;
  text: string;
  textStatus: TextStatus;
};

/**
 * Fold one incoming item into what is already stored, under one rule: the
 * record may gain text, never lose it.
 *
 * The invariant this maintains is that `final` always carries text and
 * `failed` never does, so a reader can trust `textStatus` without inspecting
 * the string:
 *
 *   - incoming text present -> it wins, and the turn is `final` unless the
 *     client reported the turn was cut short by barge-in.
 *   - incoming text empty, stored text present -> keep the stored text. This
 *     is the late-ASR case in reverse: a snapshot taken before a final landed
 *     must not erase the final. A truncation report still upgrades the status.
 *   - no text either side -> `failed`, or `truncated` if either side says the
 *     turn was cut. An ASR pass that never returns leaves the turn here
 *     permanently, which is the honest record of it.
 *
 * `orderKey` always takes the incoming value: the newest reconciled snapshot
 * is authoritative about position. (Convex executes one client's mutations in
 * the order they were submitted, so "newest" and "last to arrive" are the same
 * thing here.)
 */
function mergeFields(
  stored: Doc<"transcriptItems">,
  incoming: IncomingItem,
): MergedFields {
  const incomingHasText = incoming.text.length > 0;
  const storedHasText = stored.text.length > 0;

  let text: string;
  let merged: TextStatus;

  if (incomingHasText) {
    text = incoming.text;
    merged = incoming.textStatus === "truncated" ? "truncated" : "final";
  } else if (storedHasText) {
    text = stored.text;
    merged =
      incoming.textStatus === "truncated" ? "truncated" : stored.textStatus;
  } else {
    text = "";
    merged =
      incoming.textStatus === "truncated" || stored.textStatus === "truncated"
        ? "truncated"
        : "failed";
  }

  return {
    orderKey: incoming.orderKey,
    // The speaker of a turn cannot change; the stored value is the first one
    // seen and stays.
    speaker: stored.speaker,
    text,
    textStatus: merged,
  };
}

/** The same normalisation, for an item being stored for the first time. */
function firstWriteFields(incoming: IncomingItem): MergedFields {
  const hasText = incoming.text.length > 0;
  return {
    orderKey: incoming.orderKey,
    speaker: incoming.speaker,
    text: incoming.text,
    textStatus: hasText
      ? incoming.textStatus === "truncated"
        ? "truncated"
        : "final"
      : incoming.textStatus === "truncated"
        ? "truncated"
        : "failed",
  };
}

function unchanged(
  stored: Doc<"transcriptItems">,
  fields: MergedFields,
): boolean {
  return (
    stored.orderKey === fields.orderKey &&
    stored.speaker === fields.speaker &&
    stored.text === fields.text &&
    stored.textStatus === fields.textStatus
  );
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Upsert a slice of the reconciled history snapshot into the Transcript.
 *
 * Idempotent by construction: rows are keyed on `(sessionId, itemId)`, and an
 * item that has not changed is not rewritten. Re-sending the same snapshot —
 * which the client does constantly, because a snapshot is what it has — costs
 * one indexed read per item and no writes.
 *
 * Returns rather than throws when the Session's write window has closed: a
 * late flush from a tab that was mid-write when the time-box fired is an
 * expected event, not an exception. Nothing is written in that case.
 *
 * @throws when the caller is not the Student this Session belongs to.
 */
export const upsert = mutation({
  args: {
    sessionId: v.id("sessions"),
    items: v.array(transcriptItemInput),
  },
  returns: upsertResultValidator,
  handler: async (ctx, args): Promise<UpsertResult> => {
    const owned = await requireOwnSession(ctx, args.sessionId);
    const config = await getDeploymentConfig(ctx);

    // A Transcript write is server-side proof that the call is up. A Session
    // still `minted` at this point belongs to a client that connected and never
    // called `sessions.start` — which, before this, meant a Session with no
    // `startedAt`: zero duration, forgiven by the caps, and a $0 realtime
    // spendEvent for a real examination (INV-4, both halves). The server starts
    // it here rather than waiting to be told.
    const session = await adoptUnreportedStart(ctx, owned);

    if (Date.now() > writeCutoffFor(session, config.timeboxSec)) {
      return {
        accepted: false,
        refusal: "past_write_cutoff",
        inserted: 0,
        updated: 0,
        unchanged: 0,
      };
    }

    let inserted = 0;
    let updated = 0;
    let untouched = 0;

    for (const item of args.items) {
      const stored = await ctx.db
        .query("transcriptItems")
        .withIndex("by_session_item", (q) =>
          q.eq("sessionId", args.sessionId).eq("itemId", item.itemId),
        )
        .unique();

      if (stored === null) {
        await ctx.db.insert("transcriptItems", {
          sessionId: args.sessionId,
          itemId: item.itemId,
          ...firstWriteFields(item),
        });
        inserted += 1;
        continue;
      }

      const fields = mergeFields(stored, item);
      if (unchanged(stored, fields)) {
        untouched += 1;
        continue;
      }
      await ctx.db.patch("transcriptItems", stored._id, fields);
      updated += 1;
    }

    return {
      accepted: true,
      refusal: null,
      inserted,
      updated,
      unchanged: untouched,
    };
  },
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function projectRow(row: Doc<"transcriptItems">): TranscriptRow {
  return {
    itemId: row.itemId,
    orderKey: row.orderKey,
    speaker: row.speaker,
    text: row.text,
    textStatus: row.textStatus,
  };
}

/**
 * The Transcript of a Session, in conversation order.
 *
 * Ordering comes from the `by_session_order` index, not from arrival: an item
 * whose text landed late still sits where it was spoken.
 */
async function orderedRows(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
): Promise<TranscriptRow[]> {
  const rows = await ctx.db
    .query("transcriptItems")
    .withIndex("by_session_order", (q) => q.eq("sessionId", sessionId))
    .collect();
  return rows.map(projectRow);
}

/**
 * The caller's own Transcript, in order. Never anybody else's.
 *
 * @throws when the caller is not the Student this Session belongs to.
 */
export const forSession = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(transcriptRowValidator),
  handler: async (ctx, args): Promise<TranscriptRow[]> => {
    await requireOwnSession(ctx, args.sessionId);
    return await orderedRows(ctx, args.sessionId);
  },
});

/**
 * The Transcript for server-side readers — the Grader (ticket #5) and the
 * Teacher/Operator surfaces that reach it through their own authorization.
 * Internal, so it carries no identity check of its own: there is no caller to
 * check, and the callers that do exist are trusted server code.
 */
export const itemsForSession = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.array(transcriptRowValidator),
  handler: async (ctx, args): Promise<TranscriptRow[]> => {
    return await orderedRows(ctx, args.sessionId);
  },
});
