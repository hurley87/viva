// Deployment seed — run with `npm run seed` (npx convex run internal.seed.run).
//
// Idempotent: every row is looked up by a stable natural key first, so
// re-running never duplicates and never overwrites. It creates the minimum a
// deployment needs to be demonstrable:
//   - the `deploymentConfig` singleton (INV-4 caps, breaker, time-box, shadow
//     release mode)
//   - one Teacher
//   - one Assignment with published version 1 and a real oral-examination
//     prompt
//   - that version's Standard, written through convex/standards.ts (INV-3:
//     this module never touches the `standards` table itself)
//
// Accounts are normally created by hand-provisioning (PRD §6: pre-create the
// Privy user, allowlist the email, insert the Convex user row). The seeded
// Teacher below carries a PLACEHOLDER privyDid so the deployment is usable
// before Privy is wired up — ticket #2 replaces it with the real DID.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

// ---------------------------------------------------------------------------
// Seeded values
// ---------------------------------------------------------------------------

/** Placeholder Privy DID for the seeded Teacher. Replaced at provisioning. */
const SEED_TEACHER_PRIVY_DID = "did:privy:seed-teacher";
const SEED_TEACHER_EMAIL = "teacher@viva.local";
const SEED_TEACHER_DISPLAY_NAME = "Seed Teacher";

const SEED_ASSIGNMENT_TITLE =
  "Technology and politics as drivers of change in war";

/**
 * What the Examiner receives, and the only Assignment content that ever
 * reaches a live Session (INV-3). Written as a spoken task: there is no
 * artifact and no written submission (PRD v1.4 — oral only).
 */
const SEED_ASSIGNMENT_PROMPT = [
  '"Technology has changed war more than politics has."',
  "",
  "Take a position on this claim and defend it with historical evidence drawn",
  "from at least two different eras. You will be asked to justify your",
  "position, to say what it rules out, to meet counterexamples, and to state",
  "what evidence would change your mind. This is a spoken response: bring your",
  "reasoning, not a script.",
].join("\n");

/**
 * The Standard for version 1: what a competent oral response to the above must
 * demonstrate. Six named Criteria, each with a short descriptor (PRD §8:
 * 3–7 criteria, 1–3 sentences each). Consumed only by the Grader.
 */
const SEED_STANDARD_CRITERIA = [
  {
    name: "Clear position",
    descriptor:
      "The Student states a definite position on the claim early and holds it consistently across the Session. Qualifications are made explicitly rather than by quiet retreat once the position is pressed.",
  },
  {
    name: "Historical evidence",
    descriptor:
      "The position is supported with specific cases — named conflicts, technologies, or political settlements — from at least two different eras. Each case is described accurately enough that its relevance can be checked, not merely gestured at.",
  },
  {
    name: "Causal reasoning",
    descriptor:
      "The Student explains how the cause they favour actually produced the change in warfare, rather than noting that the two coincided. Mechanism is distinguished from correlation and from simple chronology.",
  },
  {
    name: "Engagement with counterexamples",
    descriptor:
      "When given a case that cuts against the position, the Student engages it directly: conceding it, distinguishing it, or explaining why it does not bear on the claim. Restating the original position or changing the subject does not count as engagement.",
  },
  {
    name: "Conceptual precision",
    descriptor:
      "The Student can say what \"technology\", \"politics\", and \"changed war\" mean inside their argument, and the meanings stay stable under pressure. Ambiguity is resolved when named rather than used to slide between readings.",
  },
  {
    name: "Limits of the claim",
    descriptor:
      "The Student can say what their position rules out and name evidence that would count against it. Recognising the strongest opposing case is part of holding a defensible position, not a concession of it.",
  },
];

/**
 * INV-4 defaults (PRD §4). Caps and the breaker ceiling are config-only in the
 * MVP — there is no settings UI, so this row is the whole control surface.
 *
 * `monthlyBudgetUsd` is a deliberately generous placeholder — the whole $5K
 * grant, so the breaker exists and is testable without throttling the pilot
 * before anyone knows what a Session costs. The real per-Session and
 * per-Student-week arithmetic, and the ceiling that follows from it, are the
 * open cost-model ticket (`.scratch/viva-mvp/issues/08-cost-model.md`).
 *
 * `releaseMode: "shadow"` is the cold-start default (PRD §8): a deployment's
 * first real Sessions release Assessments to the Teacher only, until the
 * Teacher has spot-checked Grader quality.
 */
const SEED_DEPLOYMENT_CONFIG = {
  sessionsPerDay: 2,
  sessionsPerWeek: 8,
  timeboxSec: 900,
  warningAtSec: 780,
  minDurationSec: 180,
  monthlyBudgetUsd: 5000,
  releaseMode: "shadow" as const,
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/** Whether the seed inserted a row or found one already there. */
type SeedState = "created" | "existing";

/**
 * Explicit so TypeScript can type this module: `seed.ts` imports `internal`,
 * which is generated from every module including this one, so the handler's
 * return type has to be annotated to break the inference cycle.
 */
type SeedReport = {
  deploymentConfig: SeedState;
  teacher: SeedState;
  assignment: SeedState;
  assignmentVersion: SeedState;
  standard: SeedState;
};

export const run = internalMutation({
  args: {},
  returns: v.object({
    deploymentConfig: v.string(),
    teacher: v.string(),
    assignment: v.string(),
    assignmentVersion: v.string(),
    standard: v.string(),
  }),
  handler: async (ctx): Promise<SeedReport> => {
    // deploymentConfig singleton -------------------------------------------
    let configState: SeedState = "existing";
    const existingConfig = await ctx.db.query("deploymentConfig").first();
    if (existingConfig === null) {
      await ctx.db.insert("deploymentConfig", SEED_DEPLOYMENT_CONFIG);
      configState = "created";
    }

    // Teacher ---------------------------------------------------------------
    let teacherState: SeedState = "existing";
    let teacher = await ctx.db
      .query("users")
      .withIndex("by_privyDid", (q) =>
        q.eq("privyDid", SEED_TEACHER_PRIVY_DID),
      )
      .unique();
    if (teacher === null) {
      const teacherId = await ctx.db.insert("users", {
        privyDid: SEED_TEACHER_PRIVY_DID,
        email: SEED_TEACHER_EMAIL,
        displayName: SEED_TEACHER_DISPLAY_NAME,
        role: "teacher",
        status: "active",
      });
      teacher = await ctx.db.get("users", teacherId);
      teacherState = "created";
    }
    if (teacher === null) {
      throw new Error("Seed failed: Teacher row could not be read back.");
    }

    // Assignment ------------------------------------------------------------
    // `assignments` has no index in the approved schema; the table is tiny
    // (one Assignment in the MVP), so a scan is correct and cheap here.
    let assignmentState: SeedState = "existing";
    const assignments = await ctx.db.query("assignments").collect();
    let assignment =
      assignments.find((a) => a.title === SEED_ASSIGNMENT_TITLE) ?? null;
    if (assignment === null) {
      const assignmentId = await ctx.db.insert("assignments", {
        title: SEED_ASSIGNMENT_TITLE,
        teacherId: teacher._id,
      });
      assignment = await ctx.db.get("assignments", assignmentId);
      assignmentState = "created";
    }
    if (assignment === null) {
      throw new Error("Seed failed: Assignment row could not be read back.");
    }

    // Published version 1 ---------------------------------------------------
    // Published versions are immutable by construction: this is the only write
    // path for `assignmentVersions`, and it only ever inserts.
    let versionState: SeedState = "existing";
    let version = await ctx.db
      .query("assignmentVersions")
      .withIndex("by_assignment", (q) =>
        q.eq("assignmentId", assignment._id).eq("version", 1),
      )
      .unique();
    if (version === null) {
      const versionId = await ctx.db.insert("assignmentVersions", {
        assignmentId: assignment._id,
        version: 1,
        prompt: SEED_ASSIGNMENT_PROMPT,
        publishedAt: Date.now(),
      });
      version = await ctx.db.get("assignmentVersions", versionId);
      versionState = "created";
    }
    if (version === null) {
      throw new Error(
        "Seed failed: Assignment version row could not be read back.",
      );
    }

    // Standard --------------------------------------------------------------
    // INV-3: written through convex/standards.ts, never touched directly here.
    // Annotated to break the `internal` inference cycle, and deliberately
    // narrow: this module never handles a Standard id or its content.
    const standard: { created: boolean } = await ctx.runMutation(
      internal.standards.createStandardForVersion,
      {
        assignmentVersionId: version._id,
        criteria: SEED_STANDARD_CRITERIA,
      },
    );

    return {
      deploymentConfig: configState,
      teacher: teacherState,
      assignment: assignmentState,
      assignmentVersion: versionState,
      standard: standard.created ? "created" : "existing",
    };
  },
});
