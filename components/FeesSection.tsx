"use client";

// Fees inside the student card: totals, breakdown, schedule, discounts,
// payments and the full ledger. Read only, except "Remove" on a discount
// (registrar). Payments, discounts and voids start from the action box.

import { useState } from "react";
import type { DataStore, SessionInfo } from "@/lib/data/store";
import type { EnrollmentDetail } from "@/lib/enrollment/types";
import {
  PAYMENT_MODE_LABEL,
  PLAN_INFO,
  feePermissions,
  peso,
  withRunningBalance,
} from "@/lib/fees";
import { Button, inputClass } from "./ui";
import { DueChip, fmtDay, summaryOf } from "./fees-ui";

function Money({ v, className = "" }: { v: number; className?: string }) {
  return <span className={`shrink-0 tabular-nums whitespace-nowrap ${className}`}>{peso(v)}</span>;
}

function Tile({ label, value, tone = "", testId }: { label: string; value: string; tone?: string; testId?: string }) {
  return (
    <div className="min-w-0 border-l border-line pl-4 first:border-l-0 first:pl-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num truncate text-xl font-semibold ${tone}`} data-testid={testId}>{value}</dd>
    </div>
  );
}

const H3 = ({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) => (
  <div className="mb-1.5 flex items-baseline justify-between gap-2">
    <h3 className="text-sm font-semibold">{children}</h3>
    {aside && <span className="text-xs text-muted">{aside}</span>}
  </div>
);

export default function FeesSection({
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
  const role = session.actor.role;
  const perms = feePermissions(role);
  const f = summaryOf(detail);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const e = detail.enrollment;

  if (detail.ledger.length === 0) {
    return (
      <div className="max-w-md space-y-1 text-sm text-muted" data-testid="fees-section">
        <p>Fees are worked out once the load is set. The breakdown, payment schedule and payments show here.</p>
        {!detail.feeSetup && <p className="text-warn">No fee setup for this term yet.{perms.setup ? " Add one in Setup, Fee setup." : ""}</p>}
      </div>
    );
  }

  const charges = f.lines.filter((l) => l.kind === "charge");
  const discounts = f.lines.filter((l) => l.kind === "discount");
  const liveDiscounts = detail.discounts.filter((d) => !d.voided_at);

  const removeDiscount = async (id: string) => {
    setError(null);
    const r = await store.runFeeAction(e.id, { type: "remove_discount", discount_id: id, reason });
    if (r.ok) {
      setRemoving(null);
      setReason("");
      onChanged("Discount removed.");
    } else setError(r.error);
  };

  return (
    <div className="space-y-5 text-sm" data-testid="fees-section">
      {f.previous > 0 && (
        <div className="rounded-r-md border-l-2 border-warn bg-warn/8 px-3 py-2 text-warn" data-testid="back-account">
          <p className="font-semibold">Back account from an earlier term: <span className="num">{peso(f.previous)}</span></p>
          <p className="text-xs">Payments go to the back account first, then to this term.</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-y-3 border-b border-line pb-4 sm:grid-cols-4">
        <Tile label="This term" value={peso(f.assessed)} />
        <Tile label="Discounts" value={peso(f.discounts)} tone={f.discounts ? "text-go" : ""} />
        <Tile label="Paid" value={peso(f.paid)} />
        {f.credit > 0 ? (
          <Tile label="Credit" value={peso(f.credit)} tone="text-go" testId="fee-balance" />
        ) : (
          <Tile label="Balance" value={peso(f.balance)} tone={f.balance > 0 ? "text-ink" : "text-go"} testId="fee-balance" />
        )}
      </dl>
      {f.carriedOut > 0 && (
        <p className="rounded-r-md border-l-2 border-line bg-paper px-3 py-2 text-xs text-muted">
          This term is closed. {peso(f.carriedOut)} was carried to the student&apos;s next enrollment.
        </p>
      )}

      <div className="grid gap-x-10 gap-y-6 xl:grid-cols-2">
        <div className="space-y-6">
      <div>
        <H3 aside={detail.feeSetup && e.track === "k12" && e.tuition_plan ? PLAN_INFO[e.tuition_plan].label : undefined}>Breakdown</H3>
        <ul className="divide-y divide-line/70" data-testid="fee-breakdown">
          {f.previous > 0 && (
            <li className="flex justify-between gap-4 py-1.5 font-medium">
              <span>Previous balance</span>
              <Money v={f.previous} />
            </li>
          )}
          {charges.map((l) => (
            <li key={l.code} className="flex justify-between gap-4 py-1.5">
              <span className="min-w-0">{l.label}</span>
              <Money v={l.amount} />
            </li>
          ))}
          {discounts.map((l) => (
            <li key={l.code} className="flex justify-between gap-4 py-1.5 text-go">
              <span className="min-w-0">{l.label}</span>
              <Money v={l.amount} />
            </li>
          ))}
          <li className="flex justify-between gap-4 border-t border-line py-2 font-semibold">
            <span>Total {f.previous > 0 ? "(with back account)" : "assessment"}</span>
            <Money v={f.assessed + f.previous + f.penalties} />
          </li>
        </ul>
      </div>

      {liveDiscounts.length > 0 && (
        <div>
          <H3>Discounts and scholarships</H3>
          <ul className="divide-y divide-line/70" data-testid="discount-list">
            {liveDiscounts.map((d) => {
              const line = discounts.find((l) => l.code === `disc:${d.id}`);
              return (
                <li key={d.id} className="py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{d.name}</p>
                      <p className="text-xs text-muted">
                        {line?.label.replace(`${d.name} (`, "").replace(/\)$/, "") ?? "no matching fee"}. “{d.reason}” {d.applied_by_name ?? "Registrar"}, {fmtDay(d.applied_at)}
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      <Money v={line?.amount ?? 0} className="text-go" />
                      {perms.applyDiscount && !detail.term.closed_at && (
                        <button
                          type="button"
                          className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-muted hover:text-stop"
                          onClick={() => { setRemoving(removing === d.id ? null : d.id); setReason(""); setError(null); }}
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  </div>
                  {removing === d.id && (
                    <form className="mt-2 flex flex-wrap gap-2" onSubmit={(ev) => { ev.preventDefault(); void removeDiscount(d.id); }}>
                      <input className={`${inputClass} min-w-0 flex-1`} placeholder="Reason for removing" value={reason} onChange={(ev) => setReason(ev.target.value)} />
                      <Button type="submit" variant="danger" disabled={!reason.trim()} className="min-h-9">Remove</Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
      )}

        </div>
        <div className="space-y-6">
      {f.installments.length > 0 && (
        <div>
          <H3>Payment schedule</H3>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-sm" data-testid="schedule-table">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-1 py-1.5 font-medium">Due</th>
                  <th className="px-1 py-1.5 font-medium">For</th>
                  <th className="px-1 py-1.5 text-right font-medium">Amount</th>
                  <th className="hidden px-1 py-1.5 text-right font-medium sm:table-cell">Paid</th>
                  <th className="px-1 py-1.5 text-right font-medium"><span className="sr-only sm:not-sr-only">Status</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {f.installments.map((i) => (
                  <tr key={i.key}>
                    <td className="px-1 py-2 text-muted sm:whitespace-nowrap">{fmtDay(i.due_date)}</td>
                    <td className="px-1 py-2">{i.label}</td>
                    <td className="px-1 py-2 text-right"><Money v={i.amount} /></td>
                    <td className="hidden px-1 py-2 text-right sm:table-cell"><Money v={i.paid} className="text-muted" /></td>
                    <td className="px-1 py-2 text-right"><DueChip status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted">
            Minimum to be officially enrolled: <span className="num">{peso(f.downpaymentRequired)}</span>
            {f.previous > 0 ? " (back account + downpayment)" : " (downpayment)"}
            {f.downpaymentMet ? ", reached" : ""}
          </p>
        </div>
      )}

      {detail.payments.length > 0 && (
        <div>
          <H3>Payments</H3>
          <ul className="divide-y divide-line/70" data-testid="payment-list">
            {detail.payments.map((p) => (
              <li key={p.id} className={`py-2 ${p.voided_at ? "text-muted" : ""}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-medium">OR #{p.or_no}</span>
                    <span className="ml-3 text-muted">{fmtDay(p.paid_at)}</span>
                    <span className="ml-3 text-muted">{PAYMENT_MODE_LABEL[p.mode]}{p.reference ? ` ${p.reference}` : ""}</span>
                    {p.voided_at && <span className="pill pill-stop ml-2">Void</span>}
                  </span>
                  <Money v={p.amount} className={p.voided_at ? "line-through" : ""} />
                </div>
                {p.voided_at ? (
                  <p className="text-xs">Voided: {p.void_reason}</p>
                ) : (
                  f.allocations[p.id] && (
                    <p className="text-xs text-muted">
                      Applied to: {f.allocations[p.id].map((a) => `${a.label} ${peso(a.amount)}`).join(", ")}
                    </p>
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-4">
      <details className="group min-w-0 flex-1">
        <summary className="cursor-pointer text-sm font-semibold">
          Ledger <span className="font-normal text-muted">{detail.ledger.length} {detail.ledger.length === 1 ? "row" : "rows"}, never edited</span>
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs" data-testid="ledger-table">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Entry</th>
                <th className="py-1 pr-2 text-right font-medium">Debit</th>
                <th className="py-1 pr-2 text-right font-medium">Credit</th>
                <th className="py-1 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {withRunningBalance(detail.ledger).map((r) => (
                <tr key={r.id} className={r.kind === "void" ? "text-danger" : ""}>
                  <td className="py-1.5 pr-2 whitespace-nowrap text-muted">{fmtDay(r.posted_at)}</td>
                  <td className="py-1.5 pr-2">
                    {r.description}
                    {r.reason && r.kind !== "charge" && <span className="block text-muted">{r.reason}</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.debit ? peso(r.debit) : ""}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.credit ? peso(r.credit) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{peso(r.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <Button variant="secondary" size="sm" onClick={() => { document.body.dataset.print = "statement"; window.print(); }} data-testid="print-statement">
        Print statement of account
      </Button>
      </div>
    </div>
  );
}
