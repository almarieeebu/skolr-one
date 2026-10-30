"use client";

// The detail of one enrollment: header (name, ID, status, one-line tracker),
// horizontal sub-tabs and the tab content. The action dock (ActionBox.tsx)
// sits at the bottom of the pane.

import { useRef, useState, type ReactNode } from "react";
import type { DataStore, SessionInfo } from "@/lib/data/store";
import { fullName, termLabel } from "@/lib/data/store";
import type { DocType, EnrollmentDetail, Role, Status } from "@/lib/enrollment/types";
import { STATUS_LABEL, STEPS, isFinal, stepIndex } from "@/lib/enrollment/status";
import { DOC_LABEL, formatSchedule, requiredDocs, totalUnits } from "@/lib/enrollment/checks";
import { ACTION_LABEL, canUploadPapers, type ActionType } from "@/lib/enrollment/actions";
import { PLAN_INFO, feePermissions, peso } from "@/lib/fees";
import { gradePermissions } from "@/lib/grades";
import { Note, Pill, StatusBadge, SubTabs, type TabDef } from "./ui";
import FeesSection from "./FeesSection";
import GradesSection from "./GradesSection";
import { summaryOf } from "./fees-ui";
import RequestList from "./RequestList";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "None";
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ---------- step tracker ----------

/** The 6 steps on one compact line. */
export function StepTracker({ status, className = "" }: { status: Status; className?: string }) {
  const current = stepIndex(status);
  const allDone = status === "officially_enrolled";
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <ol className="flex min-w-0 items-center gap-1" aria-label="Enrollment progress">
        {STEPS.map((s, i) => {
          const done = current > i || allDone;
          const here = current === i && !allDone;
          return (
            <li key={s.status} className="flex min-w-0 items-center gap-1" aria-current={here ? "step" : undefined}>
              {i > 0 && <span aria-hidden className={`h-px w-2.5 shrink-0 md:w-4 ${done || here ? "bg-ink/50" : "bg-line"}`} />}
              <span
                aria-hidden
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  done ? "bg-go text-white" : here ? "bg-ink text-sheet" : "border border-line text-muted"
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2l2.2 2.2 4.8-4.8" /></svg>
                ) : (
                  <span className="sr-only">{i + 1}</span>
                )}
              </span>
              <span className={`truncate text-xs ${here ? "font-semibold text-ink" : done ? "text-ink" : "text-muted"} ${here ? "" : "hidden lg:inline"}`}>
                {s.short}
                <span className="sr-only">{done ? " (done)" : here ? " (now)" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {current >= 0 && (
        <p className="hidden shrink-0 text-xs text-muted xl:block" data-testid="step-caption">
          {allDone ? "All 6 steps done" : `Step ${current + 1} of 6`}
        </p>
      )}
    </div>
  );
}

/** Older name, used by the applicant portal. */
export const ProgressBar = StepTracker;

// ---------- tabs ----------

export type DetailTab = "profile" | "papers" | "load" | "fees" | "grades" | "requests" | "history";

export const TAB_LABEL: Record<DetailTab, string> = {
  profile: "Profile",
  papers: "Papers",
  load: "Load",
  fees: "Fees",
  grades: "Grades",
  requests: "Requests",
  history: "History",
};

/** The sub-tabs that make sense for this enrollment and role. */
export function relevantTabs(detail: EnrollmentDetail, role: Role): DetailTab[] {
  const e = detail.enrollment;
  const step = stepIndex(e.status);
  const tabs: DetailTab[] = ["profile", "papers"];
  if (step >= 2 || detail.loads.length > 0) tabs.push("load");
  if (feePermissions(role).view && (step >= 2 || detail.ledger.length > 0)) tabs.push("fees");
  if (gradePermissions(role).view && (e.status === "officially_enrolled" || e.status === "withdrawn")) tabs.push("grades");
  if ((detail.requests?.length ?? 0) > 0) tabs.push("requests");
  tabs.push("history");
  return tabs;
}

/** A sensible first tab for the enrollment's status. */
export function defaultTab(detail: EnrollmentDetail, tabs: DetailTab[], prefer?: DetailTab[]): DetailTab {
  for (const p of prefer ?? []) if (tabs.includes(p)) return p;
  const s = detail.enrollment.status;
  const pick: Record<Status, DetailTab[]> = {
    applied: ["papers"],
    papers_checked: ["papers"],
    student_made: ["load"],
    load_set: ["load", "fees"],
    assessed_paid: ["fees"],
    officially_enrolled: ["grades", "load"],
    rejected: ["history"],
    withdrawn: ["history"],
  };
  return pick[s].find((t) => tabs.includes(t)) ?? tabs[0];
}

export function tabDefs(detail: EnrollmentDetail, tabs: DetailTab[], role: Role): TabDef[] {
  const e = detail.enrollment;
  const reqOpen = (detail.requests ?? []).filter((r) => r.status === "open").length;
  const docs = requiredDocs(e);
  const docsIn = detail.documents.filter((d) => d.file_name && docs.includes(d.type)).length;
  const picked = detail.offerings.filter((o) => detail.loads.some((l) => l.offering_id === o.id));
  return tabs.map((t) => ({
    id: t,
    label: TAB_LABEL[t],
    badge:
      t === "papers" && docs.length > 0 ? `${docsIn}/${docs.length}`
      : t === "requests" && reqOpen > 0 ? reqOpen
      : t === "load" && e.track === "college" && picked.length > 0 ? `${totalUnits(picked)} u`
      : t === "fees" && detail.ledger.length > 0 && feePermissions(role).view ? undefined
      : undefined,
  }));
}

// ---------- header ----------

export function StudentHeader({ detail, session, aside }: { detail: EnrollmentDetail; session: SessionInfo; aside?: ReactNode }) {
  const { enrollment: e, student: s, term } = detail;
  const isCollege = e.track === "college";
  const settings = session.school.settings;
  return (
    <div className="space-y-2" data-testid="student-card">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="truncate text-xl font-semibold" data-testid="student-name">{fullName(s)}</h2>
            <span data-testid="card-status">
              <StatusBadge status={e.status} />
            </span>
            {e.status === "applied" && e.fix_note && <Pill tone="warn">Needs fix</Pill>}
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted">
            <span className="num font-medium text-ink" data-testid="student-no">
              {s.student_no ?? <span className="font-normal text-muted">No student ID yet</span>}
            </span>
            <span>{isCollege ? `${e.course ?? ""} ${e.level}` : `${e.level}${e.strand ? ` ${e.strand}` : ""}`}</span>
            <span>{termLabel(term)}</span>
            <span>{isCollege ? "College" : "K to 12"}</span>
          </p>
        </div>
        {aside}
      </div>
      <StepTracker status={e.status} />
      {isFinal(e.status) && (
        <Note tone="stop">
          This enrollment is {STATUS_LABEL[e.status].toLowerCase()}.
          {detail.history.at(-1)?.reason ? ` Reason: ${detail.history.at(-1)!.reason}` : ""}
        </Note>
      )}
      {e.status === "applied" && e.fix_note && (
        <Note tone="warn">
          <strong className="font-semibold">Needs fix:</strong> {e.fix_note}
        </Note>
      )}
      {settings.use_dean_approval && e.status === "assessed_paid" && (
        <p className="text-xs text-muted">Dean approval: {e.dean_approved ? "done" : "waiting"}</p>
      )}
    </div>
  );
}

// ---------- the whole detail (header + tabs + body) ----------

export function StudentTabs({
  detail,
  tabs,
  tab,
  onTab,
  role,
}: {
  detail: EnrollmentDetail;
  tabs: DetailTab[];
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  role: Role;
}) {
  if (tabs.length < 2) return null;
  return <SubTabs tabs={tabDefs(detail, tabs, role)} value={tab} onChange={(t) => onTab(t as DetailTab)} idBase="detail" label="Student sections" />;
}

export function StudentTabBody({
  tab,
  detail,
  session,
  store,
  onChanged,
}: {
  tab: DetailTab;
  detail: EnrollmentDetail;
  session: SessionInfo;
  store: DataStore;
  onChanged: (msg: string) => void;
}) {
  const role = session.actor.role;
  switch (tab) {
    case "profile":
      return <Profile detail={detail} />;
    case "papers":
      return <Papers detail={detail} session={session} store={store} onChanged={onChanged} />;
    case "load":
      return <Load detail={detail} />;
    case "fees":
      return feePermissions(role).view ? (
        <FeesSection detail={detail} session={session} store={store} onChanged={onChanged} />
      ) : null;
    case "grades":
      return gradePermissions(role).view && (detail.enrollment.status === "officially_enrolled" || detail.enrollment.status === "withdrawn") ? (
        <GradesSection detail={detail} session={session} store={store} />
      ) : (
        <Empty>Grades show here once the enrollment is official and the registrar posts them.</Empty>
      );
    case "requests":
      return (
        <div className="max-w-3xl" data-testid="card-requests">
          <RequestList requests={detail.requests ?? []} />
          {(detail.requests?.length ?? 0) === 0 && null}
        </div>
      );
    case "history":
      return <History detail={detail} />;
  }
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="max-w-md text-sm text-muted">{children}</p>;
}

function Row({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 border-b border-line/70 py-2 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{value ?? "None"}</dd>
    </div>
  );
}

function Profile({ detail }: { detail: EnrollmentDetail }) {
  const { enrollment: e, student: s } = detail;
  const isCollege = e.track === "college";
  return (
    <div className="max-w-5xl space-y-5">
      <dl className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
        <Row label="Birth date" value={fmtDate(s.birth_date)} />
        <Row label="Sex" value={s.sex === "M" ? "Male" : s.sex === "F" ? "Female" : "Not given"} />
        <Row label="Student type" value={<span className="capitalize">{e.student_type}</span>} />
        {s.applicant_no && <Row label="Applicant number" value={<span className="num">{s.applicant_no}</span>} />}
        {s.civil_status && <Row label="Civil status" value={s.civil_status} />}
        {s.citizenship && <Row label="Citizenship" value={s.citizenship} />}
        {s.contact_no && <Row label="Contact number" value={<span className="num">{s.contact_no}</span>} />}
        {s.email && <Row label="Email" value={<span className="break-all">{s.email}</span>} />}
        {s.address && <Row label="Address" value={s.address} wide />}
        {s.guardian_name && <Row label="Guardian" value={<>{s.guardian_name}{s.guardian_contact && <span className="num ml-2 font-normal text-muted">{s.guardian_contact}</span>}</>} />}
        {isCollege ? (
          <Row label="Course" value={e.course} />
        ) : (
          <>
            <Row label="LRN" value={<span className="num">{s.lrn ?? "None"}</span>} />
            {e.strand && <Row label="Strand" value={e.strand} />}
            <Row label="ESC / voucher" value={e.esc_voucher ? "Yes" : "No"} />
            <Row label="Mother tongue" value={e.mother_tongue ?? "None"} />
            <Row label="IP group" value={e.ip_group ?? "None"} />
            <Row label="4Ps beneficiary" value={e.is_4ps ? "Yes" : "No"} />
            <Row label="Tuition plan" value={e.tuition_plan ? PLAN_INFO[e.tuition_plan].label : "None"} />
          </>
        )}
      </dl>
      {e.application && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted" data-testid="online-application">
          <p>
            Sent online and certified true and correct by <span className="font-medium text-ink">{e.application.signed_name}</span> on{" "}
            {fmtDate(e.application.signed_at)}.
          </p>
          {e.application.signature && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.application.signature} alt="Drawn signature" className="h-12 rounded-md border border-line bg-white" />
          )}
        </div>
      )}
    </div>
  );
}

function Load({ detail }: { detail: EnrollmentDetail }) {
  const e = detail.enrollment;
  const isCollege = e.track === "college";
  const picked = detail.offerings.filter((o) => detail.loads.some((l) => l.offering_id === o.id));
  if (picked.length === 0) {
    return <Empty>{isCollege ? "No subjects picked yet. Press Pick subjects below to choose them." : "No section picked yet. Press Pick section below to choose one."}</Empty>;
  }
  if (!isCollege) {
    return (
      <dl className="grid max-w-3xl gap-x-8 sm:grid-cols-3" data-testid="load-table">
        <Row label="Section" value={picked[0].title} />
        <Row label="Schedule" value={formatSchedule(picked[0])} />
        <Row label="Room" value={picked[0].room} />
      </dl>
    );
  }
  return (
    <div className="max-w-5xl overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm" data-testid="load-table">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">Code</th>
            <th className="py-2 pr-3 font-medium">Subject</th>
            <th className="py-2 pr-3 text-right font-medium">Units</th>
            <th className="py-2 pr-3 font-medium">Schedule</th>
            <th className="py-2 font-medium">Room</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {picked.map((o) => (
            <tr key={o.id}>
              <td className="num py-2 pr-3 font-medium">{o.code}</td>
              <td className="py-2 pr-3">{o.title}{o.is_major && <span className="ml-2 text-xs text-muted">Major</span>}</td>
              <td className="num py-2 pr-3 text-right">{o.units}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{formatSchedule(o)}</td>
              <td className="py-2">{o.room}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold">
            <td className="py-2 pr-3" colSpan={2}>{picked.length} subjects</td>
            <td className="num py-2 pr-3 text-right">{totalUnits(picked)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function History({ detail }: { detail: EnrollmentDetail }) {
  const e = detail.enrollment;
  return (
    <div className="grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <ol className="space-y-0" data-testid="history">
        {[...detail.history].reverse().map((h) => (
          <li key={h.id} className="relative border-l border-line pb-4 pl-5 text-sm last:pb-0">
            <span aria-hidden className="absolute top-1.5 -left-[4.5px] h-2 w-2 rounded-full bg-ink" />
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-semibold">
                {h.from_status ? `${STATUS_LABEL[h.from_status]} → ${STATUS_LABEL[h.to_status]}` : STATUS_LABEL[h.to_status]}
              </span>
              <span className="text-xs text-muted first-letter:uppercase">{h.action.replace(/_/g, " ")}</span>
            </p>
            <p className="text-xs text-muted">
              {h.actor_name ?? "Someone"}, {fmtDateTime(h.created_at)}
            </p>
            {h.reason && <p className="mt-0.5 text-sm">“{h.reason}”</p>}
          </li>
        ))}
      </ol>
      {e.overrides.length > 0 && (
        <div className="text-sm lg:border-l lg:border-line lg:pl-6" data-testid="overrides">
          <h3 className="mb-2 font-semibold">Overrides on record</h3>
          <ul className="space-y-2">
            {e.overrides.map((o, i) => (
              <li key={i}>
                <span className="font-medium">{ACTION_LABEL[o.action as ActionType] ?? o.action}</span>
                <span className="block text-muted">{o.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
  const required = requiredDocs(e);
  const types: DocType[] = [...new Set([...required, ...detail.documents.map((d) => d.type)])];
  return (
    <div className="max-w-3xl">
      <ul className="divide-y divide-line/70" data-testid="papers">
        {types.map((t) => {
          const doc = detail.documents.find((d) => d.type === t);
          return (
            <li key={t} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{DOC_LABEL[t]}</span>
                {!required.includes(t) && <span className="ml-2 text-xs text-muted">Optional</span>}
                <span className="block truncate text-xs text-muted">{doc?.file_name ? doc.file_name : "Not uploaded"}</span>
              </span>
              <span className="flex items-center gap-2">
                {doc?.file_name ? (
                  doc.checked ? <Pill tone="go">Checked</Pill> : <Pill tone="ink">Uploaded</Pill>
                ) : (
                  <Pill tone="warn">Missing</Pill>
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
      {canUpload && <p className="mt-3 text-xs text-muted">Photos and PDFs are fine. Papers lock once the registrar accepts them.</p>}
    </div>
  );
}

export function UploadButton({ label, onFile, testId }: { label: string; onFile: (f: File) => Promise<void>; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        data-testid={testId}
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
        className="min-h-8 rounded-md border border-line px-2.5 text-xs font-semibold hover:bg-hover"
      >
        {busy ? "Uploading" : label}
      </button>
    </>
  );
}

/** A narrow column of the facts a desk worker checks most, next to the tab content. */
export function KeyFacts({ detail }: { detail: EnrollmentDetail }) {
  const { enrollment: e, student: s } = detail;
  const applied = detail.history[0]?.created_at ?? null;
  const rows: [string, ReactNode][] = [
    ["Student type", <span key="t" className="capitalize">{e.student_type}</span>],
    ["Applied", applied ? fmtDate(applied) : "Not recorded"],
    ["Sent", e.application ? "Online form, signed" : "At the registrar"],
  ];
  if (s.contact_no) rows.push(["Contact number", <span key="c" className="num">{s.contact_no}</span>]);
  if (s.email) rows.push(["Email", <span key="e" className="break-all">{s.email}</span>]);
  if (s.guardian_name) rows.push(["Guardian", <>{s.guardian_name}{s.guardian_contact && <span className="num block font-normal text-muted">{s.guardian_contact}</span>}</>]);
  if (e.track === "k12") rows.push(["LRN", <span key="l" className="num">{s.lrn ?? "None"}</span>]);
  if (s.address) rows.push(["Address", s.address]);
  return (
    <aside className="hidden text-sm xl:block" aria-label="Key facts" data-testid="key-facts">
      <h3 className="mb-1 text-xs font-semibold text-muted">Key facts</h3>
      <dl className="divide-y divide-line/70">
        {rows.map(([k, v]) => (
          <div key={k} className="py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5 font-medium break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/** Balance line used in the dock and the family header. */
export function balanceText(detail: EnrollmentDetail): string | null {
  if (!detail.ledger.length) return null;
  const f = summaryOf(detail);
  return f.credit > 0 ? `Credit ${peso(f.credit)}` : `Balance ${peso(f.balance)}`;
}
