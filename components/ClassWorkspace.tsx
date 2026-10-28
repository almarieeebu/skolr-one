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
import { Button, Field, Modal, Pill, SidePanel, SubTabs, Warnings, inputClass, type TabDef } from "./ui";
import { DetailPane } from "./shell/Shell";
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
  /** Phones: back to the class list. */
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
  const [tab, setTab] = useState<"sheet" | "approve" | "changes" | "history">("sheet");
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnNote, setReturnNote] = useState("");
  const [askOpen, setAskOpen] = useState(false);

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
    return <p className="p-8 text-sm text-muted">Loading class</p>;
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
    `${periodLabel(s.period)}${s.learning_area && s.learning_area !== KINDER_AREA ? ` ${areas.find((a) => a.code === s.learning_area)?.name ?? s.learning_area}` : ""}`;
  const currentLabel = labelOfSheet({ period: current, learning_area: areaCode });

  const isApprover = role === "registrar" || role === "dean";
  const submitted = data.sheets.filter((s) => s.status === "submitted");
  const pendingChanges = data.requests.filter((r) => r.status === "pending");
  const canAsk = role === "teacher" && data.teaches && sheet?.status === "posted" && kind !== "kinder";
  const historyRows = sheet ? data.history.filter((h) => h.sheet_id === sheet.id) : [];
  const canApproveCurrent = !!sheet && sheet.status === "submitted" && sheetActions({ ...ctx, sheet }).includes("approve");
  const canReturnCurrent = !!sheet && sheet.status === "submitted" && isApprover;

  const tabs: TabDef[] = [{ id: "sheet", label: "Grade sheet" }];
  if (isApprover) tabs.push({ id: "approve", label: "To approve", badge: submitted.length || undefined });
  if (canAsk || data.requests.length > 0) tabs.push({ id: "changes", label: "Change requests", badge: pendingChanges.length || undefined });
  tabs.push({ id: "history", label: "History", badge: historyRows.length || undefined });
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "sheet";

  const approve = (s: GradeSheet) =>
    act(async () => {
      const r = await store.runSheetAction(s.id, { type: "approve" });
      if (!r.ok) throw new Error(r.error);
      return `${labelOfSheet(s)} approved and posted.`;
    });
  const sendBack = (s: GradeSheet, note: string) =>
    act(async () => {
      const r = await store.runSheetAction(s.id, { type: "return", note });
      if (!r.ok) throw new Error(r.error);
      return `${labelOfSheet(s)} returned to the teacher.`;
    });

  const header = (
    <div className="space-y-2.5" data-testid="grade-sheet">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-xl font-semibold" data-testid="class-title">
              <span className="num">{data.offering.code}</span> <span className="font-medium text-muted">{data.offering.title}</span>
            </h2>
            <span data-testid="sheet-status"><SheetChip status={sheet?.status ?? null} /></span>
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-4 text-sm text-muted">
            <span>{termLabel(data.term)}</span>
            <span>{data.teacher_name ?? "No teacher"}</span>
            <span className="num">{roster.length} {roster.length === 1 ? "student" : "students"}</span>
            {kind === "college" && <span className="num">{data.offering.units} units{data.offering.non_credit ? ", non-credit" : ""}</span>}
          </p>
        </div>
      </div>

      {kind !== "college" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {kind === "k12" && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs font-medium text-muted">Learning area</span>
              <select
                data-testid="area-select"
                className={`${inputClass} w-auto py-1`}
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
                      {a.name}{st ? `, ${st}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          <div role="tablist" aria-label="Quarter" className="flex max-w-full flex-wrap gap-1">
            {runs.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={p === current}
                data-testid={`period-${p}`}
                disabled={busy}
                onClick={() => void go(p)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${p === current ? "border-ink bg-select text-ink" : "border-line text-muted hover:text-ink"}`}
              >
                {periodLabel(p)}
                <SheetChip status={statusOf(p)} />
              </button>
            ))}
          </div>
          {areaInfo && (
            <p className="text-xs text-muted">
              Weights: written work {data.settings.k12_weights[areaInfo.group].ww}%, performance tasks {data.settings.k12_weights[areaInfo.group].pt}%, quarterly assessment {data.settings.k12_weights[areaInfo.group].qa}%
            </p>
          )}
        </div>
      )}

      {sheet?.status === "returned" && sheet.return_note && (
        <p className="rounded-r-md border-l-2 border-warn bg-warn/8 px-3 py-1.5 text-sm text-warn" data-testid="return-note">
          <strong className="font-semibold">Returned:</strong> {sheet.return_note}
        </p>
      )}
      {late && <Warnings items={[late]} />}
    </div>
  );

  // ---------- dock ----------
  const deadlineText = `${currentLabel}: ${sheet ? SHEET_STATUS_TEXT[sheet.status] : "not started"}${ctx.deadline ? `, due ${fmtDue(ctx.deadline)}` : ""}${sheet?.late_allowed ? " (late allowed)" : ""}`;
  const dock = (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="min-w-0 text-sm">
        {error ? (
          <p className="font-medium text-stop" role="alert" data-testid="grade-error">{error}</p>
        ) : role === "teacher" && sheet && !isEditable(sheet.status) ? (
          <p className="text-muted" data-testid="sheet-locked">
            {sheet.status === "submitted"
              ? `Waiting for the ${ctx.useDean ? "dean" : "registrar"} to approve.`
              : "Posted and locked. To change a grade, ask for a grade change."}
          </p>
        ) : (
          <p className="text-muted">
            <span className="font-medium text-ink" data-testid="sheet-deadline">{deadlineText}</span>
            {editable && roster.length > 0 && (
              <span className="ml-3 hidden xl:inline">
                {kind === "college"
                  ? "Type a percent or INC, DRP, W. Tab moves right, Enter moves down."
                  : kind === "k12"
                    ? "Type raw scores. Tab moves right, Enter moves down."
                    : "Mark each domain: Beginning, Developing or Consistent."}
              </span>
            )}
            {!sheet && role === "registrar" && ctx.deadline && lateWarning(ctx) && (
              <span className="ml-3">The deadline has passed. You can allow a late submission once the teacher saves a draft.</span>
            )}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {actions.includes("allow_late") && (
          <Button variant="secondary" disabled={busy || !sheet} data-testid="grade-allow-late" className="max-md:flex-1"
            onClick={() => act(async () => {
              const r = await store.runSheetAction(sheet!.id, { type: "allow_late" });
              if (!r.ok) throw new Error(r.error);
              return "Late submission allowed.";
            })}
          >
            {SHEET_ACTION_LABEL.allow_late}
          </Button>
        )}
        {canReturnCurrent && (
          <Button variant="danger" disabled={busy} onClick={() => { setReturnNote(""); setReturnOpen(true); }} data-testid="dock-return" className="max-md:flex-1">
            Return to teacher
          </Button>
        )}
        {canApproveCurrent && (
          <Button disabled={busy} onClick={() => approve(sheet!)} data-testid="dock-approve" className="max-md:flex-1">
            Approve and post
          </Button>
        )}
        {canAsk && (
          <Button variant="secondary" onClick={() => setAskOpen(true)} data-testid="cgr-open" className="max-md:flex-1">
            Ask for a grade change
          </Button>
        )}
        {actions.includes("save") && (
          <>
            <Button variant="secondary" disabled={busy} onClick={saveDraft} data-testid="grade-save" className="max-md:flex-1">
              {dirtyPeriods.size ? "Save draft*" : "Save draft"}
            </Button>
            <Button disabled={busy || roster.length === 0} onClick={submit} data-testid="grade-submit" className="max-md:flex-1">
              Submit {currentLabel}
            </Button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <DetailPane
        onBack={onBack}
        backLabel={role === "teacher" ? "My classes" : "Grades"}
        header={header}
        tabs={tabs.length > 1 ? <SubTabs tabs={tabs} value={activeTab} onChange={(t) => setTab(t as typeof tab)} idBase="class" label="Class sections" /> : undefined}
        panelId="class-panel"
        labelledBy={`class-tab-${activeTab}`}
        flush={activeTab === "sheet"}
        dock={dock}
        testId="class-detail"
      >
        {activeTab === "sheet" &&
          (roster.length === 0 ? (
            <p className="p-6 text-sm text-muted">No officially enrolled students in this class yet. Students show up here once the registrar approves their enrollment.</p>
          ) : (
            // The sheet scrolls in both directions inside the pane; the header row and the name column stay put.
            <div className="h-full overflow-auto" data-testid="sheet-scroll">
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
          ))}

        {activeTab === "approve" && (
          <ApproveQueue
            sheets={submitted}
            label={labelOfSheet}
            canApprove={(s) => sheetActions({ ...ctx, sheet: s }).includes("approve")}
            busy={busy}
            onOpen={(s) => {
              if (kind === "k12" && s.learning_area) setArea(s.learning_area);
              setPeriod(s.period);
              setTab("sheet");
            }}
            onApprove={approve}
            onReturn={sendBack}
          />
        )}

        {activeTab === "changes" && (
          <ChangeRequestList data={data} role={role} sheet={sheet} nameOf={nameOf} label={labelOfSheet} busy={busy}
            onDecide={(req, ok, note) => act(async () => {
              const r = await store.decideGradeChange(req.id, ok, note);
              if (!r.ok) throw new Error(r.error);
              return ok ? "Grade change approved and logged." : "Grade change not approved.";
            })}
          />
        )}

        {activeTab === "history" && <SheetHistory rows={historyRows} label={currentLabel} />}
      </DetailPane>

      <Modal title={`Return ${currentLabel} to the teacher`} open={returnOpen} onClose={() => setReturnOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setReturnOpen(false);
            void sendBack(sheet!, returnNote);
          }}
        >
          <Field label="What should the teacher fix?">
            <textarea className={inputClass} rows={3} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} data-testid="dock-return-text" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={busy || !returnNote.trim()}>Return to teacher</Button>
          </div>
        </form>
      </Modal>

      <SidePanel title="Ask for a grade change" subtitle={`${data.offering.code} ${currentLabel}`} open={askOpen} onClose={() => setAskOpen(false)} testId="cgr-panel">
        {sheet && (
          <ChangeRequestForm
            data={data}
            kind={kind}
            sheet={sheet}
            items={items}
            busy={busy}
            onRequest={(entryId, value, reason) => {
              setAskOpen(false);
              void act(async () => {
                const r = await store.requestGradeChange(entryId, value, reason);
                if (!r.ok) throw new Error(r.error);
                return "Change request sent to the registrar.";
              });
            }}
          />
        )}
      </SidePanel>
    </>
  );
}

const SHEET_STATUS_TEXT: Record<GradeSheet["status"], string> = {
  draft: "draft",
  submitted: "submitted",
  returned: "returned",
  posted: "posted",
};

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
    <div className="max-w-3xl" data-testid="approve-queue">
      <p className="mb-2 text-sm font-semibold">Waiting for approval ({sheets.length})</p>
      {sheets.length === 0 && <p className="text-sm text-muted">Nothing submitted in this class. Submitted grade sheets show up here.</p>}
      <ul className="divide-y divide-line/70">
        {sheets.map((s) => (
          <li key={s.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" className="min-w-0 text-left text-sm hover:underline" onClick={() => onOpen(s)}>
                <span className="font-semibold">{label(s)}</span>
                <span className="block text-xs text-muted">Submitted {fmtWhen(s.submitted_at)}. Open the sheet to check it.</span>
              </button>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" disabled={busy} onClick={() => { setReturning(returning === s.id ? null : s.id); setNote(""); }}>
                  Return
                </Button>
                {canApprove(s) && (
                  <Button size="sm" disabled={busy} onClick={() => onApprove(s)} data-testid={`approve-${s.period}${s.learning_area ? `-${s.learning_area}` : ""}`}>
                    Approve and post
                  </Button>
                )}
              </div>
            </div>
            {returning === s.id && (
              <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); onReturn(s, note); setReturning(null); }}>
                <input className={`${inputClass} flex-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the teacher fix?" data-testid="return-text" />
                <Button type="submit" variant="danger" disabled={busy || !note.trim()}>Return to teacher</Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function valueText(v: EntryValue, data: ClassSheetDetail) {
  if (!v.scores) return describeValue(v);
  return Object.entries(v.scores)
    .map(([id, sc]) => `${data.items.find((i) => i.id === id)?.label ?? "item"} ${sc ?? "blank"}`)
    .join(", ");
}

function ChangeRequestForm({
  data,
  kind,
  sheet,
  items,
  busy,
  onRequest,
}: {
  data: ClassSheetDetail;
  kind: ReturnType<typeof sheetKind>;
  sheet: GradeSheet;
  items: ItemDraft[];
  busy: boolean;
  onRequest: (entryId: string, value: EntryValue, reason: string) => void;
}) {
  const valuesFor = (id: string) => {
    const g = data.entries.find((e) => e.sheet_id === sheet.id && e.enrollment_id === id);
    return {
      text: g ? cellText(g.percent, g.mark) : "",
      scores: Object.fromEntries(items.map((i) => [i.id, g?.scores[i.id] != null ? String(g.scores[i.id]) : ""])) as Record<string, string>,
    };
  };
  const first = data.roster[0]?.enrollment_id ?? "";
  const [enrollmentId, setEnrollmentId] = useState(first);
  const [text, setText] = useState(() => valuesFor(first).text);
  const [itemScores, setItemScores] = useState<Record<string, string>>(() => valuesFor(first).scores);
  const [reason, setReason] = useState("");
  const entry = data.entries.find((e) => e.sheet_id === sheet.id && e.enrollment_id === enrollmentId);

  const pickStudent = (id: string) => {
    setEnrollmentId(id);
    const v = valuesFor(id);
    setText(v.text);
    setItemScores(v.scores);
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
  };
  const newQuarterly =
    kind === "k12" && sheet.subject_group
      ? quarterlyGrade(
          items.map((i) => ({ ...i, max_score: Number(i.max_score) })),
          Object.fromEntries(items.map((i) => [i.id, parseScore(itemScores[i.id] ?? "", Number(i.max_score)) ?? null])),
          data.settings.k12_weights[sheet.subject_group],
        ).quarterly
      : null;

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); send(); }} data-testid="cgr-form">
      <p className="text-sm text-muted">Posted grades are locked. The registrar approves or rejects the change, and it is kept in the sheet history.</p>
      <Field label="Student">
        <select className={inputClass} value={enrollmentId} onChange={(e) => pickStudent(e.target.value)} data-testid="cgr-student">
          {data.roster.map((r) => (
            <option key={r.enrollment_id} value={r.enrollment_id}>{r.name}</option>
          ))}
        </select>
      </Field>
      {entry && (
        <p className="text-sm">Posted now: <span className="num font-semibold">{kind === "college" ? cellText(entry.percent, entry.mark) || "blank" : `quarterly ${entry.grade ?? "blank"}`}</span></p>
      )}
      {kind === "college" ? (
        <Field label="New percent (or INC, DRP, W)">
          <input className={`${inputClass} num`} value={text} onChange={(e) => setText(e.target.value)} data-testid="cgr-value" />
        </Field>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map((it) => (
            <Field key={it.id} label={`${it.label} (of ${it.max_score})`}>
              <input className={`${inputClass} num text-right`} inputMode="decimal" value={itemScores[it.id] ?? ""} onChange={(e) => setItemScores((s) => ({ ...s, [it.id]: e.target.value }))} />
            </Field>
          ))}
          {newQuarterly != null && <p className="col-span-3 text-sm text-muted">New quarterly grade: <strong className="num text-ink">{newQuarterly}</strong></p>}
        </div>
      )}
      <Field label="Reason">
        <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="cgr-reason" placeholder="e.g. Final exam re-checked" />
      </Field>
      <Button type="submit" className="w-full" disabled={busy || !reason.trim() || !entry} data-testid="cgr-submit">
        Send request
      </Button>
    </form>
  );
}

function ChangeRequestList({
  data,
  role,
  sheet,
  nameOf,
  label,
  busy,
  onDecide,
}: {
  data: ClassSheetDetail;
  role: SessionInfo["actor"]["role"];
  sheet: GradeSheet | null;
  nameOf: (enrollmentId: string) => string;
  label: (s: GradeSheet) => string;
  busy: boolean;
  onDecide: (req: ChangeGradeRequest, approve: boolean, note: string) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const sheetOfReq = (r: ChangeGradeRequest) => data.sheets.find((s) => s.id === r.sheet_id)!;
  const shown = role === "registrar"
    ? [...data.requests].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"))
    : data.requests.filter((r) => r.sheet_id === sheet?.id || r.status === "pending");
  return (
    <div className="max-w-3xl" data-testid="change-requests">
      {shown.length === 0 && <p className="text-sm text-muted">No change requests yet. A teacher can ask for a change once a sheet is posted.</p>}
      <ul className="divide-y divide-line/70">
        {shown.map((r) => {
          const s = sheetOfReq(r);
          return (
            <li key={r.id} className="space-y-1.5 py-3 text-sm" data-testid="cgr-item">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{nameOf(r.enrollment_id)} <span className="font-normal text-muted">{label(s)}</span></p>
                {r.status === "pending" ? <Pill tone="ink">Pending</Pill> : r.status === "approved" ? <Pill tone="go">Approved</Pill> : <Pill tone="stop">Not approved</Pill>}
              </div>
              <p className="num">
                {valueText(r.old_value, data)} → <strong>{valueText(r.new_value, data)}</strong>
              </p>
              <p className="text-xs text-muted">“{r.reason}” {r.requested_by_name}, {fmtWhen(r.requested_at)}</p>
              {r.status !== "pending" ? (
                r.decision_note ? <p className="text-xs text-muted">Note: {r.decision_note}</p> : null
              ) : role === "registrar" ? (
                <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                  <input className={`${inputClass} flex-1`} placeholder="Note (needed to reject)" value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} data-testid="cgr-note" />
                  <div className="flex gap-2">
                    <Button variant="danger" disabled={busy || !(notes[r.id] ?? "").trim()} onClick={() => onDecide(r, false, notes[r.id] ?? "")}>
                      Reject
                    </Button>
                    <Button disabled={busy} onClick={() => onDecide(r, true, notes[r.id] ?? "")} data-testid="cgr-approve">
                      Approve change
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs font-medium text-muted">Waiting for the registrar</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SheetHistory({ rows, label }: { rows: ClassSheetDetail["history"]; label: string }) {
  if (!rows.length) return <p className="text-sm text-muted">No history for {label} yet. Saves, submits, approvals and changes show up here.</p>;
  return (
    <ol className="max-w-3xl" data-testid="sheet-history">
      {[...rows].reverse().map((h) => (
        <li key={h.id} className="relative border-l border-line pb-4 pl-5 text-sm last:pb-0">
          <span aria-hidden className="absolute top-1.5 -left-[4.5px] h-2 w-2 rounded-full bg-ink" />
          <p className="font-semibold first-letter:uppercase">{h.action.replace(/_/g, " ")}</p>
          <p className="text-xs text-muted">{h.actor_name}, {fmtWhen(h.created_at)}</p>
          {h.note && <p className="mt-0.5">“{h.note}”</p>}
        </li>
      ))}
    </ol>
  );
}
