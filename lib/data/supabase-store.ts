// SUPABASE MODE: same DataStore interface, backed by Postgres + RLS.
// Business rules still run in lib/enrollment (planAction); this file only
// loads rows and saves the planned changes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../supabase/client";
import type {
  DocType,
  Enrollment,
  EnrollmentDetail,
  Role,
  School,
  Student,
  Term,
} from "../enrollment/types";
import { planAction, type Mutations, type PlanResult, type WithOverride } from "../enrollment/actions";
import { isWaitingOn, sortForRole } from "../enrollment/queue";
import { nextSeq } from "../enrollment/ids";
import { totalPaid } from "../enrollment/fees";
import {
  fullName,
  termLabel,
  type DataStore,
  type EnrollmentListItem,
  type NewApplicationInput,
  type SessionInfo,
} from "./store";

const BUCKET = "documents";

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

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
            "fee_lines(amount), payments(amount)",
        )
        .eq("school_id", school.id),
    ) as unknown as Array<
      Enrollment & {
        student: Student;
        term: Term;
        fee_lines: { amount: number }[];
        payments: { amount: number }[];
      }
    >;
    const items = rows.map((r) => {
      const fees = r.fee_lines.reduce((a, f) => a + Number(f.amount), 0);
      const paid = totalPaid(r.payments.map((p) => ({ amount: Number(p.amount) })));
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
        balance: Math.max(0, fees - paid),
        updated_at: r.updated_at,
      };
      return { ...base, waiting: isWaitingOn(actor.role, base, school.settings) };
    });
    return sortForRole(actor.role, items, school.settings);
  }

  async getDetail(enrollmentId: string): Promise<EnrollmentDetail | null> {
    const e = must(await this.sb.from("enrollments").select("*").eq("id", enrollmentId).maybeSingle()) as Enrollment | null;
    if (!e) return null;
    const [student, term, documents, loads, offerings, feeLines, payments, history, counts] = await Promise.all([
      this.sb.from("students").select("*").eq("id", e.student_id).single(),
      this.sb.from("terms").select("*").eq("id", e.term_id).single(),
      this.sb.from("documents").select("*").eq("enrollment_id", e.id),
      this.sb.from("enrollment_loads").select("*").eq("enrollment_id", e.id),
      this.sb.from("offerings").select("*").eq("term_id", e.term_id).order("code"),
      this.sb.from("fee_lines").select("*").eq("enrollment_id", e.id),
      this.sb.from("payments").select("*").eq("enrollment_id", e.id).order("paid_at"),
      this.sb.from("enrollment_history").select("*").eq("enrollment_id", e.id).order("created_at"),
      // Security-definer function: counts seats without exposing other students.
      this.sb.rpc("offering_taken_counts", { p_term_id: e.term_id, p_exclude_enrollment: e.id }),
    ]);
    const takenCounts: Record<string, number> = {};
    for (const row of (must(counts) as { offering_id: string; taken: number }[]) ?? []) {
      takenCounts[row.offering_id] = Number(row.taken);
    }
    const num = <T extends { amount: number }>(rows: T[]) => rows.map((r) => ({ ...r, amount: Number(r.amount) }));
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
      feeLines: num(must(feeLines) ?? []),
      payments: num(must(payments) ?? []),
      history: must(history) ?? [],
    } as EnrollmentDetail;
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
    if (result.ok) await this.apply(detail, result.mutations);
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
    if (m.replaceFeeLines) {
      must(await this.sb.from("fee_lines").delete().eq("enrollment_id", eid));
      must(await this.sb.from("fee_lines").insert(m.replaceFeeLines.map((l) => ({ school_id, enrollment_id: eid, ...l }))));
    }
    if (m.addPayment) must(await this.sb.from("payments").insert({ school_id, enrollment_id: eid, ...m.addPayment }));
    must(await this.sb.from("enrollments").update(m.enrollment).eq("id", eid));
    must(await this.sb.from("enrollment_history").insert({ school_id, enrollment_id: eid, ...m.history }));
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
