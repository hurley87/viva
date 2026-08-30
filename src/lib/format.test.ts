// One Session has one length. These pin that the Student's views and the
// Teacher's views cannot disagree about it again.

import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";
import {
  describeSession,
  formatDuration as studentDuration,
} from "./sessionText";
import { formatDuration as teacherDuration } from "./teacherFormat";

describe("formatDuration", () => {
  it("is the same function on both sides of the product", () => {
    expect(studentDuration).toBe(formatDuration);
    expect(teacherDuration).toBe(formatDuration);
  });

  it("reads a short Session as the length it was", () => {
    expect(formatDuration(25)).toBe("0:25");
    expect(formatDuration(100)).toBe("1:40");
    expect(formatDuration(900)).toBe("15:00");
  });

  it("says nothing rather than zero where there is no duration", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("describeSession", () => {
  it("gives the Student the same length the Teacher reads", () => {
    const sentence = describeSession({
      status: "ended",
      durationSec: 100,
      endReason: "student_hangup",
      countsAgainstCaps: true,
    });
    expect(sentence).toBe("Ran for 1:40 — you ended it.");
    expect(sentence).toContain(teacherDuration(100));
  });
});
