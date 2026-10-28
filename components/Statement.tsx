"use client";

// Statement of account. Hidden on screen; it is what prints when someone
// presses "Print statement" (the rest of the page is hidden in print).

import type { SessionInfo } from "@/lib/data/store";
import { fullName, termLabel } from "@/lib/data/store";
import type { EnrollmentDetail } from "@/lib/enrollment/types";
import { PAYMENT_MODE_LABEL, PLAN_INFO, peso } from "@/lib/fees";
import { DueChip, fmtDay, summaryOf } from "./fees-ui";

const cell = "border-b border-zinc-300 py-1";

export default function Statement({ detail, session }: { detail: EnrollmentDetail; session: SessionInfo }) {
  const { enrollment: e, student: s, term } = detail;
  const f = summaryOf(detail);
  const school = session.school;
  const today = fmtDay(new Date().toISOString());

  return (
    <section className="statement mx-auto max-w-[780px] bg-white p-8 text-[12px] text-black" data-testid="statement" aria-label="Statement of account">
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <p className="text-lg font-bold">{school.name}</p>
          <p className="text-zinc-600">School code {school.code}</p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold tracking-wide uppercase">Statement of account</p>
          <p className="text-zinc-600">As of {today}</p>
        </div>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-0.5">
        <div className="flex gap-2"><dt className="w-24 text-zinc-600">Student</dt><dd className="font-semibold">{fullName(s)}</dd></div>
        <div className="flex gap-2"><dt className="w-24 text-zinc-600">Student ID</dt><dd>{s.student_no ?? "—"}</dd></div>
        <div className="flex gap-2"><dt className="w-24 text-zinc-600">{e.track === "college" ? "Program" : "Grade"}</dt><dd>{e.track === "college" ? `${e.course ?? ""} · ${e.level}` : `${e.level}${e.strand ? ` · ${e.strand}` : ""}`}</dd></div>
        <div className="flex gap-2"><dt className="w-24 text-zinc-600">Term</dt><dd>{termLabel(term)}</dd></div>
        {e.track === "k12" && e.tuition_plan && (
          <div className="flex gap-2"><dt className="w-24 text-zinc-600">Plan</dt><dd>{PLAN_INFO[e.tuition_plan].label}</dd></div>
        )}
      </dl>

      <h2 className="mt-5 mb-1 font-semibold uppercase">Assessment</h2>
      <table className="w-full">
        <tbody>
          {f.previous > 0 && (
            <tr><td className={cell}>Previous balance (back account)</td><td className={`${cell} text-right tabular-nums`}>{peso(f.previous)}</td></tr>
          )}
          {f.lines.map((l) => (
            <tr key={l.code}><td className={cell}>{l.label}</td><td className={`${cell} text-right tabular-nums`}>{peso(l.amount)}</td></tr>
          ))}
          <tr className="font-semibold"><td className="py-1">Total</td><td className="py-1 text-right tabular-nums">{peso(f.assessed + f.previous + f.penalties)}</td></tr>
        </tbody>
      </table>

      <h2 className="mt-5 mb-1 font-semibold uppercase">Payments</h2>
      {detail.payments.length === 0 ? (
        <p className="text-zinc-600">No payments yet.</p>
      ) : (
        <table className="w-full">
          <thead className="text-left text-zinc-600"><tr><th className={cell}>Date</th><th className={cell}>OR no.</th><th className={cell}>Mode</th><th className={`${cell} text-right`}>Amount</th></tr></thead>
          <tbody>
            {detail.payments.map((p) => (
              <tr key={p.id} className={p.voided_at ? "text-zinc-500 line-through" : ""}>
                <td className={cell}>{fmtDay(p.paid_at)}</td>
                <td className={cell}>{p.or_no}{p.voided_at ? " (void)" : ""}</td>
                <td className={cell}>{PAYMENT_MODE_LABEL[p.mode]}{p.reference ? ` ${p.reference}` : ""}</td>
                <td className={`${cell} text-right tabular-nums`}>{peso(p.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td className="py-1" colSpan={3}>Total paid</td><td className="py-1 text-right tabular-nums">{peso(f.paid)}</td></tr>
          </tbody>
        </table>
      )}

      {f.installments.length > 0 && (
        <>
          <h2 className="mt-5 mb-1 font-semibold uppercase">Payment schedule</h2>
          <table className="w-full">
            <thead className="text-left text-zinc-600"><tr><th className={cell}>Due</th><th className={cell}>For</th><th className={`${cell} text-right`}>Amount</th><th className={`${cell} text-right`}>Paid</th><th className={`${cell} text-right`}>Status</th></tr></thead>
            <tbody>
              {f.installments.map((i) => (
                <tr key={i.key}>
                  <td className={cell}>{fmtDay(i.due_date)}</td>
                  <td className={cell}>{i.label}</td>
                  <td className={`${cell} text-right tabular-nums`}>{peso(i.amount)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{peso(i.paid)}</td>
                  <td className={`${cell} text-right`}><DueChip status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="mt-5 flex justify-end">
        <dl className="w-64 border-2 border-black p-2">
          <div className="flex justify-between"><dt>{f.credit > 0 ? "Credit" : "Balance due"}</dt><dd className="text-base font-bold tabular-nums" data-testid="statement-balance">{peso(f.credit > 0 ? f.credit : f.balance)}</dd></div>
          {f.nextDue && f.balance > 0 && (
            <div className="flex justify-between text-zinc-600"><dt>Next due</dt><dd>{f.nextDue.label}, {fmtDay(f.nextDue.due_date)}</dd></div>
          )}
        </dl>
      </div>
      <p className="mt-6 text-[10px] text-zinc-500">
        System-generated statement. Please bring this statement when paying at the cashier. Official receipts (OR) are the proof of payment.
      </p>
    </section>
  );
}
