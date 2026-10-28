// DEMO MODE: all data lives in the browser (memory + localStorage), seeded
// from lib/data/seed.ts. Used automatically when no Supabase URL is set.

import * as seed from "./seed";
import type {
  DocType,
  DocumentRow,
  Enrollment,
  EnrollmentDetail,
  EnrollmentLoad,
  HistoryRow,
  Membership,
  Offering,
  ParentLink,
  Payment,
  Profile,
  Role,
  School,
  Student,
  Term,
} from "../enrollment/types";
import { planAction, type Mutations, type WithOverride } from "../enrollment/actions";
import { canSee, isWaitingOn, sortForRole } from "../enrollment/queue";
import { nextSeq } from "../enrollment/ids";
import { DOC_LABEL } from "../enrollment/checks";
import {
  applicantAuthEmail,
  checkNewPassword,
  cleanPersonal,
  cleanProgram,
  formatApplicantNo,
  generateTempPassword,
  loginKind,
  nextApplicantSeq,
  planDetailsUpdate,
  planRequestClose,
  planRequestCreate,
  planRequestReply,
  roleAfterStatus,
  validateConfirm,
  validateDocuments,
  validatePersonal,
  validateProgram,
  type ApplicantRequest,
  type DetailsChange,
  type RequestType,
} from "../applicant";
import {
  advanceOr,
  balance,
  bindPaymentId,
  feePermissions,
  findSetup,
  pendingCarryForward,
  planFeeAction,
  planTermClose,
  validateSetup,
  type Discount,
  type FeeActionInput,
  type FeeResult,
  type FeeSetup,
  type LedgerDraft,
  type LedgerEntry,
  type OrSeries,
} from "../fees";
import {
  deadlineFor,
  entryFilled,
  entryGrade,
  findArea,
  gradePermissions,
  isEditable,
  passedCodes,
  planChangeDecision,
  planChangeRequest,
  planSheetAction,
  sheetKind,
  validateGradeSettings,
  type ChangeGradeRequest,
  type EntryValue,
  type GradeEntry,
  type GradeHistoryRow,
  type GradeSettings,
  type GradeSheet,
  type ScoreItem,
  type SheetActionInput,
} from "../grades";
import {
  fullName,
  termLabel,
  type ClassListItem,
  type ClassSheetDetail,
  type GradeResult,
  type SheetDraft,
  type StudentGrades,
  type ClosePreview,
  type DataStore,
  type FeeSetupDraft,
  type SubjectFeeEdit,
  type DemoControls,
  type EnrollmentListItem,
  type NewApplicationInput,
  type SessionInfo,
  type ApplicantCredentials,
  type ApplyInfo,
  type PortalData,
  type PublicApplicationInput,
  type SimpleResult,
} from "./store";

interface DemoDb {
  school: School;
  profiles: Profile[];
  memberships: Membership[];
  terms: Term[];
  students: Student[];
  parentLinks: ParentLink[];
  enrollments: Enrollment[];
  documents: DocumentRow[];
  offerings: Offering[];
  loads: EnrollmentLoad[];
  payments: Payment[];
  history: HistoryRow[];
  feeSetups: FeeSetup[];
  discounts: Discount[];
  ledger: LedgerEntry[];
  orSeries: OrSeries;
  gradeSettings: GradeSettings;
  gradeSheets: GradeSheet[];
  gradeEntries: GradeEntry[];
  scoreItems: ScoreItem[];
  changeRequests: ChangeGradeRequest[];
  gradeHistory: GradeHistoryRow[];
  applicantRequests: ApplicantRequest[];
  /** Demo logins: user id -> password (demo only; Supabase keeps real hashed passwords). */
  passwords: Record<string, string>;
}

const STORAGE_KEY = "alew-demo-db-v4";
const ROLE_KEY = "alew-demo-role";
/** Main app: a signed-in user instead of the role switcher's sample user (e.g. a promoted applicant). */
const USER_KEY = "alew-demo-user";
/** Applicant portal: who is signed in there. */
const PORTAL_USER_KEY = "alew-demo-portal-user";

function freshDb(): DemoDb {
  // structuredClone so edits never touch the seed module.
  return structuredClone({
    school: seed.school,
    profiles: seed.profiles,
    memberships: seed.memberships,
    terms: seed.terms,
    students: seed.students,
    parentLinks: seed.parentLinks,
    enrollments: seed.enrollments,
    documents: seed.documents,
    offerings: seed.offerings,
    loads: seed.enrollmentLoads,
    payments: seed.payments,
    history: seed.history,
    feeSetups: seed.feeSetups,
    discounts: seed.discounts,
    ledger: seed.ledger,
    orSeries: seed.orSeries,
    gradeSettings: seed.gradeSettings,
    gradeSheets: seed.gradeSheets,
    gradeEntries: seed.gradeEntries,
    scoreItems: seed.scoreItems,
    changeRequests: seed.changeRequests,
    gradeHistory: seed.gradeHistory,
    applicantRequests: seed.applicantRequests,
    passwords: Object.fromEntries(seed.profiles.map((p) => [p.id, seed.passwordFor(p.id)])),
  });
}

function drop(key: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Storage can be blocked (private mode, previews), so every access is guarded.
function load<T>(key: string): T | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export class DemoStore implements DataStore, DemoControls {
  readonly mode = "demo" as const;
  private db: DemoDb;
  private role: Role;
  /** Portal store: the signed-in portal user. Main app: an optional signed-in user (else the role switcher). */
  private readonly portal: boolean;
  private userId: string | null;

  constructor(opts: { portal?: boolean } = {}) {
    this.db = load<DemoDb>(STORAGE_KEY) ?? freshDb();
    this.role = load<Role>(ROLE_KEY) ?? "registrar";
    this.portal = !!opts.portal;
    this.userId = load<string>(this.portal ? PORTAL_USER_KEY : USER_KEY);
  }

  /** Demo: open the applicant portal as this user (used by the header's "Applicant" choice). */
  static openPortalAs(userId: string) {
    save(PORTAL_USER_KEY, userId);
  }
  /** Demo: open the main app as this user (a promoted applicant going to the student app). */
  static openMainAppAs(userId: string) {
    save(USER_KEY, userId);
  }

  // ----- demo controls -----
  setRole(role: Role) {
    this.role = role;
    save(ROLE_KEY, role);
    // Picking a role in the switcher leaves any signed-in demo user.
    this.userId = null;
    drop(USER_KEY);
  }
  getRole() {
    return this.actor().role;
  }
  reset() {
    this.db = freshDb();
    this.persist();
  }
  private persist() {
    save(STORAGE_KEY, this.db);
  }

  /** The user's role in this school (signed-in demo users). */
  private roleOf(userId: string): Role | null {
    return this.db.memberships.find((m) => m.user_id === userId && m.school_id === this.db.school.id)?.role ?? null;
  }

  private actor() {
    let userId: string;
    let role: Role;
    if (this.userId && this.roleOf(this.userId)) {
      userId = this.userId;
      role = this.roleOf(userId)!;
    } else if (this.portal) {
      throw new Error("Not signed in.");
    } else {
      role = this.role;
      userId = seed.demoUserByRole[role];
    }
    const p = this.db.profiles.find((x) => x.id === userId)!;
    return { user_id: userId, role, name: p.full_name, email: p.email };
  }

  // ----- DataStore -----
  async getSession(): Promise<SessionInfo | null> {
    if (this.portal && !(this.userId && this.roleOf(this.userId))) return null;
    const a = this.actor();
    return { actor: { user_id: a.user_id, role: a.role, name: a.name }, email: a.email, school: this.db.school };
  }

  private visible(e: Enrollment): boolean {
    const a = this.actor();
    const student = this.db.students.find((s) => s.id === e.student_id)!;
    const teaches = this.db.loads.some(
      (l) => l.enrollment_id === e.id &&
        this.db.offerings.find((o) => o.id === l.offering_id)?.teacher_id === a.user_id,
    );
    return canSee(a.role, a.user_id, student, this.db.parentLinks, teaches);
  }

  async listEnrollments(): Promise<EnrollmentListItem[]> {
    const { db } = this;
    const settings = db.school.settings;
    const items = db.enrollments.filter((e) => this.visible(e)).map((e) => {
      const s = db.students.find((x) => x.id === e.student_id)!;
      const t = db.terms.find((x) => x.id === e.term_id)!;
      const owed = balance(db.ledger.filter((r) => r.enrollment_id === e.id));
      const base = {
        id: e.id,
        student_id: s.id,
        student_name: fullName(s),
        student_no: s.student_no,
        track: e.track,
        level: e.level,
        course: e.course,
        strand: e.strand,
        term_label: termLabel(t),
        status: e.status,
        dean_approved: e.dean_approved,
        fix_note: e.fix_note,
        balance: feePermissions(this.actor().role).view ? Math.max(0, owed) : 0,
        updated_at: e.updated_at,
        open_requests: this.actor().role === "registrar"
          ? db.applicantRequests.filter((r) => r.enrollment_id === e.id && r.status === "open").length
          : 0,
      };
      return { ...base, waiting: isWaitingOn(this.actor().role, base, settings) };
    });
    return sortForRole(this.actor().role, items, settings);
  }

  async getDetail(enrollmentId: string): Promise<EnrollmentDetail | null> {
    const { db } = this;
    const e = db.enrollments.find((x) => x.id === enrollmentId);
    if (!e || !this.visible(e)) return null;
    const offerings = db.offerings.filter((o) => o.term_id === e.term_id);
    const takenCounts: Record<string, number> = {};
    for (const l of db.loads) {
      if (l.enrollment_id === e.id) continue;
      const other = db.enrollments.find((x) => x.id === l.enrollment_id);
      if (!other || other.status === "withdrawn" || other.status === "rejected") continue;
      takenCounts[l.offering_id] = (takenCounts[l.offering_id] ?? 0) + 1;
    }
    // Teachers see nothing about fees (the database does the same with RLS).
    const fees = feePermissions(this.actor().role).view;
    return structuredClone({
      enrollment: e,
      student: db.students.find((s) => s.id === e.student_id)!,
      term: db.terms.find((t) => t.id === e.term_id)!,
      documents: db.documents.filter((d) => d.enrollment_id === e.id),
      loads: db.loads.filter((l) => l.enrollment_id === e.id),
      offerings,
      takenCounts,
      feeSetup: fees ? findSetup(db.feeSetups, e) : null,
      discounts: fees ? db.discounts.filter((d) => d.enrollment_id === e.id) : [],
      ledger: fees ? db.ledger.filter((r) => r.enrollment_id === e.id) : [],
      payments: fees ? db.payments.filter((p) => p.enrollment_id === e.id) : [],
      history: db.history
        .filter((h) => h.enrollment_id === e.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      passed_codes: this.passedFor(e),
      requests: this.seesRequests()
        ? db.applicantRequests.filter((r) => r.enrollment_id === e.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
        : [],
    });
  }

  /** Requests are for the registrar and the applicant / student / parent (not cashier, dean, teacher). */
  private seesRequests() {
    return ["registrar", "applicant", "student", "parent"].includes(this.actor().role);
  }

  /** Subjects the student passed in OTHER enrollments (posted grades only). */
  private passedFor(e: Enrollment): string[] {
    const { db } = this;
    return passedCodes({
      enrollments: db.enrollments.filter((x) => x.student_id === e.student_id && x.id !== e.id),
      offerings: db.offerings,
      loads: db.loads,
      sheets: db.gradeSheets,
      entries: db.gradeEntries,
      settings: db.gradeSettings,
    });
  }

  async listTerms() {
    return this.db.terms.filter((t) => t.is_open);
  }

  async listReturningStudents() {
    const a = this.actor();
    return this.db.students.filter(
      (s) => s.student_no && canSee(a.role, a.user_id, s, this.db.parentLinks, false),
    );
  }

  async createApplication(input: NewApplicationInput): Promise<string> {
    const { db } = this;
    const a = this.actor();
    const now = new Date().toISOString();
    let student = input.existing_student_id
      ? db.students.find((s) => s.id === input.existing_student_id)
      : undefined;
    if (!student) {
      student = {
        id: uid(),
        school_id: db.school.id,
        student_no: null,
        lrn: input.lrn || null,
        first_name: input.first_name,
        middle_name: input.middle_name || null,
        last_name: input.last_name,
        birth_date: input.birth_date || null,
        sex: input.sex || null,
        user_id: a.role === "student" ? a.user_id : null,
        guardian_user_id: a.role === "parent" ? a.user_id : null,
        completed_codes: [],
      };
      db.students.push(student);
      if (a.role === "parent") {
        db.parentLinks.push({ id: uid(), school_id: db.school.id, parent_user_id: a.user_id, student_id: student.id });
      }
    }
    if (db.enrollments.some((x) => x.student_id === student!.id && x.term_id === input.term_id)) {
      throw new Error("This student already has an enrollment for this term.");
    }
    // Returning students (already have an ID) start at step 4.
    const returning = !!student.student_no;
    const e: Enrollment = {
      id: uid(),
      school_id: db.school.id,
      term_id: input.term_id,
      student_id: student.id,
      track: input.track,
      status: returning ? "student_made" : "applied",
      level: input.level,
      course: input.track === "college" ? input.course || null : null,
      strand: input.track === "k12" ? input.strand || null : null,
      student_type: input.student_type,
      esc_voucher: input.track === "k12" && input.esc_voucher,
      mother_tongue: input.mother_tongue || null,
      ip_group: input.ip_group || null,
      is_4ps: input.is_4ps,
      tuition_plan: input.track === "k12" ? input.tuition_plan : null,
      fix_note: null,
      dean_approved: false,
      overrides: [],
      created_at: now,
      updated_at: now,
    };
    db.enrollments.push(e);
    for (const f of input.files) {
      db.documents.push({
        id: uid(), school_id: db.school.id, enrollment_id: e.id, type: f.type,
        file_name: f.file.name, file_path: null, checked: false, uploaded_at: now,
      });
    }
    db.history.push({
      id: uid(), school_id: db.school.id, enrollment_id: e.id,
      from_status: null, to_status: e.status,
      action: returning ? "returning" : "submit",
      reason: returning ? "Returning student - starts at the load step" : null,
      actor_id: a.user_id, actor_name: `${a.name} (${a.role})`, created_at: now,
    });
    // A balance carried out of an earlier term lands here as "Previous balance".
    const mine = new Set(db.enrollments.filter((x) => x.student_id === student!.id).map((x) => x.id));
    const carry = pendingCarryForward(
      db.ledger.filter((r) => mine.has(r.enrollment_id)),
      e.id,
      (eid) => termLabel(db.terms.find((t) => t.id === db.enrollments.find((x) => x.id === eid)!.term_id)!),
    );
    this.post(e.id, carry, now, "Carried forward at enrollment");
    this.persist();
    return e.id;
  }

  async runAction(enrollmentId: string, input: WithOverride) {
    const detail = await this.getDetail(enrollmentId);
    if (!detail) return { ok: false as const, error: "Enrollment not found.", warnings: [], canOverride: false };
    const a = this.actor();
    const result = planAction(
      {
        detail,
        school: this.db.school,
        actor: { user_id: a.user_id, role: a.role, name: a.name },
        now: new Date().toISOString(),
        nextStudentSeq: nextSeq(this.db.students.map((s) => s.student_no), this.db.school.code, detail.term.school_year),
      },
      input,
    );
    if (result.ok) {
      this.apply(enrollmentId, detail.student.id, result.mutations);
      this.promote(detail.student.id, result.mutations.enrollment.status ?? detail.enrollment.status);
      this.persist();
    }
    return result;
  }

  /** An applicant account becomes a student account once the student ID is made. */
  private promote(studentId: string, status: EnrollmentDetail["enrollment"]["status"]) {
    const s = this.db.students.find((x) => x.id === studentId);
    if (!s?.user_id) return;
    for (const m of this.db.memberships) {
      if (m.user_id === s.user_id && m.school_id === this.db.school.id) m.role = roleAfterStatus(m.role, status);
    }
  }

  /** Save the changes planned by planAction. */
  private apply(enrollmentId: string, studentId: string, m: Mutations) {
    const { db } = this;
    const schoolId = db.school.id;
    const e = db.enrollments.find((x) => x.id === enrollmentId)!;
    Object.assign(e, m.enrollment);
    if (m.student) Object.assign(db.students.find((s) => s.id === studentId)!, m.student);
    if (m.checkAllDocs) db.documents.forEach((d) => d.enrollment_id === enrollmentId && (d.checked = true));
    if (m.replaceLoads) {
      db.loads = db.loads.filter((l) => l.enrollment_id !== enrollmentId);
      for (const offering_id of m.replaceLoads) {
        db.loads.push({ id: uid(), school_id: schoolId, enrollment_id: enrollmentId, offering_id });
      }
    }
    if (m.postLedger) this.post(enrollmentId, m.postLedger, m.history.created_at);
    if (m.addPayment) {
      const p: Payment = {
        id: uid(), school_id: schoolId, enrollment_id: enrollmentId,
        paid_at: m.history.created_at, ...m.addPayment.payment,
      };
      db.payments.push(p);
      this.post(enrollmentId, [bindPaymentId(m.addPayment.row, p.id)], p.paid_at);
      db.orSeries = advanceOr(db.orSeries, p.or_no);
    }
    db.history.push({ id: uid(), school_id: schoolId, enrollment_id: enrollmentId, ...m.history });
  }

  /** Post ledger rows as the current user. Rows may name another enrollment. */
  private post(enrollmentId: string, drafts: LedgerDraft[], now: string, _note?: string) {
    const a = this.actor();
    for (const d of drafts) {
      const { enrollment_id: target = enrollmentId, ...row } = d;
      const e = this.db.enrollments.find((x) => x.id === target)!;
      this.db.ledger.push({
        id: uid(), school_id: this.db.school.id, enrollment_id: e.id, student_id: e.student_id, term_id: e.term_id,
        ...row, actor_id: a.user_id, actor_name: `${a.name} (${a.role})`, posted_at: now,
      });
    }
  }

  async listAllTerms() {
    return [...this.db.terms];
  }

  async listFeeSetups() {
    return structuredClone(this.db.feeSetups);
  }

  async listTermSubjects(termId: string) {
    return structuredClone(this.db.offerings.filter((o) => o.term_id === termId && o.kind === "subject"));
  }

  async saveFeeSetup(setup: FeeSetupDraft, subjects: SubjectFeeEdit[]) {
    if (!feePermissions(this.actor().role).setup) throw new Error("Only the registrar can change the fee setup.");
    const problems = validateSetup(setup);
    if (problems.length) throw new Error(problems.join(" "));
    const now = new Date().toISOString();
    const same = (x: FeeSetup) =>
      x.term_id === setup.term_id && x.track === setup.track &&
      (x.scope_course ?? null) === (setup.scope_course ?? null) && (x.scope_level ?? null) === (setup.scope_level ?? null);
    const existing = this.db.feeSetups.find((x) => (setup.id ? x.id === setup.id : same(x)));
    if (existing) Object.assign(existing, setup, { id: existing.id, updated_at: now });
    else this.db.feeSetups.push({ ...setup, id: uid(), updated_at: now } as FeeSetup);
    for (const sub of subjects) {
      const o = this.db.offerings.find((x) => x.id === sub.id);
      if (o) Object.assign(o, { lab_fee: Number(sub.lab_fee) || 0, is_major: sub.is_major });
    }
    this.persist();
  }

  async getOrSeries() {
    return { ...this.db.orSeries };
  }

  async saveOrSeries(s: Pick<OrSeries, "prefix" | "next_no" | "pad">) {
    if (!feePermissions(this.actor().role).setup) throw new Error("Only the registrar can change the OR series.");
    this.db.orSeries = { ...this.db.orSeries, ...s };
    this.persist();
  }

  async runFeeAction(enrollmentId: string, input: FeeActionInput): Promise<FeeResult> {
    const detail = await this.getDetail(enrollmentId);
    if (!detail) return { ok: false, error: "Enrollment not found." };
    const a = this.actor();
    const now = new Date().toISOString();
    const r = planFeeAction({ detail, actor: { user_id: a.user_id, role: a.role, name: a.name }, now, newId: uid() }, input);
    if (!r.ok) return r;
    const { db } = this;
    const m = r.mutations;
    if (m.addDiscount) db.discounts.push(m.addDiscount);
    if (m.voidDiscount) Object.assign(db.discounts.find((d) => d.id === m.voidDiscount!.id)!, m.voidDiscount);
    if (m.voidPayment) Object.assign(db.payments.find((p) => p.id === m.voidPayment!.id)!, m.voidPayment);
    this.post(enrollmentId, m.ledger, now);
    db.history.push({ id: uid(), school_id: db.school.id, enrollment_id: enrollmentId, ...m.history });
    this.persist();
    return r;
  }

  private closePlan(termId: string) {
    const { db } = this;
    const term = db.terms.find((t) => t.id === termId);
    if (!term) return { error: "Term not found." };
    const ledgerByEnrollment: Record<string, LedgerEntry[]> = {};
    for (const r of db.ledger) (ledgerByEnrollment[r.enrollment_id] ??= []).push(r);
    return {
      term,
      plan: planTermClose({ term, termLabel: termLabel(term), enrollments: db.enrollments, terms: db.terms, ledgerByEnrollment }),
    };
  }

  async previewTermClose(termId: string): Promise<ClosePreview> {
    const { db } = this;
    const r = this.closePlan(termId);
    if ("error" in r) return { label: "", items: [], total: 0, error: r.error };
    const label = termLabel(r.term);
    if ("error" in r.plan) return { label, items: [], total: 0, error: r.plan.error };
    return {
      label,
      total: r.plan.total,
      items: r.plan.items.map((i) => {
        const next = i.next_enrollment_id ? db.enrollments.find((x) => x.id === i.next_enrollment_id) : null;
        return {
          ...i,
          student_name: fullName(db.students.find((s) => s.id === i.student_id)!),
          next_label: next ? termLabel(db.terms.find((t) => t.id === next.term_id)!) : null,
        };
      }),
    };
  }

  async closeTerm(termId: string) {
    if (!feePermissions(this.actor().role).closeTerm) throw new Error("Only the registrar can close a term.");
    const r = this.closePlan(termId);
    if ("error" in r) throw new Error(r.error);
    if ("error" in r.plan) throw new Error(r.plan.error);
    const now = new Date().toISOString();
    const a = this.actor();
    for (const row of r.plan.rows) this.post(row.enrollment_id, [row], now);
    for (const i of r.plan.items) {
      const e = this.db.enrollments.find((x) => x.id === i.enrollment_id)!;
      this.db.history.push({
        id: uid(), school_id: this.db.school.id, enrollment_id: e.id, from_status: e.status, to_status: e.status,
        action: "close_term", reason: `Balance of ₱${i.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })} carried to ${i.next_enrollment_id ? "the next-term enrollment" : "the next enrollment"}`,
        actor_id: a.user_id, actor_name: `${a.name} (${a.role})`, created_at: now,
      });
    }
    Object.assign(r.term, { closed_at: now, is_open: false });
    this.persist();
    return { closed: r.plan.items.length, total: r.plan.total };
  }

  // ----- grades -----

  private gActor() {
    const a = this.actor();
    return { user_id: a.user_id, role: a.role, name: a.name };
  }

  /** Students in a class: officially enrolled, or anyone who already has a grade there. */
  private roster(offeringId: string) {
    const { db } = this;
    const sheetIds = new Set(db.gradeSheets.filter((s) => s.offering_id === offeringId).map((s) => s.id));
    const graded = new Set(db.gradeEntries.filter((g) => sheetIds.has(g.sheet_id)).map((g) => g.enrollment_id));
    return db.loads
      .filter((l) => l.offering_id === offeringId)
      .map((l) => db.enrollments.find((e) => e.id === l.enrollment_id)!)
      .filter((e) => e && (e.status === "officially_enrolled" || graded.has(e.id)))
      .map((e) => {
        const st = db.students.find((x) => x.id === e.student_id)!;
        return { enrollment_id: e.id, student_id: st.id, name: fullName(st), student_no: st.student_no, level: e.level, strand: e.strand };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private teacherName(id: string | null) {
    return id ? this.db.profiles.find((p) => p.id === id)?.full_name ?? null : null;
  }

  async listClasses(): Promise<ClassListItem[]> {
    const { db } = this;
    const a = this.gActor();
    if (!gradePermissions(a.role).classes) return [];
    const useDean = db.school.settings.use_dean_approval;
    const items: ClassListItem[] = [];
    for (const o of db.offerings) {
      if (a.role === "teacher" && o.teacher_id !== a.user_id) continue;
      const roster = this.roster(o.id);
      if (a.role !== "teacher" && roster.length === 0) continue;
      const sheets = db.gradeSheets.filter((s) => s.offering_id === o.id);
      const submitted = sheets.filter((s) => s.status === "submitted").length;
      const returned = sheets.filter((s) => s.status === "returned").length;
      const pending = db.changeRequests.filter((r) => r.status === "pending" && sheets.some((s) => s.id === r.sheet_id)).length;
      const t = db.terms.find((x) => x.id === o.term_id)!;
      const waiting =
        a.role === "teacher" ? returned > 0
        : a.role === "registrar" ? (!useDean && submitted > 0) || pending > 0
        : a.role === "dean" ? useDean && submitted > 0 : false;
      items.push({
        offering_id: o.id, kind: o.kind, code: o.code, title: o.title, term_id: o.term_id, term_label: termLabel(t),
        level: o.level, teacher_name: this.teacherName(o.teacher_id), students: roster.length,
        submitted, returned, pending_changes: pending, waiting,
      });
    }
    // Waiting first, then open terms, then code.
    const open = (i: ClassListItem) => (db.terms.find((t) => t.id === i.term_id)?.closed_at ? 1 : 0);
    return items.sort((x, y) => Number(y.waiting) - Number(x.waiting) || open(x) - open(y) || x.code.localeCompare(y.code));
  }

  async getClassSheet(offeringId: string): Promise<ClassSheetDetail | null> {
    const { db } = this;
    const a = this.gActor();
    const o = db.offerings.find((x) => x.id === offeringId);
    if (!o || !gradePermissions(a.role).classes) return null;
    const teaches = o.teacher_id === a.user_id;
    if (a.role === "teacher" && !teaches) return null;
    const sheets = db.gradeSheets.filter((s) => s.offering_id === o.id);
    const ids = new Set(sheets.map((s) => s.id));
    return structuredClone({
      offering: o,
      term: db.terms.find((t) => t.id === o.term_id)!,
      teacher_name: this.teacherName(o.teacher_id),
      teaches,
      roster: this.roster(o.id),
      sheets,
      entries: db.gradeEntries.filter((g) => ids.has(g.sheet_id)),
      items: db.scoreItems.filter((i) => ids.has(i.sheet_id)).sort((x, y) => x.position - y.position),
      requests: db.changeRequests.filter((r) => ids.has(r.sheet_id)),
      history: db.gradeHistory.filter((h) => ids.has(h.sheet_id)).sort((x, y) => x.created_at.localeCompare(y.created_at)),
      settings: db.gradeSettings,
    });
  }

  private sheetContext(sheet: Pick<GradeSheet, "status" | "late_allowed" | "term_id" | "period">, offeringTeacher: string | null) {
    const a = this.gActor();
    return {
      actor: a,
      sheet,
      teachesClass: a.role === "teacher" && offeringTeacher === a.user_id,
      useDean: this.db.school.settings.use_dean_approval,
      deadline: deadlineFor(this.db.gradeSettings, sheet.term_id, sheet.period),
      now: new Date().toISOString(),
    };
  }

  /** Work out the stored grade of every entry of a sheet. */
  private recompute(sheet: GradeSheet) {
    const { db } = this;
    const o = db.offerings.find((x) => x.id === sheet.offering_id)!;
    const kind = sheetKind(o);
    const items = db.scoreItems.filter((i) => i.sheet_id === sheet.id);
    for (const g of db.gradeEntries.filter((x) => x.sheet_id === sheet.id)) {
      const e = db.enrollments.find((x) => x.id === g.enrollment_id)!;
      const area = sheet.learning_area ? findArea(e.level, e.strand, sheet.learning_area) : undefined;
      g.grade = entryGrade(kind, g, items, db.gradeSettings, area);
    }
  }

  async saveGradeSheet(d: SheetDraft): Promise<GradeResult> {
    const { db } = this;
    const o = db.offerings.find((x) => x.id === d.offering_id);
    if (!o) return { ok: false, error: "Class not found." };
    const now = new Date().toISOString();
    let sheet = db.gradeSheets.find(
      (s) => s.offering_id === o.id && s.period === d.period && (s.learning_area ?? null) === (d.learning_area ?? null),
    );
    const ctx = this.sheetContext(sheet ?? { status: "draft", late_allowed: false, term_id: o.term_id, period: d.period }, o.teacher_id);
    const plan = planSheetAction(ctx, { type: "save" });
    if (!plan.ok) return plan;
    if (!sheet) {
      sheet = {
        id: uid(), school_id: db.school.id, term_id: o.term_id, offering_id: o.id, learning_area: d.learning_area,
        subject_group: d.subject_group, period: d.period, status: "draft", teacher_id: o.teacher_id, return_note: null, late_allowed: false,
        submitted_at: null, posted_at: null, posted_by: null, updated_at: now,
      };
      db.gradeSheets.push(sheet);
    }
    sheet.updated_at = now;
    const sid = sheet.id;
    db.scoreItems = db.scoreItems.filter((i) => i.sheet_id !== sid);
    for (const it of d.items) db.scoreItems.push({ ...it, max_score: Number(it.max_score) || 0, school_id: db.school.id, sheet_id: sid });
    const allowed = new Set(this.roster(o.id).map((r) => r.enrollment_id));
    for (const en of d.entries) {
      if (!allowed.has(en.enrollment_id)) continue;
      let g = db.gradeEntries.find((x) => x.sheet_id === sid && x.enrollment_id === en.enrollment_id);
      if (!g) {
        g = { id: uid(), school_id: db.school.id, sheet_id: sid, enrollment_id: en.enrollment_id, percent: null, mark: null, scores: {}, domains: {}, grade: null, updated_at: now };
        db.gradeEntries.push(g);
      }
      Object.assign(g, { percent: en.percent, mark: en.mark, scores: en.scores, domains: en.domains, updated_at: now });
    }
    this.recompute(sheet);
    this.persist();
    return { ok: true, sheet_id: sid };
  }

  async runSheetAction(sheetId: string, input: SheetActionInput): Promise<GradeResult> {
    const { db } = this;
    const sheet = db.gradeSheets.find((s) => s.id === sheetId);
    if (!sheet) return { ok: false, error: "Grade sheet not found. Save a draft first." };
    const o = db.offerings.find((x) => x.id === sheet.offering_id)!;
    const items = db.scoreItems.filter((i) => i.sheet_id === sheet.id);
    const kind = sheetKind(o);
    const missing = this.roster(o.id).filter(
      (r) => !entryFilled(kind, db.gradeEntries.find((g) => g.sheet_id === sheet.id && g.enrollment_id === r.enrollment_id), items),
    ).length;
    const plan = planSheetAction(this.sheetContext(sheet, o.teacher_id), input, missing);
    if (!plan.ok) return plan;
    Object.assign(sheet, plan.sheet);
    if (plan.history) db.gradeHistory.push({ id: uid(), school_id: db.school.id, sheet_id: sheet.id, ...plan.history });
    this.persist();
    return { ok: true, sheet_id: sheet.id };
  }

  async requestGradeChange(entryId: string, newValue: EntryValue, reason: string): Promise<GradeResult> {
    const { db } = this;
    const g = db.gradeEntries.find((x) => x.id === entryId);
    const sheet = g && db.gradeSheets.find((s) => s.id === g.sheet_id);
    if (!g || !sheet) return { ok: false, error: "Grade not found." };
    const o = db.offerings.find((x) => x.id === sheet.offering_id)!;
    const a = this.gActor();
    const plan = planChangeRequest(
      {
        actor: a, sheet, teachesClass: a.role === "teacher" && o.teacher_id === a.user_id,
        entry: { id: g.id, enrollment_id: g.enrollment_id, value: { percent: g.percent, mark: g.mark, ...(newValue.scores ? { scores: g.scores } : {}) } },
        pending: db.changeRequests, now: new Date().toISOString(),
      },
      { new_value: newValue, reason },
    );
    if (!plan.ok) return plan;
    db.changeRequests.push({ ...plan.request, id: uid(), school_id: db.school.id });
    db.gradeHistory.push({
      id: uid(), school_id: db.school.id, sheet_id: sheet.id, entry_id: g.id, action: "request_change",
      from_status: sheet.status, to_status: sheet.status, note: reason.trim(),
      actor_id: a.user_id, actor_name: `${a.name} (${a.role})`, created_at: plan.request.requested_at,
    });
    this.persist();
    return { ok: true, sheet_id: sheet.id };
  }

  async decideGradeChange(requestId: string, approve: boolean, note: string): Promise<GradeResult> {
    const { db } = this;
    const r = db.changeRequests.find((x) => x.id === requestId);
    if (!r) return { ok: false, error: "Request not found." };
    const plan = planChangeDecision({ actor: this.gActor(), request: r, now: new Date().toISOString() }, { approve, note });
    if (!plan.ok) return plan;
    Object.assign(r, plan.request);
    const sheet = db.gradeSheets.find((s) => s.id === r.sheet_id)!;
    if (plan.apply) {
      const g = db.gradeEntries.find((x) => x.id === r.entry_id)!;
      Object.assign(g, { percent: plan.apply.percent, mark: plan.apply.mark, updated_at: plan.history.created_at });
      if (plan.apply.scores) g.scores = { ...g.scores, ...plan.apply.scores };
      this.recompute(sheet);
    }
    db.gradeHistory.push({ id: uid(), school_id: db.school.id, sheet_id: sheet.id, ...plan.history });
    this.persist();
    return { ok: true, sheet_id: sheet.id };
  }

  async getStudentGrades(enrollmentId: string): Promise<StudentGrades | null> {
    const { db } = this;
    const e = db.enrollments.find((x) => x.id === enrollmentId);
    const a = this.gActor();
    const perms = gradePermissions(a.role);
    if (!e || !this.visible(e) || !perms.view) return null;
    const mine = new Set(db.loads.filter((l) => l.enrollment_id === e.id).map((l) => l.offering_id));
    const sheets = db.gradeSheets.filter((s) => {
      if (!mine.has(s.offering_id)) return false;
      if (perms.postedOnly && s.status !== "posted") return false;
      // Teachers see the grades of their own classes only.
      if (a.role === "teacher") return db.offerings.find((o) => o.id === s.offering_id)?.teacher_id === a.user_id;
      return true;
    });
    const ids = new Set(sheets.map((s) => s.id));
    return structuredClone({
      settings: db.gradeSettings,
      sheets,
      entries: db.gradeEntries.filter((g) => ids.has(g.sheet_id) && g.enrollment_id === e.id),
    });
  }

  async getGradeSettings() {
    return structuredClone(this.db.gradeSettings);
  }

  async saveGradeSettings(s: GradeSettings) {
    if (!gradePermissions(this.actor().role).settings) throw new Error("Only the registrar can change grade settings.");
    const problems = validateGradeSettings(s);
    if (problems.length) throw new Error(problems.join(" "));
    this.db.gradeSettings = { ...s, school_id: this.db.school.id, updated_at: new Date().toISOString() };
    // Drafts follow the new weights. Posted K to 12 grades keep the grade they were posted with.
    for (const sh of this.db.gradeSheets) if (isEditable(sh.status)) this.recompute(sh);
    this.persist();
  }

  async uploadDocument(enrollmentId: string, type: DocType, file: File) {
    const now = new Date().toISOString();
    const e = this.db.enrollments.find((x) => x.id === enrollmentId);
    if (!e || !this.visible(e)) throw new Error("Enrollment not found.");
    const a = this.actor();
    this.db.history.push({
      id: uid(), school_id: this.db.school.id, enrollment_id: enrollmentId, from_status: e.status, to_status: e.status,
      action: "upload_paper", reason: `${DOC_LABEL[type]} uploaded (${file.name})`,
      actor_id: a.user_id, actor_name: `${a.name} (${a.role})`, created_at: now,
    });
    if (a.role === "applicant") e.updated_at = now;
    const existing = this.db.documents.find((d) => d.enrollment_id === enrollmentId && d.type === type);
    if (existing) {
      Object.assign(existing, { file_name: file.name, uploaded_at: now, checked: false });
    } else {
      this.db.documents.push({
        id: uid(), school_id: this.db.school.id, enrollment_id: enrollmentId, type,
        file_name: file.name, file_path: null, checked: false, uploaded_at: now,
      });
    }
    this.persist();
  }

  async signOut() {
    // Main app: nothing to do (the role switcher stays). Portal: forget the signed-in user.
    if (this.portal) {
      this.userId = null;
      drop(PORTAL_USER_KEY);
    }
  }

  // ----- applicant portal -----

  async getApplyInfo(schoolCode: string | null): Promise<ApplyInfo> {
    const s = this.db.school;
    if (schoolCode && schoolCode.toUpperCase() !== s.code.toUpperCase()) throw new Error(`No school with the code "${schoolCode}".`);
    return {
      school: { id: s.id, name: s.name, code: s.code, logo_url: s.logo_url },
      terms: this.db.terms.filter((t) => t.is_open),
    };
  }

  async submitPublicApplication(input: PublicApplicationInput): Promise<ApplicantCredentials> {
    const { db } = this;
    const f = input.form;
    // Bots fill in the hidden field. (Demo mode has no rate limit.)
    if (f.website.trim()) throw new Error("Something went wrong. Please try again.");
    const info = await this.getApplyInfo(input.school_code);
    const now = new Date().toISOString();
    const problems = {
      ...validatePersonal(f, now.slice(0, 10)),
      ...validateProgram(f, info.terms),
      ...validateDocuments(f, Object.fromEntries(input.files.map((x) => [x.type, x.file]))),
      ...validateConfirm(f),
    };
    const first = Object.values(problems)[0];
    if (first) throw new Error(first);

    const term = info.terms.find((t) => t.id === f.term_id)!;
    const year = term.school_year.slice(0, 4);
    const applicantNo = formatApplicantNo(year, nextApplicantSeq(db.students.map((s) => s.applicant_no), year));
    const personal = cleanPersonal(f);
    // The account uses the applicant's email, unless it is already used by another account.
    const taken = !!personal.email && db.profiles.some((p) => p.email.toLowerCase() === personal.email);
    const authEmail = personal.email && !taken ? personal.email : applicantAuthEmail(applicantNo, db.school.code);
    const fullName = [personal.first_name, personal.middle_name, personal.last_name].filter(Boolean).join(" ");
    const password = generateTempPassword();

    const userId = uid();
    db.profiles.push({ id: userId, full_name: fullName, email: authEmail, must_change_password: true });
    db.memberships.push({ id: uid(), user_id: userId, school_id: db.school.id, role: "applicant" });
    db.passwords[userId] = password;

    const student: Student = {
      id: uid(), school_id: db.school.id, student_no: null, user_id: userId, guardian_user_id: null, completed_codes: [],
      applicant_no: applicantNo, ...personal,
    };
    db.students.push(student);
    const e: Enrollment = {
      id: uid(), school_id: db.school.id, term_id: term.id, student_id: student.id, track: f.track, status: "applied",
      ...cleanProgram(f), fix_note: null, dean_approved: false, overrides: [],
      application: { source: "online", signed_name: f.signed_name.trim(), signed_at: now, signature: f.signature },
      created_at: now, updated_at: now,
    };
    db.enrollments.push(e);
    for (const x of input.files) {
      db.documents.push({
        id: uid(), school_id: db.school.id, enrollment_id: e.id, type: x.type,
        file_name: x.file.name, file_path: null, checked: false, uploaded_at: now,
      });
    }
    db.history.push({
      id: uid(), school_id: db.school.id, enrollment_id: e.id, from_status: null, to_status: "applied",
      action: "submit", reason: `Online application form (${applicantNo})`,
      actor_id: userId, actor_name: `${fullName} (applicant)`, created_at: now,
    });
    this.persist();
    return {
      full_name: fullName,
      school_name: db.school.name,
      applicant_no: applicantNo,
      password,
      email: personal.email,
      email_note: "demo",
      papers_uploaded: true,
      notice: taken ? "This email already has an account, so sign in with your applicant number." : null,
    };
  }

  async signIn(login: string, password: string) {
    const { db } = this;
    const v = login.trim().toLowerCase();
    const kind = loginKind(v);
    const userId =
      kind === "email"
        ? db.profiles.find((p) => p.email.toLowerCase() === v)?.id
        : db.students.find((s) => (kind === "applicant_no" ? s.applicant_no : s.student_no)?.toLowerCase() === v)?.user_id ?? undefined;
    if (!userId || db.passwords[userId] !== password || !this.roleOf(userId)) {
      throw new Error("Wrong login or password. Check your applicant number (e.g. APP-2026-00012) and password.");
    }
    this.userId = userId;
    save(this.portal ? PORTAL_USER_KEY : USER_KEY, userId);
  }

  async getPortal(): Promise<PortalData | null> {
    const session = await this.getSession();
    if (!session) return null;
    const { db } = this;
    const mine = db.students.find((s) => s.user_id === session.actor.user_id);
    const latest = mine
      ? db.enrollments.filter((e) => e.student_id === mine.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      : undefined;
    return {
      session,
      must_change_password: !!db.profiles.find((p) => p.id === session.actor.user_id)?.must_change_password,
      applicant_no: mine?.applicant_no ?? null,
      detail: latest ? await this.getDetail(latest.id) : null,
    };
  }

  async updateApplicantDetails(enrollmentId: string, change: DetailsChange): Promise<SimpleResult> {
    const detail = await this.getDetail(enrollmentId);
    if (!detail) return { ok: false, error: "Enrollment not found." };
    const a = this.actor();
    const plan = planDetailsUpdate({ role: a.role, student: detail.student, enrollment: detail.enrollment }, change);
    if (!plan.ok) return plan;
    const now = new Date().toISOString();
    const { db } = this;
    Object.assign(db.students.find((s) => s.id === detail.student.id)!, plan.student);
    const e = db.enrollments.find((x) => x.id === enrollmentId)!;
    Object.assign(e, plan.enrollment, { updated_at: now });
    db.history.push({
      id: uid(), school_id: db.school.id, enrollment_id: enrollmentId, from_status: e.status, to_status: e.status,
      action: "update_details", reason: plan.summary, actor_id: a.user_id, actor_name: `${a.name} (${a.role})`, created_at: now,
    });
    this.persist();
    return { ok: true, message: plan.summary };
  }

  async createApplicantRequest(enrollmentId: string, type: RequestType, message: string): Promise<SimpleResult> {
    const detail = await this.getDetail(enrollmentId);
    if (!detail) return { ok: false, error: "Enrollment not found." };
    const a = this.actor();
    const now = new Date().toISOString();
    const plan = planRequestCreate({ role: a.role, status: detail.enrollment.status, requests: detail.requests ?? [], now }, { type, message });
    if (!plan.ok) return plan;
    this.db.applicantRequests.push({
      ...plan.value, id: uid(), school_id: this.db.school.id, enrollment_id: enrollmentId,
      created_by: a.user_id, created_by_name: `${a.name} (${a.role})`,
    });
    this.db.enrollments.find((x) => x.id === enrollmentId)!.updated_at = now;
    this.persist();
    return { ok: true };
  }

  private findRequest(requestId: string) {
    const r = this.db.applicantRequests.find((x) => x.id === requestId);
    const e = r && this.db.enrollments.find((x) => x.id === r.enrollment_id);
    return r && e && this.visible(e) && this.seesRequests() ? { r, e } : null;
  }

  async answerApplicantRequest(requestId: string, reply: string, close: boolean): Promise<SimpleResult> {
    const found = this.findRequest(requestId);
    if (!found) return { ok: false, error: "Request not found." };
    const a = this.actor();
    const plan = planRequestReply(
      { role: a.role, request: found.r, now: new Date().toISOString(), by: a.user_id, byName: `${a.name} (${a.role})` },
      { reply, close },
    );
    if (!plan.ok) return plan;
    Object.assign(found.r, plan.value);
    this.persist();
    return { ok: true };
  }

  async closeApplicantRequest(requestId: string): Promise<SimpleResult> {
    const found = this.findRequest(requestId);
    if (!found) return { ok: false, error: "Request not found." };
    const a = this.actor();
    const plan = planRequestClose({ role: a.role, isOwner: a.role !== "registrar", request: found.r, now: new Date().toISOString() });
    if (!plan.ok) return plan;
    Object.assign(found.r, plan.value);
    this.persist();
    return { ok: true };
  }

  async changePassword(next: string) {
    const a = this.actor();
    const problems = checkNewPassword(next, next, this.db.passwords[a.user_id]);
    if (problems.length) throw new Error(problems.join(" "));
    this.db.passwords[a.user_id] = next;
    const p = this.db.profiles.find((x) => x.id === a.user_id);
    if (p) p.must_change_password = false;
    this.persist();
  }
}
