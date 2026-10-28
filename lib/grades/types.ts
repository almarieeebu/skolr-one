// Grades module types. Field names match the database columns (snake_case),
// like the enrollment and fee types.

import type { Role } from "../enrollment/types";

// ---------- periods ----------

export type CollegePeriod = "prelim" | "midterm" | "semifinal" | "final";
export type Quarter = "q1" | "q2" | "q3" | "q4";
export type GradePeriod = CollegePeriod | Quarter;

/** INC = incomplete, DRP = dropped, W = withdrawn. */
export type SpecialMark = "INC" | "DRP" | "W";

export type Remarks = "Passed" | "Failed" | "Incomplete" | "Dropped";

/** College: how the four period grades become one average. */
export type CollegeAverageRule = "all_four" | "present" | "final_only";

// ---------- K to 12 ----------

export type K12Component = "ww" | "pt" | "qa";

/** Subject groups of DO 8 s. 2015 (each has its own WW / PT / QA weights). */
export type SubjectGroup =
  | "lang_ap_esp"
  | "sci_math"
  | "mapeh_epp_tle"
  | "shs_core"
  | "shs_academic"
  | "shs_immersion"
  | "shs_tvl";

export interface ComponentWeights {
  ww: number;
  pt: number;
  qa: number;
}

export interface LearningArea {
  code: string;
  name: string;
  group: SubjectGroup;
  /** MAPEH components (Music, Arts, PE, Health) point to "MAPEH". */
  parent?: string;
  /** Quarters the subject runs (SHS subjects run one semester = 2 quarters). */
  quarters: Quarter[];
}

/** Kinder: each domain gets a mark, no numbers. */
export type KinderMark = "B" | "D" | "C";

// ---------- settings ----------

export interface CollegeScaleRow {
  /** Whole percent, inclusive. */
  min: number;
  max: number;
  grade: number;
}

export interface GradeDeadline {
  term_id: string;
  period: GradePeriod;
  /** YYYY-MM-DD (Philippine date). Submissions after this day need the registrar's OK. */
  due_date: string;
}

export interface GradeSettings {
  school_id: string;
  college_average: CollegeAverageRule;
  /** Percent weight of each period (equal by default). */
  period_weights: Record<CollegePeriod, number>;
  /** Do not compute the average when a period is INC or DRP. */
  block_average_on_inc: boolean;
  gwa_decimals: number;
  passing_grade: number;
  college_scale: CollegeScaleRow[];
  k12_weights: Record<SubjectGroup, ComponentWeights>;
  deadlines: GradeDeadline[];
  updated_at: string;
}

// ---------- sheets ----------

/** draft -> submitted -> posted (locked). "returned" = sent back to the teacher with a note. */
export type SheetStatus = "draft" | "returned" | "submitted" | "posted";

/** One class (offering / section), one period or quarter, one learning area (K to 12). */
export interface GradeSheet {
  id: string;
  school_id: string;
  term_id: string;
  offering_id: string;
  /** K to 12 learning area code ("MATH", "MUS", "KINDER"); null for college. */
  learning_area: string | null;
  /** K to 12: the learning area's subject group (picks the weights); null for college / Kinder. */
  subject_group: SubjectGroup | null;
  period: GradePeriod;
  status: SheetStatus;
  teacher_id: string | null;
  return_note: string | null;
  late_allowed: boolean;
  submitted_at: string | null;
  posted_at: string | null;
  posted_by: string | null;
  updated_at: string;
}

export interface GradeEntry {
  id: string;
  school_id: string;
  sheet_id: string;
  enrollment_id: string;
  /** College: raw percent for the period (0-100). */
  percent: number | null;
  mark: SpecialMark | null;
  /** K to 12: raw score per score item id. */
  scores: Record<string, number | null>;
  /** Kinder: mark per domain code. */
  domains: Record<string, KinderMark>;
  /** Worked out from the above: college period grade (1.00-5.00) or K to 12 quarterly grade (60-100). */
  grade: number | null;
  updated_at: string;
}

/** One K to 12 activity (quiz, project, exam) with its highest possible score. */
export interface ScoreItem {
  id: string;
  school_id: string;
  sheet_id: string;
  component: K12Component;
  label: string;
  max_score: number;
  position: number;
}

export type ChangeStatus = "pending" | "approved" | "rejected";

/** What a teacher asks to change on a posted grade. */
export interface EntryValue {
  percent: number | null;
  mark: SpecialMark | null;
  scores?: Record<string, number | null>;
}

export interface ChangeGradeRequest {
  id: string;
  school_id: string;
  sheet_id: string;
  entry_id: string;
  enrollment_id: string;
  old_value: EntryValue;
  new_value: EntryValue;
  reason: string;
  status: ChangeStatus;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface GradeHistoryRow {
  id: string;
  school_id: string;
  sheet_id: string;
  entry_id: string | null;
  action: string;
  from_status: SheetStatus | null;
  to_status: SheetStatus;
  note: string | null;
  actor_id: string;
  actor_name: string | null;
  created_at: string;
}

export interface GradeActor {
  user_id: string;
  role: Role;
  name: string;
}
