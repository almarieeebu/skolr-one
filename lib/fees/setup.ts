// Fee setup helpers: pick the setup for an enrollment, default schedules,
// plan info, and a simple validation before saving.

import type { Enrollment, Term, TuitionPlan } from "../enrollment/types";
import type { ExamPeriod, FeeSetup, PlanSetup } from "./types";
import { toCents } from "./money";

export const PLAN_INFO: Record<TuitionPlan, { installments: number; label: string }> = {
  annual: { installments: 1, label: "Annual (one payment)" },
  quarterly: { installments: 4, label: "Quarterly (4 payments)" },
  monthly: { installments: 10, label: "Monthly (10 payments, Jun to Mar)" },
};

/**
 * The setup that applies to an enrollment. Same term + track, then the most
 * specific scope wins: course + level, course, level, then "all".
 */
export function findSetup(
  setups: FeeSetup[],
  e: Pick<Enrollment, "term_id" | "track" | "course" | "level">,
): FeeSetup | null {
  let best: FeeSetup | null = null;
  let bestScore = -1;
  for (const s of setups) {
    if (s.term_id !== e.term_id || s.track !== e.track) continue;
    if (s.scope_course && s.scope_course !== e.course) continue;
    if (s.scope_level && s.scope_level !== e.level) continue;
    const score = (s.scope_course ? 2 : 0) + (s.scope_level ? 1 : 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

export function scopeLabel(s: Pick<FeeSetup, "scope_course" | "scope_level" | "track">): string {
  const parts = [s.scope_course, s.scope_level].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return s.track === "college" ? "All courses and years" : "All grade levels";
}

const startYear = (schoolYear: string) => parseInt(schoolYear.slice(0, 4), 10) || 2026;
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** College exam periods, 25% each by default. */
export function defaultExamPeriods(term: Pick<Term, "school_year" | "semester">): ExamPeriod[] {
  const y = startYear(term.school_year);
  // 1st sem Aug-Dec, 2nd sem Jan-May, summer Jun-Jul.
  const months =
    term.semester === "2nd" ? [[y + 1, 2], [y + 1, 3], [y + 1, 4], [y + 1, 5]]
    : term.semester === "summer" ? [[y + 1, 6], [y + 1, 6], [y + 1, 7], [y + 1, 7]]
    : [[y, 9], [y, 10], [y, 11], [y, 12]];
  const names = ["Prelim", "Midterm", "Semi-final", "Final"];
  return names.map((name, i) => ({ name, percent: 25, due_date: ymd(months[i][0], months[i][1], 15) }));
}

/** K to 12 due dates: annual = June, quarterly = Jun/Aug/Nov/Jan, monthly = Jun to Mar. */
export function defaultPlanDueDates(schoolYear: string, plan: TuitionPlan): string[] {
  const y = startYear(schoolYear);
  if (plan === "annual") return [ymd(y, 6, 15)];
  if (plan === "quarterly") return [ymd(y, 6, 15), ymd(y, 8, 15), ymd(y, 11, 15), ymd(y + 1, 1, 15)];
  return Array.from({ length: 10 }, (_, i) => {
    const m = 6 + i; // Jun (6) .. Mar (15 -> 3 next year)
    return m <= 12 ? ymd(y, m, 5) : ymd(y + 1, m - 12, 5);
  });
}

export function defaultPlans(schoolYear: string, tuition: number): PlanSetup[] {
  return (["annual", "quarterly", "monthly"] as TuitionPlan[]).map((plan) => ({
    plan,
    items: [{ name: "Tuition", amount: tuition, group: "tuition" }],
    surcharge_pct: plan === "annual" ? 0 : plan === "quarterly" ? 3 : 5,
    due_dates: defaultPlanDueDates(schoolYear, plan),
  }));
}

export function newSetup(
  term: Term,
  scope: { course?: string | null; level?: string | null } = {},
): Omit<FeeSetup, "id" | "updated_at"> {
  return {
    school_id: term.school_id,
    term_id: term.id,
    track: term.track,
    scope_course: term.track === "college" ? scope.course ?? null : null,
    scope_level: scope.level ?? null,
    min_downpayment: 3000,
    misc_items: [
      { name: "Registration", amount: 500, group: "misc" },
      { name: "Library", amount: 800, group: "misc" },
    ],
    rate_per_unit: term.track === "college" ? 1000 : 0,
    major_rate_per_unit: term.track === "college" ? 1200 : 0,
    exam_periods: term.track === "college" ? defaultExamPeriods(term) : [],
    plans: term.track === "k12" ? defaultPlans(term.school_year, 25000) : [],
    esc_amount: 0,
    shs_voucher_amount: 0,
  };
}

/** Plan total = plan items + surcharge on tuition items + misc items. */
export function planTotal(setup: Pick<FeeSetup, "misc_items">, plan: PlanSetup): number {
  const items = plan.items.reduce((a, i) => a + toCents(i.amount), 0);
  const tuition = plan.items.filter((i) => (i.group ?? "tuition") === "tuition").reduce((a, i) => a + toCents(i.amount), 0);
  const surcharge = Math.round((tuition * Math.round(plan.surcharge_pct * 100)) / 10000);
  const misc = setup.misc_items.reduce((a, i) => a + toCents(i.amount), 0);
  return (items + surcharge + misc) / 100;
}

/** Problems that block saving a setup. Empty = fine. */
export function validateSetup(s: Omit<FeeSetup, "id" | "updated_at">): string[] {
  const w: string[] = [];
  const neg = (n: number) => !(Number(n) >= 0);
  if (neg(s.min_downpayment)) w.push("Minimum downpayment must be 0 or more.");
  for (const i of s.misc_items) {
    if (!i.name.trim()) w.push("Every misc item needs a name.");
    if (neg(i.amount)) w.push(`${i.name || "Misc item"}: amount must be 0 or more.`);
  }
  const names = s.misc_items.map((i) => i.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) w.push("Misc item names must be different.");
  if (s.track === "college") {
    if (neg(s.rate_per_unit) || neg(s.major_rate_per_unit)) w.push("Rates per unit must be 0 or more.");
    if (s.exam_periods.length === 0) w.push("Add at least one exam period.");
    const pct = s.exam_periods.reduce((a, p) => a + Math.round(Number(p.percent) * 100), 0);
    if (pct !== 10000) w.push(`Exam period percents must add up to 100 (now ${pct / 100}).`);
    for (const p of s.exam_periods) if (!p.due_date) w.push(`${p.name}: set a due date.`);
  } else {
    if (s.plans.length === 0) w.push("Add at least one tuition plan.");
    for (const p of s.plans) {
      if (p.due_dates.length !== PLAN_INFO[p.plan].installments) {
        w.push(`${PLAN_INFO[p.plan].label}: needs ${PLAN_INFO[p.plan].installments} due dates.`);
      }
      if (p.items.some((i) => neg(i.amount))) w.push(`${p.plan} plan: amounts must be 0 or more.`);
      if (neg(p.surcharge_pct)) w.push(`${p.plan} plan: surcharge must be 0 or more.`);
    }
    if (neg(s.esc_amount) || neg(s.shs_voucher_amount)) w.push("Voucher amounts must be 0 or more.");
  }
  return [...new Set(w)];
}
