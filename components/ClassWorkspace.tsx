"use client";

// A class opened from the class list: the grade sheet (middle) and the
// grade actions (right). Teachers type grades here; the registrar (or dean)
// approves, returns, allows late submission and decides change requests.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClassSheetDetail, DataStore, SessionInfo, SheetDraft } from "@/lib/data/store";
import { termLabel } from "@/lib/data/store";
import {
  COLLEGE_PERIODS,
  KINDER_AREA,
  QUARTERS,
  SHEET_ACTION_LABEL,
  deadlineFor,
  describeValue,
  isEditable,
  learningAreasFor,
  lateWarning,
  periodLabel,
  quarterlyGrade,
  sheetActions,
  sheetKind,
  type ChangeGradeRequest,
  type CollegePeriod,
  type EntryValue,
  type GradePeriod,
  type GradeSheet,
  type K12Component,
  type KinderMark,
  type Quarter,
} from "@/lib/grades";
import { Button, Field, Warnings, inputClass } from "./ui";
import { CollegeTable, K12Table, KinderTable, type ItemDraft } from "./GradeTables";
import { SheetChip, cellText, fmtDue, fmtWhen, parseCollegeCell, parseScore } from "./grades-ui";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

const DEFAULT_ITEMS: [K12Component, string, number][] = [["ww", "Quiz 1", 20], ["pt", "Task 1", 50], ["qa", "Quarterly exam", 50]];

export default function ClassWorkspace({
  store,
  session,
  offeringId,
  onBack,
  onChanged,
}: {
  store: DataStore;
  session: SessionInfo;
  offeringId: string;
  onBack: () => void;
  onChanged: (msg: string) => void;
}) {
  const role = session.actor.role;
  const [data, setData] = useState<ClassSheetDetail | null>(null);
  const [period, setPeriod] = useState<GradePeriod | null>(null);
  const [area, setArea] = useState<string | null>(null);
  // Drafts
  const [college, setCollege] = useState<Record<CollegePeriod, Record<string, string>>>({ prelim: {}, midterm: {}, semifinal: {}, final: {} });
  const [dirtyPeriods, setDirtyPeriods] = useState<Set<GradePeriod>>(new Set());
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [scores, setScores] = useState<Record<string, Record<string, string>>>({});
  const [marks, setMarks] = useState<Record<string, Record<string, KinderMark | "">>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await store.getClassSheet(offeringId);
    setData(d);
    return d;
  }, [store, offeringId]);

  useEffect(() => {
    setPeriod(null);
    setArea(null);
    void load();
  }, [load]);

  const kind = data ? sheetKind(data.offering) : "college";
  const areas = useMemo(
    () => (data && kind === "k12" ? learningAreasFor(data.offering.level ?? "", data.offering.strand) : []),
    [data, kind],
  );
  const periods: GradePeriod[] = kind === "college" ? COLLEGE_PERIODS : QUARTERS;
  const areaCode = kind === "kinder" ? KINDER_AREA : kind === "k12" ? area ?? areas[0]?.code ?? null : null;
  const areaInfo = areas.find((a) => a.code === areaCode);

  const sheetOf = useCallback(
    (p: GradePeriod, a: string | null = areaCode) =>
      data?.sheets.find((s) => s.period === p && (s.learning_area ?? null) === (kind === "college" ? null : a)) ?? null,
    [data, areaCode, kind],
  );

  // Pick a starting period: the first one not posted yet (or the last).
  useEffect(() => {
    if (!data || period) return;
    const runs = kind === "k12" && areaInfo ? areaInfo.quarters : periods;
    setPeriod(runs.find((p) => sheetOf(p)?.status !== "posted") ?? runs[runs.length - 1]);
  }, [data, period, kind, areaInfo, periods, sheetOf]);

  const current = period ?? periods[0];
  const sheet = sheetOf(current);
  const teacherCanEdit = (s: GradeSheet | null) => role === "teacher" && !!data?.teaches && (!s || isEditable(s.status));
  const editable = teacherCanEdit(sheet);

  // (Re)load the draft values from saved data. College: all four periods at
  // once (moving between periods keeps what was typed). K to 12 / Kinder: the
  // open quarter and learning area.
  useEffect(() => {
    if (!data || kind !== "college") return;
    {
      const next = { prelim: {}, midterm: {}, semifinal: {}, final: {} } as Record<CollegePeriod, Record<string, string>>;
      for (const p of COLLEGE_PERIODS) {
        const s = data.sheets.find((x) => x.period === p && !x.learning_area);
        for (const r of data.roster) {
          const g = s && data.entries.find((e) => e.sheet_id === s.id && e.enrollment_id === r.enrollment_id);
          next[p][r.enrollment_id] = g ? cellText(g.percent, g.mark) : "";
        }
      }
      setCollege(next);
    }
    setDirtyPeriods(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, kind]);

  useEffect(() => {
    if (!data || kind === "college") return;
    {
      const s = sheetOf(current);
      const its = s ? data.items.filter((i) => i.sheet_id === s.id).sort((a, b) => a.position - b.position) : [];
      setItems(
        s || !teacherCanEdit(null) || kind === "kinder"
          ? its.map(({ id, component, label, max_score, position }) => ({ id, component, label, max_score, position }))
          : DEFAULT_ITEMS.map(([component, label, max_score], i) => ({ id: newId(), component, label, max_score, position: i + 1 })),
      );
      const sc: Record<string, Record<string, string>> = {};
      const mk: Record<string, Record<string, KinderMark | "">> = {};
      for (const r of data.roster) {
        const g = s && data.entries.find((e) => e.sheet_id === s.id && e.enrollment_id === r.enrollment_id);
        sc[r.enrollment_id] = Object.fromEntries(its.map((i) => [i.id, g?.scores[i.id] != null ? String(g.scores[i.id]) : ""]));
        mk[r.enrollment_id] = { ...(g?.domains ?? {}) };
      }
      setScores(sc);
      setMarks(mk);
    }
    setDirtyPeriods(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, current, areaCode, kind]);

  const markDirty = (p: GradePeriod) => setDirtyPeriods((d) => new Set(d).add(p));

  /** Build what to save for one period (college) or the open quarter/area (K to 12). */
  const draftFor = (p: GradePeriod): SheetDraft | { error: string } => {
    if (!data) return { error: "Not loaded." };
    if (kind === "college") {
      const entries: SheetDraft["entries"] = [];
      for (const r of data.roster) {
        const v = parseCollegeCell(college[p as CollegePeriod][r.enrollment_id] ?? "");
        if (!v.ok) return { error: `${periodLabel(p)}: "${college[p as CollegePeriod][r.enrollment_id]}" for ${r.name} is not a percent (0-100) or INC / DRP / W.` };
        entries.push({ enrollment_id: r.enrollment_id, percent: v.percent, mark: v.mark, scores: {}, domains: {} });
      }
      return { offering_id: data.offering.id, period: p, learning_area: null, subject_group: null, items: [], entries };
    }
    const cleanItems = items.map((i, k) => ({ ...i, max_score: Number(i.max_score) || 0, position: k + 1 }));
    if (cleanItems.some((i) => !(i.max_score > 0))) return { error: "Every item needs a highest possible score above 0." };
    const entries: SheetDraft["entries"] = [];
    for (const r of data.roster) {
      const sc: Record<string, number | null> = {};
      for (const it of cleanItems) {
        const v = parseScore(scores[r.enrollment_id]?.[it.id] ?? "", it.max_score);
        if (v === undefined) return { error: `${r.name}: a score in "${it.label}" is not a number from 0 to ${it.max_score}.` };
        sc[it.id] = v;
      }
      const dm = Object.fromEntries(Object.entries(marks[r.enrollment_id] ?? {}).filter(([, m]) => !!m)) as Record<string, KinderMark>;
      entries.push({ enrollment_id: r.enrollment_id, percent: null, mark: null, scores: kind === "k12" ? sc : {}, domains: kind === "kinder" ? dm : {} });
    }
    return {
      offering_id: data.offering.id, period: p, learning_area: areaCode, subject_group: areaInfo?.group ?? null,
      items: kind === "k12" ? cleanItems : [], entries,
    };
  };

  /** Save every changed editable period. Returns false on a problem. */
  const saveDirty = async (): Promise<boolean> => {
    const todo = [...dirtyPeriods].filter((p) => teacherCanEdit(sheetOf(p)));
    for (const p of todo) {
      const d = draftFor(p);
      if ("error" in d) {
        setError(d.error);
        return false;
      }
      const r = await store.saveGradeSheet(d);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
    }
    return true;
  };

  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const msg = await fn();
      if (msg) {
        await load();
        onChanged(msg);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () =>
    act(async () => {
      if (!dirtyPeriods.size) return "Nothing new to save.";
      return (await saveDirty()) ? "Draft saved." : null;
    });

  const submit = () =>
    act(async () => {
      if (!(await saveDirty())) return null;
      let id = sheetOf(current)?.id;
      if (!id) {
        const d = draftFor(current);
        if ("error" in d) throw new Error(d.error);
        const r = await store.saveGradeSheet(d);
        if (!r.ok) throw new Error(r.error);
        id = r.sheet_id;
      }
      const r = await store.runSheetAction(id!, { type: "submit" });
      if (!r.ok) {
        await load();
        throw new Error(r.error);
      }
      return `${periodLabel(current)}${areaInfo ? ` ${areaInfo.name}` : ""} submitted for approval.`;
    });

  /** Switch period / area; a changed draft is saved first. */
  const go = async (p: GradePeriod, a: string | null = areaCode) => {
    if (p === current && a === areaCode) return;
    if (kind !== "college" && dirtyPeriods.size) {
      setBusy(true);
      const ok = await saveDirty();
      setBusy(false);
      if (!ok) return;
      await load();
    }
    if (kind === "k12" && a !== areaCode) setArea(a);
    setError(null);
    setPeriod(p);
  };

  if (!data) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-muted lg:col-span-2">Loading class…</div>
    );
  }

  const ctx = {
    actor: session.actor,
    sheet: sheet ?? { status: "draft" as const, late_allowed: false },
    teachesClass: data.teaches && role === "teacher",
    useDean: session.school.settings.use_dean_approval,
    deadline: deadlineFor(data.settings, data.offering.term_id, current),
    now: new Date().toISOString(),
  };
  const actions = sheetActions(ctx);
  const late = editable ? lateWarning(ctx) : null;
  const statusOf = (p: GradePeriod) => sheetOf(p)?.status ?? null;
  const runs = kind === "k12" && areaInfo ? areaInfo.quarters : periods;
  const roster = data.roster;
  const nameOf = (enrollmentId: string) => roster.find((r) => r.enrollment_id === enrollmentId)?.name ?? "Student";
  const labelOfSheet = (s: Pick<GradeSheet, "period" | "learning_area">) =>
    `${periodLabel(s.period)}${s.learning_area && s.learning_area !== KINDER_AREA ? ` · ${areas.find((a) => a.code === s.learning_area)?.name ?? s.learning_area}` : ""}`;

  return (
    <>
      {/* Middle: the grade sheet */}
      <div className="min-w-0 space-y-3">
        <Button variant="ghost" className="lg:hidden" onClick={onBack}>
          ← Back to classes
        </Button>
        <article className="overflow-hidden rounded-2xl border border-line bg-surface" data-testid="grade-sheet">
          <div className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold" data-testid="class-title">
                  <span className="font-mono text-base">{data.offering.code}</span> · {data.offering.title}
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  {termLabel(data.term)} · {data.teacher_name ?? "No teacher"} · {roster.length} {roster.length === 1 ? "student" : "students"}
                  {kind === "college" && ` · ${data.offering.units} units${data.offering.non_credit ? " (non-credit)" : ""}`}
                </p>
              </div>
              <span data-testid="sheet-status"><SheetChip status={sheet?.status ?? null} /></span>
            </div>

            {kind !== "college" && (
              <div className="flex flex-wrap items-end gap-3">
                {kind === "k12" && (
                  <Field label="Learning area">
                    <select
                      data-testid="area-select"
                      className={`${inputClass} w-auto`}
                      value={areaCode ?? ""}
                      disabled={busy}
                      onChange={(e) => {
                        const a = areas.find((x) => x.code === e.target.value)!;
                        void go(a.quarters.includes(current as Quarter) ? current : a.quarters[0], a.code);
                      }}
                    >
                      {areas.map((a) => {
                        const st = sheetOf(current, a.code)?.status;
                        return (
                          <option key={a.code} value={a.code}>
                            {a.name}{st ? ` · ${st}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </Field>
                )}
                <div role="tablist" aria-label="Quarter" className="grid w-full grid-cols-4 gap-1 sm:flex sm:w-auto">
                  {runs.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="tab"
                      aria-selected={p === current}
                      data-testid={`period-${p}`}
                      disabled={busy}
                      onClick={() => void go(p)}
                      className={`flex flex-col items-center rounded-lg border px-1 py-1 text-xs sm:px-3 ${p === current ? "border-brand bg-brand-soft font-semibold" : "border-line"}`}
                    >
                      {periodLabel(p)}
                      <SheetChip status={statusOf(p)} />
                    </button>
                  ))}
                </div>
                {areaInfo && (
                  <p className="text-xs text-muted">
                    Weights: WW {data.settings.k12_weights[areaInfo.group].ww}% · PT {data.settings.k12_weights[areaInfo.group].pt}% · QA {data.settings.k12_weights[areaInfo.group].qa}%
                  </p>
                )}
              </div>
            )}

            {sheet?.status === "returned" && sheet.return_note && (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="return-note">
                <strong>Returned:</strong> {sheet.return_note}
              </p>
            )}
            {late && <Warnings items={[late]} />}
          </div>

          <div className="border-t border-line">
            {roster.length === 0 ? (
              <p className="p-5 text-sm text-muted">No officially enrolled students in this class yet.</p>
            ) : (
              // The sheet scrolls sideways inside this box only (the page never does).
              <div className="max-w-full overflow-x-auto px-3 py-3" data-testid="sheet-scroll">
                {kind === "college" && (
                  <CollegeTable
                    roster={roster}
                    values={college}
                    editable={Object.fromEntries(COLLEGE_PERIODS.map((p) => [p, teacherCanEdit(sheetOf(p))])) as Record<CollegePeriod, boolean>}
                    statuses={Object.fromEntries(COLLEGE_PERIODS.map((p) => [p, statusOf(p)])) as Record<CollegePeriod, GradeSheet["status"] | null>}
                    current={current as CollegePeriod}
                    settings={data.settings}
                    onPickPeriod={(p) => setPeriod(p)}
                    onChange={(p, eid, text) => {
                      setCollege((c) => ({ ...c, [p]: { ...c[p], [eid]: text } }));
                      markDirty(p);
                    }}
                  />
                )}
                {kind === "k12" && areaInfo && (
                  <K12Table
                    roster={roster}
                    items={items}
                    scores={scores}
                    weights={data.settings.k12_weights[areaInfo.group]}
                    editable={editable}
                    onScore={(eid, itemId, text) => {
                      setScores((s) => ({ ...s, [eid]: { ...s[eid], [itemId]: text } }));
                      markDirty(current);
                    }}
                    onItem={(id, patch) => {
                      setItems((its) => its.map((i) => (i.id === id ? { ...i, ...patch } : i)));
                      markDirty(current);
                    }}
                    onAddItem={(c) => {
                      const n = items.filter((i) => i.component === c).length + 1;
                      const label = c === "ww" ? `Quiz ${n}` : c === "pt" ? `Task ${n}` : n === 1 ? "Quarterly exam" : `Exam ${n}`;
                      const order: K12Component[] = ["ww", "pt", "qa"];
                      setItems((its) =>
                        [...its, { id: newId(), component: c, label, max_score: c === "ww" ? 20 : 50, position: its.length + 1 }].sort(
                          (a, b) => order.indexOf(a.component) - order.indexOf(b.component) || a.position - b.position,
                        ),
                      );
                      markDirty(current);
                    }}
                    onRemoveItem={(id) => {
                      setItems((its) => its.filter((i) => i.id !== id));
                      markDirty(current);
                    }}
                  />
                )}
                {kind === "kinder" && (
                  <KinderTable
                    roster={roster}
                    marks={marks}
                    editable={editable}
                    onMark={(eid, d, m) => {
                      setMarks((x) => ({ ...x, [eid]: { ...x[eid], [d]: m } }));
                      markDirty(current);
                    }}
                  />
                )}
              </div>
            )}
          </div>
          {editable && roster.length > 0 && (
            <p className="border-t border-line px-5 py-2 text-xs text-muted">
              {kind === "college"
                ? "Type the percent (0-100) or INC, DRP, W. Tab moves right, Enter moves down. The 1.00-5.00 grade shows under each percent."
                : kind === "k12"
                  ? "Type raw scores. Tab moves right, Enter moves down. PS = raw ÷ highest × 100, WS = PS × weight; blank scores count as 0 in the live grade."
                  : "Mark each domain: Beginning, Developing or Consistent."}
            </p>
          )}
        </article>
      </div>

      {/* Right: grade actions */}
      <div className="min-w-0">
        <aside className="space-y-4 rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-20" data-testid="grade-actions">
          <div>
            <h2 className="text-sm font-semibold">Grades · {labelOfSheet({ period: current, learning_area: areaCode })}</h2>
            <p className="text-xs text-muted">
              As <span className="capitalize">{role}</span> · {session.actor.name}
            </p>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">Status</dt><dd><SheetChip status={sheet?.status ?? null} /></dd></div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Deadline</dt>
              <dd data-testid="sheet-deadline">{fmtDue(ctx.deadline) ?? "None"}{sheet?.late_allowed ? " (late allowed)" : ""}</dd>
            </div>
            {sheet?.submitted_at && <div className="flex justify-between gap-3"><dt className="text-muted">Submitted</dt><dd>{fmtWhen(sheet.submitted_at)}</dd></div>}
            {sheet?.posted_at && <div className="flex justify-between gap-3"><dt className="text-muted">Posted</dt><dd>{fmtWhen(sheet.posted_at)}</dd></div>}
          </dl>

          {actions.includes("save") && (
            <div className="space-y-2">
              <Button variant="secondary" className="w-full" disabled={busy} onClick={saveDraft} data-testid="grade-save">
                Save draft{dirtyPeriods.size ? " •" : ""}
              </Button>
              <Button className="w-full" disabled={busy || roster.length === 0} onClick={submit} data-testid="grade-submit">
                Submit {labelOfSheet({ period: current, learning_area: areaCode })}
              </Button>
            </div>
          )}
          {role === "teacher" && sheet && !isEditable(sheet.status) && (
            <p className="rounded-lg bg-paper px-3 py-3 text-sm text-muted" data-testid="sheet-locked">
              {sheet.status === "submitted"
                ? `Waiting for the ${ctx.useDean ? "dean" : "registrar"} to approve.`
                : "Posted and locked. To change a grade, send a change request below."}
            </p>
          )}

          {actions.includes("allow_late") && (
            <Button variant="secondary" className="w-full" disabled={busy || !sheet} data-testid="grade-allow-late"
              onClick={() => act(async () => {
                const r = await store.runSheetAction(sheet!.id, { type: "allow_late" });
                if (!r.ok) throw new Error(r.error);
                return "Late submission allowed.";
              })}
            >
              {SHEET_ACTION_LABEL.allow_late}
            </Button>
          )}
          {!sheet && role === "registrar" && ctx.deadline && lateWarning(ctx) && (
            <p className="text-xs text-muted">The deadline has passed and nothing is saved yet. You can allow a late submission once the teacher saves a draft.</p>
          )}

          {(role === "registrar" || role === "dean") && (
            <ApproveQueue
              sheets={data.sheets.filter((s) => s.status === "submitted")}
              label={labelOfSheet}
              canApprove={(s) => sheetActions({ ...ctx, sheet: s }).includes("approve")}
              busy={busy}
              onOpen={(s) => {
                if (kind === "k12" && s.learning_area) setArea(s.learning_area);
                setPeriod(s.period);
              }}
              onApprove={(s) => act(async () => {
                const r = await store.runSheetAction(s.id, { type: "approve" });
                if (!r.ok) throw new Error(r.error);
                return `${labelOfSheet(s)} approved and posted.`;
              })}
              onReturn={(s, note) => act(async () => {
                const r = await store.runSheetAction(s.id, { type: "return", note });
                if (!r.ok) throw new Error(r.error);
                return `${labelOfSheet(s)} returned to the teacher.`;
              })}
            />
          )}

          <ChangeRequests
            data={data}
            role={role}
            kind={kind}
            sheet={sheet}
            items={items}
            nameOf={nameOf}
            label={labelOfSheet}
            busy={busy}
            onRequest={(entryId, value, reason) => act(async () => {
              const r = await store.requestGradeChange(entryId, value, reason);
              if (!r.ok) throw new Error(r.error);
              return "Change request sent to the registrar.";
            })}
            onDecide={(req, approve, note) => act(async () => {
              const r = await store.decideGradeChange(req.id, approve, note);
              if (!r.ok) throw new Error(r.error);
              return approve ? "Grade change approved and logged." : "Grade change not approved.";
            })}
          />

          {error && <p className="text-sm text-danger" role="alert" data-testid="grade-error">{error}</p>}

          <SheetHistory data={data} sheet={sheet} />
        </aside>
      </div>
    </>
  );
}

function ApproveQueue({
  sheets,
  label,
  canApprove,
  busy,
  onOpen,
  onApprove,
  onReturn,
}: {
  sheets: GradeSheet[];
  label: (s: GradeSheet) => string;
  canApprove: (s: GradeSheet) => boolean;
  busy: boolean;
  onOpen: (s: GradeSheet) => void;
  onApprove: (s: GradeSheet) => void;
  onReturn: (s: GradeSheet, note: string) => void;
}) {
  const [returning, setReturning] = useState<string | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2 border-t border-line pt-3" data-testid="approve-queue">
      <p className="text-xs font-medium text-muted">Waiting for approval ({sheets.length})</p>
      {sheets.length === 0 && <p className="text-sm text-muted">Nothing submitted in this class.</p>}
      {sheets.map((s) => (
        <div key={s.id} className="space-y-2 rounded-lg border border-line p-2.5">
          <button type="button" className="block w-full text-left text-sm font-medium hover:underline" onClick={() => onOpen(s)}>
            {label(s)}
            <span className="block text-xs font-normal text-muted">Submitted {fmtWhen(s.submitted_at)}</span>
          </button>
          <div className="flex gap-2">
            {canApprove(s) && (
              <Button className="min-h-8 flex-1 px-2 text-xs" disabled={busy} onClick={() => onApprove(s)} data-testid={`approve-${s.period}${s.learning_area ? `-${s.learning_area}` : ""}`}>
                Approve and post
              </Button>
            )}
            <Button variant="secondary" className="min-h-8 flex-1 px-2 text-xs" disabled={busy} onClick={() => { setReturning(returning === s.id ? null : s.id); setNote(""); }}>
              Return…
            </Button>
          </div>
          {returning === s.id && (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); onReturn(s, note); setReturning(null); }}>
              <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the teacher fix?" data-testid="return-text" />
              <Button type="submit" variant="danger" className="min-h-8 w-full text-xs" disabled={busy || !note.trim()}>
                Return to teacher
              </Button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}

function valueText(v: EntryValue, data: ClassSheetDetail) {
  if (!v.scores) return describeValue(v);
  return Object.entries(v.scores)
    .map(([id, sc]) => `${data.items.find((i) => i.id === id)?.label ?? "item"} ${sc ?? "—"}`)
    .join(", ");
}

function ChangeRequests({
  data,
  role,
  kind,
  sheet,
  items,
  nameOf,
  label,
  busy,
  onRequest,
  onDecide,
}: {
  data: ClassSheetDetail;
  role: SessionInfo["actor"]["role"];
  kind: ReturnType<typeof sheetKind>;
  sheet: GradeSheet | null;
  items: ItemDraft[];
  nameOf: (enrollmentId: string) => string;
  label: (s: GradeSheet) => string;
  busy: boolean;
  onRequest: (entryId: string, value: EntryValue, reason: string) => void;
  onDecide: (req: ChangeGradeRequest, approve: boolean, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [enrollmentId, setEnrollmentId] = useState(data.roster[0]?.enrollment_id ?? "");
  const [text, setText] = useState("");
  const [itemScores, setItemScores] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const sheetOfReq = (r: ChangeGradeRequest) => data.sheets.find((s) => s.id === r.sheet_id)!;
  const canAsk = role === "teacher" && data.teaches && sheet?.status === "posted" && kind !== "kinder";
  const entry = sheet && data.entries.find((e) => e.sheet_id === sheet.id && e.enrollment_id === enrollmentId);
  const pending = data.requests.filter((r) => r.status === "pending");
  const shown = role === "registrar" ? pending : data.requests.filter((r) => r.sheet_id === sheet?.id || r.status === "pending");

  const pickStudent = (id: string) => {
    setEnrollmentId(id);
    const g = sheet && data.entries.find((e) => e.sheet_id === sheet.id && e.enrollment_id === id);
    setText(g ? cellText(g.percent, g.mark) : "");
    setItemScores(Object.fromEntries(items.map((i) => [i.id, g?.scores[i.id] != null ? String(g.scores[i.id]) : ""])));
  };

  const send = () => {
    if (!entry) return;
    if (kind === "college") {
      const v = parseCollegeCell(text);
      if (!v.ok) return onRequest(entry.id, { percent: Number.NaN, mark: null }, reason);
      onRequest(entry.id, { percent: v.percent, mark: v.mark }, reason);
    } else {
      const sc: Record<string, number | null> = {};
      for (const it of items) sc[it.id] = parseScore(itemScores[it.id] ?? "", Number(it.max_score)) ?? null;
      onRequest(entry.id, { percent: null, mark: null, scores: sc }, reason);
    }
    setOpen(false);
    setReason("");
  };

  if (!canAsk && shown.length === 0) return null;
  const newQuarterly =
    kind === "k12" && sheet?.subject_group
      ? quarterlyGrade(
          items.map((i) => ({ ...i, max_score: Number(i.max_score) })),
          Object.fromEntries(items.map((i) => [i.id, parseScore(itemScores[i.id] ?? "", Number(i.max_score)) ?? null])),
          data.settings.k12_weights[sheet.subject_group],
        ).quarterly
      : null;

  return (
    <div className="space-y-2 border-t border-line pt-3" data-testid="change-requests">
      <p className="text-xs font-medium text-muted">Change grade requests</p>
      {canAsk && (
        <>
          <Button variant="secondary" className="w-full" onClick={() => { setOpen(!open); pickStudent(enrollmentId); }} data-testid="cgr-open">
            Ask for a grade change
          </Button>
          {open && (
            <form className="space-y-2 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); send(); }} data-testid="cgr-form">
              <Field label="Student">
                <select className={inputClass} value={enrollmentId} onChange={(e) => pickStudent(e.target.value)} data-testid="cgr-student">
                  {data.roster.map((r) => (
                    <option key={r.enrollment_id} value={r.enrollment_id}>{r.name}</option>
                  ))}
                </select>
              </Field>
              {entry && (
                <p className="text-xs text-muted">Posted now: {kind === "college" ? cellText(entry.percent, entry.mark) || "blank" : `quarterly ${entry.grade ?? "—"}`}</p>
              )}
              {kind === "college" ? (
                <Field label="New percent (or INC / DRP / W)">
                  <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} data-testid="cgr-value" />
                </Field>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {items.map((it) => (
                    <Field key={it.id} label={`${it.label} /${it.max_score}`}>
                      <input className={inputClass} inputMode="decimal" value={itemScores[it.id] ?? ""} onChange={(e) => setItemScores((s) => ({ ...s, [it.id]: e.target.value }))} />
                    </Field>
                  ))}
                  {newQuarterly != null && <p className="col-span-3 text-xs text-muted">New quarterly grade: <strong>{newQuarterly}</strong></p>}
                </div>
              )}
              <Field label="Reason">
                <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="cgr-reason" placeholder="e.g. Final exam re-checked" />
              </Field>
              <Button type="submit" className="w-full" disabled={busy || !reason.trim()} data-testid="cgr-submit">
                Send request
              </Button>
            </form>
          )}
        </>
      )}
      {shown.map((r) => {
        const s = sheetOfReq(r);
        return (
          <div key={r.id} className="space-y-1.5 rounded-lg border border-line p-2.5 text-sm" data-testid="cgr-item">
            <p className="font-medium">{nameOf(r.enrollment_id)} · {label(s)}</p>
            <p className="text-xs">
              {valueText(r.old_value, data)} → <strong>{valueText(r.new_value, data)}</strong>
            </p>
            <p className="text-xs text-muted">“{r.reason}” · {r.requested_by_name} · {fmtWhen(r.requested_at)}</p>
            {r.status !== "pending" ? (
              <p className={`text-xs font-medium ${r.status === "approved" ? "text-emerald-700" : "text-danger"}`}>
                {r.status === "approved" ? "Approved" : "Not approved"}{r.decision_note ? `: ${r.decision_note}` : ""}
              </p>
            ) : role === "registrar" ? (
              <div className="space-y-1.5">
                <input className={inputClass} placeholder="Note (needed to reject)" value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} data-testid="cgr-note" />
                <div className="flex gap-2">
                  <Button className="min-h-8 flex-1 px-2 text-xs" disabled={busy} onClick={() => onDecide(r, true, notes[r.id] ?? "")} data-testid="cgr-approve">
                    Approve change
                  </Button>
                  <Button variant="danger" className="min-h-8 flex-1 px-2 text-xs" disabled={busy || !(notes[r.id] ?? "").trim()} onClick={() => onDecide(r, false, notes[r.id] ?? "")}>
                    Reject
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs font-medium text-wait">Waiting for the registrar</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SheetHistory({ data, sheet }: { data: ClassSheetDetail; sheet: GradeSheet | null }) {
  const rows = sheet ? data.history.filter((h) => h.sheet_id === sheet.id) : [];
  if (!rows.length) return null;
  return (
    <details className="border-t border-line pt-3" data-testid="sheet-history">
      <summary className="cursor-pointer text-xs font-medium text-muted">History ({rows.length})</summary>
      <ol className="mt-2 space-y-2 border-l-2 border-line pl-3">
        {[...rows].reverse().map((h) => (
          <li key={h.id} className="text-xs">
            <p className="font-medium">{h.action.replace(/_/g, " ")}</p>
            <p className="text-muted">{h.actor_name} · {fmtWhen(h.created_at)}</p>
            {h.note && <p>“{h.note}”</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}
