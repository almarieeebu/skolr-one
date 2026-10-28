"use client";

// Applicant follow-up requests and the registrar's replies (portal and student detail).

import type { ApplicantRequest } from "@/lib/applicant";
import { REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL } from "@/lib/applicant";
import { Pill, type Tone } from "./ui";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const REQ_TONE: Record<ApplicantRequest["status"], Tone> = {
  open: "ink",
  answered: "go",
  closed: "muted",
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
    <ul className="divide-y divide-line/70" data-testid="request-list">
      {[...requests].reverse().map((r) => (
        <li key={r.id} className="py-3 text-sm first:pt-0" data-testid={`request-${r.status}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{REQUEST_TYPE_LABEL[r.type]}</span>
            <Pill tone={REQ_TONE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Pill>
          </div>
          <p className="mt-1 whitespace-pre-wrap">{r.message}</p>
          <p className="mt-1 text-xs text-muted">{r.created_by_name ?? "Applicant"}, {fmtDateTime(r.created_at)}</p>
          {r.reply && (
            <div className="mt-2 border-l-2 border-go pl-3" data-testid="request-reply">
              <p className="text-xs font-semibold text-go">Reply from {r.replied_by_name ?? "the registrar"}{r.replied_at ? `, ${fmtDateTime(r.replied_at)}` : ""}</p>
              <p className="mt-0.5 whitespace-pre-wrap">{r.reply}</p>
            </div>
          )}
          {onClose && r.status !== "closed" && (
            <button type="button" disabled={busy} onClick={() => onClose(r)} className="mt-2 text-xs font-semibold text-muted underline hover:text-ink">
              Mark as done
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
