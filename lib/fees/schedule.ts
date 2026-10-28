// Payment schedule and allocation.
// College: downpayment, then the rest split across exam periods by percent.
// K to 12: downpayment, then the rest split by plan (annual 1, quarterly 4,
// monthly 10). Leftover centavos always go on the last installment.
// Payments pay the oldest item first: previous balance, penalties,
// downpayment, then installments by due date.

import type { Track, TuitionPlan } from "../enrollment/types";
import type { FeeSetup, Installment, InstallmentStatus, LedgerEntry, Payment } from "./types";
import { splitByPercent, splitEven, toCents } from "./money";
import { liveRows, sumKinds } from "./ledger";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORDINAL = ["1st", "2nd", "3rd", "4th"];

type Due = Omit<Installment, "paid" | "carried" | "status">;

export function scheduleAmounts(input: {
  track: Track;
  setup: Pick<FeeSetup, "min_downpayment" | "exam_periods" | "plans"> | null;
  plan: TuitionPlan | null;
  ledger: LedgerEntry[];
}): Due[] {
  const { setup, ledger } = input;
  const out: Due[] = [];
  const prev = sumKinds(ledger, ["previous_balance"]);
  if (prev > 0) out.push({ key: "prev", label: "Previous balance (back account)", due_date: null, amount: prev / 100 });
  const penalty = sumKinds(ledger, ["penalty"]);
  if (penalty > 0) out.push({ key: "penalty", label: "Penalties", due_date: null, amount: penalty / 100 });

  const current = sumKinds(ledger, ["charge", "discount"]);
  if (current <= 0) return out;
  if (!setup) {
    out.push({ key: "bal", label: "Balance", due_date: null, amount: current / 100 });
    return out;
  }
  const down = Math.min(toCents(setup.min_downpayment), current);
  if (down > 0) out.push({ key: "down", label: "Downpayment", due_date: null, amount: down / 100 });
  const rest = current - down;
  if (rest <= 0) return out;

  if (input.track === "college") {
    const periods = setup.exam_periods.length
      ? setup.exam_periods
      : [{ name: "Balance", percent: 100, due_date: "" }];
    splitByPercent(rest, periods.map((p) => p.percent)).forEach((c, i) => {
      out.push({ key: `p${i + 1}`, label: periods[i].name, due_date: periods[i].due_date || null, amount: c / 100 });
    });
  } else {
    const p = setup.plans.find((x) => x.plan === (input.plan ?? "annual")) ?? setup.plans[0];
    const dates = p?.due_dates.length ? p.due_dates : [""];
    splitEven(rest, dates.length).forEach((c, i) => {
      const d = dates[i];
      const label =
        p?.plan === "monthly" && d ? MONTHS[parseInt(d.slice(5, 7), 10) - 1]
        : p?.plan === "quarterly" ? `${ORDINAL[i] ?? i + 1} quarter`
        : "Balance";
      out.push({ key: `p${i + 1}`, label, due_date: d || null, amount: c / 100 });
    });
  }
  return out.filter((x) => toCents(x.amount) > 0);
}

/**
 * Fill in paid amounts, oldest due first, then mark each installment.
 * `carriedCents` is the part moved to the next term at closing.
 */
export function allocate(due: Due[], paidCents: number, carriedCents: number, today: string): { installments: Installment[]; creditCents: number } {
  let pay = Math.max(0, paidCents);
  let carry = Math.max(0, carriedCents);
  const installments = due.map((d) => {
    const amt = toCents(d.amount);
    const p = Math.min(pay, amt);
    pay -= p;
    const c = Math.min(carry, amt - p);
    carry -= c;
    let status: InstallmentStatus;
    if (p >= amt) status = "paid";
    else if (p + c >= amt) status = "carried";
    else if (d.due_date && d.due_date < today) status = "overdue";
    else if (p > 0) status = "partial";
    else if (!d.due_date || d.due_date <= today) status = "due";
    else status = "upcoming";
    return { ...d, paid: p / 100, carried: c / 100, status };
  });
  return { installments, creditCents: pay };
}

/** How each payment was used (oldest due first), for receipts and the statement. */
export function allocatePayments(
  due: Due[],
  payments: Pick<Payment, "id" | "amount" | "voided_at">[],
): { byPayment: Record<string, { key: string; label: string; amount: number }[]>; creditCents: number } {
  const left = due.map((d) => toCents(d.amount));
  const byPayment: Record<string, { key: string; label: string; amount: number }[]> = {};
  let credit = 0;
  for (const p of payments) {
    if (p.voided_at) continue;
    let amt = toCents(p.amount);
    const parts: { key: string; label: string; amount: number }[] = [];
    for (let i = 0; i < due.length && amt > 0; i++) {
      const take = Math.min(left[i], amt);
      if (take > 0) {
        parts.push({ key: due[i].key, label: due[i].label, amount: take / 100 });
        left[i] -= take;
        amt -= take;
      }
    }
    if (amt > 0) {
      parts.push({ key: "credit", label: "Credit (overpayment)", amount: amt / 100 });
      credit += amt;
    }
    byPayment[p.id] = parts;
  }
  return { byPayment, creditCents: credit };
}

/** Total paid (live payment rows) in centavos. */
export function paidCents(ledger: LedgerEntry[]): number {
  return -sumKinds(ledger, ["payment"]) || 0;
}

export function carriedOutCents(ledger: LedgerEntry[]): number {
  return -liveRows(ledger).filter((r) => r.kind === "carry_forward").reduce((a, r) => a + toCents(r.debit) - toCents(r.credit), 0);
}
