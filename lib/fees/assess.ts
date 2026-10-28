// Assessment = tuition + lab + misc (+ installment surcharge) - discounts.
// Charge lines come from the fee setup. Discount lines are worked out from
// the charge lines in a fixed order: item -> group -> total.
//
// The same rules run in Postgres (supabase/migrations/0002_fees.sql,
// fees_charge_lines / fees_discount_lines). Keep both in step.

import type { Enrollment, Offering, TuitionPlan } from "../enrollment/types";
import { isSeniorHigh } from "../enrollment/checks";
import type { AssessLine, Assessment, Discount, FeeGroup, FeeSetup } from "./types";
import { FEE_GROUP_LABEL } from "./types";
import { peso, pctOf, toCents } from "./money";
import { PLAN_INFO } from "./setup";

export type SubjectForFees = Pick<Offering, "code" | "units" | "lab_fee" | "is_major">;

const line = (code: string, label: string, group: FeeGroup | null, cents: number, kind: AssessLine["kind"] = "charge"): AssessLine => ({
  code, label, group, kind, amount: cents / 100,
});

/** College: units x rate (major subjects at the major rate) + lab fees + misc. */
export function collegeChargeLines(setup: FeeSetup, subjects: SubjectForFees[]): AssessLine[] {
  const lines: AssessLine[] = [];
  const regular = subjects.filter((s) => !s.is_major).reduce((a, s) => a + Number(s.units), 0);
  const major = subjects.filter((s) => s.is_major).reduce((a, s) => a + Number(s.units), 0);
  if (regular > 0) {
    lines.push(line("tuition", `Tuition (${regular} units x ${peso(setup.rate_per_unit)})`, "tuition",
      Math.round(regular * toCents(setup.rate_per_unit))));
  }
  if (major > 0) {
    lines.push(line("tuition_major", `Tuition, major subjects (${major} units x ${peso(setup.major_rate_per_unit)})`, "tuition",
      Math.round(major * toCents(setup.major_rate_per_unit))));
  }
  for (const s of subjects) {
    if (Number(s.lab_fee) > 0) lines.push(line(`lab:${s.code}`, `Lab fee - ${s.code}`, "lab", toCents(s.lab_fee)));
  }
  for (const m of setup.misc_items) {
    if (Number(m.amount) > 0) lines.push(line(`misc:${m.name}`, m.name, m.group ?? "misc", toCents(m.amount)));
  }
  return lines;
}

/** K to 12: plan items + surcharge on tuition items + misc items. */
export function k12ChargeLines(setup: FeeSetup, plan: TuitionPlan): AssessLine[] {
  const p = setup.plans.find((x) => x.plan === plan) ?? setup.plans[0];
  if (!p) return [];
  const lines: AssessLine[] = [];
  let tuition = 0;
  for (const i of p.items) {
    const g = i.group ?? "tuition";
    if (g === "tuition") tuition += toCents(i.amount);
    if (Number(i.amount) > 0) lines.push(line(`plan:${i.name}`, i.name, g, toCents(i.amount)));
  }
  if (p.surcharge_pct > 0 && tuition > 0) {
    lines.push(line("surcharge", `Installment surcharge (${p.surcharge_pct}% of tuition, ${PLAN_INFO[p.plan].label.split(" (")[0].toLowerCase()} plan)`,
      "other", pctOf(tuition, p.surcharge_pct)));
  }
  for (const m of setup.misc_items) {
    if (Number(m.amount) > 0) lines.push(line(`misc:${m.name}`, m.name, m.group ?? "misc", toCents(m.amount)));
  }
  return lines;
}

/** Grades 7-10 get the ESC grant; Grades 11-12 the SHS voucher. */
export function isJuniorHigh(level: string): boolean {
  return /Grade (7|8|9|10)\b/.test(level);
}

/**
 * ESC grant / SHS voucher for a K to 12 enrollment that has the voucher flag,
 * as a fixed-amount discount on the total. Its id is always "voucher".
 */
export function voucherDiscount(
  e: Pick<Enrollment, "id" | "school_id" | "track" | "level" | "esc_voucher" | "created_at">,
  setup: FeeSetup | null,
): Discount | null {
  if (!setup || e.track !== "k12" || !e.esc_voucher) return null;
  const shs = isSeniorHigh(e.level);
  const amount = shs ? setup.shs_voucher_amount : isJuniorHigh(e.level) ? setup.esc_amount : 0;
  if (!(amount > 0)) return null;
  return {
    id: "voucher",
    school_id: e.school_id,
    enrollment_id: e.id,
    name: shs ? "SHS voucher" : "ESC grant",
    scope: "total",
    target: null,
    kind: "amount",
    value: amount,
    reason: "Voucher flag on the application",
    applied_by: "system",
    applied_by_name: null,
    applied_at: "",
    voided_at: null,
    void_reason: null,
  };
}

const STAGE: Record<Discount["scope"], number> = { item: 0, group: 1, total: 2 };

/** Discounts in the order they apply: item, then group, then total; oldest first. */
export function orderDiscounts(discounts: Discount[]): Discount[] {
  return discounts
    .filter((d) => !d.voided_at)
    .sort((a, b) => STAGE[a.scope] - STAGE[b.scope] || a.applied_at.localeCompare(b.applied_at) || a.id.localeCompare(b.id));
}

export function describeDiscount(d: Pick<Discount, "scope" | "target" | "kind" | "value">, chargeLines: AssessLine[] = []): string {
  const what =
    d.scope === "total" ? "total"
    : d.scope === "group" ? FEE_GROUP_LABEL[d.target as FeeGroup]?.toLowerCase() ?? d.target
    : chargeLines.find((l) => l.code === d.target)?.label ?? d.target;
  return d.kind === "percent" ? `${d.value}% of ${what}` : `${peso(d.value)} off ${what}`;
}

/**
 * Discount lines, stacked in a clear order:
 * 1. item discounts reduce one fee line,
 * 2. group discounts reduce what is left of a group (e.g. tuition only),
 * 3. total discounts reduce what is left of everything.
 * Percent discounts use what is left at that point. A discount never takes
 * more than what is left, so the total never goes below zero.
 */
export function discountLines(chargeLines: AssessLine[], discounts: Discount[]): AssessLine[] {
  const itemLeft = new Map<string, number>();
  const groupLeft = new Map<string, number>();
  let totalLeft = 0;
  for (const l of chargeLines) {
    const c = toCents(l.amount);
    itemLeft.set(l.code, (itemLeft.get(l.code) ?? 0) + c);
    if (l.group) groupLeft.set(l.group, (groupLeft.get(l.group) ?? 0) + c);
    totalLeft += c;
  }
  const groupOf = new Map(chargeLines.map((l) => [l.code, l.group]));
  const out: AssessLine[] = [];
  for (const d of orderDiscounts(discounts)) {
    let base = 0;
    if (d.scope === "item") base = itemLeft.get(d.target ?? "") ?? 0;
    else if (d.scope === "group") base = groupLeft.get(d.target ?? "") ?? 0;
    else base = totalLeft;
    base = Math.max(0, base);
    let cents = d.kind === "percent" ? pctOf(base, d.value) : toCents(d.value);
    cents = Math.max(0, Math.min(cents, base));
    if (d.scope === "item") {
      itemLeft.set(d.target!, base - cents);
      const g = groupOf.get(d.target!);
      if (g) groupLeft.set(g, (groupLeft.get(g) ?? 0) - cents);
    } else if (d.scope === "group") {
      groupLeft.set(d.target!, base - cents);
    }
    totalLeft -= cents;
    const group = d.scope === "item" ? groupOf.get(d.target ?? "") ?? null : d.scope === "group" ? (d.target as FeeGroup) : null;
    out.push(line(`disc:${d.id}`, `${d.name} (${describeDiscount(d, chargeLines)})`, group, -cents, "discount"));
  }
  return out;
}

export function summarize(lines: AssessLine[]): Assessment {
  const charges = lines.filter((l) => l.kind === "charge").reduce((a, l) => a + toCents(l.amount), 0);
  const discounts = lines.filter((l) => l.kind === "discount").reduce((a, l) => a + toCents(l.amount), 0);
  return { lines, charges: charges / 100, discounts: discounts / 100, total: (charges + discounts) / 100 };
}

/** Full assessment for an enrollment (charges from the setup + all discounts). */
export function assess(input: {
  enrollment: Pick<Enrollment, "id" | "school_id" | "track" | "level" | "esc_voucher" | "tuition_plan" | "created_at">;
  setup: FeeSetup;
  subjects: SubjectForFees[];
  discounts: Discount[];
}): Assessment {
  const { enrollment: e, setup } = input;
  const charges = e.track === "college"
    ? collegeChargeLines(setup, input.subjects)
    : k12ChargeLines(setup, e.tuition_plan ?? "annual");
  const v = voucherDiscount(e, setup);
  const all = v ? [v, ...input.discounts] : input.discounts;
  return summarize([...charges, ...discountLines(charges, all)]);
}
