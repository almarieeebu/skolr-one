// Fee assessment. College: units x rate + lab fees + misc.
// K to 12: yearly tuition by grade + misc - voucher, then split by plan.

import type { Enrollment, Offering, Payment, SchoolSettings, TuitionPlan } from "./types";
import { isSeniorHigh } from "./checks";

export interface FeeLineDraft {
  label: string;
  amount: number;
}

export interface Assessment {
  lines: FeeLineDraft[];
  total: number;
  installments: number;
  perInstallment: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function assessCollege(subjects: Offering[], settings: SchoolSettings): Assessment {
  const units = subjects.reduce((s, o) => s + o.units, 0);
  const lines: FeeLineDraft[] = [
    { label: `Tuition (${units} units x ${peso(settings.rate_per_unit)})`, amount: round2(units * settings.rate_per_unit) },
  ];
  for (const s of subjects) {
    if (s.lab_fee > 0) lines.push({ label: `Lab fee - ${s.code}`, amount: s.lab_fee });
  }
  lines.push({ label: "Miscellaneous fees", amount: settings.misc_fee });
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  return { lines, total, installments: 1, perInstallment: total };
}

export const PLAN_INFO: Record<TuitionPlan, { installments: number; surcharge: number; label: string }> = {
  annual: { installments: 1, surcharge: 0, label: "Annual (one payment)" },
  quarterly: { installments: 4, surcharge: 0.03, label: "Quarterly (4 payments, +3%)" },
  monthly: { installments: 10, surcharge: 0.05, label: "Monthly (10 payments, +5%)" },
};

/** Grades 7-10 are junior high (ESC grant); 11-12 senior high (SHS voucher). */
function isJuniorHigh(level: string) {
  return /Grade (7|8|9|10)\b/.test(level);
}

export function assessK12(
  e: Pick<Enrollment, "level" | "esc_voucher" | "tuition_plan">,
  settings: SchoolSettings,
): Assessment {
  const plan = PLAN_INFO[e.tuition_plan ?? "annual"];
  const tuition = settings.k12_tuition?.[e.level] ?? settings.k12_default_tuition ?? 0;
  const lines: FeeLineDraft[] = [{ label: `Tuition - ${e.level}`, amount: tuition }];
  if (plan.surcharge > 0) {
    lines.push({ label: `Installment charge (${Math.round(plan.surcharge * 100)}%)`, amount: round2(tuition * plan.surcharge) });
  }
  lines.push({ label: "Miscellaneous fees", amount: settings.k12_misc_fee ?? 0 });
  if (e.esc_voucher) {
    if (isSeniorHigh(e.level) && settings.shs_voucher_amount) {
      lines.push({ label: "SHS voucher", amount: -settings.shs_voucher_amount });
    } else if (isJuniorHigh(e.level) && settings.esc_amount) {
      lines.push({ label: "ESC grant", amount: -settings.esc_amount });
    }
  }
  const total = Math.max(0, round2(lines.reduce((s, l) => s + l.amount, 0)));
  return {
    lines,
    total,
    installments: plan.installments,
    perInstallment: round2(total / plan.installments),
  };
}

export function totalPaid(payments: Pick<Payment, "amount">[]): number {
  return round2(payments.reduce((s, p) => s + p.amount, 0));
}

/** The downpayment needed before official enrollment (never more than the total). */
export function requiredDownpayment(total: number, settings: Pick<SchoolSettings, "min_downpayment">): number {
  return Math.min(total, settings.min_downpayment);
}

export function peso(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
