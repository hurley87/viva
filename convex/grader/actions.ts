"use node";

import { v } from "convex/values";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { assessmentOutputSchema } from "../../shared/assessmentSchema";
import { alignCriteriaToStandard } from "./align";
import { resolveGraderModel } from "./constants";
import { estimateGraderSpendUsd } from "./cost";
import { buildGraderUserPayload, GRADER_SYSTEM_PROMPT } from "./prompt";

function requireOpenAiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set on the Convex deployment. Add it with npx convex env set OPENAI_API_KEY.",
    );
  }
  return apiKey;
}

function extractRefusal(output: OpenAI.Responses.Response["output"]): string | null {
  for (const item of output) {
    if (item.type !== "message") {
      continue;
    }
    for (const part of item.content) {
      if (part.type === "refusal") {
        return part.refusal;
      }
    }
  }
  return null;
}

const gradeResultValidator = v.object({
  status: v.union(
    v.literal("complete"),
    v.literal("failed"),
    v.literal("skipped"),
  ),
});

export const gradeSession = internalAction({
  args: { sessionId: v.id("sessions") },
  returns: gradeResultValidator,
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.grader.queries.loadGradingContext, {
      sessionId: args.sessionId,
    });

    if (context.kind === "skip") {
      return { status: "skipped" as const };
    }

    if (context.kind === "unready") {
      try {
        await ctx.runMutation(internal.grader.mutations.markFailed, {
          sessionId: args.sessionId,
        });
      } catch (error) {
        console.error("Grader markFailed failed", error);
      }
      console.error("Grader unready", context.reason);
      return { status: "failed" as const };
    }

    let usd: number | undefined;
    try {
      const apiKey = requireOpenAiKey();
      const graderModel = resolveGraderModel();
      const openai = new OpenAI({ apiKey });
      const response = await openai.responses.parse({
        model: graderModel,
        input: [
          { role: "system", content: GRADER_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildGraderUserPayload({
              assignmentPrompt: context.assignmentPrompt,
              criteria: context.criteria,
              transcript: context.transcript,
            }),
          },
        ],
        text: {
          format: zodTextFormat(assessmentOutputSchema, "assessment"),
        },
      });

      usd = estimateGraderSpendUsd(response.usage);

      const parsed = response.output_parsed;
      if (!parsed) {
        const refusal = extractRefusal(response.output);
        throw new Error(
          refusal
            ? `Grader refused: ${refusal}`
            : "Grader refused or failed to parse",
        );
      }

      const criteria = alignCriteriaToStandard(context.criteria, parsed.criteria);

      await ctx.runMutation(internal.grader.mutations.writeAssessment, {
        sessionId: args.sessionId,
        criteria,
        formativeSummary: parsed.formativeSummary,
        inv1Flags: parsed.inv1Flags,
        graderModel,
        usd,
      });

      return { status: "complete" as const };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown grader error";
      console.error("Grader failed", message);
      try {
        await ctx.runMutation(internal.grader.mutations.markFailed, {
          sessionId: args.sessionId,
          ...(usd !== undefined ? { usd } : {}),
        });
      } catch (markError) {
        console.error("Grader markFailed failed", markError);
      }
      return { status: "failed" as const };
    }
  },
});
