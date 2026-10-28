// Applicant Portal rules (pure TypeScript, used by both data stores):
// - who may edit the application and when (only while it is "applied", including "needs fix")
// - what an edit changes (for the history row)
// - follow-up requests: open -> answered -> closed
// - promotion: the applicant account becomes a student account when the student ID is made
// - plain-language progress text for the portal

import type { Enrollment, HistoryRow, Role, Status, Student } from "../enrollment/types";
import { STEPS, stepIndex } from "../enrollment/status";
import type { ApplicantRequest, RequestStatus, RequestType } from "./types";
import { REQUEST_TYPE_LABEL } from "./types";
import { isEmail, isPhMobile, normalizePhone } from "./validate";

export type Check = { ok: true } | { ok: false; reason: string };

/** People who own the application: the applicant, and later the student or parent. */
const OWNER_ROLES: Role[] = ["applicant", "student", "parent"];

// ---------- editing ----------

/** The applicant may change details and papers only before the papers are checked. */
export function canEditApplication(status: Status): Check {
  switch (status) {
    case "applied":
      return { ok: true };
    case "rejected":
      return { ok: false, reason: "This application was not accepted, so it can no longer be changed." };
    case "withdrawn":
      return { ok: false, reason: "This enrollment was withdrawn, so it can no longer be changed." };
    default:
      return {
        ok: false,
        reason:
          "Your papers were already checked, so your details are locked. If something is wrong, send a Change request to the registrar.",
      };
  }
}

export const STUDENT_EDIT_FIELDS = [
  "last_name", "first_name", "middle_name", "birth_date", "sex", "civil_status", "citizenship",
  "contact_no", "email", "address", "guardian_name", "guardian_contact", "lrn",
] as const;
export const ENROLLMENT_EDIT_FIELDS = [
  "course", "level", "strand", "student_type", "esc_voucher", "mother_tongue", "ip_group", "is_4ps", "tuition_plan",
] as const;

export type StudentEditField = (typeof STUDENT_EDIT_FIELDS)[number];
export type EnrollmentEditField = (typeof ENROLLMENT_EDIT_FIELDS)[number];

export const FIELD_LABEL: Record<StudentEditField | EnrollmentEditField, string> = {
  last_name: "Last name", first_name: "First name", middle_name: "Middle name", birth_date: "Birthdate",
  sex: "Gender", civil_status: "Civil status", citizenship: "Citizenship", contact_no: "Contact number",
  email: "Email", address: "Address", guardian_name: "Guardian name", guardian_contact: "Guardian number",
  lrn: "LRN", course: "Course", level: "Level", strand: "Strand", student_type: "Student type",
  esc_voucher: "ESC / voucher", mother_tongue: "Mother tongue", ip_group: "IP group", is_4ps: "4Ps",
  tuition_plan: "Tuition plan",
};

export interface DetailsChange {
  student: Partial<Record<StudentEditField, string | null>>;
  enrollment: Partial<Record<EnrollmentEditField, string | boolean | null>>;
}

export type DetailsPlan =
  | { ok: true; student: Partial<Student>; enrollment: Partial<Enrollment>; summary: string }
  | { ok: false; error: string };

const show = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : v === null || v === undefined || v === "" ? "—" : String(v));
const norm = (v: unknown) => (typeof v === "string" ? v.trim() || null : v ?? null);

/** Work out what changes. The summary goes into the history: "Course: BSIT → BSCS; ...". */
export function planDetailsUpdate(
  ctx: { role: Role; student: Student; enrollment: Enrollment },
  change: DetailsChange,
): DetailsPlan {
  if (!OWNER_ROLES.includes(ctx.role)) return { ok: false, error: "Only the applicant can change these details here." };
  const allowed = canEditApplication(ctx.enrollment.status);
  if (!allowed.ok) return { ok: false, error: allowed.reason };

  const student: Record<string, unknown> = {};
  const enrollment: Record<string, unknown> = {};
  const parts: string[] = [];
  for (const k of STUDENT_EDIT_FIELDS) {
    if (!(k in change.student)) continue;
    let v = norm(change.student[k]);
    if ((k === "contact_no" || k === "guardian_contact") && typeof v === "string") v = normalizePhone(v);
    if (k === "email" && typeof v === "string") v = v.toLowerCase();
    const old = norm((ctx.student as unknown as Record<string, unknown>)[k]);
    if (v !== old) {
      student[k] = v;
      parts.push(`${FIELD_LABEL[k]}: ${show(old)} → ${show(v)}`);
    }
  }
  for (const k of ENROLLMENT_EDIT_FIELDS) {
    if (!(k in change.enrollment)) continue;
    const v = norm(change.enrollment[k]);
    const old = norm((ctx.enrollment as unknown as Record<string, unknown>)[k]);
    if (v !== old) {
      enrollment[k] = v;
      parts.push(`${FIELD_LABEL[k]}: ${show(old)} → ${show(v)}`);
    }
  }
  if (!parts.length) return { ok: false, error: "Nothing changed." };

  const merged = { ...ctx.student, ...student } as Student;
  if (!merged.first_name || !merged.last_name) return { ok: false, error: "The first and last name cannot be empty." };
  if (merged.contact_no && !isPhMobile(merged.contact_no)) return { ok: false, error: "Use a PH mobile number like 09171234567." };
  if (merged.guardian_contact && !isPhMobile(merged.guardian_contact)) {
    return { ok: false, error: "Use a PH mobile number like 09171234567 for the guardian." };
  }
  if (merged.email && !isEmail(merged.email)) return { ok: false, error: "Please check the email address." };
  if (merged.lrn && !/^\d{12}$/.test(merged.lrn)) return { ok: false, error: "The LRN has 12 digits." };
  if (merged.sex && merged.sex !== "M" && merged.sex !== "F") return { ok: false, error: "Please pick Male or Female." };
  const e2 = { ...ctx.enrollment, ...enrollment } as Enrollment;
  if (!e2.level) return { ok: false, error: "Please pick a level." };
  if (e2.track === "college" && !e2.course) return { ok: false, error: "Please pick a course." };

  return {
    ok: true,
    student: student as Partial<Student>,
    enrollment: enrollment as Partial<Enrollment>,
    summary: parts.join("; "),
  };
}

// ---------- follow-up requests ----------

export const MAX_OPEN_REQUESTS = 5;
export const MAX_REQUEST_LENGTH = 1000;

export function openRequestCount(requests: Pick<ApplicantRequest, "status">[]): number {
  return requests.filter((r) => r.status === "open").length;
}

export type RequestPlan<T> = { ok: true; value: T } | { ok: false; error: string };

/** The applicant (or the student / parent) sends a message to the registrar. */
export function planRequestCreate(
  ctx: { role: Role; status: Status; requests: Pick<ApplicantRequest, "status">[]; now: string },
  input: { type: RequestType; message: string },
): RequestPlan<Pick<ApplicantRequest, "type" | "message" | "status" | "reply" | "created_at" | "replied_at" | "closed_at" | "replied_by" | "replied_by_name">> {
  if (!OWNER_ROLES.includes(ctx.role)) return { ok: false, error: "Only the applicant can send a request here." };
  if (ctx.status === "rejected" || ctx.status === "withdrawn") return { ok: false, error: "This application is closed." };
  if (!(input.type in REQUEST_TYPE_LABEL)) return { ok: false, error: "Pick a request type." };
  const message = input.message.trim();
  if (!message) return { ok: false, error: "Please type your message." };
  if (message.length > MAX_REQUEST_LENGTH) return { ok: false, error: `Keep the message under ${MAX_REQUEST_LENGTH} characters.` };
  if (openRequestCount(ctx.requests) >= MAX_OPEN_REQUESTS) {
    return { ok: false, error: `You already have ${MAX_OPEN_REQUESTS} requests waiting. Please wait for a reply.` };
  }
  return {
    ok: true,
    value: {
      type: input.type, message, status: "open", reply: null, created_at: ctx.now,
      replied_at: null, closed_at: null, replied_by: null, replied_by_name: null,
    },
  };
}

/** The registrar replies (and may close the request at the same time). */
export function planRequestReply(
  ctx: { role: Role; request: Pick<ApplicantRequest, "status">; now: string; by: string; byName: string },
  input: { reply: string; close?: boolean },
): RequestPlan<Pick<ApplicantRequest, "status" | "reply" | "replied_at" | "replied_by" | "replied_by_name" | "closed_at">> {
  if (ctx.role !== "registrar") return { ok: false, error: "Only the registrar can reply to requests." };
  if (ctx.request.status === "closed") return { ok: false, error: "This request is already closed." };
  const reply = input.reply.trim();
  if (!reply) return { ok: false, error: "Please type a reply." };
  const status: RequestStatus = input.close ? "closed" : "answered";
  return {
    ok: true,
    value: {
      status, reply, replied_at: ctx.now, replied_by: ctx.by, replied_by_name: ctx.byName,
      closed_at: input.close ? ctx.now : null,
    },
  };
}

/** The registrar or the owner closes a request (nothing more to do). */
export function planRequestClose(
  ctx: { role: Role; isOwner: boolean; request: Pick<ApplicantRequest, "status">; now: string },
): RequestPlan<Pick<ApplicantRequest, "status" | "closed_at">> {
  if (!(ctx.role === "registrar" || ctx.isOwner)) return { ok: false, error: "You cannot close this request." };
  if (ctx.request.status === "closed") return { ok: false, error: "This request is already closed." };
  return { ok: true, value: { status: "closed", closed_at: ctx.now } };
}

// ---------- promotion ----------

/** An applicant becomes a student once the student ID is made (step 3 or later). */
export function roleAfterStatus(role: Role, status: Status): Role {
  if (role !== "applicant") return role;
  return stepIndex(status) >= stepIndex("student_made") ? "student" : role;
}

// ---------- portal text ----------

export interface StageInfo {
  tone: "wait" | "fix" | "good" | "done" | "stop";
  title: string;
  body: string;
  next: string;
}

export function applicantStage(
  e: Pick<Enrollment, "status" | "fix_note" | "track">,
  s: Pick<Student, "student_no">,
  lastReason?: string | null,
): StageInfo {
  const load = e.track === "college" ? "pick your subjects" : "pick a section";
  switch (e.status) {
    case "applied":
      return e.fix_note
        ? {
            tone: "fix",
            title: `Needs a fix: ${e.fix_note}`,
            body: "The registrar looked at your application and asked you to fix something.",
            next: "Fix it in Update details or Papers below, then send a Follow up so the registrar knows.",
          }
        : {
            tone: "wait",
            title: "We are checking your papers",
            body: "The registrar is looking at your form and papers. This usually takes 1 to 3 school days.",
            next: "Nothing to do for now. You can still fix your details or add papers until they are checked.",
          };
    case "papers_checked":
      return {
        tone: "good",
        title: "Your papers are OK",
        body: "The registrar checked your papers.",
        next: "Wait for your student number. We will show it here.",
      };
    case "student_made":
    case "load_set":
    case "assessed_paid":
      return {
        tone: "done",
        title: `Accepted! Your student number is ${s.student_no ?? "being made"}`,
        body: "You are now a student. Your login stays the same, and you can also sign in with your student number.",
        next: e.status === "student_made"
          ? `Open the student app to ${load}.`
          : e.status === "load_set"
            ? "Pay the downpayment at the cashier."
            : "Wait for the registrar's final approval.",
      };
    case "officially_enrolled":
      return {
        tone: "done",
        title: "You are officially enrolled!",
        body: `Your student number is ${s.student_no ?? "—"}.`,
        next: "See your load, fees and grades in the student app.",
      };
    case "rejected":
      return {
        tone: "stop",
        title: "Your application was not accepted",
        body: lastReason ? `Reason: ${lastReason}` : "The registrar did not accept this application.",
        next: "You can send a Question below or visit the registrar's office.",
      };
    case "withdrawn":
      return {
        tone: "stop",
        title: "This enrollment was withdrawn",
        body: lastReason ? `Reason: ${lastReason}` : "",
        next: "Visit the registrar's office if you have questions.",
      };
  }
}

/** When each of the 6 steps was reached (from the history). Missing = not reached yet. */
export function stepDates(history: Pick<HistoryRow, "from_status" | "to_status" | "created_at">[]): Partial<Record<Status, string>> {
  const out: Partial<Record<Status, string>> = {};
  const sorted = [...history].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const h of sorted) {
    if (h.to_status === "applied") {
      out.applied ??= h.created_at; // the first submission
    } else if (h.from_status !== h.to_status) {
      out[h.to_status] = h.created_at; // the latest move into that step
    }
  }
  // Returning students skip steps: no dates for steps they never went through.
  for (const s of STEPS) if (out[s.status] === undefined) delete out[s.status];
  return out;
}
