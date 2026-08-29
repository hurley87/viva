// INV-2 — No research data leaves the deployment boundary.
//
// PRD §4: "Operator role has no read access to transcript content — aggregate
// metrics and error logs only, enforced in Convex access rules, not
// convention", with a designed break-glass: "the Teacher — who already has read
// access — explicitly shares that single transcript with the Operator; the
// share is a Teacher action, logged and permanently visible on the transcript.
// The Operator access rule itself is never bypassed."
//
// Done-means: an access-rule test proving the Operator role cannot query
// transcript bodies, including via the share path without a Teacher grant.
//
// The central test here is a sweep, not a list. It discovers every public
// Convex function, calls each one as the Operator, and fails if any sentinel —
// a Transcript body, Assessment content, or Student identity — appears in what
// comes back. A public function added later is covered the moment it exists,
// which is the difference between a suite that holds and one that rots.

import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  actionRef,
  mutationRef,
  publicFunctions,
  queryRef,
  synthesizeArgs,
  validatorTypes,
} from "../../test/invariants/publicFunctions";
import { convexModules, tableWrites } from "../../test/invariants/sources";
import {
  OPERATOR_DID,
  OTHER_STUDENT_DID,
  STUDENT_DID,
  TEACHER_DID,
  seedWorld,
  sentinelsIn,
} from "../../test/invariants/world";

const INV2 = "INV-2 (operator blindness)";

const modules = import.meta.glob("../**/*.ts");

const sources = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The break-glass surface: the only Operator-callable functions permitted to
 * declare a string in their return type, because returning Teacher-authorised
 * Transcript content is precisely what they are for.
 */
const BREAK_GLASS_FUNCTIONS = ["transcriptForSession", "sharesForSession"];

describe("INV-2 — the Operator's surface is aggregates only", () => {
  test("an Operator function cannot even declare a return type that carries prose", async () => {
    const operatorFunctions = (await publicFunctions(modules)).filter(
      (fn) => fn.module === "operator",
    );
    expect(
      operatorFunctions.length,
      `${INV2}: no public functions were found in convex/operator.ts — the ` +
        "sweep is looking in the wrong place, or the Operator surface is gone.",
    ).toBeGreaterThan(0);

    for (const fn of operatorFunctions) {
      if (BREAK_GLASS_FUNCTIONS.includes(fn.name)) {
        continue;
      }
      const types = validatorTypes(fn.returns);
      const complaint =
        `${INV2}: ${fn.path} declares a return type containing ` +
        `[${types.join(", ")}]. An Operator function returns counts, sums, ` +
        "rates and booleans — nothing that can carry a Transcript body, " +
        "Assessment content, or a Student's name. If it genuinely must " +
        "return text, it is a break-glass function and has to be gated on a " +
        "Teacher-granted transcriptShares row.";
      expect(types, complaint).not.toContain("string");
      expect(types, complaint).not.toContain("bytes");
      expect(types, complaint).not.toContain("any");
    }
  });

  test("the aggregates are real: session counts, spend, error counts, INV-1 flag rate", async () => {
    const { t } = await seedWorld(modules);
    const metrics = await t
      .withIdentity({ subject: OPERATOR_DID })
      .query(api.operator.metrics, {});
    expect(metrics).toMatchObject({
      sessions: { total: 1, ended: 1, endedByStudentHangup: 1, forgiven: 0 },
      students: { active: 2, voided: 0 },
      transcript: { items: 2, failedAsrItems: 0 },
      assessments: { total: 1, complete: 1, failed: 0, released: 1 },
      inv1: { flaggedAssessments: 1, flags: 1, flagRate: 1 },
      spend: {
        monthToDateUsd: 3,
        realtimeUsd: 3,
        graderUsd: 0,
        breakerBlocksNewMints: false,
      },
      breakGlass: { grantedShares: 0 },
    });
    expect(
      sentinelsIn(JSON.stringify(metrics)),
      `${INV2}: the Operator's aggregates carried Student content.`,
    ).toEqual([]);
  });

  test("a Student, a Teacher, and an unauthenticated caller cannot read Operator metrics", async () => {
    const { t } = await seedWorld(modules);
    await expect(
      t.withIdentity({ subject: STUDENT_DID }).query(api.operator.metrics, {}),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      t.withIdentity({ subject: TEACHER_DID }).query(api.operator.metrics, {}),
    ).rejects.toThrow(/Forbidden/);
    await expect(t.query(api.operator.metrics, {})).rejects.toThrow(
      /Not authenticated/,
    );
  });
});

describe("INV-2 — the Operator cannot reach content through any exported function", () => {
  test("every public function, called as the Operator, yields no Transcript body, Assessment content, or Student identity", async () => {
    const { t, ids } = await seedWorld(modules);
    const operator = t.withIdentity({ subject: OPERATOR_DID });
    const functions = await publicFunctions(modules);

    // A sweep that discovered nothing would pass silently, which is the one
    // failure mode that would make this whole test worthless.
    expect(
      functions.map((fn) => fn.path),
      `${INV2}: the public-function sweep found nothing to call.`,
    ).toEqual(
      expect.arrayContaining([
        "operator:metrics",
        "operator:transcriptForSession",
        "sessions:getForStudent",
        "transcript:forSession",
        "assessments:getForTeacher",
        "users:me",
      ]),
    );

    const idsByTable: Record<string, string> = {
      users: ids.studentId,
      assignments: ids.assignmentId,
      assignmentVersions: ids.assignmentVersionId,
      standards: ids.standardId,
      sessions: ids.sessionId,
      transcriptItems: ids.transcriptItemId,
      assessments: ids.assessmentId,
      spendEvents: ids.spendEventId,
      deploymentConfig: ids.deploymentConfigId,
      // Deliberately dangling. The sweep must not hold a real share: the whole
      // point is that this Operator was never granted one.
      transcriptShares: ids.danglingShareId,
    };

    const leaks: string[] = [];
    const called: string[] = [];
    for (const fn of functions) {
      const args = synthesizeArgs(fn, idsByTable);
      let serialized: string;
      try {
        const result =
          fn.type === "query"
            ? await operator.query(queryRef(fn.path), args)
            : fn.type === "mutation"
              ? await operator.mutation(mutationRef(fn.path), args)
              : await operator.action(actionRef(fn.path), args);
        serialized = JSON.stringify(result ?? null);
      } catch (error) {
        // An authorization failure is the expected outcome for most of these,
        // and it is not a pass on its own — the message is scanned too. A
        // refusal that quotes what it is refusing has leaked it anyway.
        serialized = error instanceof Error ? error.message : String(error);
      }
      called.push(fn.path);
      for (const hit of sentinelsIn(serialized)) {
        leaks.push(`  ${fn.path} (${fn.type}) yielded ${hit}`);
      }
    }

    expect(
      leaks,
      `${INV2} BROKEN. The Operator identity obtained content it must never ` +
        "see, through these exported functions:\n" +
        leaks.join("\n") +
        "\n\nOperator reads are aggregates only (PRD §4 INV-2 mechanism a). " +
        "The one exception is operator.transcriptForSession, gated on a " +
        `Teacher-granted transcriptShares row.\nSwept ${called.length} ` +
        `public functions: ${called.join(", ")}`,
    ).toEqual([]);
  });
});

describe("INV-2 — the designed break-glass", () => {
  test("without a Teacher's grant the Operator's Transcript read is refused outright", async () => {
    const { t, ids } = await seedWorld(modules);
    await expect(
      t
        .withIdentity({ subject: OPERATOR_DID })
        .query(api.operator.transcriptForSession, { sessionId: ids.sessionId }),
      `${INV2}: the break-glass read must refuse, not return an empty ` +
        "Transcript — an Operator must never be able to mistake 'you were " +
        "not granted this' for 'there was nothing here'.",
    ).rejects.toThrow(/INV-2/);
  });

  test("with a Teacher's grant the Operator reads that one Transcript, and only that one", async () => {
    const { t, ids } = await seedWorld(modules);
    const secondSessionId = await t.run(async (ctx) => {
      const sessionId = await ctx.db.insert("sessions", {
        studentId: ids.studentId,
        assignmentVersionId: ids.assignmentVersionId,
        status: "ended",
        startedAt: Date.now() - 600_000,
        endedAt: Date.now(),
        endReason: "student_hangup",
        countsAgainstCaps: true,
      });
      await ctx.db.insert("transcriptItems", {
        sessionId,
        itemId: "item-a",
        orderKey: 1,
        speaker: "student",
        text: "SENTINEL-TRANSCRIPT-STUDENT-TURN",
        textStatus: "final",
      });
      return sessionId;
    });

    await t
      .withIdentity({ subject: TEACHER_DID })
      .mutation(api.operator.shareTranscriptWithOperator, {
        sessionId: ids.sessionId,
        reason: "Debugging a Grader failure the Student reported.",
      });

    const opened = await t
      .withIdentity({ subject: OPERATOR_DID })
      .query(api.operator.transcriptForSession, { sessionId: ids.sessionId });
    expect(opened.items.map((item) => item.text)).toContain(
      "SENTINEL-TRANSCRIPT-STUDENT-TURN",
    );
    // The Operator reads the words alongside the record of who authorised it.
    expect(opened.shares).toHaveLength(1);
    expect(opened.shares[0].reason).toContain("Grader failure");
    expect(opened.shares[0].grantedByTeacherId).toBe(ids.teacherId);

    // The grant is per Session. It did not open the Student's other one.
    await expect(
      t
        .withIdentity({ subject: OPERATOR_DID })
        .query(api.operator.transcriptForSession, {
          sessionId: secondSessionId,
        }),
      `${INV2}: a share granted for one Session opened a second one.`,
    ).rejects.toThrow(/INV-2/);
  });

  test("only a Teacher may grant a share — not the Operator, not a Student", async () => {
    const { t, ids } = await seedWorld(modules);
    const args = {
      sessionId: ids.sessionId,
      reason: "Investigating an error report.",
    };
    await expect(
      t
        .withIdentity({ subject: OPERATOR_DID })
        .mutation(api.operator.shareTranscriptWithOperator, args),
      `${INV2}: an Operator granted themselves a Transcript share. The share ` +
        "is a Teacher action; an Operator who can grant one has no access " +
        "rule at all.",
    ).rejects.toThrow(/Forbidden/);
    await expect(
      t
        .withIdentity({ subject: STUDENT_DID })
        .mutation(api.operator.shareTranscriptWithOperator, args),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      t.mutation(api.operator.shareTranscriptWithOperator, args),
    ).rejects.toThrow(/Not authenticated/);
  });

  test("a share needs a stated reason", async () => {
    const { t, ids } = await seedWorld(modules);
    await expect(
      t
        .withIdentity({ subject: TEACHER_DID })
        .mutation(api.operator.shareTranscriptWithOperator, {
          sessionId: ids.sessionId,
          reason: "   ",
        }),
    ).rejects.toThrow(/stated reason/);
  });

  test("a share is permanent: nothing in the codebase deletes, patches, or replaces one", async () => {
    const offenders = tableWrites(
      convexModules(sources),
      "transcriptShares",
    ).filter((hit) => hit.operation !== "insert");
    expect(
      offenders.map((hit) => `${hit.file}:${hit.line} — ${hit.operation}`),
      `${INV2} BROKEN: a transcriptShares row can be removed or rewritten. ` +
        "The share is the permanent record of the Operator being shown one " +
        "Student's words (PRD §4: 'logged and permanently visible on the " +
        "transcript'); a Teacher who could quietly retract it would leave no " +
        "record that it ever happened. Insert only.",
    ).toEqual([]);
  });

  test("a share is visible on the Transcript — to the Teacher, the Operator, and the Student whose words were shared", async () => {
    const { t, ids } = await seedWorld(modules);
    await t
      .withIdentity({ subject: TEACHER_DID })
      .mutation(api.operator.shareTranscriptWithOperator, {
        sessionId: ids.sessionId,
        reason: "Spot-checking a Grader failure with the Operator.",
      });

    for (const subject of [TEACHER_DID, OPERATOR_DID, STUDENT_DID]) {
      const shares = await t
        .withIdentity({ subject })
        .query(api.operator.sharesForSession, { sessionId: ids.sessionId });
      expect(
        shares,
        `${INV2}: ${subject} could not see the share on the Transcript. A ` +
          "share the Student cannot see is not a visible share.",
      ).toHaveLength(1);
      expect(shares[0]).toMatchObject({
        sessionId: ids.sessionId,
        grantedByTeacherId: ids.teacherId,
      });
      expect(shares[0].grantedAt).toBeGreaterThan(0);
    }

    // Another Student learns nothing about somebody else's Session.
    await expect(
      t
        .withIdentity({ subject: OTHER_STUDENT_DID })
        .query(api.operator.sharesForSession, { sessionId: ids.sessionId }),
    ).rejects.toThrow(/Forbidden/);
  });
});
