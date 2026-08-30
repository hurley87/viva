"use node";

// The Grader: one Session's Transcript, evaluated against its pinned Standard.
//
// ============================================================================
// INV-3. THIS IS THE ONLY MODULE IN THE CODEBASE THAT READS A STANDARD.
//
// It may, because it runs strictly after the Session has ended, in a different
// model with a different context, and returns nothing to any live path. The
// Standard it reads is loaded here, spent on one API call, and dropped; it is
// never written to a row a Student or an Operator can reach and never returned
// from this action. If you find yourself wanting the Standard somewhere else,
// the answer is no — see the header of convex/standards.ts.
// ============================================================================
//
// `"use node"` applies to the whole file, so this module contains only actions.
// Every database touch it needs lives in convex/assessments.ts and is reached
// through `ctx.runQuery` / `ctx.runMutation`.
//
// The Grader is post-hoc by construction, not by convention. It is scheduled
// from `sessions.finalize`, after the Session row is already `ended`; it re-
// checks that before spending a token; and it has no way to reach the Realtime
// call even if it wanted to — nothing here can influence a Session in progress.

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { GRADER_MODEL } from "../lib/constants";
import { graderSpendUsd } from "../spend";
import {
  ASSESSMENT_SCHEMA_NAME,
  alignToStandard,
  assessmentSchema,
} from "./assessmentSchema";
import { buildGraderPrompt } from "./prompt";

/** What one Grader run did. Returned for the logs and for a manual retry. */
const gradeOutcome = v.union(
  v.literal("complete"),
  v.literal("failed"),
  v.literal("already_complete"),
  v.literal("no_assessment"),
);

type GradeOutcome =
  | "complete"
  | "failed"
  | "already_complete"
  | "no_assessment";

function openaiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set on this Convex deployment. Convex functions " +
        "do not read .env.local — run `npx convex env set OPENAI_API_KEY ...`.",
    );
  }
  return new OpenAI({ apiKey });
}

/**
 * Produce the Assessment for one Session.
 *
 * Scheduled by `sessions.finalize` the moment a Session ends, and by
 * `assessments.retry` when a Teacher re-runs a failed one. Idempotent in the
 * direction that matters: a run that finds a `complete` Assessment returns
 * without calling the model, so a duplicate schedule costs nothing and cannot
 * overwrite a result a Teacher may already have released.
 *
 * Every failure path — no Session, no Standard, no Transcript, an API error, a
 * refusal — lands the Assessment on `failed` rather than leaving it `pending`,
 * because `failed` is a state a Teacher can see and retry from and `pending` is
 * a state that looks like patience.
 */
export const gradeSession = internalAction({
  args: { sessionId: v.id("sessions") },
  returns: gradeOutcome,
  handler: async (ctx, args): Promise<GradeOutcome> => {
    const target = await ctx.runQuery(internal.assessments.forGraderRun, {
      sessionId: args.sessionId,
    });
    if (target === null) {
      // The Session-end seam creates no Assessment for a Session with no
      // Transcript. Nothing to fill in, and nothing to complain about.
      console.warn(
        `Grader: Session ${args.sessionId} has no Assessment row; nothing to ` +
          "produce. (A Session that never connected has no Transcript and is " +
          "deliberately left without one.)",
      );
      return "no_assessment";
    }
    if (target.status === "complete") {
      return "already_complete";
    }
    const assessmentId = target.assessmentId;

    const fail = async (reason: string): Promise<GradeOutcome> => {
      console.error(`Grader failed for Session ${args.sessionId}: ${reason}`);
      await ctx.runMutation(internal.assessments.recordFailed, {
        assessmentId,
      });
      return "failed";
    };

    try {
      const session = await ctx.runQuery(internal.sessions.forGrader, {
        sessionId: args.sessionId,
      });
      if (session === null) {
        return await fail("the Session row is gone.");
      }
      if (session.status !== "ended") {
        // Belt and braces on the post-hoc guarantee. The scheduler only ever
        // fires this after finalize has committed, so reaching here means
        // something else called it, and grading a running Session is exactly
        // the thing that must not happen.
        return await fail(
          `the Session is ${session.status}, not ended. The Grader is ` +
            "post-hoc and never runs against a live Session.",
        );
      }

      // The Transcript. Already time-box-clean: convex/transcript.ts refuses
      // writes past the server-side cutoff, so nothing spoken after the box
      // can be in here to be evaluated.
      const turns = await ctx.runQuery(internal.transcript.itemsForSession, {
        sessionId: args.sessionId,
      });
      if (turns.length === 0) {
        return await fail(
          "the Session has no Transcript. There is nothing to evaluate, and " +
            "an Assessment produced from nothing would be a fiction.",
        );
      }

      // The Standard. INV-3: this read, in this module, is the only one in the
      // codebase.
      const standard = await ctx.runQuery(
        internal.standards.getStandardForVersion,
        { assignmentVersionId: session.assignmentVersionId },
      );
      if (standard === null || standard.criteria.length === 0) {
        return await fail(
          "the pinned Assignment version has no Standard. Grading against " +
            "nothing is worse than not grading.",
        );
      }

      const prompt = buildGraderPrompt({
        assignmentTitle: session.assignmentTitle,
        assignmentPrompt: session.assignmentPrompt,
        criteria: standard.criteria,
        turns,
        // Fresh entropy per call: the fence a Student would have to guess to
        // speak as the system (see convex/grader/prompt.ts).
        nonce: crypto.randomUUID(),
      });

      const response = await openaiClient().responses.parse({
        model: GRADER_MODEL,
        input: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        // Strict structured output. The rating enum is enforced by the API
        // against this schema, which is why no code downstream checks ratings:
        // an out-of-enum rating cannot be generated, so a check for one would
        // be a branch that never runs.
        text: {
          format: zodTextFormat(assessmentSchema, ASSESSMENT_SCHEMA_NAME),
        },
      });

      // Spend first, and unconditionally. INV-4 edge (c): all model spend
      // counts. The tokens were bought whether or not the output was usable,
      // so the budget hears about them before anything else can throw.
      const usage = response.usage;
      if (usage !== undefined) {
        await ctx.runMutation(internal.spend.record, {
          kind: "grader",
          sessionId: args.sessionId,
          usd: graderSpendUsd(usage.input_tokens, usage.output_tokens),
        });
      }

      const parsed = response.output_parsed;
      if (parsed === null || parsed === undefined) {
        return await fail(
          `the model returned no parsed Assessment (status=${response.status}).`,
        );
      }

      await ctx.runMutation(internal.assessments.recordComplete, {
        assessmentId,
        // The rating enum comes from the API; the Criterion *set* comes from
        // the Standard. See `alignToStandard`.
        criteria: alignToStandard(standard.criteria, parsed.criteria),
        formativeSummary: parsed.formativeSummary,
        inv1Flags: parsed.inv1Flags,
        graderModel: GRADER_MODEL,
      });
      return "complete";
    } catch (error) {
      // Deliberately swallowed rather than rethrown. A scheduled action is
      // never retried by Convex, so throwing would buy nothing and cost the
      // `failed` write that makes this visible and retryable. The reason is in
      // the logs.
      return await fail(String(error));
    }
  },
});
