"use client";

// Right column: only the buttons this role may press at this status.
// Failed checks show as warnings; a registrar can override with a typed reason.

import { useEffect, useState } from "react";
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
import {
  PAYMENT_MODE_LABEL,
  canVoidPayment,
  feePermissions,
  formatOr,
  peso,
  type PaymentMode,
} from "@/lib/fees";
import { Button, Field, Warnings, inputClass } from "./ui";
import { fmtDay, summaryOf } from "./fees-ui";

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
  onApplyDiscount,
}: {
  detail: EnrollmentDetail;
  session: SessionInfo;
  store: DataStore;
  onChanged: (msg: string) => void;
  onPickLoad: () => void;
  onApplyDiscount: () => void;
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

  const perms = feePermissions(role);
  const fees = summaryOf(detail);
  const assessed = detail.ledger.length > 0;
  const needDown = Math.max(0, fees.downpaymentRequired - fees.paid);
  const nextDue = fees.nextDue ? Math.max(0, fees.nextDue.amount - fees.nextDue.paid) : 0;
  const suggest = needDown > 0 ? needDown : nextDue || fees.balance;
  const [amount, setAmount] = useState(suggest ? suggest.toFixed(2) : "");
  const [orNo, setOrNo] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  // Fill in the next OR number of the school's series (the cashier may change it).
  useEffect(() => {
    if (!actions.includes("take_payment")) return;
    let alive = true;
    void store.getOrSeries().then((s) => alive && setOrNo(formatOr(s)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, e.id, detail.payments.length]);

  // Void payment (cashier: today only; registrar: any day, as an override).
  const now = new Date().toISOString();
  const voidable = perms.voidPayment && !detail.term.closed_at
    ? detail.payments.filter((p) => canVoidPayment(role, p, now).ok)
    : [];
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidId, setVoidId] = useState(voidable[0]?.id ?? "");
  const [voidReason, setVoidReason] = useState("");
  const [feeError, setFeeError] = useState<string | null>(null);

  const voidPayment = async () => {
    setBusy(true);
    setFeeError(null);
    try {
      const r = await store.runFeeAction(e.id, { type: "void_payment", payment_id: voidId, reason: voidReason });
      if (r.ok) {
        setVoidOpen(false);
        setVoidReason("");
        onChanged("Payment voided. A reversing ledger row was posted.");
      } else setFeeError(r.error);
    } catch (err) {
      setFeeError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async (input: ActionInput, override?: string) => {
    setBusy(true);
    try {
      const r = await store.runAction(e.id, { ...input, override_reason: override });
      if (r.ok) {
        setPending(null);
        setOverrideReason("");
        setTextFor(null);
        setText("");
        setReference("");
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

      {assessed && perms.view && (
        <dl className="grid grid-cols-2 gap-2 text-center" data-testid="fee-tiles">
          <div className="rounded-lg bg-paper p-2">
            <dt className="text-[11px] text-muted">{fees.credit > 0 ? "Credit" : "Balance"}</dt>
            <dd className="text-sm font-semibold tabular-nums" data-testid="box-balance">{peso(fees.credit > 0 ? fees.credit : fees.balance)}</dd>
          </div>
          <div className="rounded-lg bg-paper p-2">
            <dt className="text-[11px] text-muted">{needDown > 0 ? "To enroll" : "Next due"}</dt>
            <dd className="text-sm font-semibold tabular-nums">{peso(needDown > 0 ? needDown : nextDue)}</dd>
            {needDown <= 0 && fees.nextDue && (
              <dd className="truncate text-[11px] text-muted">{fees.nextDue.label} · {fmtDay(fees.nextDue.due_date)}</dd>
            )}
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
            case "take_payment": {
              const amt = Number(amount);
              const credit = amt > fees.balance ? amt - fees.balance : 0;
              return (
                <form
                  key={type}
                  className="space-y-2 rounded-lg border border-line p-3"
                  data-testid="pay-form"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void run({ type, amount: amt, or_no: orNo, mode, reference });
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
                    <Field label="Mode">
                      <select data-testid="pay-mode" className={inputClass} value={mode} onChange={(ev) => setMode(ev.target.value as PaymentMode)}>
                        {(Object.keys(PAYMENT_MODE_LABEL) as PaymentMode[]).map((m) => (
                          <option key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</option>
                        ))}
                      </select>
                    </Field>
                    {mode !== "cash" && (
                      <Field label={mode === "gcash" ? "GCash ref no." : mode === "check" ? "Check no." : "Bank ref no."}>
                        <input data-testid="pay-ref" className={inputClass} value={reference} onChange={(ev) => setReference(ev.target.value)} />
                      </Field>
                    )}
                    <Field label="OR number" hint="Next in the series. You can change it.">
                      <input
                        data-testid="pay-or"
                        className={inputClass}
                        value={orNo}
                        onChange={(ev) => setOrNo(ev.target.value)}
                      />
                    </Field>
                  </div>
                  {credit > 0 && (
                    <p className="text-xs text-brand">{peso(credit)} is more than the balance and will be kept as credit.</p>
                  )}
                  <Button type="submit" disabled={busy} className="w-full" data-testid="action-take_payment">
                    Record payment
                  </Button>
                </form>
              );
            }
          }
        })}
      </div>

      {((perms.applyDiscount && fees.charges > 0) || voidable.length > 0) && assessed && !detail.term.closed_at && !["rejected", "withdrawn"].includes(e.status) && (
        <div className="space-y-2 border-t border-line pt-3" data-testid="fee-actions">
          <p className="text-xs font-medium text-muted">Fees</p>
          {perms.applyDiscount && fees.charges > 0 && (
            <Button variant="secondary" className="w-full" onClick={onApplyDiscount} data-testid="action-apply_discount">
              Apply discount / scholarship
            </Button>
          )}
          {voidable.length > 0 && (
            <Button variant="danger" className="w-full" onClick={() => { setVoidOpen(!voidOpen); setFeeError(null); }} data-testid="action-void_payment">
              Void payment
            </Button>
          )}
          {voidOpen && (
            <form
              className="space-y-2 rounded-lg border border-line p-3"
              onSubmit={(ev) => {
                ev.preventDefault();
                void voidPayment();
              }}
            >
              <Field label="Payment">
                <select data-testid="void-payment-select" className={inputClass} value={voidId} onChange={(ev) => setVoidId(ev.target.value)}>
                  {voidable.map((p) => (
                    <option key={p.id} value={p.id}>
                      OR #{p.or_no} · {peso(p.amount)} · {fmtDay(p.paid_at)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={role === "registrar" ? "Override reason (registrar)" : "Reason"}>
                <textarea data-testid="void-reason" className={inputClass} rows={2} value={voidReason} onChange={(ev) => setVoidReason(ev.target.value)} placeholder="e.g. Wrong amount keyed in" />
              </Field>
              <Button type="submit" variant="danger" className="w-full" disabled={busy || !voidReason.trim() || !voidId} data-testid="void-submit">
                Void this payment
              </Button>
            </form>
          )}
          {feeError && <p className="text-sm text-danger">{feeError}</p>}
        </div>
      )}

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
