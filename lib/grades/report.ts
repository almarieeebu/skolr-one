// Puts sheets and entries together: grade sheet rows, a student's grades
// (college grade slip / K to 12 report card), and passed subjects for
// prerequisites.

import type { Offering } from "../enrollment/types";
import {
  COLLEGE_PERIODS,
  collegeResult,
  computeGwa,
  transmuteCollege,
  type CollegeResult,
  type PeriodValue,
} from "./college";
import {
  KINDER_AREA,
  KINDER_DOMAINS,
  descriptor,
  finalGrade,
  generalAverage,
  isKinder,
  learningAreasFor,
  quarterlyGrade,
  QUARTERS,
  type Descriptor,
} from "./k12";
import type {
  CollegePeriod,
  GradeEntry,
  GradeSettings,
  GradeSheet,
  KinderMark,
  LearningArea,
  Quarter,
  ScoreItem,
  SheetStatus,
} from "./types";

export type SheetKind = "college" | "k12" | "kinder";

export function sheetKind(offering: Pick<Offering, "kind" | "level">): SheetKind {
  if (offering.kind === "subject") return "college";
  return isKinder(offering.level) ? "kinder" : "k12";
}

/** The grade saved on an entry: college period grade, or K to 12 quarterly grade. */
export function entryGrade(
  kind: SheetKind,
  entry: Pick<GradeEntry, "percent" | "mark" | "scores">,
  items: Pick<ScoreItem, "id" | "component" | "max_score">[],
  settings: Pick<GradeSettings, "college_scale" | "k12_weights">,
  area?: Pick<LearningArea, "group">,
): number | null {
  if (kind === "college") return entry.mark || entry.percent == null ? null : transmuteCollege(entry.percent, settings.college_scale);
  if (kind === "kinder" || !area) return null;
  if (!items.some((i) => entry.scores[i.id] != null)) return null;
  return quarterlyGrade(items, entry.scores, settings.k12_weights[area.group]).quarterly;
}

/** Does this row count as filled in (for submit)? */
export function entryFilled(
  kind: SheetKind,
  entry: Pick<GradeEntry, "percent" | "mark" | "scores" | "domains"> | undefined,
  items: Pick<ScoreItem, "id">[],
): boolean {
  if (!entry) return false;
  if (kind === "college") return entry.percent != null || entry.mark != null;
  if (kind === "kinder") return KINDER_DOMAINS.every((d) => !!entry.domains[d.code]);
  return items.length > 0 && items.every((i) => entry.scores[i.id] != null && Number.isFinite(entry.scores[i.id]));
}

// ---------- college grade slip ----------

export interface PeriodCell extends PeriodValue {
  grade: number | null;
  status: SheetStatus | null;
}

export interface CollegeRow {
  offering: Offering;
  periods: Record<CollegePeriod, PeriodCell>;
  result: CollegeResult;
}

export interface CollegeReport {
  rows: CollegeRow[];
  gwa: number | null;
  gwaUnits: number;
}

const visible = (s: GradeSheet, postedOnly: boolean) => !postedOnly || s.status === "posted";

export function collegeReport(args: {
  subjects: Offering[];
  enrollmentId: string;
  sheets: GradeSheet[];
  entries: GradeEntry[];
  settings: GradeSettings;
  postedOnly: boolean;
}): CollegeReport {
  const rows = args.subjects.map((o): CollegeRow => {
    const periods = {} as Record<CollegePeriod, PeriodCell>;
    for (const p of COLLEGE_PERIODS) {
      const sheet = args.sheets.find((s) => s.offering_id === o.id && s.period === p && visible(s, args.postedOnly));
      const entry = sheet && args.entries.find((e) => e.sheet_id === sheet.id && e.enrollment_id === args.enrollmentId);
      periods[p] = {
        percent: entry?.percent ?? null,
        mark: entry?.mark ?? null,
        grade: entry ? entryGrade("college", entry, [], args.settings) : null,
        status: sheet?.status ?? null,
      };
    }
    return { offering: o, periods, result: collegeResult(periods, args.settings) };
  });
  const { gwa, units } = computeGwa(
    rows.map((r) => ({ units: r.offering.units, non_credit: r.offering.non_credit, result: r.result })),
    args.settings.gwa_decimals,
  );
  return { rows, gwa, gwaUnits: units };
}

// ---------- K to 12 report card ----------

export interface AreaRow {
  code: string;
  name: string;
  parent?: string;
  quarters: Partial<Record<Quarter, number | null>>;
  /** Quarters this area runs. */
  runs: Quarter[];
  final: number | null;
  descriptor: Descriptor | null;
  passed: boolean | null;
}

export interface K12Report {
  rows: AreaRow[];
  /** MAPEH as one row (quarterly = average of the four components). */
  mapeh: AreaRow | null;
  general: number | null;
  generalExact: number | null;
  generalDescriptor: Descriptor | null;
}

export function k12Report(args: {
  level: string;
  strand: string | null;
  sectionId: string;
  enrollmentId: string;
  sheets: GradeSheet[];
  entries: GradeEntry[];
  postedOnly: boolean;
}): K12Report {
  const areas = learningAreasFor(args.level, args.strand);
  const gradeOf = (code: string, q: Quarter) => {
    const sheet = args.sheets.find(
      (s) => s.offering_id === args.sectionId && s.learning_area === code && s.period === q && visible(s, args.postedOnly),
    );
    const entry = sheet && args.entries.find((e) => e.sheet_id === sheet.id && e.enrollment_id === args.enrollmentId);
    return entry?.grade ?? null;
  };
  const rows: AreaRow[] = areas.map((a) => {
    const quarters: Partial<Record<Quarter, number | null>> = {};
    for (const q of a.quarters) quarters[q] = gradeOf(a.code, q);
    const final = finalGrade(a.quarters.map((q) => quarters[q]));
    return {
      code: a.code, name: a.name, parent: a.parent, quarters, runs: a.quarters, final,
      descriptor: final == null ? null : descriptor(final), passed: final == null ? null : final >= 75,
    };
  });
  const comps = rows.filter((r) => r.parent === "MAPEH");
  let mapeh: AreaRow | null = null;
  if (comps.length) {
    const quarters: Partial<Record<Quarter, number | null>> = {};
    for (const q of QUARTERS) {
      const qs = comps.map((c) => c.quarters[q]);
      quarters[q] = qs.some((x) => x == null) ? null : Math.round(qs.reduce((s: number, x) => s + (x as number), 0) / qs.length);
    }
    const ga = generalAverage(comps.map((c) => ({ code: c.code, parent: "MAPEH", final: c.final })));
    mapeh = {
      code: "MAPEH", name: "MAPEH", quarters, runs: QUARTERS, final: ga.mapeh,
      descriptor: ga.mapeh == null ? null : descriptor(ga.mapeh), passed: ga.mapeh == null ? null : ga.mapeh >= 75,
    };
  }
  const ga = generalAverage(rows.map((r) => ({ code: r.code, parent: r.parent, final: r.final })));
  return {
    rows, mapeh, general: ga.average, generalExact: ga.exact,
    generalDescriptor: ga.average == null ? null : descriptor(ga.average),
  };
}

// ---------- Kinder checklist ----------

export function kinderReport(args: {
  sectionId: string;
  enrollmentId: string;
  sheets: GradeSheet[];
  entries: GradeEntry[];
  postedOnly: boolean;
}): { code: string; name: string; marks: Partial<Record<Quarter, KinderMark | null>> }[] {
  return KINDER_DOMAINS.map((d) => {
    const marks: Partial<Record<Quarter, KinderMark | null>> = {};
    for (const q of QUARTERS) {
      const sheet = args.sheets.find(
        (s) => s.offering_id === args.sectionId && s.learning_area === KINDER_AREA && s.period === q && visible(s, args.postedOnly),
      );
      const entry = sheet && args.entries.find((e) => e.sheet_id === sheet.id && e.enrollment_id === args.enrollmentId);
      marks[q] = entry?.domains[d.code] ?? null;
    }
    return { ...d, marks };
  });
}

// ---------- prerequisites ----------

/**
 * Subject codes a student passed, from POSTED college grades of their other
 * enrollments. Used by the prerequisite check (with completed_codes as the
 * fallback for transferees and credited subjects).
 */
export function passedCodes(args: {
  enrollments: { id: string }[];
  offerings: Offering[];
  loads: { enrollment_id: string; offering_id: string }[];
  sheets: GradeSheet[];
  entries: GradeEntry[];
  settings: GradeSettings;
}): string[] {
  const out = new Set<string>();
  for (const e of args.enrollments) {
    const subjects = args.loads
      .filter((l) => l.enrollment_id === e.id)
      .map((l) => args.offerings.find((o) => o.id === l.offering_id))
      .filter((o): o is Offering => !!o && o.kind === "subject");
    if (!subjects.length) continue;
    const r = collegeReport({ subjects, enrollmentId: e.id, sheets: args.sheets, entries: args.entries, settings: args.settings, postedOnly: true });
    for (const row of r.rows) if (row.result.remarks === "Passed") out.add(row.offering.code);
  }
  return [...out].sort();
}
