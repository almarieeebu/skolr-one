// Checks for the public enrollment form (/apply), one page at a time.
// Each function returns { field: "message" }. An empty object means "all good".
// The database function applicant_submit checks the same things again.

import type { DocType, StudentType, Term, Track, TuitionPlan } from "../enrollment/types";
import { isSeniorHigh } from "../enrollment/checks";

export interface ApplicationForm {
  // Page 1: personal
  last_name: string;
  first_name: string;
  middle_name: string;
  birth_date: string;
  sex: "M" | "F" | "";
  civil_status: string;
  citizenship: string;
  contact_no: string;
  email: string;
  address: string;
  guardian_name: string;
  guardian_contact: string;
  // Page 2: program
  track: Track;
  term_id: string;
  level: string;
  course: string;
  strand: string;
  student_type: StudentType;
  lrn: string;
  esc_voucher: boolean;
  mother_tongue: string;
  ip_group: string;
  is_4ps: boolean;
  tuition_plan: TuitionPlan;
  // Page 4: confirm
  certify: boolean;
  signed_name: string;
  /** Drawn signature (PNG data URL), optional. */
  signature: string | null;
  /** Honeypot: hidden from people. Bots fill it in. */
  website: string;
}

export type FormErrors = Partial<Record<keyof ApplicationForm | DocType, string>>;

export function emptyApplication(track: Track = "college"): ApplicationForm {
  return {
    last_name: "", first_name: "", middle_name: "", birth_date: "", sex: "",
    civil_status: "Single", citizenship: "Filipino", contact_no: "", email: "", address: "",
    guardian_name: "", guardian_contact: "",
    track, term_id: "", level: track === "college" ? "1st Year" : "Grade 7", course: track === "college" ? "BSIT" : "",
    strand: "", student_type: "new", lrn: "", esc_voucher: false, mother_tongue: "", ip_group: "", is_4ps: false,
    tuition_plan: "annual",
    certify: false, signed_name: "", signature: null, website: "",
  };
}

/** "0917 123 4567", "+63 917-123-4567" and "639171234567" all become "09171234567". */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/[\s\-().]/g, "");
  if (/^\+639\d{9}$/.test(d)) return `0${d.slice(3)}`;
  if (/^639\d{9}$/.test(d)) return `0${d.slice(2)}`;
  return d;
}

export function isPhMobile(raw: string): boolean {
  return /^09\d{9}$/.test(normalizePhone(raw));
}

export function isEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

const MOBILE_HINT = "Use a PH mobile number like 09171234567.";

export function validatePersonal(f: ApplicationForm, today: string): FormErrors {
  const e: FormErrors = {};
  if (!f.last_name.trim()) e.last_name = "Please enter the last name.";
  if (!f.first_name.trim()) e.first_name = "Please enter the first name.";
  if (!f.birth_date) e.birth_date = "Please enter the birthdate.";
  else if (Number.isNaN(Date.parse(f.birth_date)) || f.birth_date >= today) e.birth_date = "Please check the birthdate.";
  if (!f.sex) e.sex = "Please pick Male or Female.";
  if (!f.contact_no.trim()) e.contact_no = "Please enter a contact number.";
  else if (!isPhMobile(f.contact_no)) e.contact_no = MOBILE_HINT;
  if (f.email.trim() && !isEmail(f.email)) e.email = "Please check the email address.";
  if (!f.address.trim()) e.address = "Please enter the complete address.";
  if (!f.guardian_name.trim()) e.guardian_name = "Please enter the guardian's name.";
  if (!f.guardian_contact.trim()) e.guardian_contact = "Please enter the guardian's number.";
  else if (!isPhMobile(f.guardian_contact)) e.guardian_contact = MOBILE_HINT;
  return e;
}

export function validateProgram(f: ApplicationForm, terms: Pick<Term, "id" | "track">[]): FormErrors {
  const e: FormErrors = {};
  if (!f.term_id || !terms.some((t) => t.id === f.term_id && t.track === f.track)) {
    e.term_id = f.track === "college" ? "Please pick the school year and semester." : "Please pick the school year.";
  }
  if (!f.level) e.level = f.track === "college" ? "Please pick the year level." : "Please pick the grade level.";
  if (f.track === "college" && !f.course) e.course = "Please pick a course.";
  if (!f.student_type) e.student_type = "Please pick the student type.";
  if (f.track === "k12") {
    if (isSeniorHigh(f.level) && !f.strand) e.strand = "Please pick a strand for senior high.";
    if (f.lrn && !/^\d{12}$/.test(f.lrn)) e.lrn = "The LRN has 12 digits.";
  }
  return e;
}

/** Papers asked for on page 3. Only the picture is required to send the form. */
export function applicationDocs(f: Pick<ApplicationForm, "track" | "student_type">): { type: DocType; required: boolean }[] {
  const docs: { type: DocType; required: boolean }[] = [
    { type: "form_138", required: false },
    { type: "psa_birth_cert", required: false },
    { type: "photo", required: true },
  ];
  if (f.track === "college" && f.student_type === "transferee") {
    docs.push({ type: "honorable_dismissal", required: false }, { type: "tor", required: false });
  }
  return docs;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function validateDocuments(
  f: Pick<ApplicationForm, "track" | "student_type">,
  files: Partial<Record<DocType, { name: string; type: string; size: number }>>,
): FormErrors {
  const e: FormErrors = {};
  for (const d of applicationDocs(f)) {
    const file = files[d.type];
    if (!file) {
      if (d.required) e[d.type] = "Please add a picture of the student.";
      continue;
    }
    if (file.size > MAX_FILE_BYTES) e[d.type] = "This file is too big (10 MB at most).";
    else if (d.type === "photo" && !file.type.startsWith("image/")) e[d.type] = "The picture must be an image (JPG or PNG).";
    else if (d.type !== "photo" && !(file.type.startsWith("image/") || file.type === "application/pdf")) {
      e[d.type] = "Use a photo (JPG, PNG) or a PDF.";
    }
  }
  return e;
}

export function validateConfirm(f: ApplicationForm): FormErrors {
  const e: FormErrors = {};
  if (!f.certify) e.certify = "Please tick the box to confirm.";
  if (f.signed_name.trim().length < 3) e.signed_name = "Please type your full name as your signature.";
  return e;
}

/** Program fields cleaned for saving (strand only for SHS, K to 12 fields only for K to 12). */
export function cleanProgram(f: ApplicationForm) {
  const k12 = f.track === "k12";
  return {
    level: f.level,
    course: k12 ? null : f.course || null,
    strand: k12 && isSeniorHigh(f.level) ? f.strand || null : null,
    student_type: f.student_type,
    esc_voucher: k12 && f.esc_voucher,
    mother_tongue: k12 ? f.mother_tongue.trim() || null : null,
    ip_group: k12 ? f.ip_group.trim() || null : null,
    is_4ps: k12 && f.is_4ps,
    tuition_plan: k12 ? f.tuition_plan : null,
  };
}

/** Personal fields cleaned for saving. */
export function cleanPersonal(f: ApplicationForm) {
  return {
    first_name: f.first_name.trim(),
    middle_name: f.middle_name.trim() || null,
    last_name: f.last_name.trim(),
    birth_date: f.birth_date || null,
    sex: (f.sex || null) as "M" | "F" | null,
    lrn: f.track === "k12" ? f.lrn.trim() || null : null,
    civil_status: f.civil_status || null,
    citizenship: f.citizenship || null,
    contact_no: normalizePhone(f.contact_no),
    email: f.email.trim().toLowerCase() || null,
    address: f.address.trim(),
    guardian_name: f.guardian_name.trim(),
    guardian_contact: normalizePhone(f.guardian_contact),
  };
}
