// Who sees which enrollments, and in what order.

import type { Enrollment, ParentLink, Role, SchoolSettings, Student } from "./types";

export interface QueueItem {
  status: Enrollment["status"];
  dean_approved: boolean;
  fix_note: string | null;
  balance: number;
  updated_at: string;
  /** Applicant follow-up requests waiting for a reply (registrar only). */
  open_requests?: number;
}

/** Is this enrollment waiting on the given role to do something? */
export function isWaitingOn(
  role: Role,
  item: QueueItem,
  settings: Pick<SchoolSettings, "use_dean_approval">,
): boolean {
  switch (role) {
    case "registrar":
      if ((item.open_requests ?? 0) > 0) return true;
      if (item.status === "assessed_paid") {
        return !settings.use_dean_approval || item.dean_approved;
      }
      return item.status === "applied" ? !item.fix_note : item.status === "papers_checked";
    case "cashier":
      return item.status === "load_set";
    case "dean":
      return settings.use_dean_approval && item.status === "assessed_paid" && !item.dean_approved;
    case "student":
    case "parent":
      return item.status === "student_made" || (item.status === "applied" && !!item.fix_note);
    case "applicant":
      return item.status === "applied" && !!item.fix_note;
    case "teacher":
      return false;
  }
}

/** Items waiting on this role first, then newest activity first. */
export function sortForRole<T extends QueueItem>(
  role: Role,
  items: T[],
  settings: Pick<SchoolSettings, "use_dean_approval">,
): T[] {
  return [...items].sort((a, b) => {
    const wa = isWaitingOn(role, a, settings) ? 0 : 1;
    const wb = isWaitingOn(role, b, settings) ? 0 : 1;
    if (wa !== wb) return wa - wb;
    // Cashier: anything with a balance comes next.
    if (role === "cashier") {
      const ba = a.balance > 0 ? 0 : 1;
      const bb = b.balance > 0 ? 0 : 1;
      if (ba !== bb) return ba - bb;
    }
    return b.updated_at.localeCompare(a.updated_at);
  });
}

/**
 * Can this user see the enrollment? (The database enforces the same idea with
 * Row Level Security; the demo store uses this function.)
 */
export function canSee(
  role: Role,
  userId: string,
  student: Pick<Student, "id" | "user_id" | "guardian_user_id">,
  parentLinks: Pick<ParentLink, "parent_user_id" | "student_id">[],
  teachesThisStudent: boolean,
): boolean {
  switch (role) {
    case "registrar":
    case "cashier":
    case "dean":
      return true;
    case "student":
    case "applicant":
      return student.user_id === userId;
    case "parent":
      return (
        student.guardian_user_id === userId ||
        parentLinks.some((l) => l.parent_user_id === userId && l.student_id === student.id)
      );
    case "teacher":
      return teachesThisStudent;
  }
}
