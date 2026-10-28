"use client";

// Right column: only the buttons this role may press at this status.
// Failed checks show as warnings; a registrar can override with a typed reason.

import { useState } from "react";
import type { DataStore, SessionInfo } from "@/lib/data/store";
import type { EnrollmentDetail, Role, Status } from "@/lib/enrollment/types";
import {
  ACTION_LABEL,
  allowedActions,
  canUploadPapers,
  type ActionInput,
  type ActionType,
} from "@/lib/enrollment/actions";
import { checkPapers } from "@/lib/enrollment/checks";
import { peso, requiredDownpayment, totalPaid } from "@/lib/enrollment/fees";
import { Button, Field, Warnings, inputClass } from "./ui";

/** Friendly "what happens next" text when this role has nothing to press. */
function waitingText(role: Role, status: Status, useDean: boolean, deanDone: boolean): string {
  const next: Record<Status, string> = {
    applied: "Waiting for the registrar to check the papers.",
    papers_checked: "Waiting for the registrar to assign a student ID.",
    student_made: "Waiting for the student to pick subjects or a section.",
    load_set: "Waiting for the downpayment at the cashier.",
    assessed_paid:
      useDean && !deanDone ? "Waiting for the dean's approval." : "Waiting for the registrar's final approval.",
    officially_enrolled: "All done. This student is officially enrolled. 🎉",
    rejected: "This application was rejected.",
    withdrawn: "This enrollment was withdrawn.",
  };
  if (role === "teacher") return `View only. ${next[status]}`;
  return next[status];
}

type Pending = { input: ActionInput; warnings: string[]; canOverride: boolean; error: string };

export default function ActionBox({
  detail,
  session,
  store,
  onChanged,
  onPickLoad,
}: {
  detail: EnrollmentDetail;
  session: SessionInfo;
  store: DataStore;
  onChanged: (msg: string) => void;
  onPickLoad: () => void;
}) {
  const e = detail.enrollment;
  const role = session.actor.role;
  const settings = session.school.settings;
  const actions = allowedActions(role, e, settings);

  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [textFor, setTextFor] = useState<"needs_fix" | "reject" | "withdraw" | null>(null);
  const [text, setText] = useState("");

  const total = detail.feeLines.reduce((a, f) => a + f.amount, 0);
  const paid = totalPaid(detail.payments);
  const balance = Math.max(0, total - paid);
  const needDown = Math.max(0, requiredDownpayment(total, settings) - paid);
  const [amount, setAmount] = useState(String(needDown > 0 ? needDown : balance || ""));
  const [orNo, setOrNo] = useState("");

  const run = async (input: ActionInput, override?: string) => {
    setBusy(true);
    try {
      const r = await store.runAction(e.id, { ...input, override_reason: override });
      if (r.ok) {
        setPending(null);
        setOverrideReason("");
        setTextFor(null);
        setText("");
        setOrNo("");
        onChanged(override ? `${ACTION_LABEL[input.type]} (override saved).` : `${ACTION_LABEL[input.type]}: done.`);
      } else {
        setPending({ input, warnings: r.warnings, canOverride: r.canOverride, error: r.error });
      }
    } catch (err) {
      setPending({ input, warnings: [], canOverride: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  // Show missing papers up front so the registrar knows before pressing.
  const paperWarnings = e.status === "applied" && role === "registrar" ? checkPapers(e, detail.documents) : [];

  const btn = (type: ActionType, onClick: () => void, variant: "primary" | "secondary" | "danger" = "primary") => (
    <Button
      key={type}
      variant={variant}
      disabled={busy}
      onClick={onClick}
      data-testid={`action-${type}`}
      className="w-full"
    >
      {type === "set_load" ? (e.track === "k12" ? "Pick section" : "Pick subjects") : ACTION_LABEL[type]}
    </Button>
  );

  return (
    <aside className="space-y-4 rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-20" data-testid="action-box">
      <div>
        <h2 className="text-sm font-semibold">What you can do</h2>
        <p className="text-xs text-muted">
          As <span className="capitalize">{role}</span> · {session.actor.name}
        </p>
      </div>

      {total > 0 && (role === "cashier" || role === "registrar" || role === "student" || role === "parent") && (
        <dl className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-paper p-2">
            <dt className="text-[11px] text-muted">Balance</dt>
            <dd className="text-sm font-semibold tabular-nums">{peso(balance)}</dd>
          </div>
          <div className="rounded-lg bg-paper p-2">
            <dt className="text-[11px] text-muted">Downpayment due</dt>
            <dd className="text-sm font-semibold tabular-nums">{peso(needDown)}</dd>
          </div>
        </dl>
      )}

      <Warnings items={paperWarnings} />

      {actions.length === 0 && (
        <p className="rounded-lg bg-paper px-3 py-3 text-sm text-muted" data-testid="waiting-text">
          {waitingText(role, e.status, settings.use_dean_approval, e.dean_approved)}
          {canUploadPapers(role, e.status) && " You can still upload papers in the Papers section."}
        </p>
      )}

      <div className="space-y-2">
        {actions.map((type) => {
          switch (type) {
            case "accept_papers":
              return btn(type, () => run({ type }));
            case "assign_id":
              return btn(type, () => run({ type }));
            case "approve":
              return btn(type, () => run({ type }));
            case "dean_approve":
              return btn(type, () => run({ type }));
            case "set_load":
              return btn(type, onPickLoad, role === "registrar" ? "secondary" : "primary");
            case "needs_fix":
            case "reject":
            case "withdraw":
              return btn(
                type,
                () => {
                  setTextFor(textFor === type ? null : type);
                  setText("");
                },
                type === "needs_fix" ? "secondary" : "danger",
              );
            case "take_payment":
              return (
                <form
                  key={type}
                  className="space-y-2 rounded-lg border border-line p-3"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void run({ type, amount: Number(amount), or_no: orNo });
                  }}
                >
                  <p className="text-sm font-medium">Take payment</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Amount (₱)">
                      <input
                        data-testid="pay-amount"
                        className={inputClass}
                        inputMode="decimal"
                        value={amount}
                        onChange={(ev) => setAmount(ev.target.value)}
                      />
                    </Field>
                    <Field label="OR number">
                      <input
                        data-testid="pay-or"
                        className={inputClass}
                        value={orNo}
                        placeholder="e.g. 100245"
                        onChange={(ev) => setOrNo(ev.target.value)}
                      />
                    </Field>
                  </div>
                  <Button type="submit" disabled={busy} className="w-full" data-testid="action-take_payment">
                    Record payment
                  </Button>
                </form>
              );
          }
        })}
      </div>

      {textFor && (
        <form
          className="space-y-2 rounded-lg border border-line p-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (textFor === "needs_fix") void run({ type: "needs_fix", note: text });
            else void run({ type: textFor, reason: text });
          }}
        >
          <Field label={textFor === "needs_fix" ? "What needs fixing?" : "Reason"}>
            <textarea
              data-testid="reason-text"
              className={inputClass}
              rows={3}
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              placeholder={textFor === "needs_fix" ? "e.g. PSA copy is blurry, please re-upload." : "Type the reason…"}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !text.trim()} variant={textFor === "needs_fix" ? "primary" : "danger"} className="flex-1">
              Confirm {ACTION_LABEL[textFor].toLowerCase()}
            </Button>
            <Button variant="ghost" onClick={() => setTextFor(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {pending && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-danger">{pending.error}</p>
          <Warnings items={pending.warnings} />
          {pending.canOverride && (
            <form
              className="space-y-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                void run(pending.input, overrideReason);
              }}
            >
              <Field label="Override reason (saved in history)">
                <textarea
                  data-testid="override-reason"
                  className={inputClass}
                  rows={2}
                  value={overrideReason}
                  onChange={(ev) => setOverrideReason(ev.target.value)}
                  placeholder="e.g. TOR to follow, approved by VP"
                />
              </Field>
              <Button type="submit" variant="danger" disabled={busy || !overrideReason.trim()} className="w-full" data-testid="override-submit">
                Override with reason
              </Button>
            </form>
          )}
        </div>
      )}

      {e.overrides.length > 0 && (
        <div className="border-t border-line pt-3">
          <p className="mb-1 text-xs font-medium text-muted">Overrides on record</p>
          <ul className="space-y-1 text-xs">
            {e.overrides.map((o, i) => (
              <li key={i}>
                <span className="font-medium">{ACTION_LABEL[o.action as ActionType] ?? o.action}:</span> {o.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
