import { v } from "convex/values";
import { studentMutation } from "./lib/customFunctions";
import { loadDeploymentConfig } from "./lib/caps";
import {
  transcriptWritesOpen,
  upsertTranscriptSnapshot,
} from "./lib/transcript";
import {
  transcriptSnapshotItemValidator,
  transcriptUpsertResultValidator,
} from "./lib/validators";

export const upsertSnapshot = studentMutation({
  args: {
    sessionId: v.id("sessions"),
    items: v.array(transcriptSnapshotItemValidator),
  },
  returns: transcriptUpsertResultValidator,
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.studentId !== ctx.user._id) {
      throw new Error("Session not found");
    }

    const config = await loadDeploymentConfig(ctx);
    if (
      !transcriptWritesOpen({
        session,
        timeboxSec: config.timeboxSec,
        now: Date.now(),
      })
    ) {
      return { accepted: false };
    }

    await upsertTranscriptSnapshot(ctx, args.sessionId, args.items);
    return { accepted: true };
  },
});
