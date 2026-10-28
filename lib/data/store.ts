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
