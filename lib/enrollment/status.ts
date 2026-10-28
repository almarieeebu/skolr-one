import type { Status } from "./types";

/** The six steps shown on the progress bar, in order. */
export const STEPS: { status: Status; label: string; short: string }[] = [
  { status: "applied", label: "Applied", short: "Applied" },
  { status: "papers_checked", label: "Papers checked", short: "Papers" },
  { status: "student_made", label: "Student ID made", short: "ID" },
  { status: "load_set", label: "Load set", short: "Load" },
  { status: "assessed_paid", label: "Assessed & paid", short: "Paid" },
  { status: "officially_enrolled", label: "Officially enrolled", short: "Enrolled" },
];

export const STATUS_LABEL: Record<Status, string> = {
  applied: "Applied",
  papers_checked: "Papers checked",
  student_made: "Student ID made",
  load_set: "Load set",
  assessed_paid: "Assessed & paid",
  officially_enrolled: "Officially enrolled",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** 0-based step index. End states return -1. */
export function stepIndex(status: Status): number {
  return STEPS.findIndex((s) => s.status === status);
}

export function isFinal(status: Status): boolean {
  return status === "rejected" || status === "withdrawn";
}

/**
 * Every allowed status change. Anything not listed here is refused.
 * - applied -> applied is "needs fix" (stays applied, with a note).
 * - student_made/load_set -> load_set lets the load be changed before payment.
 * - load_set -> officially_enrolled is only reachable by a registrar override
 *   (no downpayment); the rule for that lives in actions.ts.
 */
export const TRANSITIONS: Record<Status, Status[]> = {
  applied: ["applied", "papers_checked", "rejected"],
  papers_checked: ["student_made", "rejected"],
  student_made: ["load_set", "withdrawn"],
  load_set: ["load_set", "assessed_paid", "officially_enrolled", "withdrawn"],
  assessed_paid: ["assessed_paid", "officially_enrolled", "withdrawn"],
  officially_enrolled: ["officially_enrolled", "withdrawn"],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}
