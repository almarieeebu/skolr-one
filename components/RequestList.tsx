"use client";

// Applicant follow-up requests and the registrar's replies (portal and student card).

import type { ApplicantRequest } from "@/lib/applicant";
import { REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL } from "@/lib/applicant";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const REQ_STYLE: Record<ApplicantRequest["status"], string> = {
  open: "bg-wait-soft text-wait",
  answered: "bg-emerald-100 text-emerald-800",
  closed: "bg-zinc-200 text-zinc-700",
};

export default function RequestList({
  requests,
  onClose,
  busy,
}: {
  requests: ApplicantRequest[];
  onClose?: (r: ApplicantRequest) => void;
  busy?: boolean;
}) {
  if (!requests.length) return <p className="text-sm text-muted">No messages yet.</p>;
  return (
    <ul className="space-y-3" data-testid="request-list">
      {[...requests].reverse().map((r) => (
        <li key={r.id} className="rounded-xl border border-line p-3 text-sm" data-testid={`request-${r.status}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{REQUEST_TYPE_LABEL[r.type]}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REQ_STYLE[r.status]}`}>{REQUEST_STATUS_LABEL[r.status]}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap">{r.message}</p>
          <p className="mt-1 text-xs text-muted">{r.created_by_name ?? "Applicant"} · {fmtDateTime(r.created_at)}</p>
          {r.reply && (
            <div className="mt-2 rounded-lg bg-brand-soft p-2.5" data-testid="request-reply">
              <p className="text-xs font-semibold text-brand-dark">Reply from {r.replied_by_name ?? "the registrar"}{r.replied_at ? ` · ${fmtDateTime(r.replied_at)}` : ""}</p>
              <p className="mt-0.5 whitespace-pre-wrap">{r.reply}</p>
            </div>
          )}
          {onClose && r.status !== "closed" && (
            <button type="button" disabled={busy} onClick={() => onClose(r)} className="mt-2 text-xs font-medium text-muted underline hover:text-ink">
              Mark as done
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

