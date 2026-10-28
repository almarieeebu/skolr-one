// Grade sheet workflow: Draft -> Submit -> Approve (Posted, locked).
// The registrar (or the dean when the school uses the dean step) approves;
// the registrar can return a sheet with a note and allow late submission.
// Posted grades change only through a Change Grade Request.
// Everything here is pure: it returns the changes for a store to save.

import { isPastDeadline } from "./settings";
import { PERIOD_LABEL } from "./college";
import { QUARTER_LABEL } from "./k12";
import type {
  ChangeGradeRequest,
  CollegePeriod,
  EntryValue,
  GradeActor,
  GradeHistoryRow,
  GradePeriod,
  GradeSheet,
  Quarter,
  SheetStatus,
} from "./types";
import type { Role } from "../enrollment/types";

export type SheetActionType = "save" | "submit" | "approve" | "return" | "allow_late";

export const SHEET_ACTION_LABEL: Record<SheetActionType, string> = {
  save: "Save draft",
  submit: "Submit grades",
  approve: "Approve and post",
  return: "Return to teacher",
  allow_late: "Allow late submission",
};

export const SHEET_STATUS_LABEL: Record<SheetStatus, string> = {
  draft: "Draft",
  returned: "Returned",
  submitted: "Submitted",
  posted: "Posted",
};

export const periodLabel = (p: GradePeriod) =>
  p.startsWith("q") ? QUARTER_LABEL[p as Quarter] : PERIOD_LABEL[p as CollegePeriod];

export interface SheetContext {
  actor: GradeActor;
  /** The sheet, or a new one (status draft) when nothing is saved yet. */
  sheet: Pick<GradeSheet, "status" | "late_allowed">;
  /** Is the actor the teacher of this class? */
  teachesClass: boolean;
  useDean: boolean;
  /** Due date of this period (YYYY-MM-DD) or null. */
  deadline: string | null;
  now: string;
}

/** Who approves (posts) grades: the dean when the school uses the dean step, else the registrar. */
export const approverRole = (useDean: boolean): Role => (useDean ? "dean" : "registrar");

export const isEditable = (status: SheetStatus) => status === "draft" || status === "returned";

export function sheetActions(ctx: SheetContext): SheetActionType[] {
  const { actor, sheet } = ctx;
  const out: SheetActionType[] = [];
  if (actor.role === "teacher" && ctx.teachesClass && isEditable(sheet.status)) out.push("save", "submit");
  if (sheet.status === "submitted") {
    if (actor.role === approverRole(ctx.useDean)) out.push("approve");
    if (actor.role === "registrar" || actor.role === approverRole(ctx.useDean)) out.push("return");
  }
  if (
    actor.role === "registrar" && isEditable(sheet.status) && !sheet.late_allowed &&
    isPastDeadline(ctx.deadline, ctx.now)
  ) {
    out.push("allow_late");
  }
  return out;
}

/** Is a teacher's submission late (and not yet allowed)? */
export function lateWarning(ctx: Pick<SheetContext, "deadline" | "now" | "sheet">): string | null {
  if (!isPastDeadline(ctx.deadline, ctx.now) || ctx.sheet.late_allowed) return null;
  return `The deadline (${ctx.deadline}) has passed. The registrar must allow a late submission.`;
}

export type SheetActionInput =
  | { type: "save" }
  | { type: "submit" }
  | { type: "approve" }
  | { type: "return"; note: string }
  | { type: "allow_late" };

export type GradeHistoryDraft = Omit<GradeHistoryRow, "id" | "school_id" | "sheet_id">;

export type SheetPlan =
  | { ok: true; sheet: Partial<GradeSheet>; history: GradeHistoryDraft | null }
  | { ok: false; error: string };

/**
 * Plan a sheet action. `missing` = students with no grade yet (submit needs
 * every row filled; a 0 or INC counts as filled).
 */
export function planSheetAction(ctx: SheetContext, input: SheetActionInput, missing = 0): SheetPlan {
  const allowed = sheetActions(ctx);
  if (!allowed.includes(input.type)) {
    if (input.type === "save" || input.type === "submit") {
      if (!isEditable(ctx.sheet.status)) return { ok: false, error: `These grades are ${SHEET_STATUS_LABEL[ctx.sheet.status].toLowerCase()} and locked.` };
      return { ok: false, error: "Only the teacher of this class can enter grades." };
    }
    return { ok: false, error: `A ${ctx.actor.role} cannot "${SHEET_ACTION_LABEL[input.type]}" now.` };
  }
  const from = ctx.sheet.status;
  const hist = (to: SheetStatus, action: string, note: string | null): GradeHistoryDraft => ({
    entry_id: null, action, from_status: from, to_status: to, note,
    actor_id: ctx.actor.user_id, actor_name: `${ctx.actor.name} (${ctx.actor.role})`, created_at: ctx.now,
  });
  switch (input.type) {
    case "save":
      return { ok: true, sheet: { updated_at: ctx.now }, history: null };
    case "submit": {
      if (missing > 0) return { ok: false, error: `${missing} student${missing === 1 ? " has" : "s have"} no grade yet. Enter a score, a percent or a mark (INC) for everyone.` };
      const late = lateWarning(ctx);
      if (late) return { ok: false, error: late };
      return {
        ok: true,
        sheet: { status: "submitted", submitted_at: ctx.now, return_note: null, updated_at: ctx.now },
        history: hist("submitted", "submit", ctx.sheet.late_allowed ? "Late submission (allowed by the registrar)" : null),
      };
    }
    case "approve":
      return {
        ok: true,
        sheet: { status: "posted", posted_at: ctx.now, posted_by: ctx.actor.user_id, updated_at: ctx.now },
        history: hist("posted", "approve", null),
      };
    case "return": {
      const note = input.note?.trim();
      if (!note) return { ok: false, error: "Write a note for the teacher." };
      return { ok: true, sheet: { status: "returned", return_note: note, updated_at: ctx.now }, history: hist("returned", "return", note) };
    }
    case "allow_late":
      return { ok: true, sheet: { late_allowed: true, updated_at: ctx.now }, history: hist(from, "allow_late", "Late submission allowed") };
  }
}

// ---------- Change Grade Requests ----------

export function validateValue(v: EntryValue): string | null {
  if (v.mark) return null;
  if (v.percent == null) return "Enter a percent or a mark (INC, DRP, W).";
  if (!(v.percent >= 0 && v.percent <= 100)) return "A percent must be from 0 to 100.";
  if (Math.round(v.percent * 100) !== v.percent * 100) return "Use at most 2 decimals.";
  return null;
}

const sameValue = (a: EntryValue, b: EntryValue) =>
  (a.percent ?? null) === (b.percent ?? null) && (a.mark ?? null) === (b.mark ?? null) &&
  JSON.stringify(a.scores ?? {}) === JSON.stringify(b.scores ?? {});

export const describeValue = (v: EntryValue) =>
  v.mark ?? (v.percent != null ? `${v.percent}%` : v.scores ? "scores" : "blank");

export type ChangeRequestPlan =
  | { ok: true; request: Omit<ChangeGradeRequest, "id" | "school_id"> }
  | { ok: false; error: string };

export function planChangeRequest(
  ctx: {
    actor: GradeActor;
    sheet: Pick<GradeSheet, "id" | "status">;
    entry: { id: string; enrollment_id: string; value: EntryValue };
    teachesClass: boolean;
    pending: Pick<ChangeGradeRequest, "entry_id" | "status">[];
    now: string;
  },
  input: { new_value: EntryValue; reason: string },
): ChangeRequestPlan {
  if (ctx.actor.role !== "teacher" || !ctx.teachesClass) return { ok: false, error: "Only the teacher of this class can ask for a grade change." };
  if (ctx.sheet.status !== "posted") return { ok: false, error: "Only posted grades need a change request. Edit the draft instead." };
  if (ctx.pending.some((p) => p.entry_id === ctx.entry.id && p.status === "pending")) {
    return { ok: false, error: "There is already a pending change request for this grade." };
  }
  const reason = input.reason?.trim();
  if (!reason) return { ok: false, error: "Type the reason for the change." };
  if (!input.new_value.scores) {
    const bad = validateValue(input.new_value);
    if (bad) return { ok: false, error: bad };
  }
  if (sameValue(ctx.entry.value, input.new_value)) return { ok: false, error: "The new grade is the same as the posted one." };
  return {
    ok: true,
    request: {
      sheet_id: ctx.sheet.id,
      entry_id: ctx.entry.id,
      enrollment_id: ctx.entry.enrollment_id,
      old_value: ctx.entry.value,
      new_value: input.new_value,
      reason,
      status: "pending",
      requested_by: ctx.actor.user_id,
      requested_by_name: ctx.actor.name,
      requested_at: ctx.now,
      decided_by: null,
      decided_at: null,
      decision_note: null,
    },
  };
}

export type ChangeDecisionPlan =
  | {
      ok: true;
      request: Partial<ChangeGradeRequest>;
      /** Set when approved: the new value to save on the entry. */
      apply: EntryValue | null;
      history: GradeHistoryDraft;
    }
  | { ok: false; error: string };

/** Registrar approves or rejects a change request. Every decision is logged. */
export function planChangeDecision(
  ctx: { actor: GradeActor; request: ChangeGradeRequest; now: string },
  input: { approve: boolean; note?: string },
): ChangeDecisionPlan {
  if (ctx.actor.role !== "registrar") return { ok: false, error: "Only the registrar can decide on grade changes." };
  if (ctx.request.status !== "pending") return { ok: false, error: "This request was already decided." };
  const note = input.note?.trim() || null;
  if (!input.approve && !note) return { ok: false, error: "Write why the change is not approved." };
  const r = ctx.request;
  return {
    ok: true,
    request: { status: input.approve ? "approved" : "rejected", decided_by: ctx.actor.user_id, decided_at: ctx.now, decision_note: note },
    apply: input.approve ? r.new_value : null,
    history: {
      entry_id: r.entry_id,
      action: input.approve ? "change_grade" : "change_rejected",
      from_status: "posted",
      to_status: "posted",
      note: input.approve
        ? `Grade changed ${describeValue(r.old_value)} → ${describeValue(r.new_value)}. Reason: ${r.reason}${note ? ` | ${note}` : ""}`
        : `Change ${describeValue(r.old_value)} → ${describeValue(r.new_value)} not approved: ${note}`,
      actor_id: ctx.actor.user_id,
      actor_name: `${ctx.actor.name} (${ctx.actor.role})`,
      created_at: ctx.now,
    },
  };
}
