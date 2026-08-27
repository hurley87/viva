import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { getStandardByVersion, insertStandard } from "./standards";

const SEED_TEACHER_PRIVY_DID = "did:privy:seed-teacher";
const SEED_TEACHER_EMAIL = "teacher@viva.local";
const SEED_TEACHER_NAME = "Seed Teacher";
const SEED_ASSIGNMENT_TITLE = "What counts as understanding";
const SEED_ASSIGNMENT_PROMPT =
  "In an age of fluent AI-generated answers, what should count as evidence that a student actually understands a claim? Take a position and defend it orally.";

const SEED_CONFIG = {
  sessionsPerDay: 2,
  sessionsPerWeek: 8,
  timeboxSec: 900,
  warningAtSec: 780,
  minDurationSec: 180,
  monthlyBudgetUsd: 5000,
  releaseMode: "shadow" as const,
};

const SEED_CRITERIA = [
  {
    name: "Position",
    descriptor:
      "States a clear, stable claim about what should count as evidence of understanding, and holds that claim through the Session.",
  },
  {
    name: "Reasons",
    descriptor:
      "Supports the claim with at least two distinct reasons that do not merely restate the position.",
  },
  {
    name: "Counterargument",
    descriptor:
      "Engages a serious objection — for example that fluency is enough, or that live speech is too noisy to judge — and answers it without abandoning the claim.",
  },
  {
    name: "Concrete case",
    descriptor:
      "Uses a specific example or case (a student, an assignment, a failure mode) to show how the proposed evidence would work in practice.",
  },
  {
    name: "Limits",
    descriptor:
      "Names a condition under which the Student would change their mind, showing the claim has a boundary rather than being a slogan.",
  },
];

const seedResultValidator = v.object({
  alreadySeeded: v.boolean(),
  deploymentConfigId: v.id("deploymentConfig"),
  teacherId: v.id("users"),
  assignmentId: v.id("assignments"),
  assignmentVersionId: v.id("assignmentVersions"),
  standardId: v.id("standards"),
});

/**
 * Idempotent demo seed. Run via CLI (admin access):
 *   npx convex run seed:seed
 */
export const seed = internalMutation({
  args: {},
  returns: seedResultValidator,
  handler: async (ctx) => {
    const existingConfig = await ctx.db.query("deploymentConfig").first();
    const deploymentConfigId = existingConfig
      ? existingConfig._id
      : await ctx.db.insert("deploymentConfig", SEED_CONFIG);

    if (existingConfig) {
      await ctx.db.patch("deploymentConfig", existingConfig._id, SEED_CONFIG);
    }

    const existingTeacher = await ctx.db
      .query("users")
      .withIndex("by_privyDid", (q) => q.eq("privyDid", SEED_TEACHER_PRIVY_DID))
      .unique();

    const teacherId = existingTeacher
      ? existingTeacher._id
      : await ctx.db.insert("users", {
          privyDid: SEED_TEACHER_PRIVY_DID,
          email: SEED_TEACHER_EMAIL,
          displayName: SEED_TEACHER_NAME,
          role: "teacher",
          status: "active",
        });

    const teacherAssignments = await ctx.db.query("assignments").take(50);
    const existingAssignment = teacherAssignments.find(
      (assignment) =>
        assignment.teacherId === teacherId &&
        assignment.title === SEED_ASSIGNMENT_TITLE,
    );

    const assignmentId = existingAssignment
      ? existingAssignment._id
      : await ctx.db.insert("assignments", {
          title: SEED_ASSIGNMENT_TITLE,
          teacherId,
        });

    const existingVersion = await ctx.db
      .query("assignmentVersions")
      .withIndex("by_assignment", (q) =>
        q.eq("assignmentId", assignmentId).eq("version", 1),
      )
      .unique();

    const assignmentVersionId = existingVersion
      ? existingVersion._id
      : await ctx.db.insert("assignmentVersions", {
          assignmentId,
          version: 1,
          prompt: SEED_ASSIGNMENT_PROMPT,
          publishedAt: Date.now(),
        });

    const existingStandard = await getStandardByVersion(
      ctx,
      assignmentVersionId,
    );
    const standardId = existingStandard
      ? existingStandard._id
      : await insertStandard(ctx, {
          assignmentVersionId,
          criteria: SEED_CRITERIA,
        });

    return {
      alreadySeeded: existingConfig !== null && existingTeacher !== null,
      deploymentConfigId,
      teacherId,
      assignmentId,
      assignmentVersionId,
      standardId,
    };
  },
});
