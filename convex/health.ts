import { v } from "convex/values";
import { query } from "./_generated/server";

export const status = query({
  args: {},
  returns: v.object({
    ok: v.literal(true),
    hasSeed: v.boolean(),
  }),
  handler: async (ctx) => {
    const config = await ctx.db.query("deploymentConfig").first();
    return {
      ok: true as const,
      hasSeed: config !== null,
    };
  },
});
