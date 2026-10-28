"use client";

// Printed report: college grade slip, or a K to 12 report card laid out like
// DepEd SF9 (Learner's Progress Report Card). Hidden on screen.

import type { SessionInfo } from "@/lib/data/store";
import { fullName, termLabel } from "@/lib/data/store";
import type { EnrollmentDetail } from "@/lib/enrollment/types";
import { COLLEGE_PERIODS, KINDER_MARK_LABEL, PERIOD_LABEL, QUARTERS, fmtGrade } from "@/lib/grades";
import type { GradeView } from "./GradesSection";

const cell = "border border-zinc-400 px-1.5 py-1";

export default function ReportCard({ detail, session, view }: { detail: EnrollmentDetail; session: SessionInfo; view: GradeView }) {
  const { enrollment: e, student: s, term } = detail;
  const school = session.school;
  const section = detail.offerings.find((o) => o.kind === "section" && detail.loads.some((l) => l.offering_id === o.id));
  const today = new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  const isCollege = view.kind === "college";

  return (
    <section className="mx-auto max-w-[780px] bg-white p-8 text-[12px] text-black" data-testid="report-card" aria-label="Report card">
      <header className="border-b-2 border-black pb-3 text-center">
        {!isCollege && <p className="text-xs">Republic of the Philippines, Department of Education</p>}
        <p className="text-lg font-bold">{school.name}</p>
        <p className="mt-1 text-base font-semibold">
          {isCollege ? "Grade slip" : "Learner's progress report card"}
          {!isCollege && <span className="ml-2 text-xs font-normal normal-case">(SF9)</span>}
        </p>
        <p className="text-zinc-600">{isCollege ? termLabel(term) : `School year ${term.school_year}`}</p>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-0.5">
        <div className="flex gap-2"><dt className="w-24 text-zinc-600">Name</dt><dd className="font-semibold">{fullName(s)}</dd></div>
        <div className="flex gap-2"><dt className="w-24 text-zinc-600">{isCollege ? "Student ID" : "LRN"}</dt><dd>{isCollege ? s.student_no ?? "—" : s.lrn ?? "—"}</dd></div>
        <div className="flex gap-2"><dt className="w-24 text-zinc-600">{isCollege ? "Program" : "Grade"}</dt><dd>{isCollege ? `${e.course ?? ""} ${e.level}` : `${e.level}${e.strand ? ` ${e.strand}` : ""}`}</dd></div>
        {section && <div className="flex gap-2"><dt className="w-24 text-zinc-600">Section</dt><dd>{section.title}</dd></div>}
        <div className="flex gap-2"><dt className="w-24 text-zinc-600">Sex</dt><dd>{s.sex ?? "—"}</dd></div>
        <div className="flex gap-2"><dt className="w-24 text-zinc-600">Date</dt><dd>{today}</dd></div>
      </dl>

      {view.kind === "college" && (
        <>
          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr className="bg-zinc-100">
                <th className={`${cell} text-left`}>Code</th>
                <th className={`${cell} text-left`}>Description</th>
                <th className={cell}>Units</th>
                {COLLEGE_PERIODS.map((p) => <th key={p} className={cell}>{PERIOD_LABEL[p]}</th>)}
                <th className={cell}>Final grade</th>
                <th className={cell}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {view.report.rows.map((r) => (
                <tr key={r.offering.id}>
                  <td className={cell}>{r.offering.code}</td>
                  <td className={cell}>{r.offering.title}</td>
                  <td className={`${cell} text-center`}>{r.offering.non_credit ? `(${r.offering.units})` : r.offering.units}</td>
                  {COLLEGE_PERIODS.map((p) => (
                    <td key={p} className={`${cell} text-center`}>{r.periods[p].mark ?? (r.periods[p].grade != null ? fmtGrade(r.periods[p].grade) : "")}</td>
                  ))}
                  <td className={`${cell} text-center font-semibold`}>{r.result.mark ?? (r.result.final != null ? fmtGrade(r.result.final) : "")}</td>
                  <td className={`${cell} text-center`}>{r.result.remarks ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-right text-sm font-semibold" data-testid="report-gwa">
            General weighted average: {view.report.gwa != null ? view.report.gwa.toFixed(2) : "—"} ({view.report.gwaUnits} units)
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Grading: 1.00 (highest) to 3.00 (passing); 5.00 failed. INC incomplete, DRP dropped, W withdrawn. Units in ( ) are non-credit and not in the GWA.
          </p>
        </>
      )}

      {view.kind === "k12" && (
        <>
          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr className="bg-zinc-100">
                <th rowSpan={2} className={`${cell} text-left`}>Learning areas</th>
                <th colSpan={4} className={cell}>Quarter</th>
                <th rowSpan={2} className={cell}>Final grade</th>
                <th rowSpan={2} className={cell}>Remarks</th>
              </tr>
              <tr className="bg-zinc-100">
                {QUARTERS.map((q, i) => <th key={q} className={cell}>{i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {[
                ...view.report.rows.filter((r) => !r.parent),
                ...(view.report.mapeh ? [view.report.mapeh, ...view.report.rows.filter((r) => r.parent === "MAPEH")] : []),
              ].map((r) => (
                <tr key={r.code}>
                  <td className={`${cell} ${r.parent ? "pl-5 italic" : ""}`}>{r.name}</td>
                  {QUARTERS.map((q) => <td key={q} className={`${cell} text-center`}>{r.runs.includes(q) ? r.quarters[q] ?? "" : "—"}</td>)}
                  <td className={`${cell} text-center font-semibold`}>{r.final ?? ""}</td>
                  <td className={`${cell} text-center`}>{r.passed == null ? "" : r.passed ? "Passed" : "Failed"}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={cell} colSpan={5}>General average</td>
                <td className={`${cell} text-center`} data-testid="report-general">{view.report.general ?? ""}</td>
                <td className={`${cell} text-center`}>{view.report.general == null ? "" : view.report.general >= 75 ? "Passed" : "Failed"}</td>
              </tr>
            </tbody>
          </table>
          <table className="mt-4 w-auto border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-100"><th className={cell}>Descriptors</th><th className={cell}>Grading scale</th><th className={cell}>Remarks</th></tr>
            </thead>
            <tbody>
              {[
                ["Outstanding", "90-100", "Passed"],
                ["Very Satisfactory", "85-89", "Passed"],
                ["Satisfactory", "80-84", "Passed"],
                ["Fairly Satisfactory", "75-79", "Passed"],
                ["Did Not Meet Expectations", "Below 75", "Failed"],
              ].map(([d, g, r]) => (
                <tr key={d}><td className={cell}>{d}</td><td className={`${cell} text-center`}>{g}</td><td className={cell}>{r}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {view.kind === "kinder" && (
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="bg-zinc-100">
              <th className={`${cell} text-left`}>Domain</th>
              {QUARTERS.map((q, i) => <th key={q} className={cell}>Quarter {i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.code}>
                <td className={cell}>{r.name}</td>
                {QUARTERS.map((q) => <td key={q} className={`${cell} text-center`}>{r.marks[q] ? KINDER_MARK_LABEL[r.marks[q]!] : ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-10 grid grid-cols-2 gap-10 text-center">
        <div><div className="border-t border-black pt-1">{isCollege ? "Registrar" : "Adviser"}</div></div>
        <div><div className="border-t border-black pt-1">{isCollege ? "Student" : "Parent / Guardian"}</div></div>
      </div>
      <p className="mt-6 text-xs text-zinc-500">Only grades posted by the registrar appear on this report.</p>
    </section>
  );
}
