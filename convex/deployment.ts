// Deployment readiness — the one public query the app can call before auth
// exists, used by the landing page to prove the browser reaches Convex.
//
// It returns counts and booleans only: no Assignment content, no Standard, no
// Student identity, no transcript. Nothing here is sensitive enough to need an
// identity check, which is why it can ship before auth (ticket #2). Every
// other public function added later must resolve its caller through
// convex/lib/identity.ts.

import { v } from "convex/values";
import { query } from "./_generated/server";
import { getDeploymentConfigOrNull } from "./lib/config";

export const readiness = query({
  args: {},
  returns: v.object({
    seeded: v.boolean(),
    assignmentCount: v.number(),
    publishedVersionCount: v.number(),
    releaseMode: v.union(
      v.literal("shadow"),
      v.literal("auto"),
      v.literal("unset"),
    ),
  }),
  handler: async (ctx) => {
    const config = await getDeploymentConfigOrNull(ctx);
    const assignments = await ctx.db.query("assignments").collect();
    const versions = await ctx.db.query("assignmentVersions").collect();
    return {
      seeded: config !== null,
      assignmentCount: assignments.length,
      publishedVersionCount: versions.length,
      releaseMode: config === null ? ("unset" as const) : config.releaseMode,
    };
  },
});
