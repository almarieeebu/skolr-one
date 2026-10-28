// Sample data for "Sample Academy" (code SA). Used by DEMO MODE directly and
// turned into supabase/seed.sql by `npm run seed:sql`, so both stay the same.

import type {
  DocType,
  DocumentRow,
  Enrollment,
  EnrollmentLoad,
  HistoryRow,
  Membership,
  Offering,
  ParentLink,
  Payment,
  Profile,
  Role,
  School,
  Status,
  Student,
  Term,
} from "../enrollment/types";
import { STEPS } from "../enrollment/status";
import { termLabel } from "./store";
import {
  defaultExamPeriods,
  defaultPlans,
  discountLines,
  findSetup,
  postedLines,
  syncLines,
  assess,
  voucherDiscount,
  carryRow,
  previousBalanceRow,
  balanceCents,
  type Discount,
  type FeeItem,
  type FeeSetup,
  type LedgerDraft,
  type LedgerEntry,
  type OrSeries,
  type PaymentMode,
} from "../fees";
import {
  COLLEGE_PERIODS,
  KINDER_AREA,
  QUARTERS,
  defaultGradeSettings,
  entryGrade,
  findArea,
  learningAreasFor,
  sheetKind,
  type ChangeGradeRequest,
  type GradeEntry,
  type GradeHistoryRow,
  type GradePeriod,
  type GradeSettings,
  type GradeSheet,
  type K12Component,
  type KinderMark,
  type ScoreItem,
  type SpecialMark,
} from "../grades";

/** Stable, valid UUIDs so the SQL seed and the demo share ids. */
const id = (group: string, n: number) =>
  `00000000-0000-4000-8000-${group}${String(n).padStart(12 - group.length, "0")}`;

export const SCHOOL_ID = id("5c", 1);
const at = (day: number, hour = 9) =>
  new Date(Date.UTC(2026, 5, day, hour, 0, 0)).toISOString();

export const DEMO_PASSWORD = "password123";

export const profiles: Profile[] = [
  { id: id("a", 1), full_name: "Rosa Reyes", email: "registrar@sample.edu.ph" },
  { id: id("a", 2), full_name: "Carlo Cruz", email: "cashier@sample.edu.ph" },
  { id: id("a", 3), full_name: "Teresa Ramos", email: "teacher@sample.edu.ph" },
  { id: id("a", 4), full_name: "Juan Dela Cruz", email: "juan@sample.edu.ph" },
  { id: id("a", 5), full_name: "Liza Reyes", email: "parent@sample.edu.ph" },
  { id: id("a", 6), full_name: "Danilo Aquino", email: "dean@sample.edu.ph" },
  // One teacher login per class with grades (Teresa Ramos is the demo teacher).
  { id: id("a", 7), full_name: "Ramon Bautista", email: "teacher.ge@sample.edu.ph" },
  { id: id("a", 8), full_name: "Grace Lim", email: "teacher.math@sample.edu.ph" },
  { id: id("a", 9), full_name: "Joel Santos", email: "teacher.pe@sample.edu.ph" },
  { id: id("a", 10), full_name: "Mila Cruz", email: "teacher.kinder@sample.edu.ph" },
];

const [REGISTRAR, CASHIER, TEACHER, JUAN, PARENT, DEAN, T_GE, T_MATH, T_PE, T_KINDER] = profiles.map((p) => p.id);

/** One demo login per role (used by the demo role switcher). */
export const demoUserByRole: Record<Role, string> = {
  registrar: REGISTRAR,
  cashier: CASHIER,
  teacher: TEACHER,
  student: JUAN,
  parent: PARENT,
  dean: DEAN,
};

export const school: School = {
  id: SCHOOL_ID,
  name: "Sample Academy",
  code: "SA",
  logo_url: null,
  settings: {
    use_dean_approval: false,
    max_units: 24,
  },
};

export const branches = [{ id: id("b", 1), school_id: SCHOOL_ID, name: "Main Campus" }];

export const memberships: Membership[] = (
  [
    [REGISTRAR, "registrar"],
    [CASHIER, "cashier"],
    [TEACHER, "teacher"],
    [JUAN, "student"],
    [PARENT, "parent"],
    [DEAN, "dean"],
    [T_GE, "teacher"],
    [T_MATH, "teacher"],
    [T_PE, "teacher"],
    [T_KINDER, "teacher"],
  ] as [string, Role][]
).map(([user_id, role], i) => ({ id: id("ab", i + 1), user_id, school_id: SCHOOL_ID, role }));

export const TERM_COLLEGE = id("7e", 1);
export const TERM_K12 = id("7e", 2);
export const TERM_COLLEGE_2ND = id("7e", 3);
/** Last school year's 2nd semester: already closed, one balance carried forward. */
export const TERM_PREV = id("7e", 4);

export const terms: Term[] = [
  { id: TERM_COLLEGE, school_id: SCHOOL_ID, school_year: "2026-2027", semester: "1st", track: "college", is_open: true, closed_at: null },
  { id: TERM_K12, school_id: SCHOOL_ID, school_year: "2026-2027", semester: null, track: "k12", is_open: true, closed_at: null },
  { id: TERM_COLLEGE_2ND, school_id: SCHOOL_ID, school_year: "2026-2027", semester: "2nd", track: "college", is_open: true, closed_at: null },
  { id: TERM_PREV, school_id: SCHOOL_ID, school_year: "2025-2026", semester: "2nd", track: "college", is_open: false, closed_at: "2026-05-30T09:00:00.000Z" },
];

// ---------- offerings ----------

type SubjectSeed = [code: string, title: string, units: number, lab: number, days: string, start: string, end: string, room: string, slots: number, prereq: string[], teacher?: string];

/** Major subjects are charged at the major rate per unit. */
const MAJOR_CODES = new Set(["IT101", "IT102", "IT103", "IT201"]);

const subjectSeeds: SubjectSeed[] = [
  ["GE101", "Understanding the Self", 3, 0, "MWF", "08:00", "09:00", "R101", 40, [], T_GE],
  ["GE102", "Purposive Communication", 3, 0, "TTh", "08:00", "09:30", "R102", 40, [], T_GE],
  ["MATH101", "Mathematics in the Modern World", 3, 0, "TTh", "13:00", "14:30", "R103", 40, [], T_MATH],
  ["IT101", "Introduction to Computing", 3, 1500, "MWF", "09:00", "10:00", "Lab 1", 35, [], TEACHER],
  ["IT102", "Computer Programming 1", 3, 2000, "TTh", "10:00", "11:30", "Lab 2", 35, [], TEACHER],
  ["IT103", "Discrete Structures", 3, 0, "MWF", "08:30", "09:30", "R104", 1, [], T_MATH],
  ["IT201", "Computer Programming 2", 3, 2000, "MWF", "13:00", "14:00", "Lab 2", 35, ["IT102"], TEACHER],
  ["PE1", "Physical Education 1", 2, 0, "S", "08:00", "10:00", "Gym", 60, [], T_PE],
  ["NSTP1", "National Service Training Program 1", 3, 0, "S", "10:00", "13:00", "Field", 60, [], T_PE],
];

/** 2nd semester subjects. IT201 needs IT102 (passed with a posted grade). */
const subjectSeeds2nd: SubjectSeed[] = [
  ["GE103", "Readings in Philippine History", 3, 0, "MWF", "08:00", "09:00", "R101", 40, [], T_GE],
  ["IT201", "Computer Programming 2", 3, 2000, "MWF", "13:00", "14:00", "Lab 2", 35, ["IT102"], TEACHER],
  ["IT202", "Data Structures and Algorithms", 3, 0, "TTh", "10:00", "11:30", "Lab 1", 35, ["IT201"], TEACHER],
  ["PE2", "Physical Education 2", 2, 0, "S", "08:00", "10:00", "Gym", 60, ["PE1"], T_PE],
  ["NSTP2", "National Service Training Program 2", 3, 0, "S", "10:00", "13:00", "Field", 60, ["NSTP1"], T_PE],
];

/** Non-credit subjects are left out of the GWA. */
const NON_CREDIT = new Set(["NSTP1", "NSTP2"]);

type SectionSeed = [code: string, title: string, level: string, strand: string | null, days: string, start: string, end: string, room: string, slots: number, teacher?: string];

const sectionSeeds: SectionSeed[] = [
  ["G1-ROSAL", "Grade 1 - Rosal", "Grade 1", null, "MTWThF", "07:30", "11:30", "E-1", 35],
  ["G7-SAMPAGUITA", "Grade 7 - Sampaguita", "Grade 7", null, "MTWThF", "07:00", "15:00", "J-7A", 40, TEACHER],
  ["G7-NARRA", "Grade 7 - Narra", "Grade 7", null, "MTWThF", "07:00", "15:00", "J-7B", 40],
  ["G11-STEM-RIZAL", "Grade 11 STEM - Rizal", "Grade 11", "STEM", "MTWThF", "07:30", "16:00", "S-11A", 2],
  ["G11-ABM-MABINI", "Grade 11 ABM - Mabini", "Grade 11", "ABM", "MTWThF", "07:30", "16:00", "S-11B", 40],
  ["K-ILANG", "Kinder - Ilang-Ilang", "Kinder", null, "MTWThF", "08:00", "11:00", "K-1", 25, T_KINDER],
];

export const offerings: Offering[] = [
  ...subjectSeeds.map(([code, title, units, lab, days, start, end, room, slots, prereq, teacher], i) => ({
    id: id("0f", i + 1),
    school_id: SCHOOL_ID,
    term_id: TERM_COLLEGE,
    kind: "subject" as const,
    code, title, units, lab_fee: lab, is_major: MAJOR_CODES.has(code), non_credit: NON_CREDIT.has(code), days, start_time: start, end_time: end, room,
    teacher_id: teacher ?? null, slots, prerequisite_codes: prereq, level: null, strand: null,
  })),
  // Last year's 2nd semester (closed term): a few subjects for the carried-balance sample.
  ...subjectSeeds
    .filter(([code]) => ["GE101", "IT101", "IT102", "PE1"].includes(code))
    .map(([code, title, units, lab, days, start, end, room, slots, prereq, teacher], i) => ({
      id: id("0f", 100 + i + 1),
      school_id: SCHOOL_ID,
      term_id: TERM_PREV,
      kind: "subject" as const,
      code, title, units, lab_fee: lab, is_major: MAJOR_CODES.has(code), non_credit: NON_CREDIT.has(code), days, start_time: start, end_time: end, room,
      teacher_id: teacher ?? null, slots, prerequisite_codes: prereq, level: null, strand: null,
    })),
  ...subjectSeeds2nd.map(([code, title, units, lab, days, start, end, room, slots, prereq, teacher], i) => ({
    id: id("0f", 200 + i + 1),
    school_id: SCHOOL_ID,
    term_id: TERM_COLLEGE_2ND,
    kind: "subject" as const,
    code, title, units, lab_fee: lab, is_major: MAJOR_CODES.has(code), non_credit: NON_CREDIT.has(code), days, start_time: start, end_time: end, room,
    teacher_id: teacher ?? null, slots, prerequisite_codes: prereq, level: null, strand: null,
  })),
  ...sectionSeeds.map(([code, title, level, strand, days, start, end, room, slots, teacher], i) => ({
    id: id("5e", i + 1),
    school_id: SCHOOL_ID,
    term_id: TERM_K12,
    kind: "section" as const,
    code, title, units: 0, lab_fee: 0, is_major: false, non_credit: false, days, start_time: start, end_time: end, room,
    teacher_id: teacher ?? null, slots, prerequisite_codes: [], level, strand,
  })),
];

const off = (code: string, term = TERM_COLLEGE) =>
  offerings.find((o) => o.code === code && (o.kind === "section" || o.term_id === term))!;

// ---------- fee setups ----------

const collegeMisc: FeeItem[] = [
  { name: "Registration", amount: 500, group: "misc" },
  { name: "Library", amount: 900, group: "misc" },
  { name: "Athletics", amount: 400, group: "misc" },
  { name: "Medical and dental", amount: 350, group: "misc" },
  { name: "Energy fee", amount: 1200, group: "misc" },
  { name: "ID and insurance", amount: 650, group: "misc" },
];
const k12Misc: FeeItem[] = [
  { name: "Registration", amount: 1000, group: "misc" },
  { name: "Books and learning materials", amount: 2500, group: "misc" },
  { name: "Computer", amount: 1000, group: "misc" },
  { name: "Testing materials", amount: 500, group: "misc" },
];

const SETUP_AT = "2026-05-15T01:00:00.000Z";
const termOf = (tid: string) => terms.find((t) => t.id === tid)!;

const collegeSetup = (n: number, termId: string, rate: number, major: number, misc: FeeItem[]): FeeSetup => ({
  id: id("f5", n), school_id: SCHOOL_ID, term_id: termId, track: "college", scope_course: null, scope_level: null,
  min_downpayment: 3000, misc_items: misc, rate_per_unit: rate, major_rate_per_unit: major,
  exam_periods: defaultExamPeriods(termOf(termId)), plans: [], esc_amount: 0, shs_voucher_amount: 0, updated_at: SETUP_AT,
});
const k12Setup = (n: number, level: string | null, tuition: number): FeeSetup => ({
  id: id("f5", n), school_id: SCHOOL_ID, term_id: TERM_K12, track: "k12", scope_course: null, scope_level: level,
  min_downpayment: 3000, misc_items: k12Misc, rate_per_unit: 0, major_rate_per_unit: 0, exam_periods: [],
  plans: defaultPlans("2026-2027", tuition), esc_amount: 9000, shs_voucher_amount: 17500, updated_at: SETUP_AT,
});

export const feeSetups: FeeSetup[] = [
  collegeSetup(1, TERM_COLLEGE, 1200, 1500, collegeMisc),
  collegeSetup(2, TERM_COLLEGE_2ND, 1200, 1500, collegeMisc),
  collegeSetup(3, TERM_PREV, 1100, 1400, collegeMisc.map((m) => (m.name === "Energy fee" ? { ...m, amount: 1000 } : m))),
  k12Setup(4, null, 28000),
  k12Setup(5, "Grade 1", 25000),
  k12Setup(6, "Grade 7", 30000),
  k12Setup(7, "Grade 11", 35000),
  k12Setup(8, "Grade 12", 35000),
];

/** OR numbers 100198-100245 are used by the sample payments. */
export const orSeries: OrSeries = { school_id: SCHOOL_ID, prefix: "", next_no: 100246, pad: 6 };

// ---------- students + enrollments ----------

interface Sample {
  student: Partial<Student> & Pick<Student, "first_name" | "last_name">;
  enrollment: Partial<Enrollment> & Pick<Enrollment, "track" | "status" | "level" | "student_type">;
  docs: DocType[];
  load?: string[];
  payments?: [amount: number, or_no: string, mode?: PaymentMode, reference?: string][];
  discounts?: Pick<Discount, "name" | "scope" | "target" | "kind" | "value" | "reason">[];
  note?: string;
  term?: string;
  day?: number;
}

const samples: Sample[] = [
  {
    student: { first_name: "Juan", middle_name: "Santos", last_name: "Dela Cruz", birth_date: "2008-03-14", sex: "M", user_id: JUAN },
    enrollment: { track: "college", status: "applied", level: "1st Year", course: "BSIT", student_type: "new" },
    docs: ["psa_birth_cert", "form_138"],
  },
  {
    student: { first_name: "Maria", middle_name: "Lopez", last_name: "Santos", birth_date: "2006-07-02", sex: "F", completed_codes: ["GE101", "IT101"] },
    enrollment: { track: "college", status: "applied", level: "2nd Year", course: "BSIT", student_type: "transferee" },
    docs: ["psa_birth_cert", "form_138", "honorable_dismissal"],
  },
  {
    student: { first_name: "Pedro", middle_name: "Ramos", last_name: "Garcia", birth_date: "2006-01-20", sex: "M", student_no: "SA-2025-0003" },
    enrollment: { track: "college", status: "student_made", level: "2nd Year", course: "BSIT", student_type: "continuing" },
    docs: [],
  },
  {
    student: { first_name: "Ana", middle_name: "Cruz", last_name: "Lim", birth_date: "2008-11-05", sex: "F", student_no: "SA-2026-0001" },
    enrollment: { track: "college", status: "load_set", level: "1st Year", course: "BSIT", student_type: "new" },
    docs: ["psa_birth_cert", "form_138"],
    load: ["GE101", "GE102", "IT101", "MATH101"],
  },
  {
    student: { first_name: "Mark", middle_name: "Dizon", last_name: "Villanueva", birth_date: "2008-04-18", sex: "M", student_no: "SA-2026-0002" },
    enrollment: { track: "college", status: "assessed_paid", level: "1st Year", course: "BSIT", student_type: "new" },
    docs: ["psa_birth_cert", "form_138"],
    load: ["GE102", "IT101", "MATH101", "PE1"],
    payments: [[5000, "100231"]],
    discounts: [{ name: "Sibling discount", scope: "group", target: "tuition", kind: "percent", value: 10, reason: "Older brother enrolled (BSIT 3rd year)" }],
  },
  {
    student: { first_name: "Carla", middle_name: "Reyes", last_name: "Mendoza", birth_date: "2007-09-30", sex: "F", student_no: "SA-2026-0003" },
    enrollment: { track: "college", status: "officially_enrolled", level: "1st Year", course: "BSIT", student_type: "new" },
    docs: ["psa_birth_cert", "form_138"],
    load: ["GE102", "IT103", "MATH101", "PE1", "NSTP1"],
    payments: [[8000, "100198"], [4500, "100245", "gcash", "GC-7781234567"]],
    discounts: [{ name: "Academic scholarship", scope: "group", target: "tuition", kind: "percent", value: 50, reason: "Dean's lister, 2nd sem 2025-2026" }],
  },
  {
    student: { first_name: "Miguel", middle_name: "Andres", last_name: "Reyes", birth_date: "2014-02-11", sex: "M", lrn: "136512340001", guardian_user_id: PARENT },
    enrollment: { track: "k12", status: "applied", level: "Grade 7", student_type: "new", esc_voucher: true, mother_tongue: "Tagalog", tuition_plan: "quarterly" },
    docs: ["psa_birth_cert", "form_138"],
  },
  {
    student: { first_name: "Sofia", middle_name: "Andres", last_name: "Reyes", birth_date: "2010-06-25", sex: "F", lrn: "136512340002", guardian_user_id: PARENT, student_no: "SA-2026-0004" },
    enrollment: { track: "k12", status: "load_set", level: "Grade 11", strand: "STEM", student_type: "continuing", esc_voucher: true, mother_tongue: "Tagalog", tuition_plan: "monthly" },
    docs: ["psa_birth_cert", "form_138"],
    load: ["G11-STEM-RIZAL"],
  },
  {
    student: { first_name: "Bea", middle_name: "Lagman", last_name: "Torres", birth_date: "2020-08-08", sex: "F", lrn: "136512340003" },
    enrollment: { track: "k12", status: "papers_checked", level: "Grade 1", student_type: "new", mother_tongue: "Kapampangan", ip_group: "Aeta", is_4ps: true, tuition_plan: "annual" },
    docs: ["psa_birth_cert", "form_138"],
  },
  {
    student: { first_name: "Rico", middle_name: null, last_name: "Bautista", birth_date: "2007-12-01", sex: "M" },
    enrollment: { track: "college", status: "rejected", level: "1st Year", course: "BSCS", student_type: "new" },
    docs: ["psa_birth_cert"],
    note: "Course not offered this term.",
  },
  // Pedro Garcia's enrollment last school year (2nd sem). The term is closed
  // and his unpaid balance was carried to his 2026-2027 1st sem enrollment.
  {
    student: { first_name: "Pedro", last_name: "Garcia" },
    enrollment: { track: "college", status: "officially_enrolled", level: "1st Year", course: "BSIT", student_type: "continuing" },
    docs: [],
    load: ["GE101", "IT101", "IT102", "PE1"],
    payments: [[3000, "100101"], [6000, "100142"], [7950, "100177", "bank", "BPI-0425-8812"]],
    term: TERM_PREV,
    day: -140,
  },
  // K to 12 learners already in class (grades sample): Grade 7 Sampaguita and Kinder.
  {
    student: { first_name: "Paolo", middle_name: "Andres", last_name: "Reyes", birth_date: "2013-09-14", sex: "M", lrn: "136512340004", guardian_user_id: PARENT, student_no: "SA-2025-0010" },
    enrollment: { track: "k12", status: "officially_enrolled", level: "Grade 7", student_type: "continuing", mother_tongue: "Tagalog", tuition_plan: "quarterly" },
    docs: ["psa_birth_cert", "form_138"],
    load: ["G7-SAMPAGUITA"],
    payments: [[8000, "100212"]],
  },
  {
    student: { first_name: "Andrea", middle_name: "Lopez", last_name: "Cruz", birth_date: "2013-05-03", sex: "F", lrn: "136512340005", student_no: "SA-2025-0011" },
    enrollment: { track: "k12", status: "officially_enrolled", level: "Grade 7", student_type: "continuing", mother_tongue: "Tagalog", tuition_plan: "annual" },
    docs: ["psa_birth_cert", "form_138"],
    load: ["G7-SAMPAGUITA"],
    payments: [[8000, "100213"]],
  },
  {
    student: { first_name: "Lucas", middle_name: "Tan", last_name: "Garcia", birth_date: "2021-02-19", sex: "M", lrn: "136512340006", student_no: "SA-2025-0012" },
    enrollment: { track: "k12", status: "officially_enrolled", level: "Kinder", student_type: "continuing", mother_tongue: "Tagalog", tuition_plan: "annual" },
    docs: ["psa_birth_cert", "form_138"],
    load: ["K-ILANG"],
    payments: [[8000, "100214"]],
  },
];

export const students: Student[] = [];
export const enrollments: Enrollment[] = [];
export const documents: DocumentRow[] = [];
export const enrollmentLoads: EnrollmentLoad[] = [];
export const payments: Payment[] = [];
export const discounts: Discount[] = [];
export const ledger: LedgerEntry[] = [];
export const history: HistoryRow[] = [];
export const parentLinks: ParentLink[] = [];

let docN = 0, loadN = 0, payN = 0, histN = 0, ledN = 0, discN = 0;
const ACTOR_FOR: Partial<Record<Status, string>> = {
  papers_checked: REGISTRAR,
  student_made: REGISTRAR,
  load_set: REGISTRAR,
  assessed_paid: CASHIER,
  officially_enrolled: REGISTRAR,
};
const STEP_ACTION: Record<string, string> = {
  papers_checked: "accept_papers",
  student_made: "assign_id",
  load_set: "set_load",
  assessed_paid: "take_payment",
  officially_enrolled: "approve",
};
const nameOf = (uid: string) => {
  const p = profiles.find((x) => x.id === uid)!;
  const role = memberships.find((m) => m.user_id === uid)!.role;
  return `${p.full_name} (${role})`;
};

const postRows = (e: Enrollment, drafts: LedgerDraft[], actorId: string, when: string) => {
  for (const d of drafts) {
    const target = d.enrollment_id ? enrollments.find((x) => x.id === d.enrollment_id)! : e;
    const { enrollment_id: _skip, ...row } = d;
    void _skip;
    ledger.push({
      id: id("1e", ++ledN), school_id: SCHOOL_ID, enrollment_id: target.id, student_id: target.student_id, term_id: target.term_id,
      ...row, actor_id: actorId, actor_name: nameOf(actorId), posted_at: when,
    });
  }
};
const ledgerOf = (eid: string) => ledger.filter((r) => r.enrollment_id === eid);

samples.forEach((s, i) => {
  // The last sample is Pedro's older enrollment: same student as sample 3.
  const reuse = s.term === TERM_PREV ? students.find((x) => x.first_name === s.student.first_name && x.last_name === s.student.last_name) : undefined;
  const studentId = reuse?.id ?? id("57", i + 1);
  const enrollmentId = id("e", i + 1);
  const day = s.day ?? i + 1;
  const student: Student = reuse ?? {
    id: studentId,
    school_id: SCHOOL_ID,
    student_no: null,
    lrn: null,
    middle_name: null,
    birth_date: null,
    sex: null,
    user_id: null,
    guardian_user_id: null,
    completed_codes: [],
    ...s.student,
  };
  if (!reuse) students.push(student);
  if (!reuse && student.guardian_user_id) {
    parentLinks.push({ id: id("91", parentLinks.length + 1), school_id: SCHOOL_ID, parent_user_id: student.guardian_user_id, student_id: studentId });
  }

  const termId = s.term ?? (s.enrollment.track === "college" ? TERM_COLLEGE : TERM_K12);
  const e: Enrollment = {
    id: enrollmentId,
    school_id: SCHOOL_ID,
    term_id: termId,
    student_id: studentId,
    course: null,
    strand: null,
    esc_voucher: false,
    mother_tongue: null,
    ip_group: null,
    is_4ps: false,
    tuition_plan: s.enrollment.track === "k12" ? "annual" : null,
    fix_note: null,
    dean_approved: false,
    overrides: [],
    created_at: at(day),
    updated_at: at(day, 15),
    ...s.enrollment,
  };
  enrollments.push(e);

  const stepNow = STEPS.findIndex((x) => x.status === e.status);
  const checked = stepNow >= 1;
  for (const type of s.docs) {
    documents.push({
      id: id("d0", ++docN), school_id: SCHOOL_ID, enrollment_id: enrollmentId, type,
      file_name: `${type}.pdf`, file_path: null, checked, uploaded_at: at(day),
    });
  }

  const picked = (s.load ?? []).map((c) => off(c, termId));
  for (const o of picked) {
    enrollmentLoads.push({ id: id("10", ++loadN), school_id: SCHOOL_ID, enrollment_id: enrollmentId, offering_id: o.id });
  }

  // History: submitted, then each step up to the current one.
  const submitter = student.user_id ?? student.guardian_user_id ?? REGISTRAR;
  const returning = e.student_type === "continuing" && e.track === "college";
  history.push({
    id: id("4f", ++histN), school_id: SCHOOL_ID, enrollment_id: enrollmentId,
    from_status: null, to_status: returning ? "student_made" : "applied",
    action: returning ? "returning" : "submit",
    reason: returning ? "Returning student - starts at the load step" : null,
    actor_id: submitter, actor_name: nameOf(submitter), created_at: at(day, 8),
  });
  if (e.status === "rejected") {
    history.push({
      id: id("4f", ++histN), school_id: SCHOOL_ID, enrollment_id: enrollmentId,
      from_status: "applied", to_status: "rejected", action: "reject", reason: s.note ?? null,
      actor_id: REGISTRAR, actor_name: nameOf(REGISTRAR), created_at: at(day, 10),
    });
  }
  const startStep = returning ? 2 : 0;
  for (let k = startStep + 1; k <= stepNow; k++) {
    const to = STEPS[k].status;
    const actor = ACTOR_FOR[to]!;
    history.push({
      id: id("4f", ++histN), school_id: SCHOOL_ID, enrollment_id: enrollmentId,
      from_status: STEPS[k - 1].status, to_status: to,
      action: STEP_ACTION[to] ?? to,
      reason: to === "assessed_paid" && s.payments?.[0] ? `Paid ₱${s.payments[0][0].toLocaleString("en-PH")}.00, OR #${s.payments[0][1]}` : null,
      actor_id: actor, actor_name: nameOf(actor), created_at: at(day, 9 + k),
    });
  }

  // Fees: charges when the load was set (12:00), the first payment (13:00),
  // discounts (14:00), later payments every 20 days.
  if (!picked.length) return;
  const setup = findSetup(feeSetups, e)!;
  const a = assess({ enrollment: e, setup, subjects: picked.filter((o) => o.kind === "subject"), discounts: [] });
  postRows(e, syncLines([], a.lines, ["charge", "discount"], "Assessed"), REGISTRAR, at(day, 12));

  const pay = (k: number, when: string) => {
    const [amount, or_no, mode = "cash", reference] = s.payments![k];
    const p: Payment = {
      id: id("9a", ++payN), school_id: SCHOOL_ID, enrollment_id: enrollmentId, amount, or_no,
      mode, reference: reference ?? null, cashier_id: CASHIER, paid_at: when,
      voided_at: null, void_reason: null, voided_by: null,
    };
    payments.push(p);
    postRows(e, [{
      kind: "payment", code: `pay:${p.id}`, fee_group: null,
      description: `Payment, OR #${or_no} (${mode === "cash" ? "Cash" : mode === "gcash" ? "GCash" : mode === "bank" ? "Bank transfer" : "Check"}${reference ? ` ${reference}` : ""})`,
      debit: 0, credit: amount, payment_id: p.id, reverses_id: null, reason: null,
    }], CASHIER, when);
  };
  if (s.payments?.length) pay(0, at(day, 13));

  for (const d of s.discounts ?? []) {
    const disc: Discount = {
      ...d, id: id("d15c", ++discN), school_id: SCHOOL_ID, enrollment_id: enrollmentId,
      applied_by: REGISTRAR, applied_by_name: profiles[0].full_name, applied_at: at(day, 14),
      voided_at: null, void_reason: null,
    };
    discounts.push(disc);
    const v = voucherDiscount(e, setup);
    const all = discounts.filter((x) => x.enrollment_id === enrollmentId);
    const lines = discountLines(postedLines(ledgerOf(enrollmentId), ["charge"]), v ? [v, ...all] : all);
    postRows(e, syncLines(ledgerOf(enrollmentId), lines, ["discount"], `Discount applied: ${d.name}`), REGISTRAR, at(day, 14));
    history.push({
      id: id("4f", ++histN), school_id: SCHOOL_ID, enrollment_id: enrollmentId,
      from_status: e.status, to_status: e.status, action: "apply_discount",
      reason: `${d.name}: ${d.value}% off Tuition. ${d.reason}`,
      actor_id: REGISTRAR, actor_name: nameOf(REGISTRAR), created_at: at(day, 14),
    });
  }
  for (let k = 1; k < (s.payments?.length ?? 0); k++) pay(k, at(day + 20 * k, 11));
});

// Closing of last year's 2nd semester: Pedro's balance moves to his current enrollment.
{
  const prevTerm = terms.find((t) => t.id === TERM_PREV)!;
  const label = termLabel(prevTerm);
  for (const e of enrollments.filter((x) => x.term_id === TERM_PREV)) {
    const bal = balanceCents(ledgerOf(e.id));
    if (bal <= 0) continue;
    const next = enrollments.find((x) => x.student_id === e.student_id && x.term_id === TERM_COLLEGE)!;
    postRows(e, [carryRow(e.id, bal, label), previousBalanceRow(e.id, next.id, bal, label)], REGISTRAR, prevTerm.closed_at!);
  }
}

// ---------- grades ----------
// College: Carla (1st sem) has MATH101 posted, GE102 in draft, PE1 with INC
// and NSTP1 posted (non-credit, left out of the GWA). Pedro's last-year
// subjects are all posted, so IT102 counts as passed for IT201. One change
// grade request is waiting for the registrar.
// K to 12: Grade 7 Sampaguita has Q1 posted (WW/PT/QA scores for every
// learning area) and Q2 Math and English in draft. Kinder has a Q1 checklist.

const gdate = (month: number, day: number, hour = 9) => new Date(Date.UTC(2026, month - 1, day, hour, 0, 0)).toISOString();

export const gradeSettings: GradeSettings = {
  ...defaultGradeSettings(SCHOOL_ID),
  deadlines: [
    ...COLLEGE_PERIODS.map((period, i) => ({ term_id: TERM_COLLEGE, period, due_date: ["2026-07-18", "2026-08-22", "2026-09-19", "2026-10-24"][i] })),
    ...COLLEGE_PERIODS.map((period, i) => ({ term_id: TERM_COLLEGE_2ND, period, due_date: ["2026-12-12", "2027-01-30", "2027-03-06", "2027-04-10"][i] })),
    ...QUARTERS.map((period, i) => ({ term_id: TERM_K12, period, due_date: ["2026-08-28", "2026-11-06", "2027-01-29", "2027-04-02"][i] })),
  ],
  updated_at: SETUP_AT,
};

export const gradeSheets: GradeSheet[] = [];
export const gradeEntries: GradeEntry[] = [];
export const scoreItems: ScoreItem[] = [];
export const gradeHistory: GradeHistoryRow[] = [];
export const changeRequests: ChangeGradeRequest[] = [];

let sheetN = 0, entryN = 0, itemN = 0, gHistN = 0;
const enrollmentOf = (first: string, termId: string) =>
  enrollments.find((e) => e.term_id === termId && students.find((x) => x.id === e.student_id)!.first_name === first)!;

type RowValue = { percent?: number | null; mark?: SpecialMark | null; scores?: (number | null)[]; domains?: Record<string, KinderMark> };

function addSheet(args: {
  offering: Offering;
  period: GradePeriod;
  area?: string;
  status: "draft" | "posted";
  when: string;
  items?: [component: K12Component, label: string, max: number][];
  rows: [enrollmentId: string, value: RowValue][];
}) {
  const o = args.offering;
  const enr = enrollments.find((e) => e.id === args.rows[0]?.[0]);
  const area = args.area && enr ? findArea(enr.level, enr.strand, args.area) : undefined;
  const sheet: GradeSheet = {
    id: id("65", ++sheetN), school_id: SCHOOL_ID, term_id: o.term_id, offering_id: o.id,
    learning_area: args.area ?? null, subject_group: area?.group ?? null, period: args.period, status: args.status, teacher_id: o.teacher_id,
    return_note: null, late_allowed: false,
    submitted_at: args.status === "posted" ? args.when : null,
    posted_at: args.status === "posted" ? args.when : null,
    posted_by: args.status === "posted" ? REGISTRAR : null,
    updated_at: args.when,
  };
  gradeSheets.push(sheet);
  const items: ScoreItem[] = (args.items ?? []).map(([component, label, max], i) => ({
    id: id("5c0e", ++itemN), school_id: SCHOOL_ID, sheet_id: sheet.id, component, label, max_score: max, position: i + 1,
  }));
  scoreItems.push(...items);
  const kind = sheetKind(o);
  for (const [enrollment_id, v] of args.rows) {
    const scores: Record<string, number | null> = {};
    items.forEach((it, i) => (scores[it.id] = v.scores?.[i] ?? null));
    const entry: GradeEntry = {
      id: id("6e", ++entryN), school_id: SCHOOL_ID, sheet_id: sheet.id, enrollment_id,
      percent: v.percent ?? null, mark: v.mark ?? null, scores, domains: v.domains ?? {}, grade: null, updated_at: args.when,
    };
    entry.grade = entryGrade(kind, entry, items, gradeSettings, area);
    gradeEntries.push(entry);
  }
  if (args.status === "posted") {
    const teacher = o.teacher_id ?? REGISTRAR;
    const before = new Date(new Date(args.when).getTime() - 2 * 86400000).toISOString();
    gradeHistory.push(
      { id: id("64", ++gHistN), school_id: SCHOOL_ID, sheet_id: sheet.id, entry_id: null, action: "submit", from_status: "draft", to_status: "submitted", note: null, actor_id: teacher, actor_name: nameOf(teacher), created_at: before },
      { id: id("64", ++gHistN), school_id: SCHOOL_ID, sheet_id: sheet.id, entry_id: null, action: "approve", from_status: "submitted", to_status: "posted", note: null, actor_id: REGISTRAR, actor_name: nameOf(REGISTRAR), created_at: args.when },
    );
  }
  return { sheet, items };
}

const collegeSubject = (code: string, termId: string, enrollmentId: string, status: "draft" | "posted", values: (number | SpecialMark)[], months: number[][]) =>
  values.forEach((v, i) => {
    addSheet({
      offering: off(code, termId), period: COLLEGE_PERIODS[i], status, when: gdate(months[i][0], months[i][1]) ,
      rows: [[enrollmentId, typeof v === "number" ? { percent: v } : { mark: v }]],
    });
  });

{
  const carla = enrollmentOf("Carla", TERM_COLLEGE).id;
  const sem1 = [[7, 20], [8, 24], [9, 21], [10, 26]];
  collegeSubject("MATH101", TERM_COLLEGE, carla, "posted", [88, 90, 86, 92], sem1);
  collegeSubject("NSTP1", TERM_COLLEGE, carla, "posted", [95, 94, 96, 95], sem1);
  collegeSubject("PE1", TERM_COLLEGE, carla, "posted", [90, 92, 88, "INC"], sem1);
  collegeSubject("GE102", TERM_COLLEGE, carla, "draft", [91, 87], sem1);

  // Pedro, 2025-2026 2nd sem (closed term): everything posted.
  const pedro = enrollmentOf("Pedro", TERM_PREV).id;
  const prev = [[1, 10], [2, 14], [3, 14], [5, 25]];
  const prevDate = (i: number) => new Date(Date.UTC(2026, prev[i][0] - 1, prev[i][1], 9)).toISOString();
  const prevSubject = (code: string, values: number[]) =>
    values.forEach((v, i) => addSheet({ offering: off(code, TERM_PREV), period: COLLEGE_PERIODS[i], status: "posted", when: prevDate(i), rows: [[pedro, { percent: v }]] }));
  prevSubject("GE101", [84, 86, 85, 88]);
  prevSubject("IT101", [90, 92, 93, 95]);
  prevSubject("IT102", [82, 85, 80, 84]);
  prevSubject("PE1", [95, 96, 94, 97]);

  // Pending change grade request: IT101 final, re-checked exam.
  const it101Final = gradeSheets.find((x) => x.offering_id === off("IT101", TERM_PREV).id && x.period === "final")!;
  const entry = gradeEntries.find((x) => x.sheet_id === it101Final.id)!;
  changeRequests.push({
    id: id("c6", 1), school_id: SCHOOL_ID, sheet_id: it101Final.id, entry_id: entry.id, enrollment_id: pedro,
    old_value: { percent: 95, mark: null }, new_value: { percent: 98, mark: null },
    reason: "Final exam re-checked: two answers were marked wrong by mistake.",
    status: "pending", requested_by: TEACHER, requested_by_name: profiles[2].full_name, requested_at: gdate(6, 20),
    decided_by: null, decided_at: null, decision_note: null,
  });

  // K to 12: Grade 7 Sampaguita, Q1 posted for every learning area, Q2 Math and English in draft.
  const g7 = off("G7-SAMPAGUITA");
  const learners = enrollments.filter((e) => enrollmentLoads.some((l) => l.enrollment_id === e.id && l.offering_id === g7.id) && e.status === "officially_enrolled");
  const rnd = (n: number) => ((n * 9301 + 49297) % 233280) / 233280;
  let k = 0;
  const score = (max: number) => Math.round(max * (0.66 + 0.32 * rnd(++k * 7 + 3)));
  const q1Items: [K12Component, string, number][] = [
    ["ww", "Quiz 1", 20], ["ww", "Quiz 2", 20], ["ww", "Quiz 3", 15],
    ["pt", "Task 1", 50], ["pt", "Task 2", 50], ["qa", "Quarterly exam", 50],
  ];
  for (const a of learningAreasFor("Grade 7")) {
    addSheet({
      offering: g7, period: "q1", area: a.code, status: "posted", when: gdate(8, 29), items: q1Items,
      rows: learners.map((e) => [e.id, { scores: q1Items.map(([, , max]) => score(max)) }]),
    });
  }
  const q2Items: [K12Component, string, number][] = [["ww", "Quiz 1", 20], ["ww", "Quiz 2", 20], ["pt", "Task 1", 50], ["qa", "Quarterly exam", 50]];
  for (const code of ["MATH", "ENG"]) {
    addSheet({
      offering: g7, period: "q2", area: code, status: "draft", when: gdate(10, 15), items: q2Items,
      rows: learners.map((e) => [e.id, { scores: [score(20), score(20), score(50), null] }]),
    });
  }

  // Kinder: Q1 checklist posted.
  const kinder = off("K-ILANG");
  addSheet({
    offering: kinder, period: "q1", area: KINDER_AREA, status: "posted", when: gdate(8, 29),
    rows: [[enrollmentOf("Lucas", TERM_K12).id, { domains: { SE: "C", PM: "C", CR: "D", MA: "D", EN: "C", LL: "D" } }]],
  });
}
