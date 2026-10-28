// DEMO MODE: all data lives in the browser (memory + localStorage), seeded
// from lib/data/seed.ts. Used automatically when no Supabase URL is set.

import * as seed from "./seed";
import type {
  DocType,
  DocumentRow,
  Enrollment,
  EnrollmentDetail,
  EnrollmentLoad,
  FeeLine,
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
import { totalPaid } from "../enrollment/fees";
import {
  fullName,
  termLabel,
  type DataStore,
  type DemoControls,
  type EnrollmentListItem,
  type NewApplicationInput,
  type SessionInfo,
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
  feeLines: FeeLine[];
  payments: Payment[];
  history: HistoryRow[];
}

const STORAGE_KEY = "alew-demo-db-v1";
const ROLE_KEY = "alew-demo-role";

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
    feeLines: seed.feeLines,
    payments: seed.payments,
    history: seed.history,
  });
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

  constructor() {
    this.db = load<DemoDb>(STORAGE_KEY) ?? freshDb();
    this.role = load<Role>(ROLE_KEY) ?? "registrar";
  }

  // ----- demo controls -----
  setRole(role: Role) {
    this.role = role;
    save(ROLE_KEY, role);
  }
  getRole() {
    return this.role;
  }
  reset() {
    this.db = freshDb();
    this.persist();
  }
  private persist() {
    save(STORAGE_KEY, this.db);
  }

  private actor() {
    const userId = seed.demoUserByRole[this.role];
    const p = this.db.profiles.find((x) => x.id === userId)!;
    return { user_id: userId, role: this.role, name: p.full_name, email: p.email };
  }

  // ----- DataStore -----
  async getSession(): Promise<SessionInfo> {
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
      const fees = db.feeLines.filter((f) => f.enrollment_id === e.id).reduce((a, f) => a + f.amount, 0);
      const paid = totalPaid(db.payments.filter((p) => p.enrollment_id === e.id));
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
        balance: Math.max(0, fees - paid),
        updated_at: e.updated_at,
      };
      return { ...base, waiting: isWaitingOn(this.role, base, settings) };
    });
    return sortForRole(this.role, items, settings);
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
    return structuredClone({
      enrollment: e,
      student: db.students.find((s) => s.id === e.student_id)!,
      term: db.terms.find((t) => t.id === e.term_id)!,
      documents: db.documents.filter((d) => d.enrollment_id === e.id),
      loads: db.loads.filter((l) => l.enrollment_id === e.id),
      offerings,
      takenCounts,
      feeLines: db.feeLines.filter((f) => f.enrollment_id === e.id),
      payments: db.payments.filter((p) => p.enrollment_id === e.id),
      history: db.history
        .filter((h) => h.enrollment_id === e.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
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
      this.persist();
    }
    return result;
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
    if (m.replaceFeeLines) {
      db.feeLines = db.feeLines.filter((f) => f.enrollment_id !== enrollmentId);
      for (const l of m.replaceFeeLines) {
        db.feeLines.push({ id: uid(), school_id: schoolId, enrollment_id: enrollmentId, ...l });
      }
    }
    if (m.addPayment) {
      db.payments.push({
        id: uid(), school_id: schoolId, enrollment_id: enrollmentId,
        paid_at: m.history.created_at, ...m.addPayment,
      });
    }
    db.history.push({ id: uid(), school_id: schoolId, enrollment_id: enrollmentId, ...m.history });
  }

  async uploadDocument(enrollmentId: string, type: DocType, file: File) {
    const now = new Date().toISOString();
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
    /* nothing to do in demo mode */
  }
}
