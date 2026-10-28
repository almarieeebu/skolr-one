import { describe, expect, it } from "vitest";
import {
  advanceOr,
  allocate,
  allocatePayments,
  assess,
  balance,
  canVoidPayment,
  collegeChargeLines,
  discountLines,
  feeSummary,
  findSetup,
  formatOr,
  k12ChargeLines,
  liveRows,
  pendingCarryForward,
  planFeeAction,
  planPayment,
  planTermClose,
  scheduleAmounts,
  splitByPercent,
  splitEven,
  syncLines,
  validateSetup,
  type AssessLine,
  type Discount,
  type FeeSetup,
  type LedgerDraft,
  type LedgerEntry,
} from "./index";
import type { EnrollmentDetail, Offering } from "../enrollment/types";
import * as seed from "../data/seed";

// ---------- helpers ----------
const collegeSetup = (): FeeSetup => structuredClone(seed.feeSetups.find((s) => s.term_id === seed.TERM_COLLEGE)!);
const subj = (code: string, units: number, lab = 0, is_major = false) => ({ code, units, lab_fee: lab, is_major });

let n = 0;
/** Turn drafts into posted rows (what a store does). */
function post(ledger: LedgerEntry[], drafts: LedgerDraft[], enrollment_id = "e1", at = "2026-06-10T01:00:00.000Z"): LedgerEntry[] {
  return [
    ...ledger,
    ...drafts.map(({ enrollment_id: target, ...d }) => ({
      ...d,
      id: `r${++n}`,
      school_id: "s",
      enrollment_id: target ?? enrollment_id,
      student_id: "st1",
      term_id: "t1",
      actor_id: "u",
      actor_name: null,
      posted_at: at,
    })),
  ];
}

const disc = (over: Partial<Discount>): Discount => ({
  id: `d${++n}`,
  school_id: "s",
  enrollment_id: "e1",
  name: "Discount",
  scope: "total",
  target: null,
  kind: "amount",
  value: 0,
  reason: "test",
  applied_by: "u",
  applied_by_name: null,
  applied_at: `2026-06-10T0${n % 10}:00:00.000Z`,
  voided_at: null,
  void_reason: null,
  ...over,
});

const amounts = (lines: AssessLine[]) => Object.fromEntries(lines.map((l) => [l.code, l.amount]));

// ---------- money ----------
describe("rounding", () => {
  it("puts leftover centavos on the last installment", () => {
    expect(splitEven(100001, 3)).toEqual([33333, 33333, 33335]);
    expect(splitByPercent(1001, [25, 25, 25, 25])).toEqual([250, 250, 250, 251]);
    expect(splitByPercent(1000000, [30, 30, 40])).toEqual([300000, 300000, 400000]);
    const parts = splitByPercent(1234567, [33.33, 33.33, 33.34]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1234567);
  });
});

// ---------- setup ----------
describe("fee setup", () => {
  it("picks the most specific scope", () => {
    const k12 = seed.feeSetups.filter((s) => s.track === "k12");
    expect(findSetup(k12, { term_id: seed.TERM_K12, track: "k12", course: null, level: "Grade 7" })!.scope_level).toBe("Grade 7");
    expect(findSetup(k12, { term_id: seed.TERM_K12, track: "k12", course: null, level: "Grade 4" })!.scope_level).toBeNull();
    expect(findSetup(k12, { term_id: seed.TERM_COLLEGE, track: "k12", course: null, level: "Grade 4" })).toBeNull();
  });
  it("checks exam percents add up to 100", () => {
    const s = collegeSetup();
    expect(validateSetup(s)).toEqual([]);
    s.exam_periods[0].percent = 30;
    expect(validateSetup(s).join()).toMatch(/add up to 100/);
  });
});

// ---------- assessment ----------
describe("assessment", () => {
  it("college: units x rate, major units at the major rate, lab per subject, misc", () => {
    const s = collegeSetup(); // 1200 / 1500 per unit, misc 4000
    const lines = collegeChargeLines(s, [subj("GE101", 3), subj("IT101", 3, 1500, true), subj("PE1", 2)]);
    expect(amounts(lines)).toMatchObject({ tuition: 6000, tuition_major: 4500, "lab:IT101": 1500, "misc:Library": 900 });
    const a = assess({ enrollment: seed.enrollments[0], setup: s, subjects: [subj("GE101", 3), subj("IT101", 3, 1500, true), subj("PE1", 2)], discounts: [] });
    expect(a.total).toBe(6000 + 4500 + 1500 + 4000);
  });

  it("K to 12: plan items + installment surcharge + misc - voucher", () => {
    const s = structuredClone(seed.feeSetups.find((x) => x.scope_level === "Grade 11")!);
    const quarterly = k12ChargeLines(s, "quarterly");
    expect(amounts(quarterly)).toMatchObject({ "plan:Tuition": 35000, surcharge: 1050 }); // 3%
    const sofia = seed.enrollments.find((e) => e.level === "Grade 11")!; // monthly + voucher
    const a = assess({ enrollment: sofia, setup: s, subjects: [], discounts: [] });
    expect(a.charges).toBe(35000 + 1750 + 5000);
    expect(a.discounts).toBe(-17500); // SHS voucher, fixed amount
    expect(a.total).toBe(24250);
  });
});

// ---------- discounts ----------
describe("discount order: item -> group -> total", () => {
  const charges: AssessLine[] = [
    { code: "tuition", label: "Tuition", group: "tuition", kind: "charge", amount: 10000 },
    { code: "lab:IT101", label: "Lab IT101", group: "lab", kind: "charge", amount: 2000 },
    { code: "misc:Library", label: "Library", group: "misc", kind: "charge", amount: 1000 },
  ];

  it("applies item, then group, then total, whatever order they were added", () => {
    const total10 = disc({ scope: "total", kind: "percent", value: 10, applied_at: "2026-01-01" });
    const tuition50 = disc({ scope: "group", target: "tuition", kind: "percent", value: 50, applied_at: "2026-01-02" });
    const lab500 = disc({ scope: "item", target: "lab:IT101", kind: "amount", value: 500, applied_at: "2026-01-03" });
    const lines = discountLines(charges, [total10, tuition50, lab500]);
    // item: lab 2000 - 500 = 1500 ; group: tuition 10000 * 50% = 5000 ;
    // total: what is left = 13000 - 500 - 5000 = 7500, 10% = 750
    expect(lines.map((l) => l.amount)).toEqual([-500, -5000, -750]);
  });

  it("group percent uses what is left after item discounts", () => {
    const item = disc({ scope: "item", target: "tuition", kind: "amount", value: 2000 });
    const group = disc({ scope: "group", target: "tuition", kind: "percent", value: 50 });
    expect(discountLines(charges, [group, item]).map((l) => l.amount)).toEqual([-2000, -4000]);
  });

  it("never discounts more than what is left", () => {
    const big = disc({ scope: "group", target: "misc", kind: "amount", value: 5000 });
    const all = disc({ scope: "total", kind: "percent", value: 100 });
    const lines = discountLines(charges, [big, all]);
    expect(lines.map((l) => l.amount)).toEqual([-1000, -12000]);
    expect(lines.reduce((a, l) => a + l.amount, 0) + 13000).toBe(0);
  });

  it("voided discounts do not count", () => {
    expect(discountLines(charges, [disc({ value: 100, voided_at: "x" })])).toEqual([]);
  });
});

// ---------- ledger ----------
describe("ledger", () => {
  it("syncs only changed lines, by reversing and reposting", () => {
    const first: AssessLine[] = [
      { code: "tuition", label: "Tuition", group: "tuition", kind: "charge", amount: 6000 },
      { code: "misc:Library", label: "Library", group: "misc", kind: "charge", amount: 900 },
    ];
    let l = post([], syncLines([], first, ["charge"], "x"));
    expect(balance(l)).toBe(6900);
    const second = [{ ...first[0], amount: 7200 }, first[1]];
    const rows = syncLines(l, second, ["charge"], "Reassessed");
    expect(rows.map((r) => [r.kind, r.code, r.debit, r.credit])).toEqual([
      ["void", "tuition", 0, 6000],
      ["charge", "tuition", 7200, 0],
    ]);
    l = post(l, rows);
    expect(balance(l)).toBe(8100);
    expect(liveRows(l).map((r) => r.code).sort()).toEqual(["misc:Library", "tuition"]);
    expect(syncLines(l, second, ["charge"], "again")).toEqual([]);
  });
});

// ---------- schedule + allocation ----------
describe("schedule and allocation", () => {
  const setup = collegeSetup(); // downpayment 3000, 4 x 25%
  const ledgerFor = (charge: number, prev = 0) =>
    post([], [
      ...(prev ? [{ kind: "previous_balance" as const, code: "prev:old", fee_group: null, description: "Previous", debit: prev, credit: 0, payment_id: null, reverses_id: null, reason: null }] : []),
      { kind: "charge", code: "tuition", fee_group: "tuition", description: "Tuition", debit: charge, credit: 0, payment_id: null, reverses_id: null, reason: null },
    ]);

  it("college: downpayment, then exam periods by percent, centavos on the last", () => {
    const due = scheduleAmounts({ track: "college", setup, plan: null, ledger: ledgerFor(13000.03) });
    expect(due.map((d) => d.label)).toEqual(["Downpayment", "Prelim", "Midterm", "Semi-final", "Final"]);
    expect(due.map((d) => d.amount)).toEqual([3000, 2500, 2500, 2500, 2500.03]);
  });

  it("K to 12: monthly = 10 months June to March", () => {
    const k = seed.feeSetups.find((x) => x.scope_level === "Grade 7")!;
    const due = scheduleAmounts({ track: "k12", setup: k, plan: "monthly", ledger: ledgerFor(23000.07) });
    expect(due).toHaveLength(11);
    expect(due[1].label).toBe("June");
    expect(due[10].label).toBe("March");
    expect(due.slice(1).map((d) => d.amount)).toEqual([...Array(9).fill(2000), 2000.07]);
    expect(scheduleAmounts({ track: "k12", setup: k, plan: "quarterly", ledger: ledgerFor(7000) })).toHaveLength(5);
    expect(scheduleAmounts({ track: "k12", setup: k, plan: "annual", ledger: ledgerFor(7000) })).toHaveLength(2);
  });

  it("pays the oldest first: back account, downpayment, then by due date", () => {
    const due = scheduleAmounts({ track: "college", setup, plan: null, ledger: ledgerFor(11000, 1500) });
    expect(due[0].key).toBe("prev");
    const { installments, creditCents } = allocate(due, 500000, 0, "2026-10-01");
    expect(installments.map((i) => [i.key, i.paid, i.status])).toEqual([
      ["prev", 1500, "paid"],
      ["down", 3000, "paid"],
      ["p1", 500, "overdue"], // Prelim was due Sep 15
      ["p2", 0, "upcoming"],
      ["p3", 0, "upcoming"],
      ["p4", 0, "upcoming"],
    ]);
    expect(creditCents).toBe(0);
  });

  it("keeps overpayment as credit and shows how each payment was used", () => {
    const due = scheduleAmounts({ track: "college", setup, plan: null, ledger: ledgerFor(3500) });
    const r = allocatePayments(due, [
      { id: "a", amount: 3200, voided_at: null },
      { id: "x", amount: 999, voided_at: "2026-06-11" },
      { id: "b", amount: 1000, voided_at: null },
    ]);
    // 3,500 = 3,000 downpayment + 4 x 125
    expect(r.byPayment.a.map((x) => [x.key, x.amount])).toEqual([["down", 3000], ["p1", 125], ["p2", 75]]);
    expect(r.byPayment.x).toBeUndefined();
    expect(r.byPayment.b.at(-1)).toEqual({ key: "credit", label: "Credit (overpayment)", amount: 700 });
    expect(r.creditCents).toBe(70000);
  });
});

// ---------- payments and voids ----------
function detailOf(enrollmentId: string): EnrollmentDetail {
  const e = seed.enrollments.find((x) => x.id === enrollmentId)!;
  return structuredClone({
    enrollment: e,
    student: seed.students.find((s) => s.id === e.student_id)!,
    term: seed.terms.find((t) => t.id === e.term_id)!,
    documents: [],
    loads: seed.enrollmentLoads.filter((l) => l.enrollment_id === e.id),
    offerings: seed.offerings.filter((o) => o.term_id === e.term_id) as Offering[],
    takenCounts: {},
    feeSetup: findSetup(seed.feeSetups, e),
    discounts: seed.discounts.filter((d) => d.enrollment_id === e.id),
    ledger: seed.ledger.filter((r) => r.enrollment_id === e.id),
    payments: seed.payments.filter((p) => p.enrollment_id === e.id),
    history: [],
  });
}
const byName = (first: string, term = seed.TERM_COLLEGE) =>
  seed.enrollments.find((e) => e.term_id === term && seed.students.find((s) => s.id === e.student_id)!.first_name === first)!.id;

describe("payments", () => {
  const now = "2026-06-20T03:00:00.000Z";
  it("validates amount, OR number and references", () => {
    const d = detailOf(byName("Ana"));
    expect(planPayment(d, { amount: 0, or_no: "1", mode: "cash" }, now).ok).toBe(false);
    expect(planPayment(d, { amount: 100, or_no: "", mode: "cash" }, now).ok).toBe(false);
    expect(planPayment(d, { amount: 100, or_no: "9", mode: "gcash" }, now).ok).toBe(false);
    const ok = planPayment(d, { amount: 100, or_no: "9", mode: "gcash", reference: "GC123" }, now);
    expect(ok.ok && ok.row.credit).toBe(100);
  });
  it("downpayment reached -> can proceed", () => {
    const d = detailOf(byName("Ana"));
    const small = planPayment(d, { amount: 2999.99, or_no: "1", mode: "cash" }, now);
    const enough = planPayment(d, { amount: 3000, or_no: "2", mode: "cash" }, now);
    expect(small.ok && small.downpaymentMet).toBe(false);
    expect(enough.ok && enough.downpaymentMet).toBe(true);
  });
  it("with a back account, the downpayment needs the old balance paid first", () => {
    const d = detailOf(byName("Pedro"));
    d.ledger = post(d.ledger, [{ kind: "charge", code: "tuition", fee_group: "tuition", description: "T", debit: 10000, credit: 0, payment_id: null, reverses_id: null, reason: null }]);
    const p1 = planPayment(d, { amount: 3000, or_no: "1", mode: "cash" }, now);
    expect(p1.ok && p1.downpaymentMet).toBe(false); // 4,250 back account comes first
    const p2 = planPayment(d, { amount: 7250, or_no: "1", mode: "cash" }, now);
    expect(p2.ok && p2.downpaymentMet).toBe(true);
  });
  it("OR numbers come from a per-school series", () => {
    const s = { school_id: "s", prefix: "OR-", next_no: 41, pad: 5 };
    expect(formatOr(s)).toBe("OR-00041");
    expect(advanceOr(s, "OR-00041").next_no).toBe(42);
    expect(advanceOr(s, "MANUAL-7").next_no).toBe(41);
  });
});

describe("voids", () => {
  const carla = byName("Carla");
  const pay = seed.payments.find((p) => p.enrollment_id === carla)!;
  const actor = (role: "cashier" | "registrar" | "student") => ({ user_id: `u-${role}`, role, name: role });

  it("cashier may void only on the same day; registrar overrides with a reason", () => {
    const sameDay = pay.paid_at.slice(0, 10) + "T08:00:00.000Z";
    expect(canVoidPayment("cashier", pay, sameDay).ok).toBe(true);
    expect(canVoidPayment("cashier", pay, "2026-07-30T08:00:00.000Z").ok).toBe(false);
    expect(canVoidPayment("registrar", pay, "2026-07-30T08:00:00.000Z")).toEqual({ ok: true, override: true });
    expect(canVoidPayment("student", pay, sameDay).ok).toBe(false);
  });

  it("a void posts a reversing row and never edits the payment row", () => {
    const d = detailOf(carla);
    const before = balance(d.ledger);
    const noReason = planFeeAction({ detail: d, actor: actor("registrar"), now: "2026-07-30T08:00:00.000Z", newId: "n" }, { type: "void_payment", payment_id: pay.id, reason: "" });
    expect(noReason.ok).toBe(false);
    const r = planFeeAction({ detail: d, actor: actor("registrar"), now: "2026-07-30T08:00:00.000Z", newId: "n" }, { type: "void_payment", payment_id: pay.id, reason: "Bounced check" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = r.mutations.ledger;
    expect(row).toMatchObject({ kind: "void", debit: pay.amount, credit: 0, payment_id: pay.id });
    expect(row.reason).toMatch(/Registrar override: Bounced check/);
    const after = post(d.ledger, r.mutations.ledger);
    expect(balance(after)).toBe(before + pay.amount);
    expect(after.slice(0, d.ledger.length)).toEqual(d.ledger);
  });
});

describe("discount actions", () => {
  it("registrar applies a scholarship with a reason; others cannot", () => {
    const d = detailOf(byName("Ana"));
    const input = { type: "apply_discount" as const, name: "Academic scholarship", scope: "group" as const, target: "tuition", kind: "percent" as const, value: 50, reason: "Dean's lister" };
    const reg = { user_id: "r", role: "registrar" as const, name: "R" };
    expect(planFeeAction({ detail: d, actor: { ...reg, role: "cashier" }, now: "2026-06-20", newId: "x" }, input).ok).toBe(false);
    expect(planFeeAction({ detail: d, actor: reg, now: "2026-06-20", newId: "x" }, { ...input, reason: "" }).ok).toBe(false);
    const r = planFeeAction({ detail: d, actor: reg, now: "2026-06-20", newId: "x" }, input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Ana's tuition: 10,800 + 4,500 = 15,300 -> 50% = 7,650
    expect(r.mutations.ledger).toHaveLength(1);
    expect(r.mutations.ledger[0]).toMatchObject({ kind: "discount", code: "disc:x", credit: 7650 });
  });
});

// ---------- closing ----------
describe("term closing", () => {
  it("carries a balance to the next-term enrollment as Previous balance", () => {
    const old = { id: "old", student_id: "st1", term_id: "t1", status: "officially_enrolled" as const, created_at: "2026-06-01" };
    const next = { id: "new", student_id: "st1", term_id: "t2", status: "student_made" as const, created_at: "2026-11-01" };
    const paidUp = { id: "paid", student_id: "st2", term_id: "t1", status: "officially_enrolled" as const, created_at: "2026-06-01" };
    const charge = (e: string, amt: number): LedgerDraft & { enrollment_id: string } => ({
      enrollment_id: e, kind: "charge", code: "tuition", fee_group: "tuition", description: "T", debit: amt, credit: 0, payment_id: null, reverses_id: null, reason: null,
    });
    const ledger = post([], [charge("old", 5000), charge("paid", 1000), { ...charge("paid", 0), kind: "payment", code: "pay:1", debit: 0, credit: 1000 }]);
    const byE = { old: ledger.filter((r) => r.enrollment_id === "old"), paid: ledger.filter((r) => r.enrollment_id === "paid") };
    const plan = planTermClose({
      term: { id: "t1", closed_at: null }, termLabel: "2026-2027 1st sem",
      enrollments: [old, next, paidUp], terms: [{ id: "t1", closed_at: null }, { id: "t2", closed_at: null }], ledgerByEnrollment: byE,
    });
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.items).toEqual([{ enrollment_id: "old", student_id: "st1", amount: 5000, next_enrollment_id: "new" }]);
    const after = post(ledger, plan.rows);
    expect(balance(after.filter((r) => r.enrollment_id === "old"))).toBe(0);
    const carried = after.filter((r) => r.enrollment_id === "new");
    expect(carried[0]).toMatchObject({ kind: "previous_balance", debit: 5000, description: "Previous balance (2026-2027 1st sem)" });
    // Closing twice does nothing; a closed term refuses.
    expect(planTermClose({ term: { id: "t1", closed_at: "x" }, termLabel: "", enrollments: [], terms: [], ledgerByEnrollment: {} })).toHaveProperty("error");
  });

  it("posts a carried balance when the next enrollment is created later", () => {
    const rows = post([], [{ enrollment_id: "old", kind: "carry_forward", code: "carry:old", fee_group: null, description: "c", debit: 0, credit: 4250, payment_id: null, reverses_id: null, reason: null }]);
    const pending = pendingCarryForward(rows, "new", () => "2025-2026 2nd sem");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ enrollment_id: "new", kind: "previous_balance", code: "prev:old", debit: 4250 });
    expect(pendingCarryForward(post(rows, pending), "newer", () => "")).toEqual([]);
  });

  it("the seeded back account shows first on the next term", () => {
    const d = detailOf(byName("Pedro"));
    const f = feeSummary({ track: "college", plan: null, setup: d.feeSetup, ledger: d.ledger, payments: d.payments, today: "2026-10-28" });
    expect(f.previous).toBe(4250);
    expect(f.installments[0]).toMatchObject({ key: "prev", amount: 4250 });
    const old = detailOf(byName("Pedro", seed.TERM_PREV));
    expect(balance(old.ledger)).toBe(0);
  });
});
