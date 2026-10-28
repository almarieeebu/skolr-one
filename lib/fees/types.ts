// Fee module types. Field names match the database columns (snake_case),
// like the rest of the app. Money is stored in pesos with 2 decimals; the
// rules work in whole centavos so totals always add up exactly.

import type { Track, TuitionPlan } from "../enrollment/types";

/** What a fee line belongs to. Group discounts target one of these. */
export type FeeGroup = "tuition" | "lab" | "misc" | "other";

export const FEE_GROUP_LABEL: Record<FeeGroup, string> = {
  tuition: "Tuition",
  lab: "Lab fees",
  misc: "Miscellaneous",
  other: "Other fees",
};

export interface FeeItem {
  name: string;
  amount: number;
  group?: FeeGroup; // misc items default to "misc", plan items to "tuition"
}

/** College: one exam period of the payment schedule. */
export interface ExamPeriod {
  name: string; // "Prelim", "Midterm", "Semi-final", "Final"
  percent: number; // share of the balance after downpayment
  due_date: string; // YYYY-MM-DD
}

/** K to 12: one tuition plan (annual / quarterly / monthly). */
export interface PlanSetup {
  plan: TuitionPlan;
  items: FeeItem[];
  /** Installment surcharge in percent of the tuition items (0 = none). */
  surcharge_pct: number;
  /** One due date per installment after the downpayment. */
  due_dates: string[];
}

/**
 * Fee setup for one school + term + track. Optional scope:
 * course and/or year level (college), grade level (K to 12).
 * The most specific setup that matches an enrollment wins.
 */
export interface FeeSetup {
  id: string;
  school_id: string;
  term_id: string;
  track: Track;
  scope_course: string | null;
  scope_level: string | null;
  min_downpayment: number;
  misc_items: FeeItem[];
  // college
  rate_per_unit: number;
  major_rate_per_unit: number;
  exam_periods: ExamPeriod[];
  // K to 12
  plans: PlanSetup[];
  esc_amount: number; // ESC grant (Grades 7-10), fixed amount
  shs_voucher_amount: number; // SHS voucher (Grades 11-12), fixed amount
  updated_at: string;
}

export type DiscountScope = "item" | "group" | "total";
export type DiscountKind = "amount" | "percent";

export interface Discount {
  id: string;
  school_id: string;
  enrollment_id: string;
  name: string; // "Academic scholarship", "Sibling discount", "ESC grant"
  scope: DiscountScope;
  /** item: a fee line code (e.g. "lab:IT101"); group: a FeeGroup; total: null. */
  target: string | null;
  kind: DiscountKind;
  value: number; // pesos, or percent (0-100)
  reason: string;
  applied_by: string;
  applied_by_name: string | null;
  applied_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export type LedgerKind =
  | "charge"
  | "discount"
  | "payment"
  | "penalty"
  | "void"
  | "previous_balance"
  | "carry_forward";

/**
 * One posted ledger row. Rows are never edited: a void is a new row with
 * debit and credit swapped that points at the row it reverses.
 * Balance = sum(debit) - sum(credit). Positive = the student owes.
 */
export interface LedgerEntry {
  id: string;
  school_id: string;
  enrollment_id: string;
  student_id: string;
  term_id: string;
  kind: LedgerKind;
  /** Stable key per fee line: "tuition", "lab:IT101", "misc:Library fee",
   *  "disc:<discount id>", "pay:<payment id>", "prev:<enrollment id>", "carry:<enrollment id>". */
  code: string;
  fee_group: FeeGroup | null;
  description: string;
  debit: number;
  credit: number;
  payment_id: string | null;
  reverses_id: string | null;
  reason: string | null;
  actor_id: string;
  actor_name: string | null;
  posted_at: string;
}

/** A row the rules want posted; the store fills in ids and who/when. */
export type LedgerDraft = Pick<
  LedgerEntry,
  "kind" | "code" | "fee_group" | "description" | "debit" | "credit" | "payment_id" | "reverses_id" | "reason"
> & {
  /** Post on another enrollment (closing carries a balance forward). */
  enrollment_id?: string;
};

export type PaymentMode = "cash" | "gcash" | "bank" | "check";

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  cash: "Cash",
  gcash: "GCash",
  bank: "Bank transfer",
  check: "Check",
};

export interface Payment {
  id: string;
  school_id: string;
  enrollment_id: string;
  amount: number;
  or_no: string;
  mode: PaymentMode;
  reference: string | null; // GCash ref, bank ref or check number
  cashier_id: string;
  paid_at: string;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
}

/** Per-school OR (official receipt) number series. */
export interface OrSeries {
  school_id: string;
  prefix: string;
  next_no: number;
  pad: number;
}

/** One fee line of an assessment (charge > 0, discount < 0). */
export interface AssessLine {
  code: string;
  label: string;
  group: FeeGroup | null;
  kind: "charge" | "discount";
  amount: number;
}

export interface Assessment {
  lines: AssessLine[];
  charges: number;
  discounts: number; // negative or 0
  total: number;
}

export type InstallmentStatus = "paid" | "partial" | "due" | "overdue" | "upcoming" | "carried";

export interface Installment {
  key: string; // "prev", "penalty", "down", "p1", ...
  label: string;
  due_date: string | null; // null = upon enrollment
  amount: number;
  paid: number;
  carried: number;
  status: InstallmentStatus;
}
