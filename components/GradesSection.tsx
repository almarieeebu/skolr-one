"use client";

// Student card "Grades" section: college grade slip with GWA, or the K to 12
// quarterly / final grades and general average (Kinder: the checklist).
// Students and parents see posted grades only. "Print report card" prints
// the grade slip / SF9-style report card (see ReportCard.tsx).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DataStore, SessionInfo, StudentGrades } from "@/lib/data/store";
import type { EnrollmentDetail } from "@/lib/enrollment/types";
import {
  COLLEGE_PERIODS,
  KINDER_MARK_LABEL,
  PERIOD_LABEL,
  QUARTERS,
  QUARTER_LABEL,
  collegeReport,
  fmtGrade,
  gradePermissions,
  isKinder,
  k12Report,
  kinderReport,
  type CollegeReport,
  type K12Report,
} from "@/lib/grades";
import { Button } from "./ui";
import { Remarks } from "./GradeTables";
import ReportCard from "./ReportCard";

export type GradeView =
  | { kind: "college"; report: CollegeReport }
  | { kind: "k12"; report: K12Report }
  | { kind: "kinder"; rows: ReturnType<typeof kinderReport> };

export function buildGradeView(detail: EnrollmentDetail, g: StudentGrades, postedOnly: boolean): GradeView | null {
  const e = detail.enrollment;
  const picked = detail.offerings.filter((o) => detail.loads.some((l) => l.offering_id === o.id));
  if (e.track === "college") {
    return {
      kind: "college",
      report: collegeReport({ subjects: picked.filter((o) => o.kind === "subject"), enrollmentId: e.id, sheets: g.sheets, entries: g.entries, settings: g.settings, postedOnly }),
    };
  }
  const section = picked.find((o) => o.kind === "section");
  if (!section) return null;
  if (isKinder(e.level)) {
    return { kind: "kinder", rows: kinderReport({ sectionId: section.id, enrollmentId: e.id, sheets: g.sheets, entries: g.entries, postedOnly }) };
  }
  return {
    kind: "k12",
    report: k12Report({ level: e.level, strand: e.strand, sectionId: section.id, enrollmentId: e.id, sheets: g.sheets, entries: g.entries, postedOnly }),
  };
}

const th = "px-1.5 py-1.5 text-xs font-medium text-muted whitespace-nowrap";
const td = "px-1.5 py-2 tabular-nums";

export default function GradesSection({
  detail,
  session,
  store,
}: {
  detail: EnrollmentDetail;
  session: SessionInfo;
  store: DataStore;
}) {
  const perms = gradePermissions(session.actor.role);
  const [grades, setGrades] = useState<StudentGrades | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    let alive = true;
    void store.getStudentGrades(detail.enrollment.id).then((g) => alive && setGrades(g));
    return () => {
      alive = false;
    };
  }, [store, detail.enrollment.id, detail.enrollment.updated_at]);

  if (!grades) return <p className="text-sm text-muted">Loading grades…</p>;
  const view = buildGradeView(detail, grades, perms.postedOnly);
  // The printed report card always shows posted grades only.
  const printView = buildGradeView(detail, grades, true);
  if (!view || !printView) return <p className="text-sm text-muted">No section yet.</p>;

  const print = () => {
    document.body.dataset.print = "report";
    window.print();
  };

  return (
    <div className="space-y-3" data-testid="grades-section">
      {perms.postedOnly && <p className="text-xs text-muted">Only grades posted by the registrar are shown.</p>}
      {session.actor.role === "teacher" && <p className="text-xs text-muted">Showing grades from your own classes.</p>}

      {view.kind === "college" && <CollegeGrades report={view.report} decimals={grades.settings.gwa_decimals} />}
      {view.kind === "k12" && <K12Grades report={view.report} />}
      {view.kind === "kinder" && <KinderGrades rows={view.rows} />}

      <Button variant="secondary" className="w-full sm:w-auto" onClick={print} data-testid="print-report-card">
        {view.kind === "college" ? "Print grade slip" : "Print report card"}
      </Button>
      {mounted &&
        createPortal(
          <div className="hidden print:block" data-print-doc="report">
            <ReportCard detail={detail} session={session} view={printView} />
          </div>,
          document.body,
        )}
    </div>
  );
}

function CollegeGrades({ report, decimals }: { report: CollegeReport; decimals: number }) {
  return (
    <>
      {/* Phones: one line per subject, final grade first. */}
      <ul className="divide-y divide-line sm:hidden" data-testid="grades-list">
        {report.rows.map((r) => (
          <li key={r.offering.id} className="flex items-start justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="font-mono text-xs">{r.offering.code}</span>
              <span className="ml-1 text-xs text-muted">{r.offering.units}{r.offering.non_credit ? "*" : ""} units</span>
              <span className="block truncate text-sm">{r.offering.title}</span>
              <span className="block text-[11px] text-muted tabular-nums">
                {COLLEGE_PERIODS.map((p) => {
                  const c = r.periods[p];
                  return `${PERIOD_LABEL[p].slice(0, 4)} ${c.mark ?? (c.grade != null ? fmtGrade(c.grade) : "—")}`;
                }).join(" · ")}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-base font-semibold tabular-nums">{r.result.mark ?? fmtGrade(r.result.final)}</span>
              <Remarks value={r.result.remarks} />
            </span>
          </li>
        ))}
      </ul>
      <div className="-mx-1 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[560px] text-sm" data-testid="grades-table">
          <thead className="text-left">
            <tr>
              <th className={th}>Subject</th>
              <th className={`${th} text-right`}>Units</th>
              {COLLEGE_PERIODS.map((p) => (
                <th key={p} className={`${th} text-right`}>{PERIOD_LABEL[p]}</th>
              ))}
              <th className={`${th} text-right`}>Final grade</th>
              <th className={th}>Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {report.rows.map((r) => (
              <tr key={r.offering.id}>
                <td className="px-1.5 py-2">
                  <span className="font-mono text-xs">{r.offering.code}</span>
                  <span className="block max-w-[12rem] truncate text-xs text-muted">{r.offering.title}</span>
                </td>
                <td className={`${td} text-right`}>{r.offering.units}{r.offering.non_credit ? "*" : ""}</td>
                {COLLEGE_PERIODS.map((p) => {
                  const c = r.periods[p];
                  return (
                    <td key={p} className={`${td} text-right`}>
                      {c.mark ?? (c.grade != null ? fmtGrade(c.grade) : "—")}
                      {c.percent != null && <span className="block text-[11px] text-muted">{c.percent}%</span>}
                    </td>
                  );
                })}
                <td className={`${td} text-right font-semibold`}>{r.result.mark ?? fmtGrade(r.result.final)}</td>
                <td className="px-1.5 py-2"><Remarks value={r.result.remarks} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-paper px-3 py-2">
        <span className="text-sm text-muted">General weighted average (GWA)</span>
        <span className="text-lg font-semibold tabular-nums" data-testid="gwa">
          {report.gwa != null ? report.gwa.toFixed(decimals) : "—"}
          <span className="ml-1 text-xs font-normal text-muted">{report.gwaUnits} units</span>
        </span>
      </div>
      <p className="text-xs text-muted">1.00 is the highest, 3.00 passing, 5.00 failed. The GWA leaves out INC, DRP, W and non-credit (*) subjects such as NSTP.</p>
    </>
  );
}

function K12Grades({ report }: { report: K12Report }) {
  const rows = [
    ...report.rows.filter((r) => !r.parent),
    ...(report.mapeh ? [report.mapeh, ...report.rows.filter((r) => r.parent === "MAPEH")] : []),
  ];
  return (
    <>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full text-sm" data-testid="grades-table">
          <thead className="text-left">
            <tr>
              <th className={th}>Learning area</th>
              {QUARTERS.map((q) => (
                <th key={q} className={`${th} text-right`}>{QUARTER_LABEL[q]}</th>
              ))}
              <th className={`${th} text-right`}>Final</th>
              <th className={`${th} hidden sm:table-cell`}>Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.code} className={r.parent ? "text-muted" : ""}>
                <td className={`px-1.5 py-2 ${r.parent ? "pl-5 text-xs" : ""}`}>{r.name}</td>
                {QUARTERS.map((q) => (
                  <td key={q} className={`${td} text-right`}>{r.runs.includes(q) ? r.quarters[q] ?? "—" : ""}</td>
                ))}
                <td className={`${td} text-right font-semibold`}>{r.final ?? "—"}</td>
                <td className="hidden px-1.5 py-2 text-xs sm:table-cell">{r.passed == null ? "—" : r.passed ? "Passed" : "Failed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-paper px-3 py-2">
        <span className="text-sm text-muted">General average</span>
        <span className="text-lg font-semibold tabular-nums" data-testid="general-average">
          {report.general ?? "—"}
          {report.generalDescriptor && <span className="ml-2 text-xs font-normal text-muted">{report.generalDescriptor}</span>}
        </span>
      </div>
      <p className="text-xs text-muted">
        The final grade shows once every quarter is posted. Outstanding 90-100 · Very Satisfactory 85-89 · Satisfactory 80-84 ·
        Fairly Satisfactory 75-79 · Did Not Meet Expectations below 75.
      </p>
    </>
  );
}

function KinderGrades({ rows }: { rows: ReturnType<typeof kinderReport> }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm" data-testid="grades-table">
        <thead className="text-left">
          <tr>
            <th className={th}>Domain</th>
            {QUARTERS.map((q) => (
              <th key={q} className={th}>{QUARTER_LABEL[q]}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.code}>
              <td className="px-1.5 py-2 text-xs">{r.name}</td>
              {QUARTERS.map((q) => (
                <td key={q} className="px-1.5 py-2 text-xs">{r.marks[q] ? KINDER_MARK_LABEL[r.marks[q]!] : "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
