// Who can press what, and what happens when they do.
// `planAction` is pure: it reads an EnrollmentDetail and returns the changes
// to save. Both data stores (demo and Supabase) apply those same changes.

import type {
  Actor,
  Enrollment,
  EnrollmentDetail,
  HistoryRow,
  Role,
  School,
  Status,
  Student,
} from "./types";
import { canTransition, isFinal } from "./status";
import { checkCollegeLoad, checkPapers, checkSection } from "./checks";
import { feeSummary, manilaDate, peso, planAssessment, planPayment, type LedgerDraft, type Payment, type PaymentMode } from "../fees";
import { formatStudentNo } from "./ids";

export type ActionType =
  | "accept_papers"
  | "needs_fix"
  | "reject"
  | "assign_id"
  | "set_load"
  | "take_payment"
  | "dean_approve"
  | "approve"
  | "withdraw";

export const ACTION_LABEL: Record<ActionType, string> = {
  accept_papers: "Accept papers",
  needs_fix: "Needs fix",
  reject: "Reject",
  assign_id: "Assign student ID",
  set_load: "Pick subjects / section",
  take_payment: "Take payment",
  dean_approve: "Dean approve",
  approve: "Approve enrollment",
  withdraw: "Withdraw",
};

export type ActionInput =
  | { type: "accept_papers" }
  | { type: "needs_fix"; note: string }
  | { type: "reject"; reason: string }
  | { type: "assign_id" }
  | { type: "set_load"; offering_ids: string[] }
  | { type: "take_payment"; amount: number; or_no: string; mode?: PaymentMode; reference?: string | null }
  | { type: "dean_approve" }
  | { type: "approve" }
  | { type: "withdraw"; reason: string };

/** What the caller must provide for a registrar override. */
export type WithOverride = ActionInput & { override_reason?: string };

/** Buttons a role can press at the enrollment's current status. */
export function allowedActions(
  role: Role,
  e: Pick<Enrollment, "status" | "dean_approved">,
  settings: Pick<School["settings"], "use_dean_approval">,
): ActionType[] {
  const s = e.status;
  if (isFinal(s)) return [];
  switch (role) {
    case "registrar": {
      const map: Partial<Record<Status, ActionType[]>> = {
        applied: ["accept_papers", "needs_fix", "reject"],
        papers_checked: ["assign_id", "reject"],
        student_made: ["set_load", "withdraw"],
        load_set: ["set_load", "approve", "withdraw"],
        assessed_paid: ["approve", "withdraw"],
        officially_enrolled: ["withdraw"],
      };
      return map[s] ?? [];
    }
    case "cashier":
      return s === "load_set" || s === "assessed_paid" || s === "officially_enrolled"
        ? ["take_payment"]
        : [];
    case "dean":
      return settings.use_dean_approval && s === "assessed_paid" && !e.dean_approved
        ? ["dean_approve"]
        : [];
    case "student":
    case "parent":
      return s === "student_made" || s === "load_set" ? ["set_load"] : [];
    case "teacher":
    case "applicant":
      // Applicants use the portal: details, papers and follow-up requests.
      return [];
  }
}

/** Applicants, students and parents can add papers while the application is still open. */
export function canUploadPapers(role: Role, status: Status): boolean {
  return (role === "applicant" || role === "student" || role === "parent" || role === "registrar") && status === "applied";
}

/** The changes to save. Stores apply these in order. */
export interface Mutations {
  enrollment: Partial<Enrollment>;
  student?: Partial<Student>;
  checkAllDocs?: boolean;
  replaceLoads?: string[];
  /** Ledger rows to post (charges and discounts after a load change). */
  postLedger?: LedgerDraft[];
  /** A payment and its ledger row (the row's payment id is filled in by the store). */
  addPayment?: {
    payment: Omit<Payment, "id" | "school_id" | "enrollment_id" | "paid_at">;
    row: LedgerDraft;
  };
  history: Omit<HistoryRow, "id" | "school_id" | "enrollment_id">;
}

export type PlanResult =
  | { ok: true; mutations: Mutations; warnings: string[] }
  | {
      ok: false;
      error: string;
      /** Failed checks. A registrar may resend with override_reason. */
      warnings: string[];
      canOverride: boolean;
    };

export interface PlanContext {
  detail: EnrollmentDetail;
  school: School;
  actor: Actor;
  now: string;
  /** Next free sequence number for student IDs (only used by assign_id). */
  nextStudentSeq: number;
}

function fail(error: string, warnings: string[] = [], canOverride = false): PlanResult {
  return { ok: false, error, warnings, canOverride };
}

export function planAction(ctx: PlanContext, input: WithOverride): PlanResult {
  const { detail, school, actor, now } = ctx;
  const e = detail.enrollment;
  const settings = school.settings;

  if (!allowedActions(actor.role, e, settings).includes(input.type)) {
    return fail(`A ${actor.role} cannot "${ACTION_LABEL[input.type]}" at this step.`);
  }

  let to: Status = e.status;
  let warnings: string[] = [];
  let reason: string | null = null;
  const m: Omit<Mutations, "history"> = { enrollment: {} };

  switch (input.type) {
    case "accept_papers":
      warnings = checkPapers(e, detail.documents);
      to = "papers_checked";
      m.checkAllDocs = true;
      m.enrollment.fix_note = null;
      break;

    case "needs_fix":
      if (!input.note?.trim()) return fail("Please write what needs fixing.");
      to = "applied";
      reason = input.note.trim();
      m.enrollment.fix_note = reason;
      break;

    case "reject":
      if (!input.reason?.trim()) return fail("Please give a reason for rejecting.");
      to = "rejected";
      reason = input.reason.trim();
      break;

    case "assign_id": {
      to = "student_made";
      // Returning students keep their old number.
      if (!detail.student.student_no) {
        m.student = {
          student_no: formatStudentNo(school.code, detail.term.school_year, ctx.nextStudentSeq),
        };
      }
      break;
    }

    case "set_load": {
      if (detail.term.closed_at) return fail("This term is closed.");
      const picked = detail.offerings.filter((o) => input.offering_ids.includes(o.id));
      let chosen: typeof picked;
      if (e.track === "college") {
        chosen = picked.filter((o) => o.kind === "subject");
        warnings = checkCollegeLoad({
          picked: chosen,
          student: detail.student,
          passedCodes: detail.passed_codes,
          settings,
          takenCounts: detail.takenCounts,
        });
      } else {
        const sections = picked.filter((o) => o.kind === "section");
        warnings = checkSection(sections[0], e, detail.takenCounts);
        if (sections.length > 1) warnings.push("Pick only one section.");
        if (!sections[0]) return fail("Pick a section.");
        chosen = [sections[0]];
      }
      const fees = planAssessment(detail, chosen);
      if (!fees.ok) return fail(fees.error);
      m.replaceLoads = chosen.map((o) => o.id);
      m.postLedger = fees.rows;
      to = "load_set";
      break;
    }

    case "take_payment": {
      const p = planPayment(detail, { amount: input.amount, or_no: input.or_no, mode: input.mode ?? "cash", reference: input.reference }, now);
      if (!p.ok) return fail(p.error);
      m.addPayment = { payment: { ...p.payment, cashier_id: actor.user_id }, row: p.row };
      if (e.status === "load_set" && p.downpaymentMet) to = "assessed_paid";
      reason = `Paid ${peso(p.payment.amount)}, OR #${p.payment.or_no}`;
      break;
    }

    case "dean_approve":
      m.enrollment.dean_approved = true;
      reason = "Dean approved";
      break;

    case "approve": {
      const f = feeSummary({
        track: e.track,
        plan: e.tuition_plan,
        setup: detail.feeSetup,
        ledger: detail.ledger,
        payments: detail.payments,
        today: manilaDate(now),
      });
      if (f.previous > 0 && f.paid < f.previous) {
        warnings.push(`Unpaid back account: ${peso(f.previous - f.paid)} from an earlier term.`);
      }
      if (!f.downpaymentMet) warnings.push(`No downpayment yet: paid ${peso(f.paid)} of ${peso(f.downpaymentRequired)}.`);
      if (settings.use_dean_approval && !e.dean_approved) warnings.push("The dean has not approved yet.");
      to = "officially_enrolled";
      break;
    }

    case "withdraw":
      if (!input.reason?.trim()) return fail("Please give a reason for the withdrawal.");
      to = "withdrawn";
      reason = input.reason.trim();
      break;
  }

  if (!canTransition(e.status, to)) {
    return fail(`Cannot move from ${e.status} to ${to}.`);
  }

  // Failed checks: only a registrar may push through, and must say why.
  if (warnings.length > 0) {
    const isRegistrar = actor.role === "registrar";
    const why = input.override_reason?.trim();
    if (!isRegistrar) return fail("Some checks failed. Only the registrar can override.", warnings, false);
    if (!why) return fail("Some checks failed. Type a reason to override.", warnings, true);
    m.enrollment.overrides = [
      ...e.overrides,
      { action: input.type, checks: warnings, reason: why, by: actor.user_id, at: now },
    ];
    reason = reason ? `${reason} | Override: ${why}` : `Override: ${why}`;
  }

  m.enrollment.status = to;
  m.enrollment.updated_at = now;

  return {
    ok: true,
    warnings,
    mutations: {
      ...m,
      history: {
        from_status: e.status,
        to_status: to,
        action: input.type,
        reason,
        actor_id: actor.user_id,
        actor_name: `${actor.name} (${actor.role})`,
        created_at: now,
      },
    },
  };
}

/** Run only the checks (no changes) so the UI can warn before saving. */
export function previewWarnings(ctx: PlanContext, input: ActionInput): string[] {
  const r = planAction(ctx, { ...input, override_reason: undefined } as WithOverride);
  return r.ok ? [] : r.warnings;
}
