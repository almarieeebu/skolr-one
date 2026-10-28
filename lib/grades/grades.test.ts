import { describe, expect, it } from "vitest";
import {
  DEPED_TRANSMUTATION,
  approverRole,
  collegeReport,
  collegeResult,
  computeGwa,
  defaultCollegeScale,
  defaultGradeSettings,
  defaultK12Weights,
  descriptor,
  entryFilled,
  entryGrade,
  finalGrade,
  generalAverage,
  isPastDeadline,
  k12Report,
  learningAreasFor,
  passedCodes,
  planChangeDecision,
  planChangeRequest,
  planSheetAction,
  quarterlyGrade,
  sheetActions,
  transmuteCollege,
  transmuteDepEd,
  validateCollegeScale,
  validateGradeSettings,
  type ChangeGradeRequest,
  type GradeActor,
  type GradeSettings,
  type SheetContext,
} from "./index";
import { checkCollegeLoad } from "../enrollment/checks";
import * as seed from "../data/seed";

const settings = (over: Partial<GradeSettings> = {}): GradeSettings => ({ ...defaultGradeSettings("s1"), ...over });
const pct = (...ps: (number | "INC" | "DRP" | "W" | null)[]) => {
  const keys = ["prelim", "midterm", "semifinal", "final"] as const;
  const out: Record<string, { percent: number | null; mark: "INC" | "DRP" | "W" | null }> = {};
  ps.forEach((p, i) => {
    if (p === null) return;
    out[keys[i]] = typeof p === "number" ? { percent: p, mark: null } : { percent: null, mark: p };
  });
  return out;
};
const actor = (role: GradeActor["role"], user_id = `u-${role}`): GradeActor => ({ user_id, role, name: role });

// ---------- college ----------
describe("college transmutation", () => {
  const scale = defaultCollegeScale();
  it("maps percent to the 1.00-5.00 scale", () => {
    expect(transmuteCollege(100, scale)).toBe(1.0);
    expect(transmuteCollege(97, scale)).toBe(1.0);
    expect(transmuteCollege(96, scale)).toBe(1.25);
    expect(transmuteCollege(90, scale)).toBe(1.75);
    expect(transmuteCollege(85, scale)).toBe(2.0);
    expect(transmuteCollege(76, scale)).toBe(2.75);
    expect(transmuteCollege(75, scale)).toBe(3.0);
    expect(transmuteCollege(74, scale)).toBe(5.0);
    expect(transmuteCollege(0, scale)).toBe(5.0);
  });
  it("rounds the percent to a whole number first", () => {
    expect(transmuteCollege(74.5, scale)).toBe(3.0);
    expect(transmuteCollege(96.4, scale)).toBe(1.25);
    expect(transmuteCollege(96.5, scale)).toBe(1.0);
  });
  it("checks an edited scale for gaps and overlaps", () => {
    expect(validateCollegeScale(scale)).toEqual([]);
    const gap = scale.filter((r) => r.min !== 75);
    expect(validateCollegeScale(gap).join()).toMatch(/No grade for 75%/);
    expect(validateCollegeScale([...scale, { min: 90, max: 90, grade: 1.5 }]).join()).toMatch(/90% is in more than one row/);
  });
  it("uses a school's own scale", () => {
    const strict = defaultCollegeScale().map((r) => (r.min === 75 ? { ...r, grade: 3.0 } : r));
    strict[0] = { min: 98, max: 100, grade: 1.0 };
    strict[1] = { min: 94, max: 97, grade: 1.25 };
    expect(transmuteCollege(97, strict)).toBe(1.25);
  });
});

describe("college average rules", () => {
  it("all four (default): equal weights", () => {
    const r = collegeResult(pct(88, 90, 86, 92), settings());
    expect(r.average).toBe(89);
    expect(r.final).toBe(1.75);
    expect(r.remarks).toBe("Passed");
  });
  it("all four: a missing period counts as zero", () => {
    const r = collegeResult(pct(null, 90, 90, 90), settings());
    expect(r.average).toBe(67.5);
    expect(r.final).toBe(5.0);
    expect(r.remarks).toBe("Failed");
  });
  it("grades present: divides by the periods that have a grade", () => {
    const r = collegeResult(pct(null, 90, 90, 90), settings({ college_average: "present" }));
    expect(r.average).toBe(90);
    expect(r.final).toBe(1.75);
  });
  it("final only: the Final period is the average", () => {
    const r = collegeResult(pct(70, 70, 70, 95), settings({ college_average: "final_only" }));
    expect(r.average).toBe(95);
    expect(r.final).toBe(1.25);
  });
  it("per-period weights", () => {
    const s = settings({ period_weights: { prelim: 20, midterm: 20, semifinal: 20, final: 40 } });
    expect(collegeResult(pct(80, 80, 80, 90), s).average).toBe(84);
  });
  it("no final grade until the Final period is in", () => {
    expect(collegeResult(pct(90, 90), settings()).final).toBeNull();
  });
  it("INC / DRP / W: no average by default", () => {
    expect(collegeResult(pct(90, 92, 88, "INC"), settings())).toMatchObject({ final: null, mark: "INC", remarks: "Incomplete" });
    expect(collegeResult(pct(90, "DRP"), settings())).toMatchObject({ final: null, mark: "DRP", remarks: "Dropped" });
    expect(collegeResult(pct(90, "INC", "W"), settings())).toMatchObject({ mark: "W", remarks: "Dropped" });
  });
  it("with the INC block off, INC periods are skipped", () => {
    const s = settings({ block_average_on_inc: false });
    const r = collegeResult(pct(90, "INC", 90, 90), s);
    expect(r.average).toBe(90);
    expect(r.remarks).toBe("Passed");
  });
});

describe("GWA", () => {
  const ok = (final: number) => ({ average: 0, final, mark: null, remarks: "Passed" as const });
  it("sum(grade x units) / sum(units)", () => {
    expect(computeGwa([
      { units: 3, non_credit: false, result: ok(1.5) },
      { units: 2, non_credit: false, result: ok(2.0) },
    ]).gwa).toBe(1.7);
  });
  it("leaves out INC, DRP, W and non-credit (NSTP) subjects", () => {
    const r = computeGwa([
      { units: 3, non_credit: false, result: ok(1.75) },
      { units: 3, non_credit: true, result: ok(1.0) }, // NSTP
      { units: 2, non_credit: false, result: { average: null, final: null, mark: "INC", remarks: "Incomplete" } },
      { units: 3, non_credit: false, result: { average: null, final: null, mark: "W", remarks: "Dropped" } },
    ]);
    expect(r).toEqual({ gwa: 1.75, units: 3 });
  });
  it("rounds per the school setting", () => {
    const subjects = [
      { units: 3, non_credit: false, result: ok(1.25) },
      { units: 3, non_credit: false, result: ok(1.5) },
      { units: 3, non_credit: false, result: ok(2.0) },
    ];
    expect(computeGwa(subjects, 2).gwa).toBe(1.58);
    expect(computeGwa(subjects, 1).gwa).toBe(1.6);
  });
  it("seed: Carla's GWA counts MATH101 only (PE1 is INC, NSTP1 is non-credit, GE102 is not final)", () => {
    const carla = seed.enrollments.find((e) => seed.students.find((s) => s.id === e.student_id)!.first_name === "Carla" && e.term_id === seed.TERM_COLLEGE)!;
    const subjects = seed.enrollmentLoads.filter((l) => l.enrollment_id === carla.id).map((l) => seed.offerings.find((o) => o.id === l.offering_id)!);
    const all = collegeReport({ subjects, enrollmentId: carla.id, sheets: seed.gradeSheets, entries: seed.gradeEntries, settings: seed.gradeSettings, postedOnly: false });
    expect(all.gwa).toBe(1.75);
    expect(all.gwaUnits).toBe(3);
    expect(all.rows.find((r) => r.offering.code === "PE1")!.result.remarks).toBe("Incomplete");
    // Students see posted grades only: GE102 (draft) shows nothing.
    const posted = collegeReport({ subjects, enrollmentId: carla.id, sheets: seed.gradeSheets, entries: seed.gradeEntries, settings: seed.gradeSettings, postedOnly: true });
    expect(posted.rows.find((r) => r.offering.code === "GE102")!.periods.prelim.percent).toBeNull();
    expect(all.rows.find((r) => r.offering.code === "GE102")!.periods.prelim.percent).toBe(91);
  });
});

// ---------- K to 12 ----------
describe("DepEd transmutation table (DO 8 s. 2015)", () => {
  it("has the full table from 60 to 100", () => {
    expect(DEPED_TRANSMUTATION).toHaveLength(41);
    expect(DEPED_TRANSMUTATION.map(([, g]) => g)).toEqual(Array.from({ length: 41 }, (_, i) => 100 - i));
  });
  it("known points", () => {
    expect(transmuteDepEd(100)).toBe(100);
    expect(transmuteDepEd(99.99)).toBe(99);
    expect(transmuteDepEd(98.4)).toBe(99);
    expect(transmuteDepEd(98.39)).toBe(98);
    expect(transmuteDepEd(84)).toBe(90);
    expect(transmuteDepEd(83.99)).toBe(89);
    expect(transmuteDepEd(61.59)).toBe(75);
    expect(transmuteDepEd(60)).toBe(75);
    expect(transmuteDepEd(59.99)).toBe(74);
    expect(transmuteDepEd(56)).toBe(74);
    expect(transmuteDepEd(4)).toBe(61);
    expect(transmuteDepEd(3.99)).toBe(60);
    expect(transmuteDepEd(0)).toBe(60);
  });
});

describe("DepEd weights and quarterly grade", () => {
  const w = defaultK12Weights();
  it("default weights by subject group", () => {
    expect(w.lang_ap_esp).toEqual({ ww: 30, pt: 50, qa: 20 });
    expect(w.sci_math).toEqual({ ww: 40, pt: 40, qa: 20 });
    expect(w.mapeh_epp_tle).toEqual({ ww: 20, pt: 60, qa: 20 });
    expect(w.shs_core).toEqual({ ww: 25, pt: 50, qa: 25 });
    expect(w.shs_academic).toEqual({ ww: 25, pt: 45, qa: 30 });
    expect(w.shs_immersion).toEqual({ ww: 35, pt: 40, qa: 25 });
    expect(w.shs_tvl).toEqual({ ww: 20, pt: 60, qa: 20 });
    for (const g of Object.values(w)) expect(g.ww + g.pt + g.qa).toBe(100);
  });
  it("learning areas map to their groups", () => {
    const g7 = learningAreasFor("Grade 7");
    expect(g7.find((a) => a.code === "MATH")!.group).toBe("sci_math");
    expect(g7.find((a) => a.code === "AP")!.group).toBe("lang_ap_esp");
    expect(g7.find((a) => a.code === "TLE")!.group).toBe("mapeh_epp_tle");
    expect(g7.filter((a) => a.parent === "MAPEH").map((a) => a.code)).toEqual(["MUS", "ARTS", "PE", "HEALTH"]);
    expect(learningAreasFor("Grade 11", "STEM").find((a) => a.code === "PR1")!.group).toBe("shs_immersion");
    expect(learningAreasFor("Kinder")).toEqual([]);
  });
  const items = [
    { id: "w1", component: "ww" as const, max_score: 20 },
    { id: "w2", component: "ww" as const, max_score: 20 },
    { id: "p1", component: "pt" as const, max_score: 50 },
    { id: "q1", component: "qa" as const, max_score: 50 },
  ];
  it("PS = raw / highest x 100; WS = PS x weight; initial = sum; then transmute", () => {
    // Math (40/40/20): WW 30/40 = 75 -> 30; PT 40/50 = 80 -> 32; QA 35/50 = 70 -> 14; initial 76 -> 85
    const r = quarterlyGrade(items, { w1: 14, w2: 16, p1: 40, q1: 35 }, w.sci_math);
    expect(r.ww).toMatchObject({ raw: 30, highest: 40, ps: 75, ws: 30 });
    expect(r.pt).toMatchObject({ ps: 80, ws: 32 });
    expect(r.qa).toMatchObject({ ps: 70, ws: 14 });
    expect(r.initial).toBe(76);
    expect(r.quarterly).toBe(85);
    // Same scores in English (30/50/20): 22.5 + 40 + 14 = 76.5 -> 85
    expect(quarterlyGrade(items, { w1: 14, w2: 16, p1: 40, q1: 35 }, w.lang_ap_esp).initial).toBe(76.5);
  });
  it("perfect scores give 100; blank scores count as 0", () => {
    expect(quarterlyGrade(items, { w1: 20, w2: 20, p1: 50, q1: 50 }, w.sci_math).quarterly).toBe(100);
    expect(quarterlyGrade(items, {}, w.sci_math).quarterly).toBe(60);
  });
  it("final grade = average of quarterly grades, whole number", () => {
    expect(finalGrade([85, 87, 88, 90])).toBe(88); // 87.5 -> 88
    expect(finalGrade([85, 86, 86, 86])).toBe(86); // 85.75 -> 86
    expect(finalGrade([85, null, 88, 90])).toBeNull();
  });
  it("descriptors and passing", () => {
    expect(descriptor(90)).toBe("Outstanding");
    expect(descriptor(89)).toBe("Very Satisfactory");
    expect(descriptor(80)).toBe("Satisfactory");
    expect(descriptor(75)).toBe("Fairly Satisfactory");
    expect(descriptor(74)).toBe("Did Not Meet Expectations");
  });
  it("general average counts MAPEH once (average of its four components)", () => {
    const r = generalAverage([
      { code: "FIL", final: 90 },
      { code: "ENG", final: 86 },
      { code: "MUS", parent: "MAPEH", final: 88 },
      { code: "ARTS", parent: "MAPEH", final: 90 },
      { code: "PE", parent: "MAPEH", final: 92 },
      { code: "HEALTH", parent: "MAPEH", final: 91 },
    ]);
    // MAPEH = round(90.25) = 90; (90 + 86 + 90) / 3 = 88.67 -> 89
    expect(r.mapeh).toBe(90);
    expect(r.count).toBe(3);
    expect(r.exact).toBe(88.67);
    expect(r.average).toBe(89);
    expect(generalAverage([{ code: "FIL", final: 90 }, { code: "ENG", final: null }]).average).toBeNull();
  });
  it("seed: Grade 7 Q1 is posted for every learning area; Q2 Math is a draft", () => {
    const paolo = seed.enrollments.find((e) => seed.students.find((s) => s.id === e.student_id)!.first_name === "Paolo")!;
    const g7 = seed.offerings.find((o) => o.code === "G7-SAMPAGUITA")!;
    const args = { level: "Grade 7", strand: null, sectionId: g7.id, enrollmentId: paolo.id, sheets: seed.gradeSheets, entries: seed.gradeEntries };
    const posted = k12Report({ ...args, postedOnly: true });
    expect(posted.rows.every((r) => (r.quarters.q1 ?? 0) >= 60)).toBe(true);
    expect(posted.rows.find((r) => r.code === "MATH")!.quarters.q2).toBeNull();
    expect(posted.mapeh!.quarters.q1).toBeGreaterThan(60);
    expect(k12Report({ ...args, postedOnly: false }).rows.find((r) => r.code === "MATH")!.quarters.q2).not.toBeNull();
  });
});

describe("entries", () => {
  const s = settings();
  it("works out the stored grade", () => {
    expect(entryGrade("college", { percent: 88, mark: null, scores: {} }, [], s)).toBe(1.75);
    expect(entryGrade("college", { percent: null, mark: "INC", scores: {} }, [], s)).toBeNull();
    const items = [{ id: "a", component: "ww" as const, max_score: 10 }, { id: "b", component: "pt" as const, max_score: 10 }, { id: "c", component: "qa" as const, max_score: 10 }];
    expect(entryGrade("k12", { percent: null, mark: null, scores: { a: 10, b: 10, c: 10 } }, items, s, { group: "sci_math" })).toBe(100);
    expect(entryGrade("k12", { percent: null, mark: null, scores: {} }, items, s, { group: "sci_math" })).toBeNull();
  });
  it("knows when a row is filled in", () => {
    expect(entryFilled("college", { percent: 0, mark: null, scores: {}, domains: {} }, [])).toBe(true);
    expect(entryFilled("college", { percent: null, mark: "INC", scores: {}, domains: {} }, [])).toBe(true);
    expect(entryFilled("college", { percent: null, mark: null, scores: {}, domains: {} }, [])).toBe(false);
    expect(entryFilled("k12", { percent: null, mark: null, scores: { a: 5, b: null }, domains: {} }, [{ id: "a" }, { id: "b" }])).toBe(false);
    expect(entryFilled("kinder", { percent: null, mark: null, scores: {}, domains: { SE: "C" } }, [])).toBe(false);
  });
});

// ---------- workflow ----------
describe("grade sheet workflow", () => {
  const base = (over: Partial<SheetContext> = {}): SheetContext => ({
    actor: actor("teacher"),
    sheet: { status: "draft", late_allowed: false },
    teachesClass: true,
    useDean: false,
    deadline: "2026-10-24",
    now: "2026-10-20T02:00:00.000Z",
    ...over,
  });

  it("teacher: save and submit own class only", () => {
    expect(sheetActions(base())).toEqual(["save", "submit"]);
    expect(sheetActions(base({ teachesClass: false }))).toEqual([]);
    const r = planSheetAction(base({ teachesClass: false }), { type: "save" });
    expect(r.ok).toBe(false);
  });
  it("draft -> submitted -> posted (locked)", () => {
    const sub = planSheetAction(base(), { type: "submit" });
    expect(sub.ok && sub.sheet.status).toBe("submitted");
    expect(sub.ok && sub.history?.to_status).toBe("submitted");
    const reg = base({ actor: actor("registrar"), teachesClass: false, sheet: { status: "submitted", late_allowed: false } });
    expect(sheetActions(reg)).toEqual(["approve", "return"]);
    const post = planSheetAction(reg, { type: "approve" });
    expect(post.ok && post.sheet.status).toBe("posted");
    // Posted is locked for the teacher.
    const locked = planSheetAction(base({ sheet: { status: "posted", late_allowed: false } }), { type: "save" });
    expect(locked).toMatchObject({ ok: false });
    expect(!locked.ok && locked.error).toMatch(/locked/);
  });
  it("submit needs every student graded", () => {
    const r = planSheetAction(base(), { type: "submit" }, 2);
    expect(!r.ok && r.error).toMatch(/2 students have no grade/);
  });
  it("registrar returns with a note; teacher can edit again", () => {
    const reg = base({ actor: actor("registrar"), teachesClass: false, sheet: { status: "submitted", late_allowed: false } });
    expect(planSheetAction(reg, { type: "return", note: " " }).ok).toBe(false);
    const r = planSheetAction(reg, { type: "return", note: "Check Juan's midterm" });
    expect(r.ok && r.sheet).toMatchObject({ status: "returned", return_note: "Check Juan's midterm" });
    expect(sheetActions(base({ sheet: { status: "returned", late_allowed: false } }))).toEqual(["save", "submit"]);
  });
  it("dean approves instead of the registrar when the school uses the dean step", () => {
    expect(approverRole(true)).toBe("dean");
    const sheet = { status: "submitted" as const, late_allowed: false };
    expect(sheetActions(base({ actor: actor("dean"), teachesClass: false, sheet, useDean: true }))).toEqual(["approve", "return"]);
    expect(sheetActions(base({ actor: actor("registrar"), teachesClass: false, sheet, useDean: true }))).toEqual(["return"]);
    expect(sheetActions(base({ actor: actor("dean"), teachesClass: false, sheet, useDean: false }))).toEqual([]);
  });
  it("after the deadline the registrar must allow a late submission", () => {
    const late = { now: "2026-10-26T02:00:00.000Z" };
    expect(isPastDeadline("2026-10-24", "2026-10-24T15:00:00.000Z")).toBe(false); // still Oct 24 in Manila? no: 23:00 -> same day
    expect(isPastDeadline("2026-10-24", "2026-10-24T16:30:00.000Z")).toBe(true); // 00:30 Oct 25 in Manila
    const r = planSheetAction(base(late), { type: "submit" });
    expect(!r.ok && r.error).toMatch(/deadline .* has passed/);
    expect(sheetActions(base({ ...late, actor: actor("registrar"), teachesClass: false }))).toContain("allow_late");
    const allowed = planSheetAction(base({ ...late, actor: actor("registrar"), teachesClass: false }), { type: "allow_late" });
    expect(allowed.ok && allowed.sheet.late_allowed).toBe(true);
    const ok = planSheetAction(base({ ...late, sheet: { status: "draft", late_allowed: true } }), { type: "submit" });
    expect(ok.ok && ok.history?.note).toMatch(/Late submission/);
  });
  it("students, parents and cashiers cannot act on sheets", () => {
    for (const role of ["student", "parent", "cashier"] as const) {
      expect(sheetActions(base({ actor: actor(role), teachesClass: false, sheet: { status: "submitted", late_allowed: false } }))).toEqual([]);
    }
  });
});

describe("change grade request", () => {
  const ctx = {
    actor: actor("teacher"),
    sheet: { id: "sh1", status: "posted" as const },
    entry: { id: "en1", enrollment_id: "e1", value: { percent: 95, mark: null } },
    teachesClass: true,
    pending: [] as Pick<ChangeGradeRequest, "entry_id" | "status">[],
    now: "2026-10-28T01:00:00.000Z",
  };
  it("teacher asks with a reason, only on posted grades", () => {
    expect(planChangeRequest(ctx, { new_value: { percent: 98, mark: null }, reason: "" }).ok).toBe(false);
    expect(planChangeRequest({ ...ctx, sheet: { id: "sh1", status: "draft" } }, { new_value: { percent: 98, mark: null }, reason: "x" }).ok).toBe(false);
    expect(planChangeRequest(ctx, { new_value: { percent: 95, mark: null }, reason: "x" }).ok).toBe(false);
    expect(planChangeRequest(ctx, { new_value: { percent: 101, mark: null }, reason: "x" }).ok).toBe(false);
    expect(planChangeRequest({ ...ctx, teachesClass: false }, { new_value: { percent: 98, mark: null }, reason: "x" }).ok).toBe(false);
    const r = planChangeRequest(ctx, { new_value: { percent: 98, mark: null }, reason: "Exam re-checked" });
    expect(r.ok && r.request).toMatchObject({ status: "pending", old_value: { percent: 95 }, new_value: { percent: 98 } });
    // Only one pending request per grade.
    expect(planChangeRequest({ ...ctx, pending: [{ entry_id: "en1", status: "pending" }] }, { new_value: { percent: 98, mark: null }, reason: "x" }).ok).toBe(false);
  });
  it("registrar approves (logged) or rejects with a note", () => {
    const made = planChangeRequest(ctx, { new_value: { percent: 98, mark: null }, reason: "Exam re-checked" });
    if (!made.ok) throw new Error(made.error);
    const request: ChangeGradeRequest = { ...made.request, id: "c1", school_id: "s1" };
    expect(planChangeDecision({ actor: actor("teacher"), request, now: ctx.now }, { approve: true }).ok).toBe(false);
    const ok = planChangeDecision({ actor: actor("registrar"), request, now: ctx.now }, { approve: true });
    expect(ok.ok && ok.apply).toEqual({ percent: 98, mark: null });
    expect(ok.ok && ok.history).toMatchObject({ action: "change_grade", entry_id: "en1" });
    expect(ok.ok && ok.history.note).toMatch(/95% → 98%/);
    expect(planChangeDecision({ actor: actor("registrar"), request, now: ctx.now }, { approve: false }).ok).toBe(false);
    const no = planChangeDecision({ actor: actor("registrar"), request, now: ctx.now }, { approve: false, note: "Keep as is" });
    expect(no.ok && no.apply).toBeNull();
    expect(no.ok && no.request.status).toBe("rejected");
    expect(planChangeDecision({ actor: actor("registrar"), request: { ...request, status: "approved" }, now: ctx.now }, { approve: true }).ok).toBe(false);
  });
});

describe("settings", () => {
  it("defaults are valid; bad weights are caught", () => {
    expect(validateGradeSettings(settings())).toEqual([]);
    const bad = settings({ period_weights: { prelim: 25, midterm: 25, semifinal: 25, final: 30 } });
    expect(validateGradeSettings(bad).join()).toMatch(/105%/);
    const w = defaultK12Weights();
    w.sci_math = { ww: 40, pt: 40, qa: 30 };
    expect(validateGradeSettings(settings({ k12_weights: w })).join()).toMatch(/Science, Math/);
  });
});

describe("prerequisites from posted grades", () => {
  const passed = passedCodes({
    enrollments: seed.enrollments.filter((e) => e.term_id === seed.TERM_PREV),
    offerings: seed.offerings, loads: seed.enrollmentLoads, sheets: seed.gradeSheets, entries: seed.gradeEntries, settings: seed.gradeSettings,
  });
  it("Pedro passed IT102 last year (posted), so IT201 is open to him", () => {
    expect(passed).toEqual(["GE101", "IT101", "IT102", "PE1"]);
    const it201 = seed.offerings.find((o) => o.code === "IT201")!;
    const base = { picked: [it201], settings: { max_units: 24 }, takenCounts: {} };
    expect(checkCollegeLoad({ ...base, student: { completed_codes: [] } }).join()).toMatch(/IT201 needs IT102/);
    expect(checkCollegeLoad({ ...base, student: { completed_codes: [] }, passedCodes: passed })).toEqual([]);
    // completed_codes still works for transferees / credited subjects.
    expect(checkCollegeLoad({ ...base, student: { completed_codes: ["IT102"] } })).toEqual([]);
  });
  it("a failed or unposted grade does not count", () => {
    const sheets = seed.gradeSheets.map((s) => ({ ...s, status: s.offering_id === seed.offerings.find((o) => o.code === "IT102" && o.term_id === seed.TERM_PREV)!.id && s.period === "final" ? ("submitted" as const) : s.status }));
    const p = passedCodes({
      enrollments: seed.enrollments.filter((e) => e.term_id === seed.TERM_PREV),
      offerings: seed.offerings, loads: seed.enrollmentLoads, sheets, entries: seed.gradeEntries, settings: seed.gradeSettings,
    });
    expect(p).not.toContain("IT102");
  });
});
