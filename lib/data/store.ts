// The ONE interface the UI talks to. Demo mode and Supabase mode both
// implement it, so every screen works the same way in both modes.

import type {
  Actor,
  DocType,
  EnrollmentDetail,
  Role,
  School,
  Student,
  StudentType,
  Term,
  Track,
  TuitionPlan,
} from "../enrollment/types";
import type { Offering } from "../enrollment/types";
import type { PlanResult, WithOverride } from "../enrollment/actions";
import type { QueueItem } from "../enrollment/queue";
import type { CloseItem, FeeActionInput, FeeResult, FeeSetup, OrSeries } from "../fees";
import type {
  ChangeGradeRequest,
  EntryValue,
  GradeEntry,
  GradeHistoryRow,
  GradePeriod,
  GradeSettings,
  GradeSheet,
  KinderMark,
  ScoreItem,
  SheetActionInput,
  SubjectGroup,
} from "../grades";

export interface SessionInfo {
  actor: Actor;
  email: string;
  school: School;
}

export interface EnrollmentListItem extends QueueItem {
  id: string;
  student_id: string;
  student_name: string;
  student_no: string | null;
  track: Track;
  level: string;
  course: string | null;
  strand: string | null;
  term_label: string;
  waiting: boolean;
}

export interface NewApplicationInput {
  track: Track;
  term_id: string;
  /** Set for returning students: they skip straight to the load step. */
  existing_student_id?: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  birth_date: string;
  sex: "M" | "F" | "";
  lrn: string;
  level: string;
  course: string;
  strand: string;
  student_type: StudentType;
  esc_voucher: boolean;
  mother_tongue: string;
  ip_group: string;
  is_4ps: boolean;
  tuition_plan: TuitionPlan;
  /** Papers attached with the application. */
  files: { type: DocType; file: File }[];
}

/** A fee setup being saved (no id yet when it is new). */
export type FeeSetupDraft = Omit<FeeSetup, "id" | "updated_at"> & { id?: string };

/** Per-subject fee flags edited in the fee setup panel. */
export interface SubjectFeeEdit {
  id: string;
  lab_fee: number;
  is_major: boolean;
}

export interface ClosePreview {
  label: string;
  items: (CloseItem & { student_name: string; next_label: string | null })[];
  total: number;
  error?: string;
}

// ----- grades -----

/** A class (college subject offering or K to 12 section) in the left list. */
export interface ClassListItem {
  offering_id: string;
  kind: "subject" | "section";
  code: string;
  title: string;
  term_id: string;
  term_label: string;
  level: string | null;
  teacher_name: string | null;
  students: number;
  /** Sheets submitted and waiting for approval. */
  submitted: number;
  returned: number;
  pending_changes: number;
  /** Waiting on the current user (approve, decide a change, fix a returned sheet). */
  waiting: boolean;
}

export interface RosterRow {
  enrollment_id: string;
  student_id: string;
  name: string;
  student_no: string | null;
  level: string;
  strand: string | null;
}

/** Everything the grade sheet needs for one class. */
export interface ClassSheetDetail {
  offering: Offering;
  term: Term;
  teacher_name: string | null;
  /** Is the current user the teacher of this class? */
  teaches: boolean;
  roster: RosterRow[];
  sheets: GradeSheet[];
  entries: GradeEntry[];
  items: ScoreItem[];
  requests: ChangeGradeRequest[];
  history: GradeHistoryRow[];
  settings: GradeSettings;
}

/** What the teacher saves for one period / quarter (and learning area). */
export interface SheetDraft {
  offering_id: string;
  period: GradePeriod;
  learning_area: string | null;
  /** K to 12: the area's subject group (picks the WW / PT / QA weights). */
  subject_group: SubjectGroup | null;
  /** K to 12 activities. New ones carry a fresh uuid. */
  items: Pick<ScoreItem, "id" | "component" | "label" | "max_score" | "position">[];
  entries: {
    enrollment_id: string;
    percent: number | null;
    mark: GradeEntry["mark"];
    scores: Record<string, number | null>;
    domains: Record<string, KinderMark>;
  }[];
}

/** A student's grades for one enrollment (the Grades section and report card). */
export interface StudentGrades {
  settings: GradeSettings;
  sheets: GradeSheet[];
  entries: GradeEntry[];
}

export type GradeResult = { ok: true; sheet_id?: string } | { ok: false; error: string };

export interface DataStore {
  readonly mode: "demo" | "supabase";
  getSession(): Promise<SessionInfo | null>;
  listEnrollments(): Promise<EnrollmentListItem[]>;
  getDetail(enrollmentId: string): Promise<EnrollmentDetail | null>;
  listTerms(): Promise<Term[]>;
  /** Students who already have a student number (for "returning student"). */
  listReturningStudents(): Promise<Student[]>;
  createApplication(input: NewApplicationInput): Promise<string>;
  runAction(enrollmentId: string, input: WithOverride): Promise<PlanResult>;
  uploadDocument(enrollmentId: string, type: DocType, file: File): Promise<void>;
  signOut(): Promise<void>;

  // ----- fees -----
  /** All terms of the school, open or not (fee setup and closing). */
  listAllTerms(): Promise<Term[]>;
  listFeeSetups(): Promise<FeeSetup[]>;
  listTermSubjects(termId: string): Promise<Offering[]>;
  /** Registrar: save a fee setup and the lab fee / major flag of subjects. */
  saveFeeSetup(setup: FeeSetupDraft, subjects: SubjectFeeEdit[]): Promise<void>;
  getOrSeries(): Promise<OrSeries>;
  saveOrSeries(s: Pick<OrSeries, "prefix" | "next_no" | "pad">): Promise<void>;
  /** Discounts and voids (payments go through runAction "take_payment"). */
  runFeeAction(enrollmentId: string, input: FeeActionInput): Promise<FeeResult>;
  previewTermClose(termId: string): Promise<ClosePreview>;
  /** Registrar: close the term and carry balances forward. */
  closeTerm(termId: string): Promise<{ closed: number; total: number }>;

  // ----- grades -----
  /** Teacher: their classes. Registrar / dean: every class with students. */
  listClasses(): Promise<ClassListItem[]>;
  getClassSheet(offeringId: string): Promise<ClassSheetDetail | null>;
  /** Teacher: save a draft (creates the sheet the first time). */
  saveGradeSheet(draft: SheetDraft): Promise<GradeResult>;
  /** Submit / approve / return / allow late. */
  runSheetAction(sheetId: string, input: SheetActionInput): Promise<GradeResult>;
  requestGradeChange(entryId: string, newValue: EntryValue, reason: string): Promise<GradeResult>;
  decideGradeChange(requestId: string, approve: boolean, note: string): Promise<GradeResult>;
  /** Students and parents get posted grades only. */
  getStudentGrades(enrollmentId: string): Promise<StudentGrades | null>;
  getGradeSettings(): Promise<GradeSettings>;
  saveGradeSettings(s: GradeSettings): Promise<void>;
}

/** Extra controls only the demo store has. */
export interface DemoControls {
  setRole(role: Role): void;
  getRole(): Role;
  reset(): void;
}

export function termLabel(t: Term): string {
  return t.semester ? `${t.school_year} ${t.semester} sem` : `${t.school_year} (K to 12)`;
}

export function fullName(s: Pick<Student, "first_name" | "middle_name" | "last_name">): string {
  const mi = s.middle_name ? ` ${s.middle_name[0]}.` : "";
  return `${s.last_name}, ${s.first_name}${mi}`;
}
