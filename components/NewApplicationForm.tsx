"use client";

// "New application" side panel. The College / K to 12 toggle swaps the fields.

import { useEffect, useState } from "react";
import type { DataStore, NewApplicationInput, SessionInfo } from "@/lib/data/store";
import { fullName } from "@/lib/data/store";
import type { DocType, Student, StudentType, Term, Track, TuitionPlan } from "@/lib/enrollment/types";
import { DOC_LABEL, isSeniorHigh, requiredDocs } from "@/lib/enrollment/checks";
import { PLAN_INFO } from "@/lib/fees";
import { COURSES, GRADES, STRANDS, YEARS } from "@/lib/enrollment/options";
import { Button, Field, inputClass } from "./ui";


const empty = (track: Track): Omit<NewApplicationInput, "term_id" | "files"> => ({
  track,
  first_name: "",
  middle_name: "",
  last_name: "",
  birth_date: "",
  sex: "",
  lrn: "",
  level: track === "college" ? "1st Year" : "Grade 7",
  course: "BSIT",
  strand: "",
  student_type: "new",
  esc_voucher: false,
  mother_tongue: "",
  ip_group: "",
  is_4ps: false,
  tuition_plan: "annual",
});

export default function NewApplicationForm({
  store,
  session,
  onDone,
}: {
  store: DataStore;
  session: SessionInfo;
  onDone: (enrollmentId: string) => void;
}) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [returning, setReturning] = useState<Student[]>([]);
  const [form, setForm] = useState(empty("college"));
  const [existingId, setExistingId] = useState("");
  const [termId, setTermId] = useState("");
  const [files, setFiles] = useState<Partial<Record<DocType, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void store.listTerms().then(setTerms);
    void store.listReturningStudents().then(setReturning);
  }, [store]);

  const isCollege = form.track === "college";
  const trackTerms = terms.filter((t) => t.track === form.track);
  const term = trackTerms.find((t) => t.id === termId) ?? trackTerms[0];
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const docs = requiredDocs({ track: form.track, student_type: form.student_type });
  const shs = !isCollege && isSeniorHigh(form.level);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    if (!term) return setError("No open term for this track.");
    if (!existingId && (!form.first_name.trim() || !form.last_name.trim())) {
      return setError("Please enter the first and last name.");
    }
    if (!isCollege && form.lrn && !/^\d{12}$/.test(form.lrn)) {
      return setError("The LRN has 12 digits.");
    }
    if (shs && !form.strand) return setError("Please pick a strand for senior high.");
    setBusy(true);
    try {
      const id = await store.createApplication({
        ...form,
        strand: shs ? form.strand : "",
        term_id: term.id,
        existing_student_id: existingId || undefined,
        files: Object.entries(files)
          .filter(([, f]) => !!f)
          .map(([type, file]) => ({ type: type as DocType, file: file as File })),
      });
      onDone(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="new-application-form">
      {/* Track toggle */}
      <div role="radiogroup" aria-label="Track" className="grid grid-cols-2 rounded-xl bg-paper p-1">
        {(["college", "k12"] as Track[]).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={form.track === t}
            onClick={() => {
              setForm(empty(t));
              setExistingId("");
              setFiles({});
            }}
            className={`rounded-lg py-2 text-sm font-medium ${form.track === t ? "bg-surface shadow-sm" : "text-muted"}`}
          >
            {t === "college" ? "College" : "K to 12"}
          </button>
        ))}
      </div>
      {trackTerms.length > 1 ? (
        <Field label="Term">
          <select data-testid="term-select" className={inputClass} value={term?.id ?? ""} onChange={(e) => setTermId(e.target.value)}>
            {trackTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.school_year}{t.semester ? ` · ${t.semester} semester` : ""}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="-mt-2 text-xs text-muted">
          {term ? `Term: ${term.school_year}${term.semester ? ` · ${term.semester} semester` : ""}` : "No open term."}
          {" · "}
          {isCollege ? "CHED rules" : "DepEd rules"}
        </p>
      )}

      {returning.length > 0 && (
        <Field label="Returning student?" hint="Students who already have an ID skip to picking subjects/section.">
          <select data-testid="returning-select" className={inputClass} value={existingId} onChange={(e) => setExistingId(e.target.value)}>
            <option value="">No, new applicant</option>
            {returning.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)} · {s.student_no}
              </option>
            ))}
          </select>
        </Field>
      )}

      {!existingId && (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Student</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="First name">
              <input className={inputClass} value={form.first_name} onChange={(e) => set("first_name", e.target.value)} data-testid="first-name" />
            </Field>
            <Field label="Middle name">
              <input className={inputClass} value={form.middle_name} onChange={(e) => set("middle_name", e.target.value)} />
            </Field>
            <Field label="Last name">
              <input className={inputClass} value={form.last_name} onChange={(e) => set("last_name", e.target.value)} data-testid="last-name" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Birth date">
              <input type="date" className={inputClass} value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
            </Field>
            <Field label="Sex">
              <select className={inputClass} value={form.sex} onChange={(e) => set("sex", e.target.value as "M" | "F" | "")}>
                <option value="">—</option>
                <option value="F">Female</option>
                <option value="M">Male</option>
              </select>
            </Field>
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{isCollege ? "Program" : "Grade level"}</legend>
        {isCollege ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Course">
              <select className={inputClass} value={form.course} onChange={(e) => set("course", e.target.value)}>
                {COURSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Year level">
              <select className={inputClass} value={form.level} onChange={(e) => set("level", e.target.value)}>
                {YEARS.map((y) => <option key={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Student type">
              <select className={inputClass} value={form.student_type} onChange={(e) => set("student_type", e.target.value as StudentType)}>
                <option value="new">New</option>
                <option value="transferee">Transferee</option>
                <option value="returnee">Returnee</option>
                <option value="continuing">Continuing</option>
              </select>
            </Field>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Grade level">
                <select className={inputClass} value={form.level} onChange={(e) => set("level", e.target.value)}>
                  {GRADES.map((g) => <option key={g}>{g}</option>)}
                </select>
              </Field>
              {shs && (
                <Field label="Strand (SHS)">
                  <select className={inputClass} value={form.strand} onChange={(e) => set("strand", e.target.value)}>
                    <option value="">Pick…</option>
                    {STRANDS.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              )}
              {!existingId && (
                <Field label="LRN" hint="12 digits">
                  <input className={inputClass} inputMode="numeric" maxLength={12} value={form.lrn} onChange={(e) => set("lrn", e.target.value.replace(/\D/g, ""))} />
                </Field>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Mother tongue">
                <input className={inputClass} value={form.mother_tongue} placeholder="e.g. Tagalog, Cebuano" onChange={(e) => set("mother_tongue", e.target.value)} />
              </Field>
              <Field label="IP group (if any)">
                <input className={inputClass} value={form.ip_group} placeholder="e.g. Aeta, Lumad" onChange={(e) => set("ip_group", e.target.value)} />
              </Field>
              <Field label="Student type">
                <select className={inputClass} value={form.student_type} onChange={(e) => set("student_type", e.target.value as StudentType)}>
                  <option value="new">New</option>
                  <option value="transferee">Transferee</option>
                  <option value="continuing">Continuing</option>
                </select>
              </Field>
              <Field label="Tuition plan">
                <select className={inputClass} value={form.tuition_plan} onChange={(e) => set("tuition_plan", e.target.value as TuitionPlan)}>
                  {(Object.keys(PLAN_INFO) as TuitionPlan[]).map((p) => (
                    <option key={p} value={p}>{PLAN_INFO[p].label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.esc_voucher} onChange={(e) => set("esc_voucher", e.target.checked)} />
                ESC grant / SHS voucher
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.is_4ps} onChange={(e) => set("is_4ps", e.target.checked)} />
                4Ps beneficiary
              </label>
            </div>
          </>
        )}
      </fieldset>

      {!existingId && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Papers</legend>
          {docs.map((d) => (
            <label key={d} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <span>{DOC_LABEL[d]}</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="max-w-[60%] text-xs file:mr-2 file:rounded-md file:border-0 file:bg-paper file:px-2 file:py-1"
                onChange={(e) => setFiles((f) => ({ ...f, [d]: e.target.files?.[0] }))}
              />
            </label>
          ))}
          <p className="text-xs text-muted">You can also upload papers later from the student card.</p>
        </fieldset>
      )}

      {error && <p className="text-sm font-medium text-danger" role="alert">{error}</p>}

      <Button type="submit" disabled={busy} className="w-full" data-testid="submit-application">
        {busy ? "Submitting…" : existingId ? "Start enrollment" : "Submit application"}
      </Button>
    </form>
  );
}
