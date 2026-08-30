// The `deploymentConfig` singleton reader.
//
// One row, hand-seeded (see convex/seed.ts). Every INV-4 decision — caps,
// breaker ceiling, time-box, forgiveness floor — and the shadow-period release
// mode read through here so there is exactly one place that knows the row is a
// singleton and exactly one error message when it is missing.

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type DeploymentConfig = Doc<"deploymentConfig">;

/**
 * The Examiner's instruction template (assets/07-examiner-prompt.prototype.md,
 * lifted into convex/examiner/instructions.ts) hard-codes the note text
 * `[SYSTEM: two minutes remaining]` and the spoken line "Two minutes left.",
 * and PRD §7 specifies a *two-minute* warning. `warningAtSec` is therefore not
 * a free-floating warning point: it is when that two-minute warning fires.
 *
 * A deployment that sets it anywhere else makes the Examiner say something
 * untrue to a Student under examination, which no test would otherwise catch
 * because the seeded values (900/780) satisfy it by construction.
 */
export const WARNING_LEAD_SEC = 120;

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
  assertWarningLead(config);
  return config;
}

/**
 * Fail closed when the configured warning point is not the two-minute warning
 * the Examiner is instructed to give. See {@link WARNING_LEAD_SEC}.
 */
function assertWarningLead(config: DeploymentConfig): void {
  const lead = config.timeboxSec - config.warningAtSec;
  if (lead !== WARNING_LEAD_SEC) {
    throw new Error(
      `deploymentConfig is inconsistent: warningAtSec must be ` +
        `${WARNING_LEAD_SEC}s before timeboxSec, because the Examiner is ` +
        `instructed to say "Two minutes left." when the warning note arrives ` +
        `(PRD §7). Got timeboxSec=${config.timeboxSec}, ` +
        `warningAtSec=${config.warningAtSec} (a ${lead}s lead).`,
    );
  }
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
