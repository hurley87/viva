// The world the invariant suite runs against, and the sentinels that make a
// leak visible.
//
// Every piece of content a Student produced, or that identifies a Student, is
// seeded as a distinctive string. That is what lets the INV-2 test assert
// something stronger than "these fields look right": it can call every exported
// function in the codebase, serialize whatever comes back, and fail if any
// sentinel appears anywhere in it. A newly added function that leaks a
// Transcript is caught without anybody remembering to write a test for it.
//
// Why this fixture lives outside `convex/`: Convex pushes every `.ts` file in
// that directory except `*.test.ts`, and analyses it in its own runtime. A
// fixture there would be bundled into the deployment, and one that imports
// `convex-test` or calls `import.meta.glob` fails the push outright
// ("import.meta unsupported"), taking the whole deployment down with it. Test
// suites stay in `convex/tests/*.test.ts`, which the push skips; everything
// they share lives here.

import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

export type TestWorldConvex = TestConvex<typeof schema>;

/** The Convex function modules, as convex-test wants them. */
export type ConvexModules = Record<string, () => Promise<unknown>>;

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

export const TEACHER_DID = "did:privy:test-teacher";
export const STUDENT_DID = "did:privy:SENTINEL-STUDENT-DID";
export const OTHER_STUDENT_DID = "did:privy:test-other-student";
export const OPERATOR_DID = "did:privy:test-operator";

// ---------------------------------------------------------------------------
// Sentinels — anything an Operator must never see
// ---------------------------------------------------------------------------

/**
 * Student identity, Transcript bodies, Assessment content, and Standard
 * content, each as a string that appears nowhere else in the repository.
 *
 * Grouped by what they prove, because the INV-2 failure message names the
 * group: "the Operator obtained Student identity" is a different bug report
 * from "the Operator obtained a Transcript body".
 */
export const SENTINELS = {
  studentIdentity: [
    STUDENT_DID,
    "SENTINEL-STUDENT-EMAIL@viva.invalid",
    "SENTINEL-STUDENT-DISPLAY-NAME",
  ],
  transcriptBody: [
    "SENTINEL-TRANSCRIPT-STUDENT-TURN",
    "SENTINEL-TRANSCRIPT-EXAMINER-TURN",
  ],
  assessmentContent: [
    "SENTINEL-ASSESSMENT-CRITERION",
    "SENTINEL-ASSESSMENT-EVIDENCE",
    "SENTINEL-FORMATIVE-SUMMARY",
    "SENTINEL-INV1-FLAG-QUOTE",
    "SENTINEL-INV1-FLAG-EXPLANATION",
  ],
  standardContent: [
    "SENTINEL-STANDARD-CRITERION",
    "SENTINEL-STANDARD-DESCRIPTOR",
  ],
} as const;

export type SentinelGroup = keyof typeof SENTINELS;

/** Every sentinel, with the group it belongs to. */
export function allSentinels(): { group: SentinelGroup; value: string }[] {
  return (Object.keys(SENTINELS) as SentinelGroup[]).flatMap((group) =>
    SENTINELS[group].map((value) => ({ group, value })),
  );
}

/**
 * The sentinels present in `text`, described the way a failing test should
 * report them: which guarantee broke, and with which string.
 */
export function sentinelsIn(text: string): string[] {
  return allSentinels()
    .filter(({ value }) => text.includes(value))
    .map(({ group, value }) => `${group}: "${value}"`);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export type DeploymentConfigFields = Omit<
  Doc<"deploymentConfig">,
  "_id" | "_creationTime"
>;

export const DEFAULT_CONFIG: DeploymentConfigFields = {
  sessionsPerDay: 2,
  sessionsPerWeek: 8,
  timeboxSec: 900,
  warningAtSec: 780,
  minDurationSec: 180,
  monthlyBudgetUsd: 5000,
  releaseMode: "auto",
};

export type WorldIds = {
  teacherId: Id<"users">;
  studentId: Id<"users">;
  otherStudentId: Id<"users">;
  operatorId: Id<"users">;
  assignmentId: Id<"assignments">;
  assignmentVersionId: Id<"assignmentVersions">;
  standardId: Id<"standards">;
  sessionId: Id<"sessions">;
  assessmentId: Id<"assessments">;
  transcriptItemId: Id<"transcriptItems">;
  spendEventId: Id<"spendEvents">;
  deploymentConfigId: Id<"deploymentConfig">;
  /**
   * A well-formed `transcriptShares` id that points at nothing: the row was
   * inserted and deleted. The INV-2 sweep needs an id of every table so it can
   * call every function, and it must not create a real share — the whole point
   * of the sweep is that the Operator has not been granted one.
   */
  danglingShareId: Id<"transcriptShares">;
};

export type World = { t: TestWorldConvex; ids: WorldIds };

/**
 * A seeded deployment: one Teacher, one Student (plus a second one, so
 * "somebody else's" is testable), one Operator, one published Assignment
 * version with its Standard, one ended Session with a Transcript and a complete
 * Assessment, and one spend event.
 *
 * No `transcriptShares` row. Default-deny is the state the break-glass tests
 * start from.
 */
export async function seedWorld(
  modules: ConvexModules,
  overrides: Partial<DeploymentConfigFields> = {},
): Promise<World> {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx): Promise<WorldIds> => {
    const deploymentConfigId = await ctx.db.insert("deploymentConfig", {
      ...DEFAULT_CONFIG,
      ...overrides,
    });

    const teacherId = await ctx.db.insert("users", {
      privyDid: TEACHER_DID,
      email: "teacher@viva.local",
      displayName: "Teacher",
      role: "teacher",
      status: "active",
    });
    const studentId = await ctx.db.insert("users", {
      privyDid: STUDENT_DID,
      email: "SENTINEL-STUDENT-EMAIL@viva.invalid",
      displayName: "SENTINEL-STUDENT-DISPLAY-NAME",
      role: "student",
      status: "active",
    });
    const otherStudentId = await ctx.db.insert("users", {
      privyDid: OTHER_STUDENT_DID,
      email: "other-student@viva.local",
      displayName: "Other Student",
      role: "student",
      status: "active",
    });
    const operatorId = await ctx.db.insert("users", {
      privyDid: OPERATOR_DID,
      email: "operator@viva.local",
      displayName: "Operator",
      role: "operator",
      status: "active",
    });

    const assignmentId = await ctx.db.insert("assignments", {
      title: "Assignment under examination",
      teacherId,
    });
    const assignmentVersionId = await ctx.db.insert("assignmentVersions", {
      assignmentId,
      version: 1,
      prompt:
        "Defend or reject the claim that deterrence requires credibility " +
        "more than capability.",
      publishedAt: Date.now(),
    });
    const standardId = await ctx.db.insert("standards", {
      assignmentVersionId,
      criteria: [
        {
          name: "SENTINEL-STANDARD-CRITERION",
          descriptor: "SENTINEL-STANDARD-DESCRIPTOR",
        },
      ],
    });

    const endedAt = Date.now();
    const sessionId = await ctx.db.insert("sessions", {
      studentId,
      assignmentVersionId,
      status: "ended",
      startedAt: endedAt - 600_000,
      endedAt,
      endReason: "student_hangup",
      countsAgainstCaps: true,
    });

    const transcriptItemId = await ctx.db.insert("transcriptItems", {
      sessionId,
      itemId: "item-1",
      orderKey: 1,
      speaker: "student",
      text: "SENTINEL-TRANSCRIPT-STUDENT-TURN",
      textStatus: "final",
    });
    await ctx.db.insert("transcriptItems", {
      sessionId,
      itemId: "item-2",
      orderKey: 2,
      speaker: "examiner",
      text: "SENTINEL-TRANSCRIPT-EXAMINER-TURN",
      textStatus: "final",
    });

    const assessmentId = await ctx.db.insert("assessments", {
      sessionId,
      status: "complete",
      criteria: [
        {
          name: "SENTINEL-ASSESSMENT-CRITERION",
          rating: "established",
          evidence: ["SENTINEL-ASSESSMENT-EVIDENCE"],
        },
      ],
      formativeSummary: "SENTINEL-FORMATIVE-SUMMARY",
      inv1Flags: [
        {
          quote: "SENTINEL-INV1-FLAG-QUOTE",
          explanation: "SENTINEL-INV1-FLAG-EXPLANATION",
        },
      ],
      graderModel: "gpt-5.6-sol",
      released: true,
      releasedAt: endedAt,
    });

    const spendEventId = await ctx.db.insert("spendEvents", {
      kind: "realtime",
      sessionId,
      usd: 3,
    });

    const throwaway = await ctx.db.insert("transcriptShares", {
      sessionId,
      grantedByTeacherId: teacherId,
      reason: "throwaway — deleted immediately, see danglingShareId",
    });
    await ctx.db.delete("transcriptShares", throwaway);

    return {
      teacherId,
      studentId,
      otherStudentId,
      operatorId,
      assignmentId,
      assignmentVersionId,
      standardId,
      sessionId,
      assessmentId,
      transcriptItemId,
      spendEventId,
      deploymentConfigId,
      danglingShareId: throwaway,
    };
  });
  return { t, ids };
}
