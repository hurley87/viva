import type { CriterionRating } from "../../../shared/assessmentSchema";

export const buttonClassName =
  "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function sessionStatusLabel(
  status: "minted" | "live" | "ended",
): string {
  switch (status) {
    case "minted":
      return "Minted";
    case "live":
      return "Live";
    case "ended":
      return "Ended";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function endReasonLabel(
  reason: "student_hangup" | "timebox" | "examiner_ended" | "disconnected",
): string {
  switch (reason) {
    case "student_hangup":
      return "Student ended the Session";
    case "timebox":
      return "Time-box";
    case "examiner_ended":
      return "Examiner ended the Session";
    case "disconnected":
      return "Disconnected";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function assessmentStatusLabel(
  status: "none" | "pending" | "complete" | "failed",
): string {
  switch (status) {
    case "none":
      return "No Assessment";
    case "pending":
      return "Pending";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function ratingLabel(rating: CriterionRating): string {
  switch (rating) {
    case "established":
      return "Established";
    case "partially_established":
      return "Partially established";
    case "not_established":
      return "Not established";
    case "not_probed":
      return "Not probed";
    default: {
      const exhaustive: never = rating;
      return exhaustive;
    }
  }
}

export function ratingClassName(rating: CriterionRating): string {
  switch (rating) {
    case "established":
      return "text-emerald-700 dark:text-emerald-400";
    case "partially_established":
      return "text-amber-700 dark:text-amber-400";
    case "not_established":
      return "text-red-700 dark:text-red-400";
    case "not_probed":
      return "text-zinc-600 dark:text-zinc-400";
    default: {
      const exhaustive: never = rating;
      return exhaustive;
    }
  }
}

export function speakerLabel(speaker: "student" | "examiner"): string {
  switch (speaker) {
    case "student":
      return "Student";
    case "examiner":
      return "Examiner";
    default: {
      const exhaustive: never = speaker;
      return exhaustive;
    }
  }
}
