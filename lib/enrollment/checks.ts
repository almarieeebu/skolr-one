// Pure checks used before a status change. Each returns a list of
// human-readable warnings. An empty list means "all good".

import type {
  DocType,
  DocumentRow,
  Enrollment,
  Offering,
  SchoolSettings,
  Student,
} from "./types";

export const DOC_LABEL: Record<DocType, string> = {
  psa_birth_cert: "PSA birth certificate",
  form_138: "Form 138 (report card)",
  honorable_dismissal: "Honorable dismissal",
  tor: "Transcript of records (TOR)",
  photo: "Student picture",
};

/** Which papers an applicant must submit. */
export function requiredDocs(e: Pick<Enrollment, "track" | "student_type">): DocType[] {
  const docs: DocType[] = ["psa_birth_cert", "form_138"];
  if (e.track === "college" && e.student_type === "transferee") {
    docs.push("honorable_dismissal", "tor");
  }
  return docs;
}

export function checkPapers(
  e: Pick<Enrollment, "track" | "student_type">,
  docs: Pick<DocumentRow, "type" | "file_name">[],
): string[] {
  const have = new Set(docs.filter((d) => d.file_name).map((d) => d.type));
  return requiredDocs(e)
    .filter((t) => !have.has(t))
    .map((t) => `Missing paper: ${DOC_LABEL[t]}`);
}

// ---------- schedule helpers ----------

/** "MWF" -> ["M","W","F"], "TTh" -> ["T","Th"], "SatSu" style also works. */
export function parseDays(days: string | null): string[] {
  if (!days) return [];
  const tokens = days.match(/Th|Su|Sa|M|T|W|F|S/g) ?? [];
  // Treat "Sa" and "S" as the same day (Saturday).
  return tokens.map((t) => (t === "Sa" ? "S" : t));
}

/** "08:30" -> 510 (minutes after midnight). */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function schedulesOverlap(a: Offering, b: Offering): boolean {
  if (!a.start_time || !a.end_time || !b.start_time || !b.end_time) return false;
  const daysA = parseDays(a.days);
  const daysB = new Set(parseDays(b.days));
  if (!daysA.some((d) => daysB.has(d))) return false;
  return toMinutes(a.start_time) < toMinutes(b.end_time) &&
    toMinutes(b.start_time) < toMinutes(a.end_time);
}

export function formatSchedule(o: Pick<Offering, "days" | "start_time" | "end_time">): string {
  if (!o.days || !o.start_time || !o.end_time) return "TBA";
  return `${o.days} ${o.start_time}-${o.end_time}`;
}

// ---------- college load ----------

export function totalUnits(subjects: Offering[]): number {
  return subjects.reduce((sum, s) => sum + s.units, 0);
}

export interface LoadCheckInput {
  picked: Offering[];
  student: Pick<Student, "completed_codes">;
  /** Subjects passed with posted grades (see lib/grades passedCodes). */
  passedCodes?: string[];
  settings: Pick<SchoolSettings, "max_units">;
  /** Seats already used by other enrollments, per offering id. */
  takenCounts: Record<string, number>;
}

export function checkCollegeLoad({ picked, student, passedCodes = [], settings, takenCounts }: LoadCheckInput): string[] {
  const warnings: string[] = [];
  if (picked.length === 0) warnings.push("Pick at least one subject.");

  // Prerequisites: passed with a posted grade, or credited (transferees).
  const passed = new Set([...passedCodes, ...student.completed_codes]);
  for (const s of picked) {
    const missing = s.prerequisite_codes.filter((p) => !passed.has(p));
    if (missing.length) {
      warnings.push(`${s.code} needs ${missing.join(", ")} first (prerequisite).`);
    }
  }

  // Max units
  const max = settings.max_units || 24;
  const units = totalUnits(picked);
  if (units > max) warnings.push(`Too many units: ${units} (max ${max}).`);

  // Time conflicts (check each pair once)
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      if (schedulesOverlap(picked[i], picked[j])) {
        warnings.push(`Time conflict: ${picked[i].code} and ${picked[j].code}.`);
      }
    }
  }

  // Slots
  for (const s of picked) {
    if ((takenCounts[s.id] ?? 0) >= s.slots) {
      warnings.push(`${s.code} is full (${s.slots} slots).`);
    }
  }
  return warnings;
}

// ---------- K to 12 section ----------

export function checkSection(
  section: Offering | undefined,
  e: Pick<Enrollment, "level" | "strand">,
  takenCounts: Record<string, number>,
): string[] {
  if (!section) return ["Pick a section."];
  const warnings: string[] = [];
  if (section.level && section.level !== e.level) {
    warnings.push(`${section.title} is for ${section.level}, not ${e.level}.`);
  }
  if (section.strand && e.strand && section.strand !== e.strand) {
    warnings.push(`${section.title} is for ${section.strand}, not ${e.strand}.`);
  }
  if ((takenCounts[section.id] ?? 0) >= section.slots) {
    warnings.push(`${section.title} is full (capacity ${section.slots}).`);
  }
  return warnings;
}

/** Senior high = Grade 11 and 12 (they need a strand). */
export function isSeniorHigh(level: string): boolean {
  return /Grade 1[12]\b/.test(level);
}
