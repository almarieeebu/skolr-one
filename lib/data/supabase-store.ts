// SUPABASE MODE: same DataStore interface, backed by Postgres + RLS.
// Business rules still run in lib/enrollment (planAction) for the checks.
// Everything about money is posted by database functions (0002_fees.sql):
// fees_assess, fees_take_payment, fees_apply_discount, fees_void_payment,
// fees_close_term. The browser never writes fee rows itself.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../supabase/client";
import type {
  DocType,
  Enrollment,
  EnrollmentDetail,
  Offering,
  Role,
  School,
  Student,
  Term,
} from "../enrollment/types";
import { planAction, type Mutations, type PlanResult, type WithOverride } from "../enrollment/actions";
import { isWaitingOn, sortForRole } from "../enrollment/queue";
import { nextSeq } from "../enrollment/ids";
import {
  balance,
  findSetup,
  planFeeAction,
  planTermClose,
  validateSetup,
  type Discount,
  type FeeActionInput,
  type FeeResult,
  type FeeSetup,
  type LedgerEntry,
  type OrSeries,
  type Payment,
} from "../fees";
import {
  defaultGradeSettings,
  deadlineFor,
  gradePermissions,
  passedCodes,
  planChangeRequest,
  planSheetAction,
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
  type RosterRow,
  type SheetDraft,
  type StudentGrades,
  type ClosePreview,
  type DataStore,
  type FeeSetupDraft,
  type SubjectFeeEdit,
  type EnrollmentListItem,
  type NewApplicationInput,
  type SessionInfo,
} from "./store";

const BUCKET = "documents";

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// Postgres numeric columns arrive as strings.
const numLedger = (r: LedgerEntry): LedgerEntry => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) });
const numPayment = (p: Payment): Payment => ({ ...p, amount: Number(p.amount) });
const numDiscount = (d: Discount): Discount => ({ ...d, value: Number(d.value) });
const numSetup = (s: FeeSetup): FeeSetup => ({
  ...s,
  min_downpayment: Number(s.min_downpayment),
  rate_per_unit: Number(s.rate_per_unit),
  major_rate_per_unit: Number(s.major_rate_per_unit),
  esc_amount: Number(s.esc_amount),
  shs_voucher_amount: Number(s.shs_voucher_amount),
});

const numEntry = (g: GradeEntry): GradeEntry => ({
  ...g,
  percent: g.percent == null ? null : Number(g.percent),
  grade: g.grade == null ? null : Number(g.grade),
  scores: g.scores ?? {},
  domains: g.domains ?? {},
});
const numItem = (i: ScoreItem): ScoreItem => ({ ...i, max_score: Number(i.max_score) });
const numSettings = (s: GradeSettings): GradeSettings => ({
  ...s,
  passing_grade: Number(s.passing_grade),
  gwa_decimals: Number(s.gwa_decimals),
});
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

export class SupabaseStore implements DataStore {
  readonly mode = "supabase" as const;
  private sb: SupabaseClient = createClient();
  private session: SessionInfo | null = null;

  async getSession(): Promise<SessionInfo | null> {
    const { data } = await this.sb.auth.getUser();
    const user = data.user;
    if (!user) return null;
    // MVP: a user works in the first school they belong to.
    const membership = must(
      await this.sb.from("memberships").select("school_id, role").eq("user_id", user.id).limit(1).maybeSingle(),
    ) as { school_id: string; role: Role } | null;
    if (!membership) return null;
    const school = must(await this.sb.from("schools").select("*").eq("id", membership.school_id).single()) as School;
    const profile = must(await this.sb.from("profiles").select("full_name").eq("id", user.id).maybeSingle()) as
      | { full_name: string }
      | null;
    this.session = {
      actor: { user_id: user.id, role: membership.role, name: profile?.full_name ?? user.email ?? "User" },
      email: user.email ?? "",
      school,
    };
    return this.session;
  }

  private async me(): Promise<SessionInfo> {
    const s = this.session ?? (await this.getSession());
    if (!s) throw new Error("Not signed in.");
    return s;
  }

  async listEnrollments(): Promise<EnrollmentListItem[]> {
    const { actor, school } = await this.me();
    // RLS already limits rows to what this user may see.
    const rows = must(
      await this.sb
        .from("enrollments")
        .select(
          "id, status, track, level, course, strand, dean_approved, fix_note, updated_at, student_id," +
            "student:students(first_name, middle_name, last_name, student_no)," +
            "term:terms(school_year, semester, track, is_open, id, school_id)," +
            "ledger_entries(debit, credit)",
        )
        .eq("school_id", school.id),
    ) as unknown as Array<
      Enrollment & {
        student: Student;
        term: Term;
        ledger_entries: { debit: number; credit: number }[];
      }
    >;
    const items = rows.map((r) => {
      // RLS returns no ledger rows to teachers, so their balance shows 0.
      const owed = balance((r.ledger_entries ?? []).map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) })));
      const base = {
        id: r.id,
        student_id: r.student_id,
        student_name: fullName(r.student),
        student_no: r.student.student_no,
        track: r.track,
        level: r.level,
        course: r.course,
        strand: r.strand,
        term_label: termLabel(r.term),
        status: r.status,
        dean_approved: r.dean_approved,
        fix_note: r.fix_note,
        balance: Math.max(0, owed),
        updated_at: r.updated_at,
      };
      return { ...base, waiting: isWaitingOn(actor.role, base, school.settings) };
    });
    return sortForRole(actor.role, items, school.settings);
  }

  async getDetail(enrollmentId: string): Promise<EnrollmentDetail | null> {
    const e = must(await this.sb.from("enrollments").select("*").eq("id", enrollmentId).maybeSingle()) as Enrollment | null;
    if (!e) return null;
    const [student, term, documents, loads, offerings, setups, discounts, ledger, payments, history, counts] = await Promise.all([
      this.sb.from("students").select("*").eq("id", e.student_id).single(),
      this.sb.from("terms").select("*").eq("id", e.term_id).single(),
      this.sb.from("documents").select("*").eq("enrollment_id", e.id),
      this.sb.from("enrollment_loads").select("*").eq("enrollment_id", e.id),
      this.sb.from("offerings").select("*").eq("term_id", e.term_id).order("code"),
      this.sb.from("fee_setups").select("*").eq("term_id", e.term_id),
      this.sb.from("discounts").select("*").eq("enrollment_id", e.id).order("applied_at"),
      this.sb.from("ledger_entries").select("*").eq("enrollment_id", e.id).order("seq"),
      this.sb.from("payments").select("*").eq("enrollment_id", e.id).order("paid_at"),
      this.sb.from("enrollment_history").select("*").eq("enrollment_id", e.id).order("created_at"),
      // Security-definer function: counts seats without exposing other students.
      this.sb.rpc("offering_taken_counts", { p_term_id: e.term_id, p_exclude_enrollment: e.id }),
    ]);
    const takenCounts: Record<string, number> = {};
    for (const row of (must(counts) as { offering_id: string; taken: number }[]) ?? []) {
      takenCounts[row.offering_id] = Number(row.taken);
    }
    return {
      enrollment: { ...e, overrides: e.overrides ?? [] },
      student: must(student),
      term: must(term),
      documents: must(documents) ?? [],
      loads: must(loads) ?? [],
      offerings: (must(offerings) ?? []).map((o: { units: number; lab_fee: number }) => ({
        ...o, units: Number(o.units), lab_fee: Number(o.lab_fee),
      })),
      takenCounts,
      feeSetup: findSetup(((must(setups) ?? []) as FeeSetup[]).map(numSetup), e),
      discounts: ((must(discounts) ?? []) as Discount[]).map(numDiscount),
      ledger: ((must(ledger) ?? []) as LedgerEntry[]).map(numLedger),
      payments: ((must(payments) ?? []) as Payment[]).map(numPayment),
      history: must(history) ?? [],
      passed_codes: await this.passedFor(e).catch(() => []),
    } as EnrollmentDetail;
  }

  /** Subjects passed in the student's OTHER enrollments (posted grades only). */
  private async passedFor(e: Enrollment): Promise<string[]> {
    const others = must(
      await this.sb.from("enrollments").select("id").eq("student_id", e.student_id).neq("id", e.id),
    ) as { id: string }[];
    if (!others.length) return [];
    const loads = must(
      await this.sb.from("enrollment_loads").select("enrollment_id, offering_id").in("enrollment_id", ids(others)),
    ) as { enrollment_id: string; offering_id: string }[];
    const offeringIds = [...new Set(loads.map((l) => l.offering_id))];
    if (!offeringIds.length) return [];
    const [offerings, sheets, entries, settings] = await Promise.all([
      this.sb.from("offerings").select("*").in("id", offeringIds),
      this.sb.from("grade_sheets").select("*").in("offering_id", offeringIds).eq("status", "posted"),
      this.sb.from("grade_entries").select("*").in("enrollment_id", ids(others)),
      this.getGradeSettings(),
    ]);
    return passedCodes({
      enrollments: others,
      offerings: ((must(offerings) ?? []) as Offering[]).map((o) => ({ ...o, units: Number(o.units) })),
      loads,
      sheets: (must(sheets) ?? []) as GradeSheet[],
      entries: ((must(entries) ?? []) as GradeEntry[]).map(numEntry),
      settings,
    });
  }

  async listTerms(): Promise<Term[]> {
    const { school } = await this.me();
    return must(await this.sb.from("terms").select("*").eq("school_id", school.id).eq("is_open", true)) as Term[];
  }

  async listReturningStudents(): Promise<Student[]> {
    const { school } = await this.me();
    return must(
      await this.sb.from("students").select("*").eq("school_id", school.id).not("student_no", "is", null),
    ) as Student[];
  }

  async createApplication(input: NewApplicationInput): Promise<string> {
    const { actor, school } = await this.me();
    let student: Student | null = null;
    if (input.existing_student_id) {
      student = must(await this.sb.from("students").select("*").eq("id", input.existing_student_id).single()) as Student;
    } else {
      student = must(
        await this.sb
          .from("students")
          .insert({
            school_id: school.id,
            lrn: input.lrn || null,
            first_name: input.first_name,
            middle_name: input.middle_name || null,
            last_name: input.last_name,
            birth_date: input.birth_date || null,
            sex: input.sex || null,
            user_id: actor.role === "student" ? actor.user_id : null,
            guardian_user_id: actor.role === "parent" ? actor.user_id : null,
          })
          .select("*")
          .single(),
      ) as Student;
      if (actor.role === "parent") {
        must(await this.sb.from("parent_links").insert({ school_id: school.id, parent_user_id: actor.user_id, student_id: student.id }));
      }
    }
    const returning = !!student.student_no;
    const e = must(
      await this.sb
        .from("enrollments")
        .insert({
          school_id: school.id,
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
        })
        .select("id")
        .single(),
    ) as { id: string };
    must(
      await this.sb.from("enrollment_history").insert({
        school_id: school.id,
        enrollment_id: e.id,
        from_status: null,
        to_status: returning ? "student_made" : "applied",
        action: returning ? "returning" : "submit",
        reason: returning ? "Returning student - starts at the load step" : null,
        actor_id: actor.user_id,
        actor_name: `${actor.name} (${actor.role})`,
      }),
    );
    for (const f of input.files) await this.uploadDocument(e.id, f.type, f.file);
    return e.id;
  }

  async runAction(enrollmentId: string, input: WithOverride): Promise<PlanResult> {
    const { actor, school } = await this.me();
    const detail = await this.getDetail(enrollmentId);
    if (!detail) return { ok: false, error: "Enrollment not found.", warnings: [], canOverride: false };
    let seq = 1;
    if (input.type === "assign_id") {
      const prefix = `${school.code}-${detail.term.school_year.slice(0, 4)}-`;
      const used = must(
        await this.sb.from("students").select("student_no").eq("school_id", school.id).like("student_no", `${prefix}%`),
      ) as { student_no: string }[];
      seq = nextSeq(used.map((u) => u.student_no), school.code, detail.term.school_year);
    }
    const result = planAction(
      { detail, school, actor, now: new Date().toISOString(), nextStudentSeq: seq },
      input,
    );
    if (!result.ok) return result;
    if (input.type === "take_payment") {
      // Payment + ledger row + OR series + status + history in ONE database transaction.
      must(
        await this.sb.rpc("fees_take_payment", {
          p_enrollment: enrollmentId,
          p_amount: Number(input.amount),
          p_mode: input.mode ?? "cash",
          p_reference: input.reference ?? null,
          p_or_no: input.or_no,
        }),
      );
      return result;
    }
    await this.apply(detail, result.mutations);
    return result;
  }

  /**
   * Save planned changes. MVP note: these are separate requests, not one
   * transaction; a later version can move this into a Postgres function.
   */
  private async apply(detail: EnrollmentDetail, m: Mutations) {
    const eid = detail.enrollment.id;
    const school_id = detail.enrollment.school_id;
    if (m.student) must(await this.sb.from("students").update(m.student).eq("id", detail.student.id));
    if (m.checkAllDocs) must(await this.sb.from("documents").update({ checked: true }).eq("enrollment_id", eid));
    if (m.replaceLoads) {
      must(await this.sb.from("enrollment_loads").delete().eq("enrollment_id", eid));
      if (m.replaceLoads.length) {
        must(await this.sb.from("enrollment_loads").insert(m.replaceLoads.map((offering_id) => ({ school_id, enrollment_id: eid, offering_id }))));
      }
    }
    must(await this.sb.from("enrollments").update(m.enrollment).eq("id", eid));
    // Charges are worked out by the database from the saved load and the fee
    // setup (the planned rows in m.postLedger are only used in demo mode).
    if (m.postLedger) must(await this.sb.rpc("fees_assess", { p_enrollment: eid }));
    must(await this.sb.from("enrollment_history").insert({ school_id, enrollment_id: eid, ...m.history }));
  }

  // ----- fees -----

  async listAllTerms(): Promise<Term[]> {
    const { school } = await this.me();
    return must(await this.sb.from("terms").select("*").eq("school_id", school.id).order("school_year")) as Term[];
  }

  async listFeeSetups(): Promise<FeeSetup[]> {
    const { school } = await this.me();
    return ((must(await this.sb.from("fee_setups").select("*").eq("school_id", school.id)) ?? []) as FeeSetup[]).map(numSetup);
  }

  async listTermSubjects(termId: string): Promise<Offering[]> {
    const rows = must(await this.sb.from("offerings").select("*").eq("term_id", termId).eq("kind", "subject").order("code")) as Offering[];
    return rows.map((o) => ({ ...o, units: Number(o.units), lab_fee: Number(o.lab_fee) }));
  }

  async saveFeeSetup(setup: FeeSetupDraft, subjects: SubjectFeeEdit[]) {
    const problems = validateSetup(setup);
    if (problems.length) throw new Error(problems.join(" "));
    // RLS: only the registrar may write fee setups and offerings.
    const { id, ...row } = setup;
    const payload = { ...row, updated_at: new Date().toISOString() };
    if (id) must(await this.sb.from("fee_setups").update(payload).eq("id", id));
    else must(await this.sb.from("fee_setups").insert(payload));
    for (const sub of subjects) {
      must(await this.sb.from("offerings").update({ lab_fee: Number(sub.lab_fee) || 0, is_major: sub.is_major }).eq("id", sub.id));
    }
  }

  async getOrSeries(): Promise<OrSeries> {
    const { school } = await this.me();
    const row = must(await this.sb.from("or_series").select("*").eq("school_id", school.id).maybeSingle()) as OrSeries | null;
    return row ? { ...row, next_no: Number(row.next_no) } : { school_id: school.id, prefix: "", next_no: 1, pad: 6 };
  }

  async saveOrSeries(s: Pick<OrSeries, "prefix" | "next_no" | "pad">) {
    const { school } = await this.me();
    must(await this.sb.from("or_series").upsert({ school_id: school.id, ...s }, { onConflict: "school_id" }));
  }

  async runFeeAction(enrollmentId: string, input: FeeActionInput): Promise<FeeResult> {
    const { actor } = await this.me();
    const detail = await this.getDetail(enrollmentId);
    if (!detail) return { ok: false, error: "Enrollment not found." };
    // Same checks as demo mode first, for friendly messages; the database checks again.
    const r = planFeeAction({ detail, actor, now: new Date().toISOString(), newId: "pending" }, input);
    if (!r.ok) return r;
    const call =
      input.type === "apply_discount"
        ? this.sb.rpc("fees_apply_discount", {
            p_enrollment: enrollmentId, p_name: input.name, p_scope: input.scope, p_target: input.target,
            p_kind: input.kind, p_value: Number(input.value), p_reason: input.reason,
          })
        : input.type === "remove_discount"
          ? this.sb.rpc("fees_remove_discount", { p_discount: input.discount_id, p_reason: input.reason })
          : this.sb.rpc("fees_void_payment", { p_payment: input.payment_id, p_reason: input.reason });
    const res = await call;
    if (res.error) return { ok: false, error: res.error.message };
    return r;
  }

  private async closeData(termId: string) {
    const { school } = await this.me();
    const [terms, enrollments, students] = await Promise.all([
      this.sb.from("terms").select("*").eq("school_id", school.id),
      this.sb.from("enrollments").select("id, student_id, term_id, status, created_at").eq("school_id", school.id),
      this.sb.from("students").select("id, first_name, middle_name, last_name").eq("school_id", school.id),
    ]);
    const ledger = must(
      await this.sb.from("ledger_entries").select("*").eq("term_id", termId).order("seq"),
    ) as LedgerEntry[];
    const ledgerByEnrollment: Record<string, LedgerEntry[]> = {};
    for (const r of ledger.map(numLedger)) (ledgerByEnrollment[r.enrollment_id] ??= []).push(r);
    return {
      terms: must(terms) as Term[],
      enrollments: must(enrollments) as Enrollment[],
      students: must(students) as Student[],
      ledgerByEnrollment,
    };
  }

  async previewTermClose(termId: string): Promise<ClosePreview> {
    const d = await this.closeData(termId);
    const term = d.terms.find((t) => t.id === termId);
    if (!term) return { label: "", items: [], total: 0, error: "Term not found." };
    const label = termLabel(term);
    const plan = planTermClose({ term, termLabel: label, enrollments: d.enrollments, terms: d.terms, ledgerByEnrollment: d.ledgerByEnrollment });
    if ("error" in plan) return { label, items: [], total: 0, error: plan.error };
    return {
      label,
      total: plan.total,
      items: plan.items.map((i) => {
        const next = d.enrollments.find((x) => x.id === i.next_enrollment_id);
        const t = next && d.terms.find((x) => x.id === next.term_id);
        return { ...i, student_name: fullName(d.students.find((s) => s.id === i.student_id)!), next_label: t ? termLabel(t) : null };
      }),
    };
  }

  async closeTerm(termId: string) {
    const rows = must(await this.sb.rpc("fees_close_term", { p_term: termId })) as { closed: number; total: number }[];
    return { closed: Number(rows?.[0]?.closed ?? 0), total: Number(rows?.[0]?.total ?? 0) };
  }

  // ----- grades -----
  // Drafts are written straight to the tables (RLS: only the teacher of the
  // class, only while the sheet is a draft; the database works out each
  // grade). Submit / approve / return / allow late and change requests are
  // database functions that check the role and write the history row.

  private async profileNames(userIds: (string | null)[]): Promise<Record<string, string>> {
    const list = [...new Set(userIds.filter(Boolean))] as string[];
    if (!list.length) return {};
    const rows = must(await this.sb.from("profiles").select("id, full_name").in("id", list)) as { id: string; full_name: string }[];
    return Object.fromEntries(rows.map((r) => [r.id, r.full_name]));
  }

  /** Officially enrolled students of these classes (plus anyone already graded). */
  private async rosters(offeringIds: string[], gradedEnrollments: Set<string> = new Set()) {
    if (!offeringIds.length) return {} as Record<string, RosterRow[]>;
    const rows = must(
      await this.sb
        .from("enrollment_loads")
        .select("offering_id, enrollment:enrollments(id, status, level, strand, student:students(id, first_name, middle_name, last_name, student_no))")
        .in("offering_id", offeringIds),
    ) as unknown as {
      offering_id: string;
      enrollment: { id: string; status: string; level: string; strand: string | null; student: Student } | null;
    }[];
    const out: Record<string, RosterRow[]> = {};
    for (const r of rows) {
      const e = r.enrollment;
      if (!e || !(e.status === "officially_enrolled" || gradedEnrollments.has(e.id))) continue;
      (out[r.offering_id] ??= []).push({
        enrollment_id: e.id, student_id: e.student.id, name: fullName(e.student), student_no: e.student.student_no,
        level: e.level, strand: e.strand,
      });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async listClasses(): Promise<ClassListItem[]> {
    const { actor, school } = await this.me();
    if (!gradePermissions(actor.role).classes) return [];
    let q = this.sb.from("offerings").select("*").eq("school_id", school.id);
    if (actor.role === "teacher") q = q.eq("teacher_id", actor.user_id);
    const offerings = must(await q) as Offering[];
    const oids = offerings.map((o) => o.id);
    if (!oids.length) return [];
    const [terms, sheets, requests, roster] = await Promise.all([
      this.listAllTerms(),
      this.sb.from("grade_sheets").select("id, offering_id, status").in("offering_id", oids),
      this.sb.from("change_grade_requests").select("sheet_id").eq("status", "pending"),
      this.rosters(oids),
    ]);
    const sheetRows = (must(sheets) ?? []) as Pick<GradeSheet, "id" | "offering_id" | "status">[];
    const pendingRows = (must(requests) ?? []) as { sheet_id: string }[];
    const names = await this.profileNames(offerings.map((o) => o.teacher_id));
    const useDean = school.settings.use_dean_approval;
    const items: ClassListItem[] = [];
    for (const o of offerings) {
      const students = roster[o.id]?.length ?? 0;
      if (actor.role !== "teacher" && students === 0) continue;
      const mine = sheetRows.filter((s) => s.offering_id === o.id);
      const submitted = mine.filter((s) => s.status === "submitted").length;
      const returned = mine.filter((s) => s.status === "returned").length;
      const pending = pendingRows.filter((r) => mine.some((s) => s.id === r.sheet_id)).length;
      const t = terms.find((x) => x.id === o.term_id)!;
      items.push({
        offering_id: o.id, kind: o.kind, code: o.code, title: o.title, term_id: o.term_id, term_label: t ? termLabel(t) : "",
        level: o.level, teacher_name: o.teacher_id ? names[o.teacher_id] ?? null : null, students,
        submitted, returned, pending_changes: pending,
        waiting:
          actor.role === "teacher" ? returned > 0
          : actor.role === "registrar" ? (!useDean && submitted > 0) || pending > 0
          : actor.role === "dean" ? useDean && submitted > 0 : false,
      });
    }
    const closed = (i: ClassListItem) => (terms.find((t) => t.id === i.term_id)?.closed_at ? 1 : 0);
    return items.sort((x, y) => Number(y.waiting) - Number(x.waiting) || closed(x) - closed(y) || x.code.localeCompare(y.code));
  }

  async getClassSheet(offeringId: string): Promise<ClassSheetDetail | null> {
    const { actor } = await this.me();
    if (!gradePermissions(actor.role).classes) return null;
    const o = must(await this.sb.from("offerings").select("*").eq("id", offeringId).maybeSingle()) as Offering | null;
    if (!o) return null;
    const teaches = o.teacher_id === actor.user_id;
    if (actor.role === "teacher" && !teaches) return null;
    const sheets = (must(await this.sb.from("grade_sheets").select("*").eq("offering_id", o.id)) ?? []) as GradeSheet[];
    const sids = ids(sheets);
    const none = { data: [], error: null };
    const [term, entries, items, requests, history, settings, names] = await Promise.all([
      this.sb.from("terms").select("*").eq("id", o.term_id).single(),
      sids.length ? this.sb.from("grade_entries").select("*").in("sheet_id", sids) : none,
      sids.length ? this.sb.from("k12_score_items").select("*").in("sheet_id", sids).order("position") : none,
      sids.length ? this.sb.from("change_grade_requests").select("*").in("sheet_id", sids).order("requested_at") : none,
      sids.length ? this.sb.from("grade_history").select("*").in("sheet_id", sids).order("created_at") : none,
      this.getGradeSettings(),
      this.profileNames([o.teacher_id]),
    ]);
    const entryRows = ((must(entries) ?? []) as GradeEntry[]).map(numEntry);
    const roster = await this.rosters([o.id], new Set(entryRows.map((g) => g.enrollment_id)));
    return {
      offering: { ...o, units: Number(o.units), lab_fee: Number(o.lab_fee) },
      term: must(term) as Term,
      teacher_name: o.teacher_id ? names[o.teacher_id] ?? null : null,
      teaches,
      roster: roster[o.id] ?? [],
      sheets,
      entries: entryRows,
      items: ((must(items) ?? []) as ScoreItem[]).map(numItem),
      requests: (must(requests) ?? []) as ChangeGradeRequest[],
      history: (must(history) ?? []) as GradeHistoryRow[],
      settings,
    };
  }

  async saveGradeSheet(d: SheetDraft): Promise<GradeResult> {
    const { actor, school } = await this.me();
    const o = must(await this.sb.from("offerings").select("*").eq("id", d.offering_id).single()) as Offering;
    let q = this.sb.from("grade_sheets").select("*").eq("offering_id", o.id).eq("period", d.period);
    q = d.learning_area ? q.eq("learning_area", d.learning_area) : q.is("learning_area", null);
    let sheet = must(await q.maybeSingle()) as GradeSheet | null;
    const settings = await this.getGradeSettings();
    const plan = planSheetAction(
      {
        actor,
        sheet: sheet ?? { status: "draft", late_allowed: false },
        teachesClass: actor.role === "teacher" && o.teacher_id === actor.user_id,
        useDean: school.settings.use_dean_approval,
        deadline: deadlineFor(settings, o.term_id, d.period),
        now: new Date().toISOString(),
      },
      { type: "save" },
    );
    if (!plan.ok) return plan;
    try {
      if (!sheet) {
        sheet = must(
          await this.sb
            .from("grade_sheets")
            .insert({
              school_id: school.id, term_id: o.term_id, offering_id: o.id, learning_area: d.learning_area,
              subject_group: d.subject_group, period: d.period, teacher_id: actor.user_id,
            })
            .select("*")
            .single(),
        ) as GradeSheet;
      } else {
        must(await this.sb.from("grade_sheets").update({ updated_at: new Date().toISOString() }).eq("id", sheet.id));
      }
      const sid = sheet.id;
      // Items first: the database works out each grade from them.
      const keep = d.items.map((i) => i.id);
      const del = this.sb.from("k12_score_items").delete().eq("sheet_id", sid);
      must(await (keep.length ? del.not("id", "in", `(${keep.join(",")})`) : del));
      if (d.items.length) {
        must(await this.sb.from("k12_score_items").upsert(
          d.items.map((i) => ({ ...i, max_score: Number(i.max_score) || 0, school_id: school.id, sheet_id: sid })),
        ));
      }
      if (d.entries.length) {
        must(await this.sb.from("grade_entries").upsert(
          d.entries.map((e) => ({ ...e, school_id: school.id, sheet_id: sid })),
          { onConflict: "sheet_id,enrollment_id" },
        ));
      }
      return { ok: true, sheet_id: sid };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async runSheetAction(sheetId: string, input: SheetActionInput): Promise<GradeResult> {
    if (input.type === "save") return { ok: true, sheet_id: sheetId };
    const res = await this.sb.rpc("grades_sheet_action", {
      p_sheet: sheetId, p_action: input.type, p_note: input.type === "return" ? input.note : null,
    });
    return res.error ? { ok: false, error: res.error.message } : { ok: true, sheet_id: sheetId };
  }

  async requestGradeChange(entryId: string, newValue: EntryValue, reason: string): Promise<GradeResult> {
    const { actor } = await this.me();
    const g = must(await this.sb.from("grade_entries").select("*").eq("id", entryId).single()) as GradeEntry;
    const sheet = must(await this.sb.from("grade_sheets").select("*").eq("id", g.sheet_id).single()) as GradeSheet;
    const o = must(await this.sb.from("offerings").select("teacher_id").eq("id", sheet.offering_id).single()) as { teacher_id: string | null };
    const pending = (must(await this.sb.from("change_grade_requests").select("entry_id, status").eq("entry_id", entryId)) ?? []) as ChangeGradeRequest[];
    // Friendly checks first; the database checks again.
    const plan = planChangeRequest(
      {
        actor, sheet, teachesClass: actor.role === "teacher" && o.teacher_id === actor.user_id,
        entry: { id: g.id, enrollment_id: g.enrollment_id, value: { percent: g.percent == null ? null : Number(g.percent), mark: g.mark, ...(newValue.scores ? { scores: g.scores } : {}) } },
        pending, now: new Date().toISOString(),
      },
      { new_value: newValue, reason },
    );
    if (!plan.ok) return plan;
    const res = await this.sb.rpc("grades_request_change", {
      p_entry: entryId, p_percent: newValue.percent, p_mark: newValue.mark, p_scores: newValue.scores ?? null, p_reason: reason,
    });
    return res.error ? { ok: false, error: res.error.message } : { ok: true, sheet_id: sheet.id };
  }

  async decideGradeChange(requestId: string, approve: boolean, note: string): Promise<GradeResult> {
    const res = await this.sb.rpc("grades_decide_change", { p_request: requestId, p_approve: approve, p_note: note || null });
    return res.error ? { ok: false, error: res.error.message } : { ok: true };
  }

  async getStudentGrades(enrollmentId: string): Promise<StudentGrades | null> {
    const { actor } = await this.me();
    const perms = gradePermissions(actor.role);
    if (!perms.view) return null;
    const loads = (must(await this.sb.from("enrollment_loads").select("offering_id").eq("enrollment_id", enrollmentId)) ?? []) as { offering_id: string }[];
    const settings = await this.getGradeSettings();
    if (!loads.length) return { settings, sheets: [], entries: [] };
    // RLS: students / parents get posted sheets only; teachers their own classes.
    let sq = this.sb.from("grade_sheets").select("*").in("offering_id", loads.map((l) => l.offering_id));
    if (perms.postedOnly) sq = sq.eq("status", "posted");
    const sheets = (must(await sq) ?? []) as GradeSheet[];
    if (!sheets.length) return { settings, sheets: [], entries: [] };
    const entries = (must(await this.sb.from("grade_entries").select("*").eq("enrollment_id", enrollmentId).in("sheet_id", ids(sheets))) ?? []) as GradeEntry[];
    return { settings, sheets, entries: entries.map(numEntry) };
  }

  async getGradeSettings(): Promise<GradeSettings> {
    const { school } = await this.me();
    const row = must(await this.sb.from("grade_settings").select("*").eq("school_id", school.id).maybeSingle()) as GradeSettings | null;
    return row ? numSettings(row) : defaultGradeSettings(school.id);
  }

  async saveGradeSettings(s: GradeSettings): Promise<void> {
    const { school } = await this.me();
    const problems = validateGradeSettings(s);
    if (problems.length) throw new Error(problems.join(" "));
    const { school_id: _skip, ...row } = s;
    void _skip;
    // RLS: only the registrar may update the school's grade settings.
    must(await this.sb.from("grade_settings").update({ ...row, updated_at: new Date().toISOString() }).eq("school_id", school.id));
  }

  async uploadDocument(enrollmentId: string, type: DocType, file: File) {
    const { school } = await this.me();
    const path = `${school.id}/${enrollmentId}/${type}-${Date.now()}-${file.name}`;
    must(await this.sb.storage.from(BUCKET).upload(path, file, { upsert: true }));
    must(
      await this.sb.from("documents").upsert(
        {
          school_id: school.id,
          enrollment_id: enrollmentId,
          type,
          file_name: file.name,
          file_path: path,
          checked: false,
          uploaded_at: new Date().toISOString(),
        },
        { onConflict: "enrollment_id,type" },
      ),
    );
  }

  async signOut() {
    await this.sb.auth.signOut();
    this.session = null;
  }
}
