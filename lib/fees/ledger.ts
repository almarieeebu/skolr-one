// The ledger: every charge, discount, payment, penalty and void is a row.
// Rows are never edited. A void is a new row that reverses another one.

import type { AssessLine, LedgerDraft, LedgerEntry, LedgerKind } from "./types";
import { toCents } from "./money";

const net = (r: Pick<LedgerEntry, "debit" | "credit">) => toCents(r.debit) - toCents(r.credit);

/** Balance in centavos. Positive = the student owes, negative = credit. */
export function balanceCents(ledger: Pick<LedgerEntry, "debit" | "credit">[]): number {
  return ledger.reduce((a, r) => a + net(r), 0);
}
export const balance = (ledger: Pick<LedgerEntry, "debit" | "credit">[]) => balanceCents(ledger) / 100;

/** Rows that still count: not a void, and not reversed by a void. */
export function liveRows<T extends Pick<LedgerEntry, "id" | "kind" | "reverses_id">>(ledger: T[]): T[] {
  const reversed = new Set(ledger.filter((r) => r.kind === "void" && r.reverses_id).map((r) => r.reverses_id));
  return ledger.filter((r) => r.kind !== "void" && !reversed.has(r.id));
}

/** A row that cancels `row`, with a reason. */
export function reversal(row: LedgerEntry, reason: string): LedgerDraft {
  return {
    kind: "void",
    code: row.code,
    fee_group: row.fee_group,
    description: `Void: ${row.description}`,
    debit: row.credit,
    credit: row.debit,
    payment_id: row.payment_id,
    reverses_id: row.id,
    reason,
  };
}

function lineDraft(l: AssessLine): LedgerDraft {
  const c = toCents(l.amount);
  return {
    kind: l.kind,
    code: l.code,
    fee_group: l.group,
    description: l.label,
    debit: c > 0 ? c / 100 : 0,
    credit: c < 0 ? -c / 100 : 0,
    payment_id: null,
    reverses_id: null,
    reason: null,
  };
}

/**
 * Rows to post so the ledger matches the new fee lines, for the given kinds.
 * Lines that did not change are left alone. A changed line is reversed and
 * posted again with the new amount; a line that is gone is reversed.
 */
export function syncLines(
  ledger: LedgerEntry[],
  lines: AssessLine[],
  kinds: ("charge" | "discount")[],
  reason: string,
): LedgerDraft[] {
  const live = liveRows(ledger).filter((r) => (kinds as LedgerKind[]).includes(r.kind));
  const want = new Map<string, AssessLine>();
  for (const l of lines) if (kinds.includes(l.kind) && toCents(l.amount) !== 0) want.set(l.code, l);
  const codes = [...new Set([...live.map((r) => r.code), ...want.keys()])];
  const out: LedgerDraft[] = [];
  for (const code of codes) {
    const rows = live.filter((r) => r.code === code);
    const have = rows.reduce((a, r) => a + net(r), 0);
    const l = want.get(code);
    const target = l ? toCents(l.amount) : 0;
    if (have === target) continue; // compared by amount only (labels may differ in wording)
    for (const r of rows) out.push(reversal(r, reason));
    if (l) out.push(lineDraft(l));
  }
  return out;
}

/** The current fee lines (charges and discounts) as posted in the ledger. */
export function postedLines(ledger: LedgerEntry[], kinds: ("charge" | "discount")[] = ["charge", "discount"]): AssessLine[] {
  const byCode = new Map<string, AssessLine>();
  for (const r of liveRows(ledger)) {
    if (!(kinds as LedgerKind[]).includes(r.kind)) continue;
    const prev = byCode.get(r.code);
    const cents = (prev ? toCents(prev.amount) : 0) + net(r);
    byCode.set(r.code, {
      code: r.code,
      label: r.description,
      group: r.fee_group,
      kind: r.kind as "charge" | "discount",
      amount: cents / 100,
    });
  }
  return [...byCode.values()].filter((l) => toCents(l.amount) !== 0);
}

/** Sum of live rows of some kinds, in centavos (net debit - credit). */
export function sumKinds(ledger: LedgerEntry[], kinds: LedgerKind[]): number {
  return liveRows(ledger).filter((r) => kinds.includes(r.kind)).reduce((a, r) => a + net(r), 0);
}

/** Ledger rows in the order they were posted, with a running balance. */
export function withRunningBalance(ledger: LedgerEntry[]): (LedgerEntry & { running: number })[] {
  let run = 0;
  return ledger.map((r) => {
    run += net(r);
    return { ...r, running: run / 100 };
  });
}
