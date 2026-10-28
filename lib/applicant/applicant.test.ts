import { describe, expect, it } from "vitest";
import {
  TEMP_PASSWORD,
  WORDS,
  applicantAuthEmail,
  applicantStage,
  canEditApplication,
  checkNewPassword,
  emptyApplication,
  formatApplicantNo,
  generateTempPassword,
  isApplicantNo,
  isPhMobile,
  loginKind,
  nextApplicantSeq,
  normalizePhone,
  openRequestCount,
  planDetailsUpdate,
  planRequestClose,
  planRequestCreate,
  planRequestReply,
  roleAfterStatus,
  stepDates,
  validateConfirm,
  validateDocuments,
  validatePersonal,
  validateProgram,
  type ApplicantRequest,
} from "./index";
import { allowedActions, canSee, canUploadPapers, isWaitingOn } from "../enrollment";
import type { Enrollment, Status, Student } from "../enrollment/types";
import * as seed from "../data/seed";

const NOW = "2026-06-20T02:00:00.000Z";

// ---------- applicant numbers ----------
describe("applicant numbers", () => {
  it("formats APP-{year}-{5 digits}", () => {
    expect(formatApplicantNo("2026-2027", 12)).toBe("APP-2026-00012");
    expect(formatApplicantNo(2026, 1)).toBe("APP-2026-00001");
    expect(formatApplicantNo(2026, 123456)).toBe("APP-2026-123456");
  });
  it("takes the next number per year", () => {
    const used = ["APP-2026-00001", "APP-2026-00007", "APP-2025-00042", null, "SA-2026-0009"];
    expect(nextApplicantSeq(used, "2026-2027")).toBe(8);
    expect(nextApplicantSeq(used, 2025)).toBe(43);
    expect(nextApplicantSeq([], 2027)).toBe(1);
  });
  it("recognises applicant numbers and builds the made-up auth email", () => {
    expect(isApplicantNo("APP-2026-00012")).toBe(true);
    expect(isApplicantNo(" app-2026-00012 ")).toBe(true);
    expect(isApplicantNo("SA-2026-0005")).toBe(false);
    expect(applicantAuthEmail("APP-2026-00012", "SA")).toBe("app-2026-00012@applicants.sa.local");
  });
  it("tells what was typed in the login box", () => {
    expect(loginKind("juan@sample.edu.ph")).toBe("email");
    expect(loginKind("APP-2026-00012")).toBe("applicant_no");
    expect(loginKind("SA-2026-0005")).toBe("student_no");
  });
  it("seeded applicants follow the format", () => {
    for (const s of seed.students.filter((x) => x.applicant_no)) {
      expect(isApplicantNo(s.applicant_no!)).toBe(true);
    }
  });
});

// ---------- temporary passwords ----------
describe("temporary password", () => {
  it("is three different words and two digits", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword();
      expect(pw).toMatch(TEMP_PASSWORD);
      const [a, b, c, d] = pw.split("-");
      expect(new Set([a, b, c]).size).toBe(3);
      expect([a, b, c].every((w) => WORDS.includes(w))).toBe(true);
      expect(Number(d)).toBeGreaterThanOrEqual(10);
      expect(Number(d)).toBeLessThanOrEqual(99);
    }
  });
  it("uses the random source it is given (skips repeated words)", () => {
    const seq = [0, 0, 1, 2, 17];
    let i = 0;
    const pw = generateTempPassword(() => seq[i++]);
    expect(pw).toBe(`${WORDS[0]}-${WORDS[1]}-${WORDS[2]}-27`);
  });
  it("checks the new password", () => {
    expect(checkNewPassword("abc", "abc")).toHaveLength(2);
    expect(checkNewPassword("mango-river-sunny-27", "mango-river-sunny-27", "mango-river-sunny-27")).toEqual([
      "Pick a new password, not the temporary one.",
    ]);
    expect(checkNewPassword("newpass123", "newpass124")).toEqual(["The two passwords do not match."]);
    expect(checkNewPassword("newpass123", "newpass123")).toEqual([]);
  });
});

// ---------- the public form ----------
describe("enrollment form checks", () => {
  const filled = () => ({
    ...emptyApplication("college"),
    last_name: "Santos", first_name: "Lea", birth_date: "2008-01-15", sex: "F" as const,
    contact_no: "0917 123 4567", address: "12 Mabini St, Quezon City", guardian_name: "Rosa Santos", guardian_contact: "+63 918 765 4321",
    term_id: seed.TERM_COLLEGE,
  });
  it("normalises PH mobile numbers", () => {
    expect(normalizePhone("+63 917-123-4567")).toBe("09171234567");
    expect(normalizePhone("639171234567")).toBe("09171234567");
    expect(isPhMobile("0917 123 4567")).toBe(true);
    expect(isPhMobile("12345")).toBe(false);
  });
  it("page 1 needs the starred fields", () => {
    expect(validatePersonal(filled(), "2026-06-20")).toEqual({});
    const e = validatePersonal({ ...emptyApplication(), email: "nope" }, "2026-06-20");
    expect(Object.keys(e).sort()).toEqual(
      ["address", "birth_date", "contact_no", "email", "first_name", "guardian_contact", "guardian_name", "last_name", "sex"].sort(),
    );
    expect(validatePersonal({ ...filled(), birth_date: "2030-01-01" }, "2026-06-20").birth_date).toBeTruthy();
  });
  it("page 2 checks the term, course and the senior high strand", () => {
    expect(validateProgram(filled(), seed.terms)).toEqual({});
    expect(validateProgram({ ...filled(), term_id: seed.TERM_K12 }, seed.terms).term_id).toBeTruthy();
    const k12 = { ...filled(), track: "k12" as const, term_id: seed.TERM_K12, level: "Grade 11", lrn: "123" };
    expect(Object.keys(validateProgram(k12, seed.terms)).sort()).toEqual(["lrn", "strand"]);
  });
  it("page 3 needs a picture; transferees may add more papers", () => {
    const f = filled();
    expect(validateDocuments(f, {}).photo).toBeTruthy();
    expect(validateDocuments(f, { photo: { name: "me.pdf", type: "application/pdf", size: 10 } }).photo).toMatch(/image/);
    expect(validateDocuments(f, { photo: { name: "me.jpg", type: "image/jpeg", size: 10 } })).toEqual({});
  });
  it("page 4 needs the certification and a typed name", () => {
    expect(Object.keys(validateConfirm(filled()))).toEqual(["certify", "signed_name"]);
    expect(validateConfirm({ ...filled(), certify: true, signed_name: "Lea Santos" })).toEqual({});
  });
});

// ---------- editing by status ----------
const student = (): Student => structuredClone(seed.students.find((s) => s.applicant_no === "APP-2026-00001")!);
const enrollmentOf = (s: Student): Enrollment => structuredClone(seed.enrollments.find((e) => e.student_id === s.id)!);

describe("edit allowed by status", () => {
  it("only while applied (also when it needs a fix)", () => {
    expect(canEditApplication("applied").ok).toBe(true);
    const locked: Status[] = ["papers_checked", "student_made", "load_set", "assessed_paid", "officially_enrolled", "rejected", "withdrawn"];
    for (const s of locked) expect(canEditApplication(s).ok).toBe(false);
    const r = canEditApplication("papers_checked");
    expect(!r.ok && r.reason).toMatch(/locked/);
  });
  it("papers can be uploaded by the applicant only while applied", () => {
    expect(canUploadPapers("applicant", "applied")).toBe(true);
    expect(canUploadPapers("applicant", "papers_checked")).toBe(false);
  });
  it("plans an update with a history summary", () => {
    const s = student();
    const e = enrollmentOf(s);
    const r = planDetailsUpdate({ role: "applicant", student: s, enrollment: e }, {
      student: { contact_no: "+63 920 111 2222", address: s.address },
      enrollment: { course: "BSCS" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.student).toEqual({ contact_no: "09201112222" });
    expect(r.enrollment).toEqual({ course: "BSCS" });
    expect(r.summary).toBe(`Contact number: ${s.contact_no} → 09201112222; Course: ${e.course} → BSCS`);
  });
  it("refuses when locked, when nothing changed, or when a value is wrong", () => {
    const s = student();
    const e = enrollmentOf(s);
    expect(planDetailsUpdate({ role: "applicant", student: s, enrollment: { ...e, status: "papers_checked" } }, { student: { first_name: "X" }, enrollment: {} }).ok).toBe(false);
    expect(planDetailsUpdate({ role: "applicant", student: s, enrollment: e }, { student: { first_name: s.first_name }, enrollment: {} })).toEqual({ ok: false, error: "Nothing changed." });
    expect(planDetailsUpdate({ role: "applicant", student: s, enrollment: e }, { student: { contact_no: "123" }, enrollment: {} }).ok).toBe(false);
    expect(planDetailsUpdate({ role: "cashier", student: s, enrollment: e }, { student: { first_name: "X" }, enrollment: {} }).ok).toBe(false);
  });
});

// ---------- requests ----------
describe("follow-up request lifecycle", () => {
  const req = (status: ApplicantRequest["status"]) => ({ status });
  it("the applicant sends a request (open)", () => {
    const r = planRequestCreate({ role: "applicant", status: "applied", requests: [], now: NOW }, { type: "follow_up", message: "  I uploaded my Form 138  " });
    expect(r.ok && r.value).toMatchObject({ type: "follow_up", message: "I uploaded my Form 138", status: "open", reply: null });
  });
  it("refuses empty messages, too many open ones, other roles and closed applications", () => {
    const ctx = { role: "applicant" as const, status: "applied" as const, requests: [], now: NOW };
    expect(planRequestCreate(ctx, { type: "question", message: " " }).ok).toBe(false);
    expect(planRequestCreate({ ...ctx, requests: Array(5).fill(req("open")) }, { type: "question", message: "Hi" }).ok).toBe(false);
    expect(planRequestCreate({ ...ctx, requests: [req("answered"), req("closed")] }, { type: "question", message: "Hi" }).ok).toBe(true);
    expect(planRequestCreate({ ...ctx, role: "cashier" }, { type: "question", message: "Hi" }).ok).toBe(false);
    expect(planRequestCreate({ ...ctx, status: "rejected" }, { type: "question", message: "Hi" }).ok).toBe(false);
  });
  it("the registrar replies (answered) or replies and closes (closed)", () => {
    const base = { request: req("open"), now: NOW, by: "u-reg", byName: "Rosa Reyes (registrar)" };
    const a = planRequestReply({ ...base, role: "registrar" }, { reply: "Got it, thanks!" });
    expect(a.ok && a.value).toMatchObject({ status: "answered", reply: "Got it, thanks!", replied_at: NOW, closed_at: null });
    const c = planRequestReply({ ...base, role: "registrar" }, { reply: "Done.", close: true });
    expect(c.ok && c.value.status).toBe("closed");
    expect(planRequestReply({ ...base, role: "applicant" }, { reply: "x" }).ok).toBe(false);
    expect(planRequestReply({ ...base, role: "registrar" }, { reply: "" }).ok).toBe(false);
    expect(planRequestReply({ ...base, request: req("closed"), role: "registrar" }, { reply: "x" }).ok).toBe(false);
    // An answered request can get another reply.
    expect(planRequestReply({ ...base, request: req("answered"), role: "registrar" }, { reply: "One more thing" }).ok).toBe(true);
  });
  it("the owner or the registrar closes it", () => {
    expect(planRequestClose({ role: "applicant", isOwner: true, request: req("answered"), now: NOW }).ok).toBe(true);
    expect(planRequestClose({ role: "registrar", isOwner: false, request: req("open"), now: NOW }).ok).toBe(true);
    expect(planRequestClose({ role: "cashier", isOwner: false, request: req("open"), now: NOW }).ok).toBe(false);
    expect(planRequestClose({ role: "registrar", isOwner: false, request: req("closed"), now: NOW }).ok).toBe(false);
  });
  it("open requests put the enrollment on the registrar's list", () => {
    const item = { status: "papers_checked" as const, dean_approved: false, fix_note: null, balance: 0, updated_at: NOW };
    expect(isWaitingOn("registrar", { ...item, status: "student_made" }, { use_dean_approval: false })).toBe(false);
    expect(isWaitingOn("registrar", { ...item, status: "student_made", open_requests: 1 }, { use_dean_approval: false })).toBe(true);
    expect(openRequestCount([req("open"), req("answered"), req("open")])).toBe(2);
  });
  it("the seeded needs-fix applicant has an answered request", () => {
    const answered = seed.applicantRequests.filter((r) => r.status === "answered");
    expect(answered).toHaveLength(1);
    expect(answered[0].reply).toBeTruthy();
  });
});

// ---------- promotion ----------
describe("promotion to student", () => {
  it("an applicant becomes a student when the student ID is made", () => {
    expect(roleAfterStatus("applicant", "applied")).toBe("applicant");
    expect(roleAfterStatus("applicant", "papers_checked")).toBe("applicant");
    expect(roleAfterStatus("applicant", "student_made")).toBe("student");
    expect(roleAfterStatus("applicant", "officially_enrolled")).toBe("student");
    expect(roleAfterStatus("applicant", "rejected")).toBe("applicant");
    expect(roleAfterStatus("parent", "student_made")).toBe("parent");
  });
  it("applicants see only their own application and press no main-app buttons", () => {
    const s = student();
    expect(canSee("applicant", s.user_id!, s, [], false)).toBe(true);
    expect(canSee("applicant", "someone-else", s, [], false)).toBe(false);
    expect(allowedActions("applicant", { status: "applied", dean_approved: false }, { use_dean_approval: false })).toEqual([]);
  });
});

// ---------- portal text ----------
describe("portal progress", () => {
  it("speaks plainly", () => {
    expect(applicantStage({ status: "applied", fix_note: null, track: "college" }, { student_no: null }).title).toBe("We are checking your papers");
    expect(applicantStage({ status: "applied", fix_note: "Blurry PSA", track: "college" }, { student_no: null }).title).toBe("Needs a fix: Blurry PSA");
    expect(applicantStage({ status: "student_made", fix_note: null, track: "college" }, { student_no: "SA-2026-0005" }).title).toBe(
      "Accepted! Your student number is SA-2026-0005",
    );
  });
  it("dates each step from the history", () => {
    const d = stepDates([
      { from_status: null, to_status: "applied", created_at: "2026-06-01T01:00:00Z" },
      { from_status: "applied", to_status: "applied", created_at: "2026-06-02T01:00:00Z" },
      { from_status: "applied", to_status: "papers_checked", created_at: "2026-06-03T01:00:00Z" },
      { from_status: "papers_checked", to_status: "student_made", created_at: "2026-06-04T01:00:00Z" },
    ]);
    expect(d).toEqual({ applied: "2026-06-01T01:00:00Z", papers_checked: "2026-06-03T01:00:00Z", student_made: "2026-06-04T01:00:00Z" });
  });
});
