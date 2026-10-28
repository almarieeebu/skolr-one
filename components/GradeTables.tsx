"use client";

// The grade sheet tables (middle column). Presentational: the workspace
// owns the draft values and passes them in.

import type { RosterRow } from "@/lib/data/store";
import {
  COLLEGE_PERIODS,
  COMPONENT_LABEL,
  KINDER_DOMAINS,
  KINDER_MARK_LABEL,
  PERIOD_LABEL,
  collegeResult,
  descriptor,
  fmtGrade,
  quarterlyGrade,
  transmuteCollege,
  type CollegePeriod,
  type ComponentWeights,
  type GradeSettings,
  type K12Component,
  type KinderMark,
  type ScoreItem,
  type SheetStatus,
} from "@/lib/grades";
import { SheetChip, onGridKey, parseCollegeCell, parseScore } from "./grades-ui";

const cellInput =
  "min-w-0 rounded-md border border-line bg-surface px-1.5 py-1 text-right text-sm tabular-nums focus:border-ink focus:outline-none";
const th = "px-2 py-1.5 text-xs font-medium text-muted whitespace-nowrap";

// ---------- college ----------

export function CollegeTable({
  roster,
  values,
  editable,
  statuses,
  current,
  settings,
  onChange,
  onPickPeriod,
}: {
  roster: RosterRow[];
  /** period -> enrollment -> typed text */
  values: Record<CollegePeriod, Record<string, string>>;
  editable: Record<CollegePeriod, boolean>;
  statuses: Record<CollegePeriod, SheetStatus | null>;
  current: CollegePeriod;
  settings: GradeSettings;
  onChange: (period: CollegePeriod, enrollmentId: string, text: string) => void;
  onPickPeriod: (p: CollegePeriod) => void;
}) {
  return (
    <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm" data-testid="college-sheet">
      <thead className="sticky top-0 z-20 bg-sheet shadow-[inset_0_-1px_0_var(--color-line)]">
        <tr className="text-left">
          <th className={`${th} sticky left-0 z-30 bg-sheet pl-4 md:pl-6`}>Student</th>
          {COLLEGE_PERIODS.map((p) => (
            <th key={p} className={`${th} text-center ${p === current ? "bg-select" : ""}`}>
              <button type="button" onClick={() => onPickPeriod(p)} className="flex w-full flex-col items-center gap-0.5" data-testid={`period-${p}`}>
                <span className={p === current ? "text-ink" : ""}>{PERIOD_LABEL[p]}</span>
                <SheetChip status={statuses[p]} />
              </button>
            </th>
          ))}
          <th className={`${th} text-right`}>Average</th>
          <th className={`${th} text-right`}>Grade</th>
          <th className={th}>Remarks</th>
        </tr>
      </thead>
      <tbody>
        {roster.map((r, row) => {
          const periods: Partial<Record<CollegePeriod, { percent: number | null; mark: "INC" | "DRP" | "W" | null }>> = {};
          for (const p of COLLEGE_PERIODS) {
            const v = parseCollegeCell(values[p][r.enrollment_id] ?? "");
            if (v.ok && (v.percent != null || v.mark)) periods[p] = { percent: v.percent, mark: v.mark };
          }
          const res = collegeResult(periods, settings);
          return (
            <tr key={r.enrollment_id} className="align-top" data-testid={`sheet-row-${r.student_no ?? r.enrollment_id}`}>
              <td className="sticky left-0 z-10 border-t border-line bg-sheet py-2 pr-3 pl-4 md:pl-6">
                <span className="block max-w-[11rem] truncate font-medium">{r.name}</span>
                <span className="block num text-xs text-muted">{r.student_no}</span>
              </td>
              {COLLEGE_PERIODS.map((p) => {
                const text = values[p][r.enrollment_id] ?? "";
                const parsed = parseCollegeCell(text);
                const g = parsed.ok && parsed.percent != null ? transmuteCollege(parsed.percent, settings.college_scale) : null;
                return (
                  <td key={p} className={`border-t border-line px-1.5 py-2 text-center ${p === current ? "bg-select/50" : ""}`}>
                    {editable[p] ? (
                      <input
                        aria-label={`${PERIOD_LABEL[p]} percent for ${r.name}`}
                        data-testid={`cell-${p}-${row}`}
                        data-row={row}
                        data-col={p}
                        inputMode="decimal"
                        className={`${cellInput} mx-auto w-full max-w-[4.5rem] ${parsed.ok ? "" : "border-danger bg-danger-soft"}`}
                        value={text}
                        placeholder="%"
                        onFocus={() => onPickPeriod(p)}
                        onKeyDown={onGridKey}
                        onChange={(e) => onChange(p, r.enrollment_id, e.target.value)}
                      />
                    ) : (
                      <span className="block tabular-nums">{text || "—"}</span>
                    )}
                    <span className="mt-0.5 block text-xs text-muted tabular-nums">
                      {parsed.ok && parsed.mark ? parsed.mark : g != null ? fmtGrade(g) : ""}
                    </span>
                  </td>
                );
              })}
              <td className="border-t border-line px-2 py-2 text-right tabular-nums">{res.average != null ? `${res.average}%` : "—"}</td>
              <td className="border-t border-line px-2 py-2 text-right font-semibold tabular-nums" data-testid={`final-${row}`}>
                {res.mark ?? fmtGrade(res.final)}
              </td>
              <td className="border-t border-line px-2 py-2">
                <Remarks value={res.remarks} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Remarks({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const style =
    value === "Passed" ? "text-go" : value === "Failed" || value === "Did Not Meet Expectations" ? "text-danger" : "text-warn";
  return <span className={`text-xs font-medium ${style}`}>{value}</span>;
}

// ---------- K to 12 ----------

export type ItemDraft = Pick<ScoreItem, "id" | "component" | "label" | "max_score" | "position">;
const COMPS: K12Component[] = ["ww", "pt", "qa"];

export function K12Table({
  roster,
  items,
  scores,
  weights,
  editable,
  onScore,
  onItem,
  onAddItem,
  onRemoveItem,
}: {
  roster: RosterRow[];
  items: ItemDraft[];
  /** enrollment -> item id -> typed text */
  scores: Record<string, Record<string, string>>;
  weights: ComponentWeights;
  editable: boolean;
  onScore: (enrollmentId: string, itemId: string, text: string) => void;
  onItem: (id: string, patch: Partial<ItemDraft>) => void;
  onAddItem: (c: K12Component) => void;
  onRemoveItem: (id: string) => void;
}) {
  const byComp = (c: K12Component) => items.filter((i) => i.component === c);
  let col = 0;
  return (
    <table className="w-full border-separate border-spacing-0 text-sm" data-testid="k12-sheet">
      <thead className="sticky top-0 z-20 bg-sheet shadow-[inset_0_-1px_0_var(--color-line)]">
        <tr>
          <th rowSpan={2} className={`${th} sticky left-0 z-30 bg-sheet pl-4 md:pl-6 text-left align-bottom`}>Learner</th>
          {COMPS.map((c) => (
            <th key={c} colSpan={byComp(c).length + 1} className={`${th} border-l border-line text-center`}>
              <span className="text-ink">{COMPONENT_LABEL[c]}</span> ({weights[c]}%)
              {editable && (
                <button
                  type="button"
                  onClick={() => onAddItem(c)}
                  className="ml-2 rounded border border-line px-1.5 text-xs text-ink hover:bg-hover"
                  data-testid={`add-item-${c}`}
                  aria-label={`Add ${COMPONENT_LABEL[c]} item`}
                >
                  + item
                </button>
              )}
            </th>
          ))}
          <th rowSpan={2} className={`${th} border-l border-line text-right align-bottom`}>Initial</th>
          <th rowSpan={2} className={`${th} text-right align-bottom`}>Quarterly</th>
        </tr>
        <tr>
          {COMPS.map((c) => (
            <ItemHeaders key={c} items={byComp(c)} editable={editable} onItem={onItem} onRemove={onRemoveItem} />
          ))}
        </tr>
      </thead>
      <tbody>
        {roster.map((r, row) => {
          const s = scores[r.enrollment_id] ?? {};
          const parsed: Record<string, number | null> = {};
          let bad = false;
          for (const it of items) {
            const v = parseScore(s[it.id] ?? "", Number(it.max_score) || 0);
            if (v === undefined) bad = true;
            parsed[it.id] = v ?? null;
          }
          const q = quarterlyGrade(items.map((i) => ({ ...i, max_score: Number(i.max_score) || 0 })), parsed, weights);
          const any = items.some((i) => parsed[i.id] != null);
          col = 0;
          return (
            <tr key={r.enrollment_id} data-testid={`k12-row-${row}`}>
              <td className="sticky left-0 z-10 border-t border-line bg-sheet py-2 pr-3 pl-4 md:pl-6">
                <span className="block max-w-[8.5rem] truncate font-medium">{r.name}</span>
              </td>
              {COMPS.map((c) => {
                const comp = q[c];
                return [
                  ...byComp(c).map((it, k) => {
                    const text = s[it.id] ?? "";
                    const ok = parseScore(text, Number(it.max_score) || 0) !== undefined;
                    const myCol = col++;
                    return (
                      <td key={it.id} className={`border-t border-line px-1 py-2 ${k === 0 ? "border-l" : ""}`}>
                        {editable ? (
                          <input
                            aria-label={`${it.label || c} score for ${r.name}`}
                            data-testid={`score-${c}-${k}-${row}`}
                            data-row={row}
                            data-col={myCol}
                            inputMode="decimal"
                            className={`${cellInput} w-12 ${ok ? "" : "border-danger bg-danger-soft"}`}
                            value={text}
                            onKeyDown={onGridKey}
                            onChange={(e) => onScore(r.enrollment_id, it.id, e.target.value)}
                          />
                        ) : (
                          <span className="block w-10 text-right tabular-nums">{text || "—"}</span>
                        )}
                      </td>
                    );
                  }),
                  <td key={`${c}-ps`} className={`border-t border-line px-2 py-2 text-right text-xs tabular-nums ${byComp(c).length === 0 ? "border-l" : ""}`}>
                    {comp.ps != null ? (
                      <>
                        <span className="block">{comp.ps.toFixed(2)}</span>
                        <span className="block text-xs text-muted">{comp.ws.toFixed(2)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>,
                ];
              })}
              <td className="border-t border-l border-line px-2 py-2 text-right tabular-nums">{any && !bad ? q.initial.toFixed(2) : "—"}</td>
              <td className="border-t border-line px-2 py-2 text-right" data-testid={`quarterly-${row}`}>
                {any && !bad ? (
                  <>
                    <span className="font-semibold tabular-nums">{q.quarterly}</span>
                    <span className={`block text-xs ${q.quarterly >= 75 ? "text-muted" : "text-danger"}`}>{descriptor(q.quarterly)}</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ItemHeaders({
  items,
  editable,
  onItem,
  onRemove,
}: {
  items: ItemDraft[];
  editable: boolean;
  onItem: (id: string, patch: Partial<ItemDraft>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      {items.map((it, k) => (
        <th key={it.id} className={`px-1 pb-1.5 align-bottom ${k === 0 ? "border-l border-line" : ""}`}>
          {editable ? (
            <div className="flex w-14 flex-col gap-0.5">
              <input
                aria-label="Item name"
                className="w-full rounded border border-line px-1 py-0.5 text-xs font-normal"
                value={it.label}
                onChange={(e) => onItem(it.id, { label: e.target.value })}
              />
              <span className="flex items-center gap-0.5 text-xs font-normal text-muted">
                /
                <input
                  aria-label={`Highest possible score of ${it.label}`}
                  data-testid={`max-${it.component}-${k}`}
                  inputMode="numeric"
                  className="w-9 rounded border border-line px-1 py-0.5 text-right text-xs"
                  value={String(it.max_score)}
                  onChange={(e) => onItem(it.id, { max_score: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })}
                />
                <button type="button" aria-label={`Remove ${it.label}`} className="ml-auto text-muted hover:text-danger" onClick={() => onRemove(it.id)}>
                  ×
                </button>
              </span>
            </div>
          ) : (
            <span className="block w-10 text-right text-xs font-normal text-muted">
              {it.label}
              <br />/{it.max_score}
            </span>
          )}
        </th>
      ))}
      <th className={`${th} text-right align-bottom ${items.length === 0 ? "border-l border-line" : ""}`}>
        PS
        <span className="block text-xs font-normal">WS</span>
      </th>
    </>
  );
}

// ---------- Kinder ----------

export function KinderTable({
  roster,
  marks,
  editable,
  onMark,
}: {
  roster: RosterRow[];
  marks: Record<string, Record<string, KinderMark | "">>;
  editable: boolean;
  onMark: (enrollmentId: string, domain: string, mark: KinderMark | "") => void;
}) {
  return (
    <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm" data-testid="kinder-sheet">
      <thead className="sticky top-0 z-20 bg-sheet shadow-[inset_0_-1px_0_var(--color-line)]">
        <tr>
          <th className={`${th} sticky left-0 z-30 bg-sheet pl-4 md:pl-6 text-left`}>Learner</th>
          {KINDER_DOMAINS.map((d) => (
            <th key={d.code} className={`${th} max-w-[7rem] whitespace-normal text-left`}>{d.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {roster.map((r) => (
          <tr key={r.enrollment_id}>
            <td className="sticky left-0 z-10 border-t border-line bg-sheet py-2 pr-3 pl-4 md:pl-6 font-medium">{r.name}</td>
            {KINDER_DOMAINS.map((d) => {
              const v = marks[r.enrollment_id]?.[d.code] ?? "";
              return (
                <td key={d.code} className="border-t border-line px-1.5 py-2">
                  {editable ? (
                    <select
                      aria-label={`${d.name} for ${r.name}`}
                      className="w-full rounded-md border border-line bg-surface px-1 py-1 text-xs"
                      value={v}
                      onChange={(e) => onMark(r.enrollment_id, d.code, e.target.value as KinderMark | "")}
                    >
                      <option value="">—</option>
                      {(Object.keys(KINDER_MARK_LABEL) as KinderMark[]).map((m) => (
                        <option key={m} value={m}>{KINDER_MARK_LABEL[m]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs">{v ? KINDER_MARK_LABEL[v] : "—"}</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
