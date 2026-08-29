// The `deploymentConfig` singleton reader.
//
// One row, hand-seeded (see convex/seed.ts). Every INV-4 decision — caps,
// breaker ceiling, time-box, forgiveness floor — and the shadow-period release
// mode read through here so there is exactly one place that knows the row is a
// singleton and exactly one error message when it is missing.

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type DeploymentConfig = Doc<"deploymentConfig">;

const UNSEEDED =
  "deploymentConfig is missing: this Convex deployment has not been seeded. " +
  "Run `npm run seed` (npx convex run internal.seed.run) before minting Sessions.";

/**
 * Read the deployment configuration singleton.
 *
 * @throws if the deployment has not been seeded — an unconfigured deployment
 * has no caps, no breaker ceiling and no time-box, so failing loudly is the
 * only safe behaviour under INV-4.
 */
export async function getDeploymentConfig(
  ctx: QueryCtx | MutationCtx,
): Promise<DeploymentConfig> {
  const config = await ctx.db.query("deploymentConfig").first();
  if (config === null) {
    throw new Error(UNSEEDED);
  }
  return config;
}

/**
 * Read the deployment configuration singleton, or `null` when the deployment
 * has not been seeded yet. For readiness/status surfaces only — anything that
 * enforces a cap must use {@link getDeploymentConfig} and fail closed.
 */
export async function getDeploymentConfigOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<DeploymentConfig | null> {
  return await ctx.db.query("deploymentConfig").first();
}
