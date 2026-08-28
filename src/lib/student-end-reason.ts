type StudentEndReason =
  | "student_hangup"
  | "timebox"
  | "examiner_ended"
  | "disconnected";

export function studentEndReasonCopy(reason: StudentEndReason): string {
  switch (reason) {
    case "timebox":
      return "Time is up.";
    case "examiner_ended":
      return "The Examiner ended the Session.";
    case "student_hangup":
      return "You ended the Session.";
    case "disconnected":
      return "The Session disconnected.";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}
