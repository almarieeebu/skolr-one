// Everything the Fees section, the action box and the statement need,
// worked out from the posted ledger (not from the setup), so what you see is
// what was charged.

import type { Track, TuitionPlan } from "../enrollment/types";
import type { AssessLine, FeeSetup, Installment, LedgerEntry, Payment } from "./types";
import { toCents } from "./money";
import { balanceCents, postedLines, sumKinds } from "./ledger";
import { allocate, allocatePayments, carriedOutCents, paidCents, scheduleAmounts } from "./schedule";

export interface FeeSummary {
  lines: AssessLine[];
  charges: number;
  discounts: number;
  assessed: number; // this term: charges - discounts
  previous: number; // back account carried in from an earlier term
  penalties: number;
  paid: number;
  carriedOut: number; // moved to the next term at closing
  balance: number; // > 0 owes
  credit: number; // overpayment kept as credit
  /** Back account + penalties + this term's downpayment: needed before official enrollment. */
  downpaymentRequired: number;
  downpaymentMet: boolean;
  installments: Installment[];
  allocations: Record<string, { key: string; label: string; amount: number }[]>;
  nextDue: Installment | null;
}

export function feeSummary(input: {
  track: Track;
  plan: TuitionPlan | null;
  setup: FeeSetup | null;
  ledger: LedgerEntry[];
  payments: Payment[];
  today: string; // YYYY-MM-DD
}): FeeSummary {
  const { ledger } = input;
  const lines = postedLines(ledger);
  const charges = lines.filter((l) => l.kind === "charge").reduce((a, l) => a + toCents(l.amount), 0);
  const discounts = lines.filter((l) => l.kind === "discount").reduce((a, l) => a + toCents(l.amount), 0);
  const assessed = charges + discounts;
  const previous = sumKinds(ledger, ["previous_balance"]);
  const penalties = sumKinds(ledger, ["penalty"]);
  const paid = paidCents(ledger);
  const carried = carriedOutCents(ledger);
  const bal = balanceCents(ledger);

  const due = scheduleAmounts({ track: input.track, setup: input.setup, plan: input.plan, ledger });
  const { installments } = allocate(due, paid, carried, input.today);
  const { byPayment } = allocatePayments(due, [...input.payments].sort((a, b) => a.paid_at.localeCompare(b.paid_at)));
  const down = installments.find((i) => i.key === "down");
  const required = Math.max(0, previous) + Math.max(0, penalties) + (down ? toCents(down.amount) : 0);

  return {
    lines,
    charges: charges / 100,
    discounts: discounts / 100,
    assessed: assessed / 100,
    previous: previous / 100,
    penalties: penalties / 100,
    paid: paid / 100,
    carriedOut: carried / 100,
    balance: Math.max(0, bal) / 100,
    credit: Math.max(0, -bal) / 100,
    downpaymentRequired: required / 100,
    downpaymentMet: paid >= required,
    installments,
    allocations: byPayment,
    nextDue: installments.find((i) => i.status !== "paid" && i.status !== "carried") ?? null,
  };
}

/** Today's date in the Philippines (YYYY-MM-DD). */
export function manilaDate(iso: string | Date = new Date()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
