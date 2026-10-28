// Who may do what with grades.
// - teacher: enter grades for their own classes (drafts), submit, ask for a change
// - registrar: approve / return / allow late, decide change requests, grade settings
// - dean: approves instead of the registrar when the school uses the dean step
// - student / parent: see their own POSTED grades and print the report card
// - cashier: nothing about grades

import type { Role } from "../enrollment/types";

export interface GradePermissions {
  /** Sees the Grades section on the student card. */
  view: boolean;
  /** Sees only posted grades (students and parents). */
  postedOnly: boolean;
  /** Has a "classes" list (grade sheets). */
  classes: boolean;
  settings: boolean;
}

export function gradePermissions(role: Role): GradePermissions {
  switch (role) {
    case "registrar":
      return { view: true, postedOnly: false, classes: true, settings: true };
    case "dean":
      return { view: true, postedOnly: false, classes: true, settings: false };
    case "teacher":
      return { view: true, postedOnly: false, classes: true, settings: false };
    case "student":
    case "parent":
      return { view: true, postedOnly: true, classes: false, settings: false };
    case "cashier":
      return { view: false, postedOnly: true, classes: false, settings: false };
  }
}
