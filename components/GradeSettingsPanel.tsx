"use client";

// Side panel (registrar): grade settings for the school. College scale and
// average rule, K to 12 weights per subject group, and deadlines per term.

import { useEffect, useState } from "react";
import type { DataStore } from "@/lib/data/store";
import { termLabel } from "@/lib/data/store";
import type { Term } from "@/lib/enrollment/types";
import {
  COLLEGE_PERIODS,
  GROUP_LABEL,
  PERIOD_LABEL,
  QUARTERS,
  QUARTER_LABEL,
  validateGradeSettings,
  type CollegeAverageRule,
  type GradePeriod,
  type GradeSettings,
  type SubjectGroup,
} from "@/lib/grades";
import { Button, Field, StickyActions, Warnings, inputClass } from "./ui";

const num = (v: string) => (v === "" ? 0 : Number(v));

const RULES: { value: CollegeAverageRule; label: string; hint: string }[] = [
  { value: "all_four", label: "Divide by all four", hint: "A missing period counts as 0." },
  { value: "present", label: "Divide by grades present", hint: "Only periods with a grade count." },
  { value: "final_only", label: "Final period is the average", hint: "Prelim to Semi-final are for reference." },
];

export default function GradeSettingsPanel({ store, onDone }: { store: DataStore; onDone: (msg: string) => void }) {
  const [s, setS] = useState<GradeSettings | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([store.getGradeSettings(), store.listAllTerms()]).then(([g, t]) => {
      setS(g);
      setTerms(t.filter((x) => !x.closed_at));
    });
  }, [store]);

  if (!s) return <p className="text-sm text-muted">Loading</p>;
  const set = <K extends keyof GradeSettings>(k: K, v: GradeSettings[K]) => setS({ ...s, [k]: v });
  const problems = validateGradeSettings(s);
  const due = (termId: string, period: GradePeriod) => s.deadlines.find((d) => d.term_id === termId && d.period === period)?.due_date ?? "";
  const setDue = (termId: string, period: GradePeriod, date: string) =>
    set("deadlines", [
      ...s.deadlines.filter((d) => !(d.term_id === termId && d.period === period)),
      ...(date ? [{ term_id: termId, period, due_date: date }] : []),
    ]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await store.saveGradeSettings(s);
      onDone("Grade settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="grade-settings">
      <div className="grid gap-x-10 gap-y-6 xl:grid-cols-2">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">College (CHED)</h3>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-medium text-muted">Average of the four periods</legend>
          {RULES.map((r) => (
            <label key={r.value} className="flex items-start gap-2 text-sm">
              <input type="radio" name="avg" className="mt-1" checked={s.college_average === r.value} onChange={() => set("college_average", r.value)} data-testid={`gs-rule-${r.value}`} />
              <span>{r.label}<span className="block text-xs text-muted">{r.hint}</span></span>
            </label>
          ))}
        </fieldset>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Period weights (%)</p>
          <div className="grid grid-cols-4 gap-2">
            {COLLEGE_PERIODS.map((p) => (
              <Field key={p} label={PERIOD_LABEL[p]}>
                <input className={`${inputClass} text-right`} inputMode="decimal" value={String(s.period_weights[p])}
                  onChange={(e) => set("period_weights", { ...s.period_weights, [p]: num(e.target.value) })} data-testid={`gs-weight-${p}`} />
              </Field>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.block_average_on_inc} onChange={(e) => set("block_average_on_inc", e.target.checked)} />
          Do not compute the average when a period is INC or DRP
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field label="GWA decimals">
            <input className={`${inputClass} text-right`} inputMode="numeric" value={String(s.gwa_decimals)} onChange={(e) => set("gwa_decimals", Math.floor(num(e.target.value)))} />
          </Field>
          <Field label="Passing grade">
            <input className={`${inputClass} text-right`} inputMode="decimal" value={String(s.passing_grade)} onChange={(e) => set("passing_grade", num(e.target.value))} />
          </Field>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Grade scale (percent → grade)</p>
          <div className="space-y-1.5" data-testid="gs-scale">
            {s.college_scale.map((r, i) => {
              const upd = (patch: Partial<typeof r>) => set("college_scale", s.college_scale.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid grid-cols-[4rem_auto_4rem_auto_5rem_auto] items-center justify-start gap-1.5 text-sm">
                  <input aria-label="From percent" className={`${inputClass} px-2 text-right`} inputMode="numeric" value={String(r.min)} onChange={(e) => upd({ min: num(e.target.value) })} />
                  <span className="text-muted">to</span>
                  <input aria-label="To percent" className={`${inputClass} px-2 text-right`} inputMode="numeric" value={String(r.max)} onChange={(e) => upd({ max: num(e.target.value) })} />
                  <span className="text-muted">% =</span>
                  <input aria-label="Grade" className={`${inputClass} px-2 text-right`} inputMode="decimal" value={String(r.grade)} onChange={(e) => upd({ grade: num(e.target.value) })} />
                  <button type="button" aria-label="Remove row" className="px-1 text-muted hover:text-danger" onClick={() => set("college_scale", s.college_scale.filter((_, j) => j !== i))}>Remove</button>
                </div>
              );
            })}
            <button type="button" className="text-xs font-medium text-brand" onClick={() => set("college_scale", [...s.college_scale, { min: 0, max: 0, grade: 5 }])}>
              + Add row
            </button>
          </div>
        </div>
      </section>

      <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">K to 12 (DepEd) weights</h3>
        <div className="space-y-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] gap-1.5 text-xs text-muted">
            <span>Subject group</span><span className="text-right">WW</span><span className="text-right">PT</span><span className="text-right">QA</span>
          </div>
          {(Object.keys(GROUP_LABEL) as SubjectGroup[]).map((g) => (
            <div key={g} className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] items-center gap-1.5 text-sm">
              <span className="text-xs">{GROUP_LABEL[g]}</span>
              {(["ww", "pt", "qa"] as const).map((c) => (
                <input key={c} aria-label={`${GROUP_LABEL[g]} ${c}`} className={`${inputClass} px-2 text-right`} inputMode="numeric"
                  value={String(s.k12_weights[g][c])}
                  onChange={(e) => set("k12_weights", { ...s.k12_weights, [g]: { ...s.k12_weights[g], [c]: num(e.target.value) } })} />
              ))}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">Quarterly grades use the DO 8 s. 2015 transmutation table (60 lowest, 75 passing).</p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Deadlines</h3>
        <p className="text-xs text-muted">After the deadline the teacher sees a warning and the registrar must allow a late submission.</p>
        {terms.map((t) => {
          const ps: GradePeriod[] = t.track === "college" ? COLLEGE_PERIODS : QUARTERS;
          return (
            <div key={t.id}>
              <p className="mb-1 text-xs font-medium">{termLabel(t)}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ps.map((p) => (
                  <Field key={p} label={p.startsWith("q") ? QUARTER_LABEL[p as (typeof QUARTERS)[number]] : PERIOD_LABEL[p as (typeof COLLEGE_PERIODS)[number]]}>
                    <input type="date" className={`${inputClass} px-2`} value={due(t.id, p)} onChange={(e) => setDue(t.id, p, e.target.value)} />
                  </Field>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      </div>
      </div>
      <StickyActions>
        <div className="min-w-0 flex-1">
          <Warnings items={problems} />
          {error && <p className="text-sm font-medium text-stop" role="alert">{error}</p>}
        </div>
        <Button disabled={busy || problems.length > 0} onClick={save} data-testid="gs-save">
          {busy ? "Saving" : "Save grade settings"}
        </Button>
      </StickyActions>
    </div>
  );
}
