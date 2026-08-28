import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  SECRET_ASSESSMENT_SUMMARY,
  SECRET_TRANSCRIPT,
  STUDENT_EMAIL,
  STUDENT_NAME,
  assertNoSecrets,
  identity,
  seedEndedSessionWithSecrets,
  seedWorld,
} from "../test.fixtures";
import { modules } from "../test.setup";

/**
 * INV-2: every public Convex function must be exercised here as Operator.
 * When you add a public export, call it from this file and prove it cannot
 * return transcript bodies, Assessment content, or Student identity.
 */

function setup() {
  return convexTest(schema, modules);
}

test("operator identity does not leak student, transcript, or assessment secrets", async () => {
  const t = setup();
  const { sessionId, assessmentId } = await t.run(async (ctx) => {
    const world = await seedWorld(ctx);
    return await seedEndedSessionWithSecrets(ctx, world);
  });
  const asOperator = t.withIdentity(identity.operator);

  const me = await asOperator.query(api.users.me, {});
  assertNoSecrets(me);
  expect(me?.role).toBe("operator");

  const whoami = await asOperator.query(api.users.whoami, {});
  assertNoSecrets(whoami);

  const health = await asOperator.query(api.health.status, {});
  assertNoSecrets(health);

  const metrics = await asOperator.query(api.operator.metrics, {
    now: Date.now(),
  });
  assertNoSecrets(metrics);
  expect(metrics.sessionCount).toBe(1);
  expect(metrics.completeAssessmentCount).toBe(1);
  expect(metrics.inv1FlagCount).toBe(1);

  await expect(asOperator.query(api.sessions.get, { sessionId })).rejects.toThrow(
    /Unauthorized/i,
  );
  await expect(asOperator.mutation(api.sessions.mint, {})).rejects.toThrow(
    /Unauthorized/i,
  );
  await expect(
    asOperator.mutation(api.sessions.reportCallId, {
      sessionId,
      openaiCallId: "call_x",
    }),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(
    asOperator.mutation(api.sessions.end, {
      sessionId,
      reason: "student_request",
    }),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(
    asOperator.mutation(api.transcripts.upsertSnapshot, {
      sessionId,
      items: [
        {
          itemId: "leak",
          orderKey: 99,
          speaker: "student",
          text: "should not write",
          textStatus: "final",
        },
      ],
    }),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(
    asOperator.mutation(api.assessments.release, { assessmentId }),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(
    asOperator.mutation(api.assessments.retry, { assessmentId }),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(
    asOperator.mutation(api.transcriptShares.grant, {
      sessionId,
      reason: "debug",
    }),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(
    asOperator.query(api.transcriptShares.getForSession, { sessionId }),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(
    asOperator.query(api.studentFeedback.listMine, {}),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(
    asOperator.query(api.studentFeedback.getMine, { sessionId }),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(asOperator.query(api.teacher.listSessions, {})).rejects.toThrow(
    /Unauthorized/i,
  );
  await expect(
    asOperator.query(api.teacher.getSession, { sessionId }),
  ).rejects.toThrow(/Unauthorized/i);
  await expect(
    asOperator.action(api.realtime.createClientSecret, { sessionId }),
  ).rejects.toThrow(/Unauthorized/i);
});

test("break-glass transcript read requires a Teacher-granted share row", async () => {
  const t = setup();
  const { sessionId, otherSessionId } = await t.run(async (ctx) => {
    const world = await seedWorld(ctx);
    const owned = await seedEndedSessionWithSecrets(ctx, world);
    const other = await seedEndedSessionWithSecrets(ctx, world, {
      openaiCallId: "call_other",
      transcriptText: "OTHER_SESSION_TRANSCRIPT",
    });
    return {
      sessionId: owned.sessionId,
      otherSessionId: other.sessionId,
    };
  });
  const asOperator = t.withIdentity(identity.operator);
  const asTeacher = t.withIdentity(identity.teacher);

  await expect(
    asOperator.query(api.operator.getSharedTranscript, { sessionId }),
  ).rejects.toThrow(/Unauthorized|share required/i);

  const visibleBefore = await asTeacher.query(
    api.transcriptShares.getForSession,
    { sessionId },
  );
  expect(visibleBefore).toBeNull();

  const shareId = await asTeacher.mutation(api.transcriptShares.grant, {
    sessionId,
    reason: "Need to debug a grader mismatch",
  });

  const visible = await asTeacher.query(api.transcriptShares.getForSession, {
    sessionId,
  });
  expect(visible?._id).toBe(shareId);
  expect(visible?.reason).toBe("Need to debug a grader mismatch");
  expect(visible?.sessionId).toBe(sessionId);

  const shared = await asOperator.query(api.operator.getSharedTranscript, {
    sessionId,
  });
  expect(shared.items.some((item) => item.text === SECRET_TRANSCRIPT)).toBe(
    true,
  );
  expect(JSON.stringify(shared)).not.toContain(STUDENT_EMAIL);
  expect(JSON.stringify(shared)).not.toContain(STUDENT_NAME);
  expect(JSON.stringify(shared)).not.toContain(SECRET_ASSESSMENT_SUMMARY);

  await expect(
    asOperator.query(api.operator.getSharedTranscript, {
      sessionId: otherSessionId,
    }),
  ).rejects.toThrow(/Unauthorized|share required/i);

  const shareAgain = await asTeacher.mutation(api.transcriptShares.grant, {
    sessionId,
    reason: "attempted rewrite",
  });
  expect(shareAgain).toBe(shareId);

  const stillVisible = await asTeacher.query(
    api.transcriptShares.getForSession,
    { sessionId },
  );
  expect(stillVisible?._id).toBe(shareId);
  expect(stillVisible?.reason).toBe("Need to debug a grader mismatch");

  const shareCount = await t.run(async (ctx) => {
    return (await ctx.db.query("transcriptShares").take(16)).length;
  });
  expect(shareCount).toBe(1);
});
