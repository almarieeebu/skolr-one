// Who may do what with fees.
// - cashier: take payments, void them (same day only)
// - registrar: fee setup, discounts, term closing, void any payment (override, with reason)
// - student / parent: see their own fees, schedule and statement (read only)
// - dean: read only
// - teacher: nothing about fees

import type { Role } from "../enrollment/types";
import type { Payment } from "./types";
import { manilaDate } from "./summary";

export interface FeePermissions {
  view: boolean;
  takePayment: boolean;
  voidPayment: boolean;
  applyDiscount: boolean;
  setup: boolean;
  closeTerm: boolean;
}

export function feePermissions(role: Role): FeePermissions {
  const none = { view: false, takePayment: false, voidPayment: false, applyDiscount: false, setup: false, closeTerm: false };
  switch (role) {
    case "registrar":
      return { ...none, view: true, voidPayment: true, applyDiscount: true, setup: true, closeTerm: true };
    case "cashier":
      return { ...none, view: true, takePayment: true, voidPayment: true };
    case "dean":
    case "student":
    case "parent":
      return { ...none, view: true };
    case "teacher":
      return none;
  }
}

export type VoidCheck = { ok: true; override: boolean } | { ok: false; error: string };

/** Cashier: same day only. Registrar: any day, as an override with a reason. */
export function canVoidPayment(role: Role, p: Pick<Payment, "paid_at" | "voided_at">, now: string): VoidCheck {
  if (p.voided_at) return { ok: false, error: "This payment is already void." };
  if (role === "cashier") {
    return manilaDate(p.paid_at) === manilaDate(now)
      ? { ok: true, override: false }
      : { ok: false, error: "Cashiers can only void payments made today. Ask the registrar to override." };
  }
  if (role === "registrar") return { ok: true, override: true };
  return { ok: false, error: `A ${role} cannot void payments.` };
}
