"use client";

// Personal and program fields of the online enrollment form. Used by the
// public form (/apply) and by "Update details" in the applicant portal.

import { useState, type ReactNode } from "react";
import type { StudentType, Term, Track, TuitionPlan } from "@/lib/enrollment/types";
import { isSeniorHigh } from "@/lib/enrollment/checks";
import { COURSES, GRADES, STRANDS, YEARS } from "@/lib/enrollment/options";
import { CITIZENSHIPS, CIVIL_STATUSES, type ApplicationForm, type FormErrors } from "@/lib/applicant";
import { PLAN_INFO } from "@/lib/fees";
import { inputClass } from "../ui";

type Setter = <K extends keyof ApplicationForm>(k: K, v: ApplicationForm[K]) => void;

export function Labeled({
  label,
  required,
  error,
  hint,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && <span className="text-danger" aria-hidden> *</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-danger" role="alert">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/** Bigger touch targets than the staff panels (phones first). */
export const bigInput = `${inputClass} min-h-11 text-base sm:text-sm`;
const bad = (e?: string) => (e ? " border-danger" : "");

export function PersonalFields({ f, set, errors }: { f: ApplicationForm; set: Setter; errors: FormErrors }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Labeled label="Last name" required error={errors.last_name}>
        <input data-testid="ap-last-name" autoComplete="family-name" className={bigInput + bad(errors.last_name)} value={f.last_name} onChange={(e) => set("last_name", e.target.value)} />
      </Labeled>
      <Labeled label="First name" required error={errors.first_name}>
        <input data-testid="ap-first-name" autoComplete="given-name" className={bigInput + bad(errors.first_name)} value={f.first_name} onChange={(e) => set("first_name", e.target.value)} />
      </Labeled>
      <Labeled label="Middle name" hint="Leave blank if none.">
        <input data-testid="ap-middle-name" autoComplete="additional-name" className={bigInput} value={f.middle_name} onChange={(e) => set("middle_name", e.target.value)} />
      </Labeled>
      <Labeled label="Birthdate" required error={errors.birth_date}>
        <input data-testid="ap-birth-date" type="date" autoComplete="bday" className={bigInput + bad(errors.birth_date)} value={f.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
      </Labeled>
      <fieldset>
        <legend className="mb-1 block text-sm font-medium">
          Gender<span className="text-danger" aria-hidden> *</span>
        </legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Gender">
          {(["M", "F"] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={f.sex === g}
              data-testid={`ap-sex-${g}`}
              onClick={() => set("sex", g)}
              className={`min-h-11 rounded-lg border text-sm font-medium ${f.sex === g ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-surface text-ink"}${bad(errors.sex)}`}
            >
              {g === "M" ? "Male" : "Female"}
            </button>
          ))}
        </div>
        {errors.sex && <span className="mt-1 block text-xs font-medium text-danger" role="alert">{errors.sex}</span>}
      </fieldset>
      <Labeled label="Civil status">
        <select data-testid="ap-civil-status" className={bigInput} value={f.civil_status} onChange={(e) => set("civil_status", e.target.value)}>
          {CIVIL_STATUSES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Labeled>
      <Labeled label="Citizenship">
        <select data-testid="ap-citizenship" className={bigInput} value={f.citizenship} onChange={(e) => set("citizenship", e.target.value)}>
          {CITIZENSHIPS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Labeled>
      <Labeled label="Personal contact number" required error={errors.contact_no} hint="PH mobile, e.g. 09171234567">
        <input data-testid="ap-contact" type="tel" inputMode="tel" autoComplete="tel" placeholder="09XXXXXXXXX" className={bigInput + bad(errors.contact_no)} value={f.contact_no} onChange={(e) => set("contact_no", e.target.value)} />
      </Labeled>
      <Labeled label="Email" error={errors.email} hint="Strongly suggested. We use it for your account." className="sm:col-span-2">
        <input data-testid="ap-email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" className={bigInput + bad(errors.email)} value={f.email} onChange={(e) => set("email", e.target.value)} />
      </Labeled>
      <Labeled label="Complete address" required error={errors.address} hint="House no., street, barangay, city or town, province" className="sm:col-span-2">
        <textarea data-testid="ap-address" rows={2} autoComplete="street-address" className={bigInput + bad(errors.address)} value={f.address} onChange={(e) => set("address", e.target.value)} />
      </Labeled>
      <Labeled label="Guardian name" required error={errors.guardian_name}>
        <input data-testid="ap-guardian-name" className={bigInput + bad(errors.guardian_name)} value={f.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} />
      </Labeled>
      <Labeled label="Guardian number" required error={errors.guardian_contact}>
        <input data-testid="ap-guardian-contact" type="tel" inputMode="tel" placeholder="09XXXXXXXXX" className={bigInput + bad(errors.guardian_contact)} value={f.guardian_contact} onChange={(e) => set("guardian_contact", e.target.value)} />
      </Labeled>
    </div>
  );
}

const semesterLabel = (s: string | null) => (s === "1st" ? "1st semester" : s === "2nd" ? "2nd semester" : s === "summer" ? "Summer" : s ?? "");

export function ProgramFields({
  f,
  set,
  errors,
  terms,
  locked = false,
}: {
  f: ApplicationForm;
  set: Setter;
  errors: FormErrors;
  terms: Term[];
  /** Portal: the track and term cannot change after sending the form. */
  locked?: boolean;
}) {
  const isCollege = f.track === "college";
  const trackTerms = terms.filter((t) => t.track === f.track);
  const years = [...new Set(trackTerms.map((t) => t.school_year))];
  const term = trackTerms.find((t) => t.id === f.term_id);
  // College: the school year is picked first, then the semester (the term).
  const [pickedYear, setPickedYear] = useState("");
  const year = term?.school_year ?? pickedYear;
  const shs = !isCollege && isSeniorHigh(f.level);

  const pickTrack = (t: Track) => {
    if (t === f.track) return;
    set("track", t);
    set("term_id", "");
    setPickedYear("");
    set("level", t === "college" ? "1st Year" : "Grade 7");
    set("course", t === "college" ? "BSIT" : "");
    set("strand", "");
    if (t === "k12" && f.student_type === "returnee") set("student_type", "new");
  };
  const pickYear = (y: string) => {
    // K to 12 has one term per school year; college asks for the semester next.
    const first = trackTerms.find((t) => t.school_year === y);
    setPickedYear(y);
    set("term_id", !isCollege && first ? first.id : "");
  };

  return (
    <div className="space-y-4">
      {!locked && (
        <div role="radiogroup" aria-label="Track" className="grid grid-cols-2 gap-1 rounded-xl bg-paper p-1">
          {(["college", "k12"] as Track[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={f.track === t}
              data-testid={`ap-track-${t}`}
              onClick={() => pickTrack(t)}
              className={`min-h-11 rounded-lg text-sm font-semibold ${f.track === t ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
            >
              {t === "college" ? "College" : "K to 12"}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {!locked && (
          <>
            <Labeled label="School year" required error={!year ? errors.term_id : undefined}>
              <select data-testid="ap-school-year" className={bigInput + bad(!year ? errors.term_id : undefined)} value={year} onChange={(e) => pickYear(e.target.value)}>
                <option value="">Pick one</option>
                {years.map((y) => <option key={y}>{y}</option>)}
              </select>
            </Labeled>
            {isCollege && (
              <Labeled label="Semester" required error={year ? errors.term_id : undefined}>
                <select data-testid="ap-semester" className={bigInput + bad(year ? errors.term_id : undefined)} value={f.term_id} onChange={(e) => set("term_id", e.target.value)} disabled={!year}>
                  <option value="">{year ? "Pick one" : "Pick the school year first"}</option>
                  {trackTerms.filter((t) => t.school_year === year).map((t) => (
                    <option key={t.id} value={t.id}>{semesterLabel(t.semester)}</option>
                  ))}
                </select>
              </Labeled>
            )}
          </>
        )}

        {isCollege ? (
          <>
            <Labeled label="Course" required error={errors.course}>
              <select data-testid="ap-course" className={bigInput + bad(errors.course)} value={f.course} onChange={(e) => set("course", e.target.value)}>
                {COURSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Labeled>
            <Labeled label="Year level" required error={errors.level}>
              <select data-testid="ap-level" className={bigInput + bad(errors.level)} value={f.level} onChange={(e) => set("level", e.target.value)}>
                {YEARS.map((y) => <option key={y}>{y}</option>)}
              </select>
            </Labeled>
          </>
        ) : (
          <>
            <Labeled label="Grade level" required error={errors.level}>
              <select data-testid="ap-level" className={bigInput + bad(errors.level)} value={f.level} onChange={(e) => set("level", e.target.value)}>
                {GRADES.map((g) => <option key={g}>{g}</option>)}
              </select>
            </Labeled>
            {shs && (
              <Labeled label="Strand (Senior High)" required error={errors.strand}>
                <select data-testid="ap-strand" className={bigInput + bad(errors.strand)} value={f.strand} onChange={(e) => set("strand", e.target.value)}>
                  <option value="">Pick one</option>
                  {STRANDS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Labeled>
            )}
            <Labeled label="LRN" error={errors.lrn} hint="Learner Reference Number, 12 digits (on the report card)">
              <input data-testid="ap-lrn" inputMode="numeric" maxLength={12} className={bigInput + bad(errors.lrn)} value={f.lrn} onChange={(e) => set("lrn", e.target.value.replace(/\D/g, ""))} />
            </Labeled>
          </>
        )}

        <Labeled label="Student type" required error={errors.student_type}>
          <select data-testid="ap-student-type" className={bigInput} value={f.student_type} onChange={(e) => set("student_type", e.target.value as StudentType)}>
            <option value="new">New</option>
            {isCollege && <option value="continuing">Continuing</option>}
            {isCollege && <option value="returnee">Returnee</option>}
            {!isCollege && <option value="continuing">Continuing (moving up)</option>}
            <option value="transferee">Transferee</option>
          </select>
        </Labeled>

        {!isCollege && (
          <>
            <Labeled label="Mother tongue">
              <input data-testid="ap-mother-tongue" className={bigInput} placeholder="e.g. Tagalog, Cebuano" value={f.mother_tongue} onChange={(e) => set("mother_tongue", e.target.value)} />
            </Labeled>
            <Labeled label="IP group (if any)">
              <input data-testid="ap-ip-group" className={bigInput} placeholder="e.g. Aeta, Lumad" value={f.ip_group} onChange={(e) => set("ip_group", e.target.value)} />
            </Labeled>
            <Labeled label="Tuition plan">
              <select data-testid="ap-plan" className={bigInput} value={f.tuition_plan} onChange={(e) => set("tuition_plan", e.target.value as TuitionPlan)}>
                {(Object.keys(PLAN_INFO) as TuitionPlan[]).map((p) => <option key={p} value={p}>{PLAN_INFO[p].label}</option>)}
              </select>
            </Labeled>
            <div className="space-y-2 sm:col-span-2">
              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 text-sm">
                <input type="checkbox" className="h-5 w-5" data-testid="ap-esc" checked={f.esc_voucher} onChange={(e) => set("esc_voucher", e.target.checked)} />
                ESC grant / SHS voucher
              </label>
              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 text-sm">
                <input type="checkbox" className="h-5 w-5" data-testid="ap-4ps" checked={f.is_4ps} onChange={(e) => set("is_4ps", e.target.checked)} />
                4Ps beneficiary
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
