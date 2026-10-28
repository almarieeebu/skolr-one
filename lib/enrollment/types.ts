// Shared domain types. Field names match the database columns (snake_case)
// so the demo store and the Supabase store can use the same shapes.

import type { Discount, FeeSetup, LedgerEntry, Payment } from "../fees/types";
export type { Payment } from "../fees/types";

export type Track = "college" | "k12";

export type Role = "registrar" | "cashier" | "teacher" | "student" | "parent" | "dean";

/** The six main steps, plus the two "end" states. */
export type Status =
  | "applied"
  | "papers_checked"
  | "student_made"
  | "load_set"
  | "assessed_paid"
  | "officially_enrolled"
  | "rejected"
  | "withdrawn";

export type StudentType = "new" | "transferee" | "returnee" | "continuing";

export type TuitionPlan = "annual" | "quarterly" | "monthly";

export type DocType = "psa_birth_cert" | "form_138" | "honorable_dismissal" | "tor";

/** Fees (rates, misc items, plans, downpayment) live in fee setups, not here. */
export interface SchoolSettings {
  use_dean_approval: boolean;
  max_units: number;
}

export interface School {
  id: string;
  name: string;
  code: string;
  logo_url: string | null;
  settings: SchoolSettings;
}

export interface Term {
  id: string;
  school_id: string;
  school_year: string; // e.g. "2026-2027"
  semester: string | null; // "1st", "2nd", "summer"; null for K to 12
  track: Track;
  is_open: boolean;
  /** Set when the registrar closes the term's accounts (balances carried forward). */
  closed_at: string | null;
}

export interface Profile {
  id: string; // = auth user id
  full_name: string;
  email: string;
}

export interface Membership {
  id: string;
  user_id: string;
  school_id: string;
  role: Role;
}

export interface Student {
  id: string;
  school_id: string;
  student_no: string | null;
  lrn: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birth_date: string | null;
  sex: "M" | "F" | null;
  user_id: string | null; // the student's own login (if any)
  guardian_user_id: string | null;
  /**
   * Subject codes credited without a grade here (transferees, credited
   * subjects). Passed subjects come from posted grades (see passed_codes).
   */
  completed_codes: string[];
}

export interface ParentLink {
  id: string;
  school_id: string;
  parent_user_id: string;
  student_id: string;
}

export interface OverrideRecord {
  action: string;
  checks: string[];
  reason: string;
  by: string;
  at: string;
}

export interface Enrollment {
  id: string;
  school_id: string;
  term_id: string;
  student_id: string;
  track: Track;
  status: Status;
  level: string; // "1st Year", "Grade 7", ...
  course: string | null; // college
  strand: string | null; // SHS only
  student_type: StudentType;
  esc_voucher: boolean; // K to 12: ESC / SHS voucher
  mother_tongue: string | null;
  ip_group: string | null;
  is_4ps: boolean;
  tuition_plan: TuitionPlan | null;
  fix_note: string | null;
  dean_approved: boolean;
  overrides: OverrideRecord[];
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  school_id: string;
  enrollment_id: string;
  type: DocType;
  file_name: string | null;
  file_path: string | null;
  checked: boolean;
  uploaded_at: string | null;
}

export interface Offering {
  id: string;
  school_id: string;
  term_id: string;
  kind: "subject" | "section";
  code: string;
  title: string;
  units: number; // 0 for sections
  lab_fee: number;
  /** Major subject: charged at the major rate per unit. */
  is_major: boolean;
  /** Non-credit subject (e.g. NSTP): left out of the GWA. */
  non_credit: boolean;
  days: string | null; // "MWF", "TTh", "S"
  start_time: string | null; // "08:00"
  end_time: string | null; // "09:30"
  room: string | null;
  teacher_id: string | null;
  slots: number;
  prerequisite_codes: string[];
  level: string | null; // sections: the grade level they serve
  strand: string | null; // SHS sections
}

export interface EnrollmentLoad {
  id: string;
  school_id: string;
  enrollment_id: string;
  offering_id: string;
}

export interface HistoryRow {
  id: string;
  school_id: string;
  enrollment_id: string;
  from_status: Status | null;
  to_status: Status;
  action: string;
  reason: string | null;
  actor_id: string;
  actor_name: string | null;
  created_at: string;
}

/** Everything the student card and the rules need for one enrollment. */
export interface EnrollmentDetail {
  enrollment: Enrollment;
  student: Student;
  term: Term;
  documents: DocumentRow[];
  loads: EnrollmentLoad[];
  /** All offerings for the enrollment's term. */
  offerings: Offering[];
  /** How many OTHER enrollments use each offering (for slot checks). */
  takenCounts: Record<string, number>;
  /** The fee setup that applies (most specific scope), if any. */
  feeSetup: FeeSetup | null;
  discounts: Discount[];
  /** Posted ledger rows of this enrollment, oldest first. */
  ledger: LedgerEntry[];
  payments: Payment[];
  history: HistoryRow[];
  /** Subject codes passed in other terms (posted grades), for prerequisites. */
  passed_codes?: string[];
}

export interface Actor {
  user_id: string;
  role: Role;
  name: string;
}
