import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const STUDENT_DID = "did:privy:inv2-student";
export const TEACHER_DID = "did:privy:inv2-teacher";
export const OPERATOR_DID = "did:privy:inv2-operator";

export const STUDENT_EMAIL = "student-secret-inv2@example.com";
export const STUDENT_NAME = "StudentSecretNameInv2";
export const SECRET_TRANSCRIPT = "INV2_SECRET_TRANSCRIPT_QUOTE";
export const SECRET_ASSESSMENT_SUMMARY = "INV2_SECRET_ASSESSMENT_SUMMARY";
export const SECRET_ASSESSMENT_EVIDENCE = "INV2_SECRET_EVIDENCE_QUOTE";
export const SECRET_STANDARD_DESCRIPTOR =
  "INV2_SECRET_STANDARD_DESCRIPTOR_MUST_NOT_LEAK";

export const identity = {
  student: { subject: STUDENT_DID, issuer: "privy.io" },
  teacher: { subject: TEACHER_DID, issuer: "privy.io" },
  operator: { subject: OPERATOR_DID, issuer: "privy.io" },
} as const;

export const DEFAULT_CONFIG = {
  sessionsPerDay: 2,
  sessionsPerWeek: 8,
  timeboxSec: 900,
  warningAtSec: 780,
  minDurationSec: 180,
  monthlyBudgetUsd: 5000,
  releaseMode: "shadow" as const,
};

export type SeededWorld = {
  teacherId: Id<"users">;
  studentId: Id<"users">;
  operatorId: Id<"users">;
  assignmentId: Id<"assignments">;
  assignmentVersionId: Id<"assignmentVersions">;
  standardId: Id<"standards">;
  configId: Id<"deploymentConfig">;
};

type SeedOptions = {
  config?: Partial<typeof DEFAULT_CONFIG>;
};

export async function seedWorld(
  ctx: MutationCtx,
  options: SeedOptions = {},
): Promise<SeededWorld> {
  const config = { ...DEFAULT_CONFIG, ...options.config };

  const teacherId = await ctx.db.insert("users", {
    privyDid: TEACHER_DID,
    email: "teacher@viva.example",
    displayName: "Seed Teacher",
    role: "teacher",
    status: "active",
  });
  const studentId = await ctx.db.insert("users", {
    privyDid: STUDENT_DID,
    email: STUDENT_EMAIL,
    displayName: STUDENT_NAME,
    role: "student",
    status: "active",
  });
  const operatorId = await ctx.db.insert("users", {
    privyDid: OPERATOR_DID,
    email: "operator@viva.example",
    displayName: "Operator",
    role: "operator",
    status: "active",
  });

  const assignmentId = await ctx.db.insert("assignments", {
    title: "INV fixture assignment",
    teacherId,
  });
  const assignmentVersionId = await ctx.db.insert("assignmentVersions", {
    assignmentId,
    version: 1,
    prompt: "Defend a claim about what counts as understanding.",
    publishedAt: Date.now(),
  });
  const standardId = await ctx.db.insert("standards", {
    assignmentVersionId,
    criteria: [
      { name: "Position", descriptor: SECRET_STANDARD_DESCRIPTOR },
      { name: "Reasons", descriptor: "Gives at least two distinct reasons." },
      { name: "Limits", descriptor: "Names a boundary of the claim." },
    ],
  });
  const configId = await ctx.db.insert("deploymentConfig", config);

  return {
    teacherId,
    studentId,
    operatorId,
    assignmentId,
    assignmentVersionId,
    standardId,
    configId,
  };
}

export async function seedEndedSessionWithSecrets(
  ctx: MutationCtx,
  world: SeededWorld,
  extra?: {
    startedAt?: number;
    openaiCallId?: string;
    transcriptText?: string;
  },
): Promise<{
  sessionId: Id<"sessions">;
  assessmentId: Id<"assessments">;
}> {
  const sessionId = await ctx.db.insert("sessions", {
    studentId: world.studentId,
    assignmentVersionId: world.assignmentVersionId,
    status: "ended",
    startedAt: extra?.startedAt ?? Date.now() - 240_000,
    endedAt: Date.now(),
    endReason: "student_hangup",
    openaiCallId: extra?.openaiCallId ?? "call_secret",
    countsAgainstCaps: true,
  });

  await ctx.db.insert("transcriptItems", {
    sessionId,
    itemId: extra?.openaiCallId ?? "item-secret",
    orderKey: 1,
    speaker: "student",
    text: extra?.transcriptText ?? SECRET_TRANSCRIPT,
    textStatus: "final",
  });

  const assessmentId = await ctx.db.insert("assessments", {
    sessionId,
    status: "complete",
    criteria: [
      {
        name: "Position",
        rating: "established",
        evidence: [SECRET_ASSESSMENT_EVIDENCE],
      },
    ],
    formativeSummary: SECRET_ASSESSMENT_SUMMARY,
    inv1Flags: [
      {
        quote: SECRET_TRANSCRIPT,
        explanation: "examiner supplied a position",
      },
    ],
    graderModel: "gpt-5.6-sol",
    released: true,
    releasedAt: Date.now(),
  });

  return { sessionId, assessmentId };
}

export function assertNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  const secrets = [
    STUDENT_EMAIL,
    STUDENT_NAME,
    SECRET_TRANSCRIPT,
    SECRET_ASSESSMENT_SUMMARY,
    SECRET_ASSESSMENT_EVIDENCE,
    SECRET_STANDARD_DESCRIPTOR,
    STUDENT_DID,
  ];
  for (const secret of secrets) {
    if (serialized.includes(secret)) {
      throw new Error(`INV-2 leak: payload contained ${secret}`);
    }
  }
}
