// The two-minute warning is a contract between three places, not a setting.
//
// The Examiner's instruction template hard-codes the note text
// `[SYSTEM: two minutes remaining]` and the spoken line "Two minutes left."
// (assets/07-examiner-prompt.prototype.md, lifted into
// convex/examiner/instructions.ts), and PRD §7 specifies a two-minute warning.
// `deploymentConfig.warningAtSec` is therefore not a free-floating warning
// point — it is when *that* warning fires.
//
// The seeded values (900/780) satisfy the contract by construction, so nothing
// else in the suite would notice a deployment that broke it. What a Student
// would notice is the Examiner announcing two minutes when five remain.

import { describe, expect, test } from "vitest";
import { buildExaminerInstructions } from "../examiner/instructions";
import { WARNING_LEAD_SEC, getDeploymentConfig } from "../lib/config";
import { DEFAULT_CONFIG, seedWorld } from "../../test/invariants/world";

const modules = import.meta.glob("../**/*.ts");

const CONTRACT =
  "the Examiner's two-minute warning (PRD §7 / examiner instructions)";

describe(CONTRACT, () => {
  test("the seeded deployment gives the warning exactly two minutes out", () => {
    expect(DEFAULT_CONFIG.timeboxSec - DEFAULT_CONFIG.warningAtSec).toBe(
      WARNING_LEAD_SEC,
    );
  });

  test("the Examiner is told to say 'Two minutes left.' on the warning note", () => {
    const instructions = buildExaminerInstructions("Any Assignment prompt.");
    expect(instructions).toContain("[SYSTEM: two minutes remaining]");
    expect(instructions).toContain("Two minutes left.");
  });

  test("a config whose warning is not two minutes out is refused, not obeyed", async () => {
    // A Teacher shortens the time-box but leaves the warning far from the end:
    // a warning five minutes out, which the Examiner would announce as two.
    const { t } = await seedWorld(modules, {
      timeboxSec: 600,
      warningAtSec: 300,
    });
    await expect(
      t.run(async (ctx) => await getDeploymentConfig(ctx)),
    ).rejects.toThrow(/warningAtSec must be 120s before timeboxSec/);
  });

  test("a shortened time-box that keeps the two-minute lead is accepted", async () => {
    const { t } = await seedWorld(modules, {
      timeboxSec: 600,
      warningAtSec: 480,
    });
    const config = await t.run(
      async (ctx) => await getDeploymentConfig(ctx),
    );
    expect(config.timeboxSec - config.warningAtSec).toBe(WARNING_LEAD_SEC);
  });
});
