"use client";

// Small fee helpers shared by the Fees section, the action box and the statement.

import type { EnrollmentDetail } from "@/lib/enrollment/types";
import { feeSummary, manilaDate, type FeeSummary, type InstallmentStatus } from "@/lib/fees";

export function summaryOf(detail: EnrollmentDetail, now: Date = new Date()): FeeSummary {
  return feeSummary({
    track: detail.enrollment.track,
    plan: detail.enrollment.tuition_plan,
    setup: detail.feeSetup,
    ledger: detail.ledger,
    payments: detail.payments,
    today: manilaDate(now),
  });
}

export const fmtDay = (iso: string | null, empty = "Upon enrollment") =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso).toLocaleDateString("en-PH", {
        year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Manila",
      })
    : empty;

const STATUS_STYLE: Record<InstallmentStatus, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  carried: "bg-sky-100 text-sky-800",
  partial: "bg-amber-100 text-amber-800",
  due: "bg-wait-soft text-wait",
  overdue: "bg-danger-soft text-danger",
  upcoming: "bg-slate-100 text-slate-700",
};
const STATUS_TEXT: Record<InstallmentStatus, string> = {
  paid: "Paid",
  carried: "Carried",
  partial: "Partly paid",
  due: "Due",
  overdue: "Overdue",
  upcoming: "Upcoming",
};

export function DueChip({ status }: { status: InstallmentStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${STATUS_STYLE[status]} print:border print:border-current print:bg-transparent`}>
      {STATUS_TEXT[status]}
    </span>
  );
}
