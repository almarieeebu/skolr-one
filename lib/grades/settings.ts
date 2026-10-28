// School grade settings: defaults, checks and deadlines.

import { COLLEGE_PERIODS, defaultCollegeScale, validateCollegeScale } from "./college";
import { defaultK12Weights, GROUP_LABEL } from "./k12";
import type { GradePeriod, GradeSettings, SubjectGroup } from "./types";

export function defaultGradeSettings(school_id: string): GradeSettings {
  return {
    school_id,
    college_average: "all_four",
    period_weights: { prelim: 25, midterm: 25, semifinal: 25, final: 25 },
    block_average_on_inc: true,
    gwa_decimals: 2,
    passing_grade: 3.0,
    college_scale: defaultCollegeScale(),
    k12_weights: defaultK12Weights(),
    deadlines: [],
    updated_at: new Date(0).toISOString(),
  };
}

export function validateGradeSettings(s: GradeSettings): string[] {
  const problems = validateCollegeScale(s.college_scale);
  const pw = COLLEGE_PERIODS.reduce((sum, p) => sum + Number(s.period_weights[p] || 0), 0);
  if (Math.abs(pw - 100) > 0.001) problems.push(`Period weights add up to ${pw}%, not 100%.`);
  for (const [g, w] of Object.entries(s.k12_weights) as [SubjectGroup, { ww: number; pt: number; qa: number }][]) {
    const t = Number(w.ww) + Number(w.pt) + Number(w.qa);
    if (Math.abs(t - 100) > 0.001) problems.push(`${GROUP_LABEL[g]}: WW + PT + QA = ${t}%, not 100%.`);
  }
  if (!(s.gwa_decimals >= 0 && s.gwa_decimals <= 4)) problems.push("GWA decimals must be 0 to 4.");
  return problems;
}

export function deadlineFor(s: Pick<GradeSettings, "deadlines">, termId: string, period: GradePeriod): string | null {
  return s.deadlines.find((d) => d.term_id === termId && d.period === period)?.due_date ?? null;
}

/** Philippine date (YYYY-MM-DD) of an ISO time. */
export function phDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** True when today (Philippine time) is after the due date. */
export function isPastDeadline(due: string | null, now: string): boolean {
  return !!due && phDate(now) > due;
}
