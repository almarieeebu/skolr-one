"use client";

// The action dock at the bottom of the detail pane: only the buttons this role
// can press now. Forms open in a side panel (take payment, discount, void,
// reply, pick load) or a modal (needs fix, reject, withdraw). Failed checks show
// inline here; a registrar can override with a typed reason.

import { useEffect, useState } from "react";
import type { DataStore, SessionInfo } from "@/lib/data/store";
import { fullName } from "@/lib/data/store";
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
import { REQUEST_TYPE_LABEL } from "@/lib/applicant";
import { Button, Field, Modal, SidePanel, Warnings, inputClass } from "./ui";
import { fmtDay, summaryOf } from "./fees-ui";
import LoadPicker from "./LoadPicker";
import DiscountForm from "./DiscountForm";

/** Friendly "what happens next" text when this role has nothing to press. */
function waitingText(role: Role, status: Status, useDean: boolean, deanDone: boolean): string {
  const next: Record<Status, string> = {
    applied: "Waiting for the registrar to check the papers.",
    papers_checked: "Waiting for the registrar to assign a student ID.",
    student_made: "Waiting for the student to pick subjects or a section.",
    load_set: "Waiting for the downpayment at the cashier.",
    assessed_paid:
      useDean && !deanDone ? "Waiting for the dean's approval." : "Waiting for the registrar's final approval.",
    officially_enrolled: "All done. This student is officially enrolled.",
    rejected: "This application was rejected.",
    withdrawn: "This enrollment was withdrawn.",
  };
  if (role === "teacher") return `View only. ${next[status]}`;
  return next[status];
}

const DONE_TEXT: Record<ActionType, string> = {
  accept_papers: "Papers accepted",
  needs_fix: "Sent back with a note",
  reject: "Application rejected",
  assign_id: "Student ID assigned",
  set_load: "Load saved",
  take_payment: "Payment saved",
  dean_approve: "Dean approval saved",
  approve: "Enrollment approved",
  withdraw: "Enrollment withdrawn",
};

type Pending = { input: ActionInput; warnings: string[]; canOverride: boolean; error: string };
type PanelKind = "pay" | "void" | "reply" | "load" | "discount" | null;

export default function ActionBox({
  detail,
  session,
  store,
  onChanged,
}: {
  detail: EnrollmentDetail;
  session: SessionInfo;
  store: DataStore;
  onChanged: (msg: string) => void;
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
  const [panel, setPanel] = useState<PanelKind>(null);

  const perms = feePermissions(role);
  const fees = summaryOf(detail);
  const assessed = detail.ledger.length > 0;
  const needDown = Math.max(0, fees.downpaymentRequired - fees.paid);
  const nextDue = fees.nextDue ? Math.max(0, fees.nextDue.amount - fees.nextDue.paid) : 0;

  // Void payment (cashier: today only; registrar: any day, as an override).
  const now = new Date().toISOString();
  const voidable = perms.voidPayment && !detail.term.closed_at
    ? detail.payments.filter((p) => canVoidPayment(role, p, now).ok)
    : [];

  const replyable = role === "registrar" ? (detail.requests ?? []).filter((r) => r.status !== "closed") : [];
  const openRequests = replyable.filter((r) => r.status === "open").length;
  const feeOpen = assessed && !detail.term.closed_at && !["rejected", "withdrawn"].includes(e.status);
  const canDiscount = perms.applyDiscount && fees.charges > 0 && feeOpen;
  const canVoid = voidable.length > 0 && feeOpen;

  const run = async (input: ActionInput, override?: string) => {
    setBusy(true);
    try {
      const r = await store.runAction(e.id, { ...input, override_reason: override });
      if (r.ok) {
        setPending(null);
        setOverrideReason("");
        setTextFor(null);
        setText("");
        setPanel(null);
        onChanged(override ? `${DONE_TEXT[input.type]} (override saved)` : DONE_TEXT[input.type]);
        return true;
      }
      setPending({ input, warnings: r.warnings, canOverride: r.canOverride, error: r.error });
      if (input.type !== "take_payment") setPanel(null);
      setTextFor(null);
    } catch (err) {
      setPending({ input, warnings: [], canOverride: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
    return false;
  };

  // Show missing papers up front so the registrar knows before pressing.
  const paperWarnings = e.status === "applied" && role === "registrar" ? checkPapers(e, detail.documents) : [];

  const loadLabel = e.track === "k12" ? "Pick section" : "Pick subjects";

  // Order: quiet / destructive first, the main button last (right).
  type Btn = { key: string; label: string; variant: "primary" | "secondary" | "danger" | "ghost"; onClick: () => void; testId: string };
  const buttons: Btn[] = [];
  const push = (b: Btn) => buttons.push(b);
  for (const type of actions) {
    switch (type) {
      case "reject":
      case "withdraw":
        push({ key: type, label: ACTION_LABEL[type], variant: "danger", testId: `action-${type}`, onClick: () => { setTextFor(type); setText(""); } });
        break;
      case "needs_fix":
        push({ key: type, label: "Needs fix", variant: "secondary", testId: `action-${type}`, onClick: () => { setTextFor(type); setText(""); } });
        break;
      case "set_load":
        push({ key: type, label: loadLabel, variant: role === "registrar" ? "secondary" : "primary", testId: "action-set_load", onClick: () => setPanel("load") });
        break;
      case "take_payment":
        push({ key: type, label: "Take payment", variant: "primary", testId: "action-take_payment", onClick: () => { setPending(null); setPanel("pay"); } });
        break;
      default:
        push({ key: type, label: ACTION_LABEL[type], variant: "primary", testId: `action-${type}`, onClick: () => void run({ type } as ActionInput) });
    }
  }
  if (canVoid) push({ key: "void", label: "Void payment", variant: "danger", testId: "action-void_payment", onClick: () => setPanel("void") });
  if (canDiscount) push({ key: "discount", label: "Apply discount", variant: "secondary", testId: "action-apply_discount", onClick: () => setPanel("discount") });
  if (replyable.length > 0) {
    push({
      key: "reply",
      label: openRequests > 0 ? `Reply to request` : "Reply",
      variant: e.status === "applied" || openRequests === 0 ? "secondary" : "primary",
      testId: "action-reply",
      onClick: () => setPanel("reply"),
    });
  }
  const rank = (b: Btn) => (b.variant === "danger" ? 0 : b.variant === "ghost" ? 1 : b.variant === "secondary" ? 2 : 3);
  buttons.sort((a, b) => rank(a) - rank(b));

  const summary = assessed && perms.view && (
    <dl className="flex shrink-0 gap-5" data-testid="fee-tiles">
      <div>
        <dt className="text-xs text-muted">{fees.credit > 0 ? "Credit" : "Balance"}</dt>
        <dd className="num text-base font-semibold" data-testid="box-balance">{peso(fees.credit > 0 ? fees.credit : fees.balance)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="truncate text-xs text-muted">{needDown > 0 ? "To enroll" : fees.nextDue ? `Next due, ${fees.nextDue.label}` : "Next due"}</dt>
        <dd className="num text-base font-semibold">{peso(needDown > 0 ? needDown : nextDue)}</dd>
      </div>
    </dl>
  );

  return (
    <div data-testid="action-box">
      {pending && panel !== "pay" && (
        <div className="mb-3 space-y-2 border-b border-line pb-3" data-testid="dock-problem">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-stop" role="alert">{pending.error}</p>
            <button type="button" className="text-xs font-medium text-muted hover:text-ink" onClick={() => setPending(null)}>Dismiss</button>
          </div>
          <Warnings items={pending.warnings} />
          {pending.canOverride && (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(ev) => {
                ev.preventDefault();
                void run(pending.input, overrideReason);
              }}
            >
              <div className="min-w-0 flex-1">
                <Field label="Override reason (saved in history)">
                  <input
                    data-testid="override-reason"
                    className={inputClass}
                    value={overrideReason}
                    onChange={(ev) => setOverrideReason(ev.target.value)}
                    placeholder="e.g. TOR to follow, approved by VP"
                  />
                </Field>
              </div>
              <Button type="submit" variant="danger" disabled={busy || !overrideReason.trim()} data-testid="override-submit">
                Override with reason
              </Button>
            </form>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="flex min-w-0 items-center gap-6">
          {summary}
          {paperWarnings.length > 0 ? (
            <p className="min-w-0 text-sm text-warn" data-testid="paper-warnings">{paperWarnings.join(" ")}</p>
          ) : actions.length === 0 ? (
            <p className="min-w-0 text-sm text-muted" data-testid="waiting-text">
              {waitingText(role, e.status, settings.use_dean_approval, e.dean_approved)}
              {canUploadPapers(role, e.status) && " You can still upload papers in the Papers tab."}
            </p>
          ) : null}
        </div>
        {buttons.length > 0 && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {buttons.map((b) => (
              <Button key={b.key} variant={b.variant} disabled={busy} onClick={b.onClick} data-testid={b.testId} className="max-md:flex-1">
                {b.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Short confirmations */}
      <Modal
        title={textFor === "needs_fix" ? "Send back with a note" : textFor === "reject" ? "Reject this application" : "Withdraw this enrollment"}
        open={!!textFor}
        onClose={() => setTextFor(null)}
        testId="reason-modal"
      >
        <form
          className="space-y-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (textFor === "needs_fix") void run({ type: "needs_fix", note: text });
            else if (textFor) void run({ type: textFor, reason: text });
          }}
        >
          <p className="text-sm text-muted">
            {textFor === "needs_fix"
              ? "The application goes back to the applicant with your note. They see it in the portal."
              : "This is saved in the history with your reason."}
          </p>
          <Field label={textFor === "needs_fix" ? "What needs fixing?" : "Reason"}>
            <textarea
              data-testid="reason-text"
              className={inputClass}
              rows={3}
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              placeholder={textFor === "needs_fix" ? "e.g. PSA copy is blurry, please re-upload." : "Type the reason"}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTextFor(null)}>Cancel</Button>
            <Button type="submit" disabled={busy || !text.trim()} variant={textFor === "needs_fix" ? "primary" : "danger"}>
              {textFor ? `Confirm ${ACTION_LABEL[textFor].toLowerCase()}` : "Confirm"}
            </Button>
          </div>
        </form>
      </Modal>

      <SidePanel title="Take payment" subtitle={fullName(detail.student)} open={panel === "pay"} onClose={() => setPanel(null)} testId="pay-panel">
        <PayForm detail={detail} store={store} busy={busy} pending={panel === "pay" ? pending : null} onSubmit={(input) => run(input)} />
      </SidePanel>

      <SidePanel title="Void payment" subtitle={fullName(detail.student)} open={panel === "void"} onClose={() => setPanel(null)} testId="void-panel">
        <VoidForm detail={detail} store={store} role={role} voidable={voidable} onDone={(m) => { setPanel(null); onChanged(m); }} />
      </SidePanel>

      <SidePanel title="Reply to the applicant" subtitle={fullName(detail.student)} open={panel === "reply"} onClose={() => setPanel(null)} testId="reply-panel">
        <ReplyForm detail={detail} store={store} onDone={(m) => { setPanel(null); onChanged(m); }} />
      </SidePanel>

      <SidePanel title={loadLabel} subtitle={fullName(detail.student)} open={panel === "load"} onClose={() => setPanel(null)} testId="load-panel">
        <LoadPicker detail={detail} session={session} store={store} onDone={() => { setPanel(null); onChanged("Load saved and fees assessed"); }} />
      </SidePanel>

      <SidePanel title="Apply discount or scholarship" subtitle={fullName(detail.student)} open={panel === "discount"} onClose={() => setPanel(null)} testId="discount-panel">
        <DiscountForm detail={detail} store={store} onDone={(m) => { setPanel(null); onChanged(m); }} />
      </SidePanel>
    </div>
  );
}

function PayForm({
  detail,
  store,
  busy,
  pending,
  onSubmit,
}: {
  detail: EnrollmentDetail;
  store: DataStore;
  busy: boolean;
  pending: Pending | null;
  onSubmit: (input: ActionInput) => Promise<boolean>;
}) {
  const fees = summaryOf(detail);
  const needDown = Math.max(0, fees.downpaymentRequired - fees.paid);
  const nextDue = fees.nextDue ? Math.max(0, fees.nextDue.amount - fees.nextDue.paid) : 0;
  const suggest = needDown > 0 ? needDown : nextDue || fees.balance;
  const [amount, setAmount] = useState(suggest ? suggest.toFixed(2) : "");
  const [orNo, setOrNo] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  // Fill in the next OR number of the school's series (the cashier may change it).
  useEffect(() => {
    let alive = true;
    void store.getOrSeries().then((s) => alive && setOrNo(formatOr(s)));
    return () => {
      alive = false;
    };
  }, [store, detail.enrollment.id, detail.payments.length]);

  const amt = Number(amount);
  const credit = amt > fees.balance ? amt - fees.balance : 0;
  return (
    <form
      className="space-y-4"
      data-testid="pay-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        void onSubmit({ type: "take_payment", amount: amt, or_no: orNo, mode, reference });
      }}
    >
      <dl className="grid grid-cols-3 gap-3 border-b border-line pb-4">
        <div>
          <dt className="text-xs text-muted">Balance</dt>
          <dd className="num text-base font-semibold">{peso(fees.balance)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{needDown > 0 ? "To enroll" : "Next due"}</dt>
          <dd className="num text-base font-semibold">{peso(needDown > 0 ? needDown : nextDue)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Paid so far</dt>
          <dd className="num text-base font-semibold">{peso(fees.paid)}</dd>
        </div>
      </dl>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₱)">
          <input data-testid="pay-amount" data-autofocus className={`${inputClass} num text-right text-base font-semibold`} inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} />
        </Field>
        <Field label="Mode">
          <select data-testid="pay-mode" className={inputClass} value={mode} onChange={(ev) => setMode(ev.target.value as PaymentMode)}>
            {(Object.keys(PAYMENT_MODE_LABEL) as PaymentMode[]).map((m) => (
              <option key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</option>
            ))}
          </select>
        </Field>
        <Field label="OR number" hint="Next in the series. You can change it.">
          <input data-testid="pay-or" className={`${inputClass} num`} value={orNo} onChange={(ev) => setOrNo(ev.target.value)} />
        </Field>
        {mode !== "cash" && (
          <Field label={mode === "gcash" ? "GCash reference" : mode === "check" ? "Check number" : "Bank reference"}>
            <input data-testid="pay-ref" className={`${inputClass} num`} value={reference} onChange={(ev) => setReference(ev.target.value)} />
          </Field>
        )}
      </div>
      {credit > 0 && <p className="text-sm text-go">{peso(credit)} is more than the balance and will be kept as credit.</p>}
      <p className="text-xs text-muted">Payments go to the oldest item first: back account, downpayment, then installments by due date.</p>
      {pending && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-stop" role="alert">{pending.error}</p>
          <Warnings items={pending.warnings} />
        </div>
      )}
      <Button type="submit" disabled={busy || !(amt > 0) || !orNo.trim()} className="w-full" data-testid="pay-submit">
        {busy ? "Saving" : `Save payment of ${amt > 0 ? peso(amt) : "₱0.00"}`}
      </Button>
    </form>
  );
}

function VoidForm({
  detail,
  store,
  role,
  voidable,
  onDone,
}: {
  detail: EnrollmentDetail;
  store: DataStore;
  role: Role;
  voidable: EnrollmentDetail["payments"];
  onDone: (msg: string) => void;
}) {
  const [voidId, setVoidId] = useState(voidable[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await store.runFeeAction(detail.enrollment.id, { type: "void_payment", payment_id: voidId, reason });
      if (r.ok) onDone("Payment voided. A reversing ledger row was posted.");
      else setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-4" onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
      <p className="text-sm text-muted">
        {role === "cashier"
          ? "Cashiers can void payments made today. The row stays in the ledger with a reversing row."
          : "As registrar you can void any payment. This is saved as an override with your reason."}
      </p>
      <Field label="Payment">
        <select data-testid="void-payment-select" className={inputClass} value={voidId} onChange={(ev) => setVoidId(ev.target.value)}>
          {voidable.map((p) => (
            <option key={p.id} value={p.id}>
              OR {p.or_no}, {peso(p.amount)}, {fmtDay(p.paid_at)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={role === "registrar" ? "Override reason" : "Reason"}>
        <textarea data-testid="void-reason" className={inputClass} rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Wrong amount keyed in" />
      </Field>
      {error && <p className="text-sm font-medium text-stop" role="alert">{error}</p>}
      <Button type="submit" variant="danger" className="w-full" disabled={busy || !reason.trim() || !voidId} data-testid="void-submit">
        Void this payment
      </Button>
    </form>
  );
}

function ReplyForm({ detail, store, onDone }: { detail: EnrollmentDetail; store: DataStore; onDone: (msg: string) => void }) {
  const replyable = (detail.requests ?? []).filter((r) => r.status !== "closed");
  const [reqId, setReqId] = useState(replyable.find((r) => r.status === "open")?.id ?? replyable[0]?.id ?? "");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = replyable.find((r) => r.id === reqId);
  const send = async (close: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await store.answerApplicantRequest(reqId, reply, close);
      if (r.ok) onDone(close ? "Reply sent and request closed" : "Reply sent to the applicant");
      else setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (!picked) return <p className="text-sm text-muted">No open requests.</p>;
  return (
    <form className="space-y-4" data-testid="reply-box" onSubmit={(ev) => { ev.preventDefault(); void send(false); }}>
      {replyable.length > 1 && (
        <Field label="Request">
          <select data-testid="reply-pick" className={inputClass} value={reqId} onChange={(ev) => setReqId(ev.target.value)}>
            {replyable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.status === "open" ? "Open: " : ""}{REQUEST_TYPE_LABEL[r.type]}, {r.message.slice(0, 40)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <blockquote className="border-l-2 border-line pl-3 text-sm">
        <span className="block text-xs font-medium text-muted">{REQUEST_TYPE_LABEL[picked.type]} from {picked.created_by_name ?? "the applicant"}</span>
        <span className="mt-0.5 block whitespace-pre-wrap">{picked.message}</span>
      </blockquote>
      <Field label="Your reply">
        <textarea data-testid="reply-text" className={inputClass} rows={5} value={reply} onChange={(ev) => setReply(ev.target.value)} placeholder="Type your reply to the applicant" />
      </Field>
      {error && <p className="text-sm text-stop" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy || !reply.trim()} onClick={() => void send(true)} data-testid="reply-close" className="flex-1">
          Reply and close
        </Button>
        <Button type="submit" disabled={busy || !reply.trim()} className="flex-1" data-testid="reply-send">
          Send reply
        </Button>
      </div>
    </form>
  );
}
