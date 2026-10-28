// College (CHED) grading: percent -> 1.00-5.00 scale, period averages,
// remarks and the GWA.

import type {
  CollegePeriod,
  CollegeScaleRow,
  GradeSettings,
  Remarks,
  SpecialMark,
} from "./types";

export const COLLEGE_PERIODS: CollegePeriod[] = ["prelim", "midterm", "semifinal", "final"];

export const PERIOD_LABEL: Record<CollegePeriod, string> = {
  prelim: "Prelim",
  midterm: "Midterm",
  semifinal: "Semi-final",
  final: "Final",
};

export const MARK_LABEL: Record<SpecialMark, string> = {
  INC: "Incomplete",
  DRP: "Dropped",
  W: "Withdrawn",
};

/** Default CHED-style scale: 97-100 = 1.00 ... 75 = 3.00, below 75 = 5.00. */
export function defaultCollegeScale(): CollegeScaleRow[] {
  return [
    { min: 97, max: 100, grade: 1.0 },
    { min: 94, max: 96, grade: 1.25 },
    { min: 91, max: 93, grade: 1.5 },
    { min: 88, max: 90, grade: 1.75 },
    { min: 85, max: 87, grade: 2.0 },
    { min: 82, max: 84, grade: 2.25 },
    { min: 79, max: 81, grade: 2.5 },
    { min: 76, max: 78, grade: 2.75 },
    { min: 75, max: 75, grade: 3.0 },
    { min: 0, max: 74, grade: 5.0 },
  ];
}

/** Round half up to a number of decimals (avoids 1.005 -> 1.00 float surprises). */
export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export const fmtGrade = (g: number | null | undefined) => (g == null ? "—" : g.toFixed(2));

/** Percent -> scale grade. The percent is first rounded to a whole number. */
export function transmuteCollege(percent: number, scale: CollegeScaleRow[]): number | null {
  if (!Number.isFinite(percent)) return null;
  const p = Math.round(Math.min(100, Math.max(0, percent)));
  const row = scale.find((r) => p >= r.min && p <= r.max);
  return row ? row.grade : null;
}

/** Problems with an edited scale (gaps, overlaps, bad grades). Empty = fine. */
export function validateCollegeScale(scale: CollegeScaleRow[]): string[] {
  const problems: string[] = [];
  for (let p = 0; p <= 100; p++) {
    const hits = scale.filter((r) => p >= r.min && p <= r.max).length;
    if (hits === 0) problems.push(`No grade for ${p}%.`);
    if (hits > 1) problems.push(`${p}% is in more than one row.`);
    if (problems.length > 3) break;
  }
  for (const r of scale) {
    if (!(r.grade >= 1 && r.grade <= 5)) problems.push(`Grade ${r.grade} is outside 1.00-5.00.`);
  }
  return problems;
}

export interface PeriodValue {
  percent: number | null;
  mark: SpecialMark | null;
}

export interface CollegeResult {
  /** Average percent (weighted), before the scale. */
  average: number | null;
  /** Final grade on the 1.00-5.00 scale. */
  final: number | null;
  /** INC / DRP / W carried to the final grade. */
  mark: SpecialMark | null;
  remarks: Remarks | null;
}

const hasValue = (v: PeriodValue | undefined) => !!v && (v.percent != null || v.mark != null);

/**
 * Final grade of one subject from its period values.
 * - The final grade shows once the Final period is in.
 * - W wins over DRP, DRP over INC. With `block_average_on_inc` (default) an
 *   INC/DRP period means no average; otherwise those periods are skipped.
 * - all_four: missing periods count as 0 but still divide by all four weights.
 *   present: divide by the weights of the periods that have a percent.
 *   final_only: the Final period is the average.
 */
export function collegeResult(
  periods: Partial<Record<CollegePeriod, PeriodValue>>,
  settings: Pick<GradeSettings, "college_average" | "period_weights" | "block_average_on_inc" | "college_scale" | "passing_grade">,
): CollegeResult {
  const values = COLLEGE_PERIODS.map((p) => periods[p]);
  const marks = values.map((v) => v?.mark).filter(Boolean) as SpecialMark[];
  const none: CollegeResult = { average: null, final: null, mark: null, remarks: null };
  if (marks.includes("W")) return { ...none, mark: "W", remarks: "Dropped" };
  if (settings.block_average_on_inc) {
    if (marks.includes("DRP")) return { ...none, mark: "DRP", remarks: "Dropped" };
    if (marks.includes("INC")) return { ...none, mark: "INC", remarks: "Incomplete" };
  }
  if (!hasValue(periods.final)) return none;

  let average: number | null = null;
  if (settings.college_average === "final_only") {
    average = periods.final?.percent ?? null;
  } else {
    let sum = 0;
    let weights = 0;
    COLLEGE_PERIODS.forEach((p) => {
      const w = Number(settings.period_weights[p] ?? 25);
      const v = periods[p];
      if (v?.percent != null && v.mark == null) {
        sum += w * v.percent;
        weights += w;
      } else if (settings.college_average === "all_four" && !(v?.mark && !settings.block_average_on_inc)) {
        weights += w; // counts as zero
      }
    });
    average = weights > 0 ? roundTo(sum / weights, 2) : null;
  }
  if (average == null) {
    // Every period is a skipped INC/DRP.
    const m = marks.includes("DRP") ? "DRP" : marks.includes("INC") ? "INC" : null;
    return { ...none, mark: m, remarks: m === "DRP" ? "Dropped" : m === "INC" ? "Incomplete" : null };
  }
  const final = transmuteCollege(average, settings.college_scale);
  return {
    average,
    final,
    mark: null,
    remarks: final == null ? null : final <= settings.passing_grade ? "Passed" : "Failed",
  };
}

export interface GwaSubject {
  units: number;
  non_credit: boolean;
  result: CollegeResult;
}

/**
 * GWA = sum(final grade x units) / sum(units). Leaves out INC / DRP / W,
 * subjects with no final grade yet, and non-credit subjects (e.g. NSTP).
 */
export function computeGwa(subjects: GwaSubject[], decimals = 2): { gwa: number | null; units: number } {
  let sum = 0;
  let units = 0;
  for (const s of subjects) {
    if (s.non_credit || s.result.mark || s.result.final == null || !(s.units > 0)) continue;
    sum += s.result.final * s.units;
    units += s.units;
  }
  return { gwa: units > 0 ? roundTo(sum / units, decimals) : null, units };
}
