import { describe, expect, it } from "vitest";
import {
  allowedActions,
  canSee,
  canTransition,
  checkCollegeLoad,
  checkPapers,
  checkSection,
  formatStudentNo,
  nextSeq,
  parseDays,
  planAction,
  requiredDocs,
  schedulesOverlap,
  sortForRole,
  stepIndex,
  type Actor,
  type EnrollmentDetail,
  type Offering,
  type PlanContext,
  type School,
} from "./index";
import * as seed from "../data/seed";
import { findSetup } from "../fees";

// ---------- helpers ----------
const school: School = structuredClone(seed.school);
const subject = (code: string): Offering => structuredClone(seed.offerings.find((o) => o.code === code)!);

const actor = (role: Actor["role"]): Actor => ({ user_id: `u-${role}`, role, name: role });

function detailFor(enrollmentId: string): EnrollmentDetail {
  const e = seed.enrollments.find((x) => x.id === enrollmentId)!;
  return structuredClone({
    enrollment: e,
    student: seed.students.find((s) => s.id === e.student_id)!,
    term: seed.terms.find((t) => t.id === e.term_id)!,
    documents: seed.documents.filter((d) => d.enrollment_id === e.id),
    loads: seed.enrollmentLoads.filter((l) => l.enrollment_id === e.id),
    offerings: seed.offerings.filter((o) => o.term_id === e.term_id),
    takenCounts: {},
    feeSetup: findSetup(seed.feeSetups, e),
    discounts: seed.discounts.filter((d) => d.enrollment_id === e.id),
    ledger: seed.ledger.filter((r) => r.enrollment_id === e.id),
    payments: seed.payments.filter((p) => p.enrollment_id === e.id),
    history: [],
  });
}

const byStatus = (status: string, track = "college") =>
  seed.enrollments.find((e) => e.status === status && e.track === track)!.id;

const ctx = (detail: EnrollmentDetail, role: Actor["role"], s: School = school): PlanContext => ({
  detail,
  school: s,
  actor: actor(role),
  now: "2026-06-10T00:00:00.000Z",
  nextStudentSeq: 5,
});

// ---------- status ----------
describe("status transitions", () => {
  it("orders the six steps", () => {
    expect(stepIndex("applied")).toBe(0);
    expect(stepIndex("officially_enrolled")).toBe(5);
    expect(stepIndex("rejected")).toBe(-1);
  });
  it("allows only listed moves", () => {
    expect(canTransition("applied", "papers_checked")).toBe(true);
    expect(canTransition("applied", "officially_enrolled")).toBe(false);
    expect(canTransition("rejected", "applied")).toBe(false);
    expect(canTransition("officially_enrolled", "withdrawn")).toBe(true);
  });
});

// ---------- roles ----------
describe("allowedActions", () => {
  const s = school.settings;
  it("registrar handles papers, ids and approval", () => {
    expect(allowedActions("registrar", { status: "applied", dean_approved: false }, s)).toEqual(["accept_papers", "needs_fix", "reject"]);
    expect(allowedActions("registrar", { status: "papers_checked", dean_approved: false }, s)).toContain("assign_id");
    expect(allowedActions("registrar", { status: "assessed_paid", dean_approved: false }, s)).toContain("approve");
    expect(allowedActions("registrar", { status: "officially_enrolled", dean_approved: false }, s)).toEqual(["withdraw"]);
  });
  it("cashier only takes payments once a load is set", () => {
    expect(allowedActions("cashier", { status: "applied", dean_approved: false }, s)).toEqual([]);
    expect(allowedActions("cashier", { status: "load_set", dean_approved: false }, s)).toEqual(["take_payment"]);
  });
  it("students pick subjects, teachers only read", () => {
    expect(allowedActions("student", { status: "student_made", dean_approved: false }, s)).toEqual(["set_load"]);
    expect(allowedActions("student", { status: "applied", dean_approved: false }, s)).toEqual([]);
    expect(allowedActions("teacher", { status: "load_set", dean_approved: false }, s)).toEqual([]);
  });
  it("dean step only when the school turns it on", () => {
    expect(allowedActions("dean", { status: "assessed_paid", dean_approved: false }, { use_dean_approval: false })).toEqual([]);
    expect(allowedActions("dean", { status: "assessed_paid", dean_approved: false }, { use_dean_approval: true })).toEqual(["dean_approve"]);
  });
  it("nothing after rejected or withdrawn", () => {
    expect(allowedActions("registrar", { status: "rejected", dean_approved: false }, s)).toEqual([]);
  });
});

// ---------- checks ----------
describe("papers", () => {
  it("transferees need honorable dismissal and TOR", () => {
    expect(requiredDocs({ track: "college", student_type: "transferee" })).toHaveLength(4);
    expect(requiredDocs({ track: "k12", student_type: "transferee" })).toHaveLength(2);
  });
  it("lists missing papers", () => {
    const w = checkPapers({ track: "college", student_type: "transferee" }, [
      { type: "psa_birth_cert", file_name: "a.pdf" },
      { type: "form_138", file_name: "b.pdf" },
    ]);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/Honorable dismissal/);
  });
});

describe("schedules", () => {
  it("parses day codes", () => {
    expect(parseDays("MWF")).toEqual(["M", "W", "F"]);
    expect(parseDays("TTh")).toEqual(["T", "Th"]);
    expect(parseDays("MTWThF")).toEqual(["M", "T", "W", "Th", "F"]);
  });
  it("detects overlapping times on a shared day", () => {
    expect(schedulesOverlap(subject("GE101"), subject("IT103"))).toBe(true); // MWF 8-9 vs 8:30-9:30
    expect(schedulesOverlap(subject("GE101"), subject("IT101"))).toBe(false); // back to back
    expect(schedulesOverlap(subject("GE101"), subject("GE102"))).toBe(false); // different days
  });
});

describe("college load checks", () => {
  const base = { student: { completed_codes: [] as string[] }, settings: { max_units: 24 }, takenCounts: {} };
  it("passes a normal load", () => {
    expect(checkCollegeLoad({ ...base, picked: ["GE101", "GE102", "IT101"].map(subject) })).toEqual([]);
  });
  it("flags missing prerequisites", () => {
    const w = checkCollegeLoad({ ...base, picked: [subject("IT201")] });
    expect(w.join()).toMatch(/IT201 needs IT102/);
    expect(checkCollegeLoad({ ...base, student: { completed_codes: ["IT102"] }, picked: [subject("IT201")] })).toEqual([]);
  });
  it("flags too many units", () => {
    const w = checkCollegeLoad({ ...base, settings: { max_units: 6 }, picked: ["GE101", "GE102", "MATH101"].map(subject) });
    expect(w.join()).toMatch(/Too many units: 9/);
  });
  it("flags time conflicts", () => {
    const w = checkCollegeLoad({ ...base, picked: ["GE101", "IT103"].map(subject) });
    expect(w.join()).toMatch(/Time conflict: GE101 and IT103/);
  });
  it("flags full subjects", () => {
    const it103 = subject("IT103");
    const w = checkCollegeLoad({ ...base, picked: [it103], takenCounts: { [it103.id]: 1 } });
    expect(w.join()).toMatch(/IT103 is full/);
  });
});

describe("K to 12 section checks", () => {
  const stem = seed.offerings.find((o) => o.code === "G11-STEM-RIZAL")!;
  it("checks capacity, level and strand", () => {
    expect(checkSection(stem, { level: "Grade 11", strand: "STEM" }, {})).toEqual([]);
    expect(checkSection(stem, { level: "Grade 11", strand: "STEM" }, { [stem.id]: 2 })[0]).toMatch(/full/);
    expect(checkSection(stem, { level: "Grade 7", strand: null }, {}).length).toBeGreaterThan(0);
    expect(checkSection(stem, { level: "Grade 11", strand: "ABM" }, {})[0]).toMatch(/STEM/);
    expect(checkSection(undefined, { level: "Grade 7", strand: null }, {})).toEqual(["Pick a section."]);
  });
});

// ---------- ids ----------
describe("student numbers", () => {
  it("formats {code}-{year}-{seq}", () => {
    expect(formatStudentNo("SA", "2026-2027", 7)).toBe("SA-2026-0007");
  });
  it("finds the next free number for the year", () => {
    expect(nextSeq(["SA-2026-0001", "SA-2026-0004", "SA-2025-0009", null], "SA", "2026-2027")).toBe(5);
    expect(nextSeq([], "SA", "2026-2027")).toBe(1);
  });
});

// ---------- planAction: the full flow ----------
describe("planAction", () => {
  it("registrar accepts complete papers", () => {
    const r = planAction(ctx(detailFor(byStatus("applied")), "registrar"), { type: "accept_papers" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mutations.enrollment.status).toBe("papers_checked");
      expect(r.mutations.history.from_status).toBe("applied");
      expect(r.mutations.history.to_status).toBe("papers_checked");
    }
  });

  it("missing papers need a typed override reason", () => {
    const transferee = seed.enrollments.find((e) => e.student_type === "transferee")!.id;
    const d = detailFor(transferee);
    const blocked = planAction(ctx(d, "registrar"), { type: "accept_papers" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.canOverride).toBe(true);
      expect(blocked.warnings[0]).toMatch(/TOR/);
    }
    const ok = planAction(ctx(d, "registrar"), { type: "accept_papers", override_reason: "TOR to follow" });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.mutations.enrollment.overrides?.[0].reason).toBe("TOR to follow");
      expect(ok.mutations.history.reason).toMatch(/Override: TOR to follow/);
    }
  });

  it("needs fix keeps the status at applied with a note", () => {
    const r = planAction(ctx(detailFor(byStatus("applied")), "registrar"), { type: "needs_fix", note: "Blurry PSA" });
    expect(r.ok && r.mutations.enrollment.status).toBe("applied");
    expect(r.ok && r.mutations.enrollment.fix_note).toBe("Blurry PSA");
    const empty = planAction(ctx(detailFor(byStatus("applied")), "registrar"), { type: "needs_fix", note: " " });
    expect(empty.ok).toBe(false);
  });

  it("cashier cannot accept papers", () => {
    const r = planAction(ctx(detailFor(byStatus("applied")), "cashier"), { type: "accept_papers" });
    expect(r.ok).toBe(false);
  });

  it("assign ID gives a new student number", () => {
    const r = planAction(ctx(detailFor(byStatus("papers_checked", "k12")), "registrar"), { type: "assign_id" });
    expect(r.ok && r.mutations.student?.student_no).toBe("SA-2026-0005");
    expect(r.ok && r.mutations.enrollment.status).toBe("student_made");
  });

  it("student picks subjects and gets assessed", () => {
    const d = detailFor(byStatus("student_made"));
    const ids = ["GE102", "IT201", "MATH101"].map((c) => subject(c).id);
    const r = planAction(ctx(d, "student"), { type: "set_load", offering_ids: ids });
    expect(r.ok).toBe(true); // Pedro already passed IT102
    if (r.ok) {
      expect(r.mutations.enrollment.status).toBe("load_set");
      expect(r.mutations.replaceLoads).toHaveLength(3);
      // charges plus the back account stays: 2 tuition lines, 1 lab, 6 misc
      expect(r.mutations.postLedger?.map((x) => x.code)).toContain("lab:IT201");
      expect(r.mutations.postLedger?.every((x) => x.kind === "charge")).toBe(true);
    }
  });

  it("a student cannot override a failed check", () => {
    const d = detailFor(byStatus("student_made"));
    const r = planAction(ctx(d, "student"), {
      type: "set_load",
      offering_ids: ["GE101", "IT103"].map((c) => subject(c).id),
      override_reason: "please",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.canOverride).toBe(false);
  });

  it("needs a fee setup to set the load", () => {
    const d = detailFor(byStatus("student_made"));
    d.feeSetup = null;
    const r = planAction(ctx(d, "student"), { type: "set_load", offering_ids: [subject("GE102").id] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/fee setup/);
  });

  it("downpayment moves load_set to assessed_paid", () => {
    const d = detailFor(byStatus("load_set"));
    const small = planAction(ctx(d, "cashier"), { type: "take_payment", amount: 1000, or_no: "A1" });
    expect(small.ok && small.mutations.enrollment.status).toBe("load_set");
    const enough = planAction(ctx(d, "cashier"), { type: "take_payment", amount: 3000, or_no: "A2" });
    expect(enough.ok && enough.mutations.enrollment.status).toBe("assessed_paid");
    expect(enough.ok && enough.mutations.addPayment?.payment.or_no).toBe("A2");
    expect(enough.ok && enough.mutations.addPayment?.row.credit).toBe(3000);
    const noOr = planAction(ctx(d, "cashier"), { type: "take_payment", amount: 3000, or_no: "" });
    expect(noOr.ok).toBe(false);
  });

  it("approval warns about an unpaid back account", () => {
    const d = detailFor(byStatus("student_made")); // Pedro: 4,250 carried from last year
    d.enrollment.status = "load_set";
    const r = planAction(ctx(d, "registrar"), { type: "approve" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.warnings.join()).toMatch(/back account: ₱4,250.00/);
  });

  it("approval requires a downpayment unless overridden", () => {
    const d = detailFor(byStatus("load_set"));
    const blocked = planAction(ctx(d, "registrar"), { type: "approve" });
    expect(blocked.ok).toBe(false);
    const ok = planAction(ctx(d, "registrar"), { type: "approve", override_reason: "Scholar, pays later" });
    expect(ok.ok && ok.mutations.enrollment.status).toBe("officially_enrolled");
  });

  it("approves a paid enrollment", () => {
    const r = planAction(ctx(detailFor(byStatus("assessed_paid")), "registrar"), { type: "approve" });
    expect(r.ok && r.mutations.enrollment.status).toBe("officially_enrolled");
  });

  it("dean approval is required first when the setting is on", () => {
    const withDean: School = { ...school, settings: { ...school.settings, use_dean_approval: true } };
    const d = detailFor(byStatus("assessed_paid"));
    expect(planAction(ctx(d, "registrar", withDean), { type: "approve" }).ok).toBe(false);
    const dean = planAction(ctx(d, "dean", withDean), { type: "dean_approve" });
    expect(dean.ok && dean.mutations.enrollment.dean_approved).toBe(true);
    d.enrollment.dean_approved = true;
    expect(planAction(ctx(d, "registrar", withDean), { type: "approve" }).ok).toBe(true);
  });

  it("withdraw needs a reason", () => {
    const d = detailFor(byStatus("officially_enrolled"));
    expect(planAction(ctx(d, "registrar"), { type: "withdraw", reason: "" }).ok).toBe(false);
    const r = planAction(ctx(d, "registrar"), { type: "withdraw", reason: "Moved to Cebu" });
    expect(r.ok && r.mutations.enrollment.status).toBe("withdrawn");
  });

  it("K to 12 picks one section", () => {
    const d = detailFor(byStatus("load_set", "k12"));
    const narra = seed.offerings.find((o) => o.code === "G11-ABM-MABINI")!;
    const r = planAction(ctx(d, "parent"), { type: "set_load", offering_ids: [narra.id] });
    expect(r.ok).toBe(false); // ABM section for a STEM student
  });
});

// ---------- queue ----------
describe("queue", () => {
  const item = (status: any, updated_at: string, balance = 0) => ({
    status, dean_approved: false, fix_note: null, balance, updated_at,
  });
  it("puts items waiting on the role first", () => {
    const list = [item("load_set", "2026-01-03"), item("applied", "2026-01-01"), item("officially_enrolled", "2026-01-05")];
    expect(sortForRole("registrar", list, school.settings)[0].status).toBe("applied");
    expect(sortForRole("cashier", list, school.settings)[0].status).toBe("load_set");
  });
  it("students only see themselves, parents their children", () => {
    const s = { id: "s1", user_id: "u1", guardian_user_id: null };
    expect(canSee("student", "u1", s, [], false)).toBe(true);
    expect(canSee("student", "u2", s, [], false)).toBe(false);
    expect(canSee("parent", "p1", s, [{ parent_user_id: "p1", student_id: "s1" }], false)).toBe(true);
    expect(canSee("teacher", "t1", s, [], false)).toBe(false);
    expect(canSee("cashier", "c1", s, [], false)).toBe(true);
  });
});
