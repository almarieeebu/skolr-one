"use client";

// Side panel (registrar): fee setup per term + track, optionally per course /
// year level (college) or grade level (K to 12). Also the OR number series.

import { useEffect, useMemo, useState } from "react";
import type { DataStore, FeeSetupDraft, SubjectFeeEdit } from "@/lib/data/store";
import { termLabel } from "@/lib/data/store";
import type { Offering, Term, TuitionPlan } from "@/lib/enrollment/types";
import {
  FEE_GROUP_LABEL,
  PLAN_INFO,
  formatOr,
  newSetup,
  peso,
  planTotal,
  scopeLabel,
  validateSetup,
  type FeeGroup,
  type FeeItem,
  type FeeSetup,
  type OrSeries,
} from "@/lib/fees";
import { Button, Chip, Field, Warnings, inputClass } from "./ui";
import { fmtDay } from "./fees-ui";

const COURSES = ["BSIT", "BSCS", "BSBA", "BSEd", "BSN"];
const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const GRADES = ["Kindergarten", ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)];

const num = (v: string) => (v === "" ? 0 : Number(v));

function Items({
  items,
  onChange,
  groups,
  testPrefix,
}: {
  items: FeeItem[];
  onChange: (items: FeeItem[]) => void;
  groups: FeeGroup[];
  testPrefix: string;
}) {
  const upd = (i: number, patch: Partial<FeeItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className={`grid gap-2 ${groups.length > 1 ? "grid-cols-[minmax(0,1fr)_7rem_auto] sm:grid-cols-[minmax(0,1fr)_8.5rem_7rem_auto]" : "grid-cols-[minmax(0,1fr)_7rem_auto]"}`}>
          <input aria-label="Item name" className={inputClass} value={it.name} onChange={(ev) => upd(i, { name: ev.target.value })} data-testid={`${testPrefix}-name-${i}`} />
          {groups.length > 1 && (
            <select aria-label="Group" className={`${inputClass} hidden px-2 text-xs text-muted sm:block`} value={it.group ?? groups[0]} onChange={(ev) => upd(i, { group: ev.target.value as FeeGroup })}>
              {groups.map((g) => <option key={g} value={g}>{FEE_GROUP_LABEL[g]}</option>)}
            </select>
          )}
          <input aria-label="Amount" className={`${inputClass} text-right`} inputMode="decimal" value={String(it.amount)} onChange={(ev) => upd(i, { amount: num(ev.target.value) })} data-testid={`${testPrefix}-amount-${i}`} />
          <button type="button" aria-label={`Remove ${it.name}`} className="rounded-md px-2 text-muted hover:text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="text-xs font-medium text-brand" onClick={() => onChange([...items, { name: "", amount: 0, group: groups[0] }])} data-testid={`${testPrefix}-add`}>
        + Add item
      </button>
    </div>
  );
}

export default function FeeSetupPanel({ store, onDone }: { store: DataStore; onDone: (msg: string) => void }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [setups, setSetups] = useState<FeeSetup[]>([]);
  const [termId, setTermId] = useState("");
  const [draft, setDraft] = useState<FeeSetupDraft | null>(null);
  const [subjects, setSubjects] = useState<Offering[]>([]);
  const [series, setSeries] = useState<OrSeries | null>(null);
  const [newScope, setNewScope] = useState<{ course: string; level: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([store.listAllTerms(), store.listFeeSetups(), store.getOrSeries()]).then(([t, s, o]) => {
      const sorted = [...t].sort((a, b) => Number(!!a.closed_at) - Number(!!b.closed_at));
      setTerms(sorted);
      setSetups(s);
      setSeries(o);
      const first = sorted.find((x) => !x.closed_at) ?? sorted[0];
      if (first) setTermId(first.id);
    });
  }, [store]);

  const term = terms.find((t) => t.id === termId);
  const termSetups = useMemo(() => setups.filter((s) => s.term_id === termId), [setups, termId]);

  // Load the "all" setup of the term (or a new one) whenever the term changes.
  useEffect(() => {
    if (!term) return;
    const base = termSetups.find((s) => !s.scope_course && !s.scope_level) ?? termSetups[0];
    setDraft(base ? structuredClone(base) : { ...newSetup(term) });
    setError(null);
    if (term.track === "college") void store.listTermSubjects(term.id).then(setSubjects);
    else setSubjects([]);
  }, [term, termSetups, store]);

  if (!term || !draft || !series) return <p className="text-sm text-muted">Loading…</p>;

  const isCollege = term.track === "college";
  const closed = !!term.closed_at;
  const set = <K extends keyof FeeSetupDraft>(k: K, v: FeeSetupDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const problems = validateSetup(draft);
  const pctSum = draft.exam_periods.reduce((a, p) => a + Number(p.percent || 0), 0);

  const addScope = () => {
    if (!newScope) return;
    const course = isCollege ? newScope.course || null : null;
    const level = newScope.level || null;
    const exists = termSetups.find((s) => (s.scope_course ?? null) === course && (s.scope_level ?? null) === level);
    if (exists) setDraft(structuredClone(exists));
    else {
      // Start from the term's general setup so only the differences need typing.
      const base = termSetups.find((s) => !s.scope_course && !s.scope_level);
      const fresh = base ? { ...structuredClone(base), id: undefined } : newSetup(term);
      setDraft({ ...fresh, scope_course: course, scope_level: level });
    }
    setNewScope(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const edits: SubjectFeeEdit[] = subjects.map((s) => ({ id: s.id, lab_fee: s.lab_fee, is_major: s.is_major }));
      await store.saveFeeSetup(draft, edits);
      await store.saveOrSeries({ prefix: series.prefix, next_no: series.next_no, pad: series.pad });
      onDone(`Fee setup saved: ${termLabel(term)}, ${scopeLabel(draft)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="fee-setup">
      <Field label="Term">
        <select data-testid="fs-term" className={inputClass} value={termId} onChange={(ev) => setTermId(ev.target.value)}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {termLabel(t)}{t.closed_at ? " (closed)" : ""}
            </option>
          ))}
        </select>
      </Field>
      {closed && <p className="rounded-lg bg-paper px-3 py-2 text-sm text-muted">This term is closed. Its setup is shown for reference.</p>}

      <div>
        <p className="mb-1 text-xs font-medium text-muted">Applies to</p>
        <div className="flex flex-wrap gap-1.5">
          {termSetups.map((s) => (
            <Chip key={s.id} active={draft.id === s.id} onClick={() => setDraft(structuredClone(s))}>
              {scopeLabel(s)}
            </Chip>
          ))}
          {!draft.id && <Chip active onClick={() => {}}>{scopeLabel(draft)} (new)</Chip>}
          {!closed && (
            <button type="button" className="rounded-full px-2 py-1 text-xs font-medium text-brand" onClick={() => setNewScope({ course: "", level: "" })}>
              + {isCollege ? "Course / year" : "Grade level"}
            </button>
          )}
        </div>
        {newScope && (
          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-line p-2">
            {isCollege && (
              <Field label="Course">
                <select className={inputClass} value={newScope.course} onChange={(ev) => setNewScope({ ...newScope, course: ev.target.value })}>
                  <option value="">All courses</option>
                  {COURSES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            )}
            <Field label={isCollege ? "Year level" : "Grade level"}>
              <select className={inputClass} value={newScope.level} onChange={(ev) => setNewScope({ ...newScope, level: ev.target.value })}>
                <option value="">All</option>
                {(isCollege ? YEARS : GRADES).map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Button variant="secondary" className="min-h-9" onClick={addScope}>Use</Button>
          </div>
        )}
        <p className="mt-1 text-xs text-muted">The most specific match is used for each student (course + year, then course, then year, then all).</p>
      </div>

      <fieldset disabled={closed} className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {isCollege && (
            <>
              <Field label="Rate per unit (₱)">
                <input data-testid="fs-rate" className={inputClass} inputMode="decimal" value={String(draft.rate_per_unit)} onChange={(ev) => set("rate_per_unit", num(ev.target.value))} />
              </Field>
              <Field label="Major subjects, per unit (₱)">
                <input data-testid="fs-major-rate" className={inputClass} inputMode="decimal" value={String(draft.major_rate_per_unit)} onChange={(ev) => set("major_rate_per_unit", num(ev.target.value))} />
              </Field>
            </>
          )}
          <Field label="Minimum downpayment (₱)">
            <input data-testid="fs-downpayment" className={inputClass} inputMode="decimal" value={String(draft.min_downpayment)} onChange={(ev) => set("min_downpayment", num(ev.target.value))} />
          </Field>
          {!isCollege && (
            <>
              <Field label="ESC grant, Gr 7-10 (₱)">
                <input className={inputClass} inputMode="decimal" value={String(draft.esc_amount)} onChange={(ev) => set("esc_amount", num(ev.target.value))} />
              </Field>
              <Field label="SHS voucher, Gr 11-12 (₱)">
                <input className={inputClass} inputMode="decimal" value={String(draft.shs_voucher_amount)} onChange={(ev) => set("shs_voucher_amount", num(ev.target.value))} />
              </Field>
            </>
          )}
        </div>

        {isCollege && subjects.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">Subjects: lab fee and major flag</h3>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[440px] text-sm">
                <thead className="bg-paper text-left text-xs text-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Subject</th>
                    <th className="px-2 py-1.5 text-right font-medium">Units</th>
                    <th className="px-2 py-1.5 font-medium">Lab fee (₱)</th>
                    <th className="px-2 py-1.5 font-medium">Major</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {subjects.map((o, i) => (
                    <tr key={o.id}>
                      <td className="px-2 py-1.5"><span className="font-mono text-xs">{o.code}</span> <span className="text-muted">{o.title}</span></td>
                      <td className="px-2 py-1.5 text-right">{o.units}</td>
                      <td className="px-2 py-1.5">
                        <input aria-label={`Lab fee ${o.code}`} className={`${inputClass} w-24 py-1 text-right`} inputMode="decimal" value={String(o.lab_fee)}
                          onChange={(ev) => setSubjects(subjects.map((x, j) => (j === i ? { ...x, lab_fee: num(ev.target.value) } : x)))} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="checkbox" aria-label={`${o.code} is a major subject`} className="h-4 w-4 accent-[var(--color-brand)]" checked={o.is_major}
                          data-testid={`fs-major-${o.code}`}
                          onChange={(ev) => setSubjects(subjects.map((x, j) => (j === i ? { ...x, is_major: ev.target.checked } : x)))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-muted">Lab fee and major flag belong to the subject offering of this term (all scopes).</p>
          </div>
        )}

        {!isCollege && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Tuition plans</h3>
            {draft.plans.map((p, pi) => {
              const setPlan = (patch: Partial<typeof p>) => set("plans", draft.plans.map((x, j) => (j === pi ? { ...x, ...patch } : x)));
              return (
                <div key={p.plan} className="space-y-2 rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{PLAN_INFO[p.plan as TuitionPlan].label}</p>
                    <p className="text-sm">Plan total <span className="font-semibold tabular-nums" data-testid={`fs-plan-total-${p.plan}`}>{peso(planTotal(draft, p))}</span></p>
                  </div>
                  <Items items={p.items} onChange={(items) => setPlan({ items })} groups={["tuition", "other"]} testPrefix={`fs-plan-${p.plan}`} />
                  <Field label="Installment surcharge (% of tuition)">
                    <input className={`${inputClass} w-28`} inputMode="decimal" value={String(p.surcharge_pct)} onChange={(ev) => setPlan({ surcharge_pct: num(ev.target.value) })} />
                  </Field>
                  <p className="text-xs text-muted">Due: {p.due_dates.map((d) => fmtDay(d)).join(" · ")}</p>
                </div>
              );
            })}
          </div>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold">Miscellaneous fees</h3>
          <Items items={draft.misc_items} onChange={(items) => set("misc_items", items)} groups={["misc", "other"]} testPrefix="fs-misc" />
          <p className="mt-1 text-xs text-muted">Total misc: {peso(draft.misc_items.reduce((a, m) => a + Number(m.amount || 0), 0))}</p>
        </div>

        {isCollege && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">Payment schedule (after the downpayment)</h3>
            <div className="space-y-2">
              {draft.exam_periods.map((p, i) => {
                const upd = (patch: Partial<typeof p>) => set("exam_periods", draft.exam_periods.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,9rem)] gap-2">
                    <input aria-label="Exam period" className={inputClass} value={p.name} onChange={(ev) => upd({ name: ev.target.value })} />
                    <input aria-label={`${p.name} percent`} className={`${inputClass} text-right`} inputMode="decimal" value={String(p.percent)} onChange={(ev) => upd({ percent: num(ev.target.value) })} />
                    <input aria-label={`${p.name} due date`} type="date" className={inputClass} value={p.due_date} onChange={(ev) => upd({ due_date: ev.target.value })} />
                  </div>
                );
              })}
            </div>
            <p className={`mt-1 text-xs ${Math.round(pctSum * 100) === 10000 ? "text-muted" : "text-danger"}`}>Percent total: {pctSum}% (must be 100). Leftover centavos go on the last period.</p>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold">Official receipt (OR) numbers</h3>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Prefix">
              <input className={inputClass} value={series.prefix} onChange={(ev) => setSeries({ ...series, prefix: ev.target.value })} />
            </Field>
            <Field label="Next number">
              <input className={inputClass} inputMode="numeric" value={String(series.next_no)} onChange={(ev) => setSeries({ ...series, next_no: Math.max(1, Math.floor(num(ev.target.value))) })} />
            </Field>
            <Field label="Digits">
              <input className={inputClass} inputMode="numeric" value={String(series.pad)} onChange={(ev) => setSeries({ ...series, pad: Math.min(12, Math.max(1, Math.floor(num(ev.target.value)))) })} />
            </Field>
          </div>
          <p className="mt-1 text-xs text-muted">Next OR: <span className="font-mono">{formatOr(series)}</span> (one series for the whole school)</p>
        </div>
      </fieldset>

      <Warnings items={problems} />
      {error && <p className="text-sm font-medium text-danger" role="alert">{error}</p>}
      {!closed && (
        <Button className="w-full" disabled={busy || problems.length > 0} onClick={save} data-testid="fs-save">
          {busy ? "Saving…" : "Save fee setup"}
        </Button>
      )}
      <p className="text-xs text-muted">New rates apply when a load is picked or changed. Fees already posted stay as they are.</p>
    </div>
  );
}
