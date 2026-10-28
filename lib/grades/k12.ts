// K to 12 grading (DepEd Order No. 8, s. 2015): Written Work, Performance
// Tasks and Quarterly Assessment, weights per subject group, the official
// transmutation table, final grades and the general average.

import { roundTo } from "./college";
import type {
  ComponentWeights,
  K12Component,
  KinderMark,
  LearningArea,
  Quarter,
  ScoreItem,
  SubjectGroup,
} from "./types";

export const QUARTERS: Quarter[] = ["q1", "q2", "q3", "q4"];
export const QUARTER_LABEL: Record<Quarter, string> = { q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4" };

export const COMPONENT_LABEL: Record<K12Component, string> = {
  ww: "Written Work",
  pt: "Performance Tasks",
  qa: "Quarterly Assessment",
};

export const GROUP_LABEL: Record<SubjectGroup, string> = {
  lang_ap_esp: "Languages, AP, EsP",
  sci_math: "Science, Math",
  mapeh_epp_tle: "MAPEH, EPP, TLE",
  shs_core: "SHS core subjects",
  shs_academic: "SHS academic track subjects",
  shs_immersion: "SHS work immersion / research / exhibit",
  shs_tvl: "SHS TVL / Sports / Arts and Design subjects",
};

/** DO 8 s. 2015 default weights (percent). Schools may edit them. */
export function defaultK12Weights(): Record<SubjectGroup, ComponentWeights> {
  return {
    lang_ap_esp: { ww: 30, pt: 50, qa: 20 },
    sci_math: { ww: 40, pt: 40, qa: 20 },
    mapeh_epp_tle: { ww: 20, pt: 60, qa: 20 },
    shs_core: { ww: 25, pt: 50, qa: 25 },
    shs_academic: { ww: 25, pt: 45, qa: 30 },
    shs_immersion: { ww: 35, pt: 40, qa: 25 },
    shs_tvl: { ww: 20, pt: 60, qa: 20 },
  };
}

/**
 * The official DO 8 s. 2015 transmutation table: [lowest initial grade, quarterly grade].
 * Each row covers initial grades from its value up to (not including) the row above.
 */
export const DEPED_TRANSMUTATION: [min: number, grade: number][] = [
  [100, 100],
  [98.4, 99],
  [96.8, 98],
  [95.2, 97],
  [93.6, 96],
  [92.0, 95],
  [90.4, 94],
  [88.8, 93],
  [87.2, 92],
  [85.6, 91],
  [84.0, 90],
  [82.4, 89],
  [80.8, 88],
  [79.2, 87],
  [77.6, 86],
  [76.0, 85],
  [74.4, 84],
  [72.8, 83],
  [71.2, 82],
  [69.6, 81],
  [68.0, 80],
  [66.4, 79],
  [64.8, 78],
  [63.2, 77],
  [61.6, 76],
  [60.0, 75],
  [56.0, 74],
  [52.0, 73],
  [48.0, 72],
  [44.0, 71],
  [40.0, 70],
  [36.0, 69],
  [32.0, 68],
  [28.0, 67],
  [24.0, 66],
  [20.0, 65],
  [16.0, 64],
  [12.0, 63],
  [8.0, 62],
  [4.0, 61],
  [0, 60],
];

/** Initial grade (0-100, 2 decimals) -> quarterly grade (60-100). */
export function transmuteDepEd(initial: number): number {
  const ig = roundTo(Math.max(0, Math.min(100, initial)), 2);
  for (const [min, grade] of DEPED_TRANSMUTATION) if (ig >= min) return grade;
  return 60;
}

export interface ComponentScore {
  raw: number;
  highest: number;
  /** Percentage score = raw / highest x 100 (2 decimals); null when there are no items. */
  ps: number | null;
  /** Weighted score = PS x weight (2 decimals). */
  ws: number;
}

export interface QuarterlyResult {
  ww: ComponentScore;
  pt: ComponentScore;
  qa: ComponentScore;
  initial: number;
  quarterly: number;
}

/** One student's quarterly grade in one learning area. Blank scores count as 0. */
export function quarterlyGrade(
  items: Pick<ScoreItem, "id" | "component" | "max_score">[],
  scores: Record<string, number | null | undefined>,
  weights: ComponentWeights,
): QuarterlyResult {
  const comp = (c: K12Component): ComponentScore => {
    const list = items.filter((i) => i.component === c);
    const highest = list.reduce((s, i) => s + Number(i.max_score || 0), 0);
    const raw = list.reduce((s, i) => s + Math.min(Number(scores[i.id] ?? 0), Number(i.max_score || 0)), 0);
    const ps = highest > 0 ? roundTo((raw / highest) * 100, 2) : null;
    return { raw, highest, ps, ws: ps == null ? 0 : roundTo((ps * weights[c]) / 100, 2) };
  };
  const ww = comp("ww");
  const pt = comp("pt");
  const qa = comp("qa");
  const initial = roundTo(ww.ws + pt.ws + qa.ws, 2);
  return { ww, pt, qa, initial, quarterly: transmuteDepEd(initial) };
}

export type Descriptor =
  | "Outstanding"
  | "Very Satisfactory"
  | "Satisfactory"
  | "Fairly Satisfactory"
  | "Did Not Meet Expectations";

export function descriptor(grade: number): Descriptor {
  if (grade >= 90) return "Outstanding";
  if (grade >= 85) return "Very Satisfactory";
  if (grade >= 80) return "Satisfactory";
  if (grade >= 75) return "Fairly Satisfactory";
  return "Did Not Meet Expectations";
}

export const k12Passed = (grade: number) => grade >= 75;

/** Final grade = average of the quarterly grades, whole number. Null until every quarter is in. */
export function finalGrade(quarterlies: (number | null | undefined)[]): number | null {
  if (quarterlies.length === 0 || quarterlies.some((q) => q == null)) return null;
  return Math.round(quarterlies.reduce((s: number, q) => s + (q as number), 0) / quarterlies.length);
}

export interface AreaFinal {
  code: string;
  /** For MAPEH components: "MAPEH". */
  parent?: string;
  final: number | null;
}

/**
 * General average = average of the learning areas' final grades, with MAPEH
 * counted once (its final = average of Music, Arts, PE and Health).
 * Null until every learning area has a final grade.
 */
export function generalAverage(areas: AreaFinal[]): { average: number | null; exact: number | null; mapeh: number | null; count: number } {
  const finals: (number | null)[] = [];
  const components = areas.filter((a) => a.parent === "MAPEH");
  let mapeh: number | null = null;
  if (components.length) {
    mapeh = components.some((c) => c.final == null)
      ? null
      : Math.round(components.reduce((s, c) => s + (c.final as number), 0) / components.length);
    finals.push(mapeh);
  }
  for (const a of areas) if (!a.parent) finals.push(a.final);
  if (finals.length === 0 || finals.some((f) => f == null)) return { average: null, exact: null, mapeh, count: finals.length };
  const exact = roundTo(finals.reduce((s: number, f) => s + (f as number), 0) / finals.length, 2);
  return { average: Math.round(exact), exact, mapeh, count: finals.length };
}

// ---------- learning areas ----------

const ALL = QUARTERS;
const SEM1: Quarter[] = ["q1", "q2"];
const SEM2: Quarter[] = ["q3", "q4"];
const la = (code: string, name: string, group: SubjectGroup, quarters: Quarter[] = ALL, parent?: string): LearningArea =>
  parent ? { code, name, group, quarters, parent } : { code, name, group, quarters };

const MAPEH: LearningArea[] = [
  la("MUS", "Music", "mapeh_epp_tle", ALL, "MAPEH"),
  la("ARTS", "Arts", "mapeh_epp_tle", ALL, "MAPEH"),
  la("PE", "Physical Education", "mapeh_epp_tle", ALL, "MAPEH"),
  la("HEALTH", "Health", "mapeh_epp_tle", ALL, "MAPEH"),
];

export const KINDER_AREA = "KINDER";

/** Kinder checklist domains. */
export const KINDER_DOMAINS: { code: string; name: string }[] = [
  { code: "SE", name: "Socio-emotional development and values" },
  { code: "PM", name: "Physical health and motor development" },
  { code: "CR", name: "Creative and aesthetic development" },
  { code: "MA", name: "Mathematics" },
  { code: "EN", name: "Understanding the physical and natural environment" },
  { code: "LL", name: "Language, literacy and communication" },
];

export const KINDER_MARK_LABEL: Record<KinderMark, string> = {
  B: "Beginning",
  D: "Developing",
  C: "Consistent",
};

const gradeNo = (level: string) => {
  const m = level.match(/Grade (\d+)/);
  return m ? Number(m[1]) : 0;
};

export const isKinder = (level: string | null | undefined) => !!level && /kinder/i.test(level);

/** Learning areas for a grade level (and SHS strand). Kinder returns []. */
export function learningAreasFor(level: string, strand: string | null = null): LearningArea[] {
  if (isKinder(level)) return [];
  const g = gradeNo(level);
  if (g >= 11) {
    const core11 = [
      la("ORALCOM", "Oral Communication in Context", "shs_core", SEM1),
      la("KOMPAN", "Komunikasyon at Pananaliksik", "shs_core", SEM1),
      la("GENMATH", "General Mathematics", "shs_core", SEM1),
      la("PEH1", "Physical Education and Health 1", "shs_core", SEM1),
      la("PERDEV", "Personal Development", "shs_core", SEM1),
      la("EAPP", "English for Academic and Professional Purposes", "shs_academic", SEM2),
      la("STATPROB", "Statistics and Probability", "shs_core", SEM2),
      la("RW", "Reading and Writing Skills", "shs_core", SEM2),
      la("PR1", "Practical Research 1", "shs_immersion", SEM2),
    ];
    const core12 = [
      la("PEH3", "Physical Education and Health 3", "shs_core", SEM1),
      la("PHILO", "Introduction to the Philosophy of the Human Person", "shs_core", SEM1),
      la("PR2", "Practical Research 2", "shs_immersion", SEM1),
      la("CPAR", "Contemporary Philippine Arts from the Regions", "shs_core", SEM2),
      la("WI", "Work Immersion", "shs_immersion", SEM2),
    ];
    const track: Record<string, LearningArea[]> = {
      STEM: g === 11
        ? [la("PRECAL", "Pre-Calculus", "shs_academic", SEM1), la("BIO1", "General Biology 1", "shs_academic", SEM1), la("BASCAL", "Basic Calculus", "shs_academic", SEM2)]
        : [la("PHYS1", "General Physics 1", "shs_academic", SEM1), la("CHEM2", "General Chemistry 2", "shs_academic", SEM2)],
      ABM: g === 11
        ? [la("ORGMAN", "Organization and Management", "shs_academic", SEM1), la("BMATH", "Business Mathematics", "shs_academic", SEM1), la("FABM1", "Fundamentals of ABM 1", "shs_academic", SEM2)]
        : [la("FABM2", "Fundamentals of ABM 2", "shs_academic", SEM1), la("APPECO", "Applied Economics", "shs_academic", SEM2)],
      TVL: [la("TVL1", "TVL Specialization", "shs_tvl", ALL)],
    };
    return [...(g === 11 ? core11 : core12), ...(track[strand ?? ""] ?? [])];
  }
  const areas: LearningArea[] = [];
  if (g >= 1 && g <= 3) areas.push(la("MTB", "Mother Tongue", "lang_ap_esp"));
  areas.push(la("FIL", "Filipino", "lang_ap_esp"), la("ENG", "English", "lang_ap_esp"), la("MATH", "Mathematics", "sci_math"));
  if (g >= 3) areas.push(la("SCI", "Science", "sci_math"));
  areas.push(la("AP", "Araling Panlipunan", "lang_ap_esp"), la("ESP", "Edukasyon sa Pagpapakatao", "lang_ap_esp"));
  if (g >= 4 && g <= 6) areas.push(la("EPP", "Edukasyong Pantahanan at Pangkabuhayan", "mapeh_epp_tle"));
  if (g >= 7) areas.push(la("TLE", "Technology and Livelihood Education", "mapeh_epp_tle"));
  areas.push(...MAPEH);
  return areas;
}

export function findArea(level: string, strand: string | null, code: string): LearningArea | undefined {
  return learningAreasFor(level, strand).find((a) => a.code === code);
}
