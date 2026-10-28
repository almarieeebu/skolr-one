// Fee actions as pure planners: they read an EnrollmentDetail and return the
// rows to post. Both stores (demo and Supabase) use these same rules; in
// Supabase mode the database functions in 0002_fees.sql do the same work
// inside one transaction.

import type { Actor, EnrollmentDetail, HistoryRow, Offering } from "../enrollment/types";
import type { Discount, DiscountKind, DiscountScope, FeeGroup, LedgerDraft, Payment, PaymentMode } from "./types";
import { FEE_GROUP_LABEL, PAYMENT_MODE_LABEL } from "./types";
import { assess, discountLines, voucherDiscount } from "./assess";
import { postedLines, reversal, syncLines } from "./ledger";
import { canVoidPayment, feePermissions } from "./roles";
import { feeSummary, manilaDate } from "./summary";
import { peso, toCents } from "./money";

// ---------- assessment on load change ----------

/** Rows that (re)post the charges and discounts for a picked load. */
export function planAssessment(
  detail: Pick<EnrollmentDetail, "enrollment" | "feeSetup" | "discounts" | "ledger">,
  picked: Offering[],
): { ok: true; rows: LedgerDraft[]; total: number } | { ok: false; error: string } {
  const setup = detail.feeSetup;
  if (!setup) return { ok: false, error: "No fee setup for this term yet. Ask the registrar to set up fees." };
  const a = assess({
    enrollment: detail.enrollment,
    setup,
    subjects: picked.filter((o) => o.kind === "subject"),
    discounts: detail.discounts,
  });
  return { ok: true, rows: syncLines(detail.ledger, a.lines, ["charge", "discount"], "Reassessed after a load change"), total: a.total };
}

// ---------- payments ----------

export interface PaymentInput {
  amount: number;
  or_no: string;
  mode: PaymentMode;
  reference?: string | null;
}

export type PaymentPlan =
  | { ok: true; payment: Omit<Payment, "id" | "school_id" | "enrollment_id" | "cashier_id" | "paid_at">; row: LedgerDraft; downpaymentMet: boolean }
  | { ok: false; error: string };

/** One payment = one payment row + one credit ledger row (same transaction). */
export function planPayment(
  detail: Pick<EnrollmentDetail, "enrollment" | "term" | "feeSetup" | "ledger" | "payments">,
  input: PaymentInput,
  now: string,
): PaymentPlan {
  const amount = Number(input.amount);
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (toCents(amount) / 100 !== amount) return { ok: false, error: "Amounts have at most 2 decimals (centavos)." };
  const or_no = input.or_no?.trim();
  if (!or_no) return { ok: false, error: "Enter the OR (official receipt) number." };
  if (detail.payments.some((p) => p.or_no === or_no)) return { ok: false, error: `OR #${or_no} is already used.` };
  const mode = input.mode ?? "cash";
  if (!PAYMENT_MODE_LABEL[mode]) return { ok: false, error: "Pick a payment mode." };
  const reference = input.reference?.trim() || null;
  if (mode !== "cash" && !reference) {
    return { ok: false, error: mode === "gcash" ? "Enter the GCash reference number." : mode === "check" ? "Enter the check number." : "Enter the bank reference." };
  }
  if (detail.term.closed_at) return { ok: false, error: "This term is closed. Take the payment on the next-term enrollment." };

  const paymentId = "__payment__"; // the store swaps in the real id
  const row: LedgerDraft = {
    kind: "payment",
    code: `pay:${paymentId}`,
    fee_group: null,
    description: `Payment, OR #${or_no} (${PAYMENT_MODE_LABEL[mode]}${reference ? ` ${reference}` : ""})`,
    debit: 0,
    credit: amount,
    payment_id: paymentId,
    reverses_id: null,
    reason: null,
  };
  const after = feeSummary({
    track: detail.enrollment.track,
    plan: detail.enrollment.tuition_plan,
    setup: detail.feeSetup,
    ledger: [...detail.ledger, { ...row, id: "new", school_id: "", enrollment_id: "", student_id: "", term_id: "", actor_id: "", actor_name: null, posted_at: now }],
    payments: detail.payments,
    today: manilaDate(now),
  });
  return {
    ok: true,
    payment: { amount, or_no, mode, reference, voided_at: null, void_reason: null, voided_by: null },
    row,
    downpaymentMet: after.downpaymentMet,
  };
}

/** Put the saved payment's id into its ledger row. */
export function bindPaymentId(row: LedgerDraft, paymentId: string): LedgerDraft {
  return { ...row, code: `pay:${paymentId}`, payment_id: paymentId };
}

// ---------- discounts and voids ----------

export type FeeActionInput =
  | {
      type: "apply_discount";
      name: string;
      scope: DiscountScope;
      target: string | null;
      kind: DiscountKind;
      value: number;
      reason: string;
    }
  | { type: "remove_discount"; discount_id: string; reason: string }
  | { type: "void_payment"; payment_id: string; reason: string };

export const FEE_ACTION_LABEL: Record<FeeActionInput["type"], string> = {
  apply_discount: "Apply discount",
  remove_discount: "Remove discount",
  void_payment: "Void payment",
};

export interface FeeMutations {
  ledger: LedgerDraft[];
  addDiscount?: Discount;
  voidDiscount?: { id: string; voided_at: string; void_reason: string };
  voidPayment?: { id: string; voided_at: string; void_reason: string; voided_by: string };
  history: Omit<HistoryRow, "id" | "school_id" | "enrollment_id">;
}

export type FeeResult = { ok: true; mutations: FeeMutations } | { ok: false; error: string };

export interface FeeContext {
  detail: EnrollmentDetail;
  actor: Actor;
  now: string;
  /** Id for a new discount (the store makes it). */
  newId: string;
}

const fail = (error: string): FeeResult => ({ ok: false, error });

/** Discount rows again after the discount list changed (charges stay as posted). */
function rediscount(detail: EnrollmentDetail, discounts: Discount[], reason: string): LedgerDraft[] {
  const charges = postedLines(detail.ledger, ["charge"]);
  const v = voucherDiscount(detail.enrollment, detail.feeSetup);
  const lines = discountLines(charges, v ? [v, ...discounts] : discounts);
  return syncLines(detail.ledger, lines, ["discount"], reason);
}

export function planFeeAction(ctx: FeeContext, input: FeeActionInput): FeeResult {
  const { detail, actor, now } = ctx;
  const e = detail.enrollment;
  const perms = feePermissions(actor.role);
  const reason = input.reason?.trim();
  const history = (action: string, why: string) => ({
    from_status: e.status,
    to_status: e.status,
    action,
    reason: why,
    actor_id: actor.user_id,
    actor_name: `${actor.name} (${actor.role})`,
    created_at: now,
  });

  switch (input.type) {
    case "apply_discount": {
      if (!perms.applyDiscount) return fail("Only the registrar can apply discounts.");
      if (detail.term.closed_at) return fail("This term is closed.");
      if (e.status === "rejected" || e.status === "withdrawn") return fail("This enrollment is closed.");
      const name = input.name?.trim();
      if (!name) return fail("Give the discount a name (e.g. Academic scholarship).");
      if (!reason) return fail("Type the reason for the discount.");
      const value = Number(input.value);
      if (!(value > 0)) return fail("Enter an amount or percent greater than zero.");
      if (input.kind === "percent" && value > 100) return fail("A percent discount is at most 100%.");
      const charges = postedLines(detail.ledger, ["charge"]);
      if (charges.length === 0) return fail("No fees assessed yet. Set the load first.");
      if (input.scope === "item" && !charges.some((c) => c.code === input.target)) return fail("Pick the fee line to discount.");
      if (input.scope === "group" && !(input.target && input.target in FEE_GROUP_LABEL)) return fail("Pick the fee group to discount.");
      const d: Discount = {
        id: ctx.newId,
        school_id: e.school_id,
        enrollment_id: e.id,
        name,
        scope: input.scope,
        target: input.scope === "total" ? null : input.target,
        kind: input.kind,
        value,
        reason,
        applied_by: actor.user_id,
        applied_by_name: actor.name,
        applied_at: now,
        voided_at: null,
        void_reason: null,
      };
      const rows = rediscount(detail, [...detail.discounts, d], `Discount applied: ${name}`);
      const what = input.kind === "percent" ? `${value}%` : peso(value);
      const on = input.scope === "total" ? "total" : input.scope === "group" ? FEE_GROUP_LABEL[input.target as FeeGroup] : input.target;
      return { ok: true, mutations: { ledger: rows, addDiscount: d, history: history("apply_discount", `${name}: ${what} off ${on}. ${reason}`) } };
    }

    case "remove_discount": {
      if (!perms.applyDiscount) return fail("Only the registrar can remove discounts.");
      if (detail.term.closed_at) return fail("This term is closed.");
      const d = detail.discounts.find((x) => x.id === input.discount_id && !x.voided_at);
      if (!d) return fail("Discount not found.");
      if (!reason) return fail("Type the reason for removing the discount.");
      const rest = detail.discounts.filter((x) => x.id !== d.id);
      const rows = rediscount(detail, rest, `Discount removed: ${reason}`);
      return {
        ok: true,
        mutations: {
          ledger: rows,
          voidDiscount: { id: d.id, voided_at: now, void_reason: reason },
          history: history("remove_discount", `${d.name} removed. ${reason}`),
        },
      };
    }

    case "void_payment": {
      const p = detail.payments.find((x) => x.id === input.payment_id);
      if (!p) return fail("Payment not found.");
      const check = canVoidPayment(actor.role, p, now);
      if (!check.ok) return fail(check.error);
      if (!reason) return fail("Type the reason for the void.");
      if (detail.term.closed_at) return fail("This term is closed.");
      const row = detail.ledger.find((r) => r.kind === "payment" && r.payment_id === p.id);
      if (!row) return fail("The payment's ledger row is missing.");
      const why = check.override ? `Registrar override: ${reason}` : reason;
      return {
        ok: true,
        mutations: {
          ledger: [reversal(row, why)],
          voidPayment: { id: p.id, voided_at: now, void_reason: why, voided_by: actor.user_id },
          history: history("void_payment", `Voided OR #${p.or_no} (${peso(p.amount)}). ${why}`),
        },
      };
    }
  }
}

