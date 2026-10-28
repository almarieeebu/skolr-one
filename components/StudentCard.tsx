"use client";

import { useRef, useState } from "react";
import type { DataStore, SessionInfo } from "@/lib/data/store";
import { fullName, termLabel } from "@/lib/data/store";
import type { DocType, EnrollmentDetail } from "@/lib/enrollment/types";
import { STATUS_LABEL, STEPS, isFinal, stepIndex } from "@/lib/enrollment/status";
import { DOC_LABEL, formatSchedule, requiredDocs, totalUnits } from "@/lib/enrollment/checks";
import { PLAN_INFO, feePermissions, peso } from "@/lib/fees";
import { canUploadPapers } from "@/lib/enrollment/actions";
import { Section, StatusBadge } from "./ui";
import FeesSection from "./FeesSection";
import GradesSection from "./GradesSection";
import { gradePermissions } from "@/lib/grades";
import { summaryOf } from "./fees-ui";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—";
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ProgressBar({ status }: { status: EnrollmentDetail["enrollment"]["status"] }) {
  const current = stepIndex(status);
  return (
    <div>
    <ol className="grid grid-cols-6 gap-1.5" aria-label="Enrollment progress">
      {STEPS.map((s, i) => {
        const done = current > i || status === "officially_enrolled";
        const here = current === i && status !== "officially_enrolled";
        return (
          <li key={s.status} className="min-w-0" aria-current={here ? "step" : undefined}>
            <div
              className={`h-1.5 rounded-full ${
                done ? "bg-brand" : here ? "bg-wait" : "bg-line"
              }`}
            />
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  done ? "bg-brand text-white" : here ? "bg-wait text-white" : "bg-paper text-muted"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`hidden truncate text-xs md:inline ${here ? "font-semibold text-ink" : "text-muted"}`}>
                {s.short}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
    {current >= 0 && (
      <p className="mt-2 text-xs text-muted" data-testid="step-caption">
        {status === "officially_enrolled"
          ? "All 6 steps done"
          : `Step ${current + 1} of 6: ${STEPS[current].label}`}
      </p>
    )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value ?? "—"}</dd>
    </div>
  );
}

export default function StudentCard({
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
  const { enrollment: e, student: s, term } = detail;
  const settings = session.school.settings;
  const picked = detail.offerings.filter((o) => detail.loads.some((l) => l.offering_id === o.id));
  const showFees = feePermissions(session.actor.role).view;
  const fees = summaryOf(detail);
  const isCollege = e.track === "college";

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface" data-testid="student-card">
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold" data-testid="student-name">{fullName(s)}</h2>
            <p className="mt-0.5 text-sm text-muted">
              {isCollege ? `${e.course ?? "—"} · ${e.level}` : `${e.level}${e.strand ? ` · ${e.strand}` : ""}`}
              {" · "}
              {termLabel(term)}
            </p>
          </div>
          <div className="sm:text-right">
            <span data-testid="card-status">
              <StatusBadge status={e.status} />
            </span>
            <p className="mt-1 font-mono text-sm" data-testid="student-no">
              {s.student_no ?? <span className="font-sans text-muted">No student ID yet</span>}
            </p>
          </div>
        </div>

        <ProgressBar status={e.status} />

        {isFinal(e.status) && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            This enrollment is <strong>{STATUS_LABEL[e.status].toLowerCase()}</strong>.
            {detail.history.at(-1)?.reason ? ` Reason: ${detail.history.at(-1)!.reason}` : ""}
          </p>
        )}
        {e.status === "applied" && e.fix_note && (
          <p className="rounded-lg bg-wait-soft px-3 py-2 text-sm text-wait">
            <strong>Needs fix:</strong> {e.fix_note}
          </p>
        )}
        {settings.use_dean_approval && e.status === "assessed_paid" && (
          <p className="text-xs text-muted">Dean approval: {e.dean_approved ? "done ✓" : "waiting"}</p>
        )}
      </div>

      <Section title="Profile" defaultOpen={false}>
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <Row label="Birth date" value={fmtDate(s.birth_date)} />
          <Row label="Sex" value={s.sex ?? "—"} />
          <Row label="Student type" value={<span className="capitalize">{e.student_type}</span>} />
          {isCollege ? (
            <Row label="Course" value={e.course} />
          ) : (
            <>
              <Row label="LRN" value={s.lrn ?? "—"} />
              {e.strand && <Row label="Strand" value={e.strand} />}
              <Row label="ESC / voucher" value={e.esc_voucher ? "Yes" : "No"} />
              <Row label="Mother tongue" value={e.mother_tongue ?? "—"} />
              <Row label="IP group" value={e.ip_group ?? "None"} />
              <Row label="4Ps beneficiary" value={e.is_4ps ? "Yes" : "No"} />
              <Row label="Tuition plan" value={e.tuition_plan ? PLAN_INFO[e.tuition_plan].label : "—"} />
            </>
          )}
        </dl>
      </Section>

      <Section
        title="Papers"
        aside={`${detail.documents.filter((d) => d.file_name).length}/${requiredDocs(e).length} in`}
        defaultOpen={e.status === "applied"}
      >
        <Papers detail={detail} session={session} store={store} onChanged={onChanged} />
      </Section>

      <Section
        title="Load"
        aside={isCollege ? `${totalUnits(picked)} units` : picked[0]?.title ?? "No section"}
        defaultOpen={stepIndex(e.status) >= 3}
      >
        {picked.length === 0 ? (
          <p className="text-sm text-muted">
            {isCollege ? "No subjects picked yet." : "No section picked yet."}
          </p>
        ) : isCollege ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm" data-testid="load-table">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-1 py-1.5 font-medium">Code</th>
                  <th className="px-1 py-1.5 font-medium">Subject</th>
                  <th className="px-1 py-1.5 text-right font-medium">Units</th>
                  <th className="px-1 py-1.5 font-medium">Schedule</th>
                  <th className="px-1 py-1.5 font-medium">Room</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {picked.map((o) => (
                  <tr key={o.id}>
                    <td className="px-1 py-2 font-mono text-xs">{o.code}</td>
                    <td className="px-1 py-2">{o.title}</td>
                    <td className="px-1 py-2 text-right">{o.units}</td>
                    <td className="px-1 py-2 whitespace-nowrap">{formatSchedule(o)}</td>
                    <td className="px-1 py-2">{o.room}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <dl>
            <Row label="Section" value={picked[0].title} />
            <Row label="Schedule" value={formatSchedule(picked[0])} />
            <Row label="Room" value={picked[0].room} />
          </dl>
        )}
      </Section>

      {showFees && (
        <Section
          title="Fees"
          aside={
            detail.ledger.length === 0
              ? "Not assessed"
              : fees.credit > 0
                ? `Credit ${peso(fees.credit)}`
                : `Balance ${peso(fees.balance)}`
          }
          defaultOpen={stepIndex(e.status) >= 3 || fees.previous > 0 || !!term.closed_at}
        >
          <FeesSection detail={detail} session={session} store={store} onChanged={onChanged} />
        </Section>
      )}

      {gradePermissions(session.actor.role).view && (e.status === "officially_enrolled" || e.status === "withdrawn") && (
        <Section title="Grades" aside={isCollege ? "Grade slip · GWA" : "Report card"} defaultOpen={e.status === "officially_enrolled"}>
          <GradesSection detail={detail} session={session} store={store} />
        </Section>
      )}

      <Section title="History" aside={`${detail.history.length} ${detail.history.length === 1 ? "entry" : "entries"}`} defaultOpen={false}>
        <ol className="space-y-3 border-l-2 border-line pl-4" data-testid="history">
          {[...detail.history].reverse().map((h) => (
            <li key={h.id} className="relative text-sm">
              <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand" />
              <p>
                <span className="font-medium">
                  {h.from_status ? `${STATUS_LABEL[h.from_status]} → ${STATUS_LABEL[h.to_status]}` : STATUS_LABEL[h.to_status]}
                </span>
                <span className="text-muted"> · {h.action.replace(/_/g, " ")}</span>
              </p>
              <p className="text-xs text-muted">
                {h.actor_name ?? "Someone"} · {fmtDateTime(h.created_at)}
              </p>
              {h.reason && <p className="mt-0.5 text-xs">“{h.reason}”</p>}
            </li>
          ))}
        </ol>
      </Section>
    </article>
  );
}

function Papers({
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
  const canUpload = canUploadPapers(session.actor.role, e.status);
  const types: DocType[] = [...new Set([...requiredDocs(e), ...detail.documents.map((d) => d.type)])];
  return (
    <ul className="divide-y divide-line">
      {types.map((t) => {
        const doc = detail.documents.find((d) => d.type === t);
        return (
          <li key={t} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              {DOC_LABEL[t]}
              <span className="block text-xs text-muted">
                {doc?.file_name ? doc.file_name : "Not uploaded"}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {doc?.file_name ? (
                doc.checked ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Checked ✓</span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Uploaded</span>
                )
              ) : (
                <span className="rounded-full bg-wait-soft px-2 py-0.5 text-xs text-wait">Missing</span>
              )}
              {canUpload && (
                <UploadButton
                  label={doc?.file_name ? "Replace" : "Upload"}
                  onFile={async (f) => {
                    await store.uploadDocument(e.id, t, f);
                    onChanged(`${DOC_LABEL[t]} uploaded.`);
                  }}
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function UploadButton({ label, onFile }: { label: string; onFile: (f: File) => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={async (ev) => {
          const f = ev.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            await onFile(f);
          } finally {
            setBusy(false);
            ev.target.value = "";
          }
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className="rounded-md border border-line px-2 py-1 text-xs font-medium hover:bg-paper"
      >
        {busy ? "Uploading…" : label}
      </button>
    </>
  );
}
