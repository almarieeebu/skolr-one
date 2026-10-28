// Account closing at term end (registrar).
// For each enrollment of the term with a balance > 0:
//   - post a "carry_forward" credit on the old ledger (it closes at zero),
//   - post a "previous_balance" debit on the student's next-term enrollment.
// If the student has no next-term enrollment yet, the previous balance is
// posted when that enrollment is created (see pendingCarryForward).

import type { Enrollment, Term } from "../enrollment/types";
import type { LedgerDraft, LedgerEntry } from "./types";
import { balanceCents, liveRows } from "./ledger";
import { toCents } from "./money";

export interface CloseItem {
  enrollment_id: string;
  student_id: string;
  amount: number;
  next_enrollment_id: string | null;
}

export interface ClosePlan {
  items: CloseItem[];
  /** Rows to post; each names the enrollment it belongs to. */
  rows: (LedgerDraft & { enrollment_id: string })[];
  total: number;
}

export const carryCode = (enrollmentId: string) => `carry:${enrollmentId}`;
export const prevCode = (enrollmentId: string) => `prev:${enrollmentId}`;

export function carryRow(enrollmentId: string, cents: number, termLabel: string): LedgerDraft & { enrollment_id: string } {
  return {
    enrollment_id: enrollmentId,
    kind: "carry_forward",
    code: carryCode(enrollmentId),
    fee_group: null,
    description: `Balance carried to next term (${termLabel} closed)`,
    debit: 0,
    credit: cents / 100,
    payment_id: null,
    reverses_id: null,
    reason: "Term closing",
  };
}

export function previousBalanceRow(
  fromEnrollmentId: string,
  toEnrollmentId: string,
  cents: number,
  fromTermLabel: string,
): LedgerDraft & { enrollment_id: string } {
  return {
    enrollment_id: toEnrollmentId,
    kind: "previous_balance",
    code: prevCode(fromEnrollmentId),
    fee_group: null,
    description: `Previous balance (${fromTermLabel})`,
    debit: cents / 100,
    credit: 0,
    payment_id: null,
    reverses_id: null,
    reason: "Carried forward at term closing",
  };
}

/** The student's next-term enrollment: another term that is not closed, newest first. */
export function nextEnrollment(
  studentId: string,
  closingTermId: string,
  enrollments: Pick<Enrollment, "id" | "student_id" | "term_id" | "status" | "created_at">[],
  terms: Pick<Term, "id" | "closed_at">[],
): string | null {
  const open = new Set(terms.filter((t) => !t.closed_at).map((t) => t.id));
  const cands = enrollments
    .filter((e) => e.student_id === studentId && e.term_id !== closingTermId && open.has(e.term_id) && e.status !== "rejected")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return cands[0]?.id ?? null;
}

export function planTermClose(input: {
  term: Pick<Term, "id" | "closed_at">;
  termLabel: string;
  enrollments: Pick<Enrollment, "id" | "student_id" | "term_id" | "status" | "created_at">[];
  terms: Pick<Term, "id" | "closed_at">[];
  ledgerByEnrollment: Record<string, LedgerEntry[]>;
}): ClosePlan | { error: string } {
  if (input.term.closed_at) return { error: "This term is already closed." };
  const items: CloseItem[] = [];
  const rows: ClosePlan["rows"] = [];
  let total = 0;
  for (const e of input.enrollments.filter((x) => x.term_id === input.term.id)) {
    const ledger = input.ledgerByEnrollment[e.id] ?? [];
    if (ledger.some((r) => r.code === carryCode(e.id) && r.kind === "carry_forward")) continue;
    const bal = balanceCents(ledger);
    if (bal <= 0) continue;
    const next = nextEnrollment(e.student_id, input.term.id, input.enrollments, input.terms);
    items.push({ enrollment_id: e.id, student_id: e.student_id, amount: bal / 100, next_enrollment_id: next });
    rows.push(carryRow(e.id, bal, input.termLabel));
    if (next) rows.push(previousBalanceRow(e.id, next, bal, input.termLabel));
    total += bal;
  }
  return { items, rows, total: total / 100 };
}

/**
 * Balances carried out of earlier terms that are not on any enrollment yet.
 * Called when a student's new enrollment is created.
 */
export function pendingCarryForward(
  studentLedger: LedgerEntry[],
  newEnrollmentId: string,
  termLabelOf: (enrollmentId: string) => string,
): (LedgerDraft & { enrollment_id: string })[] {
  const live = liveRows(studentLedger);
  const taken = new Set(live.filter((r) => r.kind === "previous_balance").map((r) => r.code));
  return live
    .filter((r) => r.kind === "carry_forward" && !taken.has(prevCode(r.enrollment_id)))
    .map((r) => previousBalanceRow(r.enrollment_id, newEnrollmentId, toCents(r.credit), termLabelOf(r.enrollment_id)));
}
