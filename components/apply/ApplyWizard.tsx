"use client";

// The public enrollment form (/apply): 4 short pages, phone first.
// 1 Personal, 2 Program, 3 Papers, 4 Confirm, then the applicant number and
// temporary password on the success screen.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ApplicantCredentials, ApplyInfo, DataStore } from "@/lib/data/store";
import type { DocType } from "@/lib/enrollment/types";
import { DOC_LABEL } from "@/lib/enrollment/checks";
import { PLAN_INFO } from "@/lib/fees";
import {
  applicationDocs,
  emptyApplication,
  validateConfirm,
  validateDocuments,
  validatePersonal,
  validateProgram,
  type ApplicationForm,
  type FormErrors,
} from "@/lib/applicant";
import { DemoStore } from "@/lib/data/demo-store";
import { SupabaseStore } from "@/lib/data/supabase-store";
import { Button } from "../ui";
import PublicShell from "./PublicShell";
import { Labeled, PersonalFields, ProgramFields, bigInput } from "./FormFields";
import SignaturePad from "./SignaturePad";

const PAGES = ["Personal", "Program", "Papers", "Confirm"] as const;

const DOC_HELP: Partial<Record<DocType, string>> = {
  form_138: "Latest report card. A clear phone photo is OK.",
  psa_birth_cert: "PSA (or NSO) copy.",
  photo: "A recent picture of the student's face, plain background (like an ID photo).",
  honorable_dismissal: "From your last school.",
  tor: "Transcript of records from your last school.",
};

const todayManila = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const longDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });

export default function ApplyWizard({
  code,
  demo,
  emailRequired,
}: {
  code: string | null;
  demo: boolean;
  /** Supabase mode without the service role key: the account needs an email. */
  emailRequired: boolean;
}) {
  const [store, setStore] = useState<DataStore | null>(null);
  const [info, setInfo] = useState<ApplyInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<ApplicationForm>(emptyApplication("college"));
  const [files, setFiles] = useState<Partial<Record<DocType, File>>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [done, setDone] = useState<ApplicantCredentials | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = demo ? new DemoStore({ portal: true }) : new SupabaseStore();
    setStore(s);
    s.getApplyInfo(code).then(setInfo, (e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [code, demo]);

  const set = <K extends keyof ApplicationForm>(k: K, v: ApplicationForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const terms = useMemo(() => info?.terms ?? [], [info]);
  const today = todayManila();

  const check = (p: number): FormErrors => {
    const e =
      p === 0 ? validatePersonal(form, today)
      : p === 1 ? validateProgram(form, terms)
      : p === 2 ? validateDocuments(form, files)
      : validateConfirm(form);
    if (p === 0 && emailRequired && !form.email.trim()) e.email = "Please give an email. We use it to make your account.";
    return Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as FormErrors;
  };

  const go = (p: number) => {
    setPage(p);
    setSendError(null);
    requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const next = () => {
    const e = check(page);
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => document.querySelector('[role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    go(page + 1);
  };

  const send = async () => {
    // Check every page again (a page may have been edited from the summary).
    for (let p = 0; p < PAGES.length; p++) {
      const e = check(p);
      if (Object.keys(e).length) {
        setErrors(e);
        go(p);
        return;
      }
    }
    if (!store) return;
    setBusy(true);
    setSendError(null);
    try {
      const docs = applicationDocs(form).map((d) => d.type);
      const creds = await store.submitPublicApplication({
        school_code: code,
        form: { ...form, signed_name: form.signed_name.trim() },
        files: Object.entries(files)
          .filter(([t, f]) => !!f && docs.includes(t as DocType))
          .map(([type, file]) => ({ type: type as DocType, file: file as File })),
      });
      setDone(creds);
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const school = info?.school ?? null;

  if (loadError) {
    return (
      <PublicShell school={null} subtitle="Online enrollment form">
        <p className="rounded-r-md border-l-2 border-stop bg-stop/7 p-4 text-sm text-stop" role="alert">{loadError}</p>
      </PublicShell>
    );
  }

  if (done) {
    return (
      <PublicShell school={school} subtitle="Online enrollment form" demo={demo} wide>
        <Success creds={done} />
      </PublicShell>
    );
  }

  const titles = ["About the student", "What will you enroll in?", "Papers", "Check and send"];
  const hints = [
    "Fields with * are needed.",
    "Pick College or K to 12 first.",
    "Take a clear photo with your phone, or pick a PDF. Only the picture is needed now: you can add the other papers later in the Applicant Portal.",
    "Look over your answers. Press Edit to fix something.",
  ];

  return (
    <PublicShell school={school} subtitle="Online enrollment form" demo={demo} wide>
      <div ref={top} className="scroll-mt-20" />
      <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10">
        {/* Steps: a list on the left (desktop), a stepper on top (phones) */}
        <aside className="md:sticky md:top-24 md:self-start">
          <h1 className="text-xl font-semibold md:text-2xl">Enroll online</h1>
          <p className="mt-1 text-sm text-muted">Four short steps, about 10 minutes.</p>
          <ol className="mt-4 grid grid-cols-4 gap-1.5 md:mt-6 md:grid-cols-1 md:gap-0" aria-label="Form steps" data-testid="ap-steps">
            {PAGES.map((label, i) => {
              const done = i < page;
              const here = i === page;
              return (
                <li key={label} aria-current={here ? "step" : undefined}>
                  {/* phones */}
                  <div className="md:hidden">
                    <div className={`h-1 rounded-full ${done ? "bg-go" : here ? "bg-ink" : "bg-line"}`} />
                    <p className={`mt-1.5 truncate text-xs ${here ? "font-semibold text-ink" : "text-muted"}`}>{i + 1} {label}</p>
                  </div>
                  {/* desktop */}
                  <button
                    type="button"
                    disabled={!done}
                    onClick={() => go(i)}
                    className={`relative hidden w-full items-center gap-3 rounded-md py-2.5 pr-2 pl-3 text-left text-sm md:flex ${here ? "bg-sheet font-semibold text-ink shadow-[0_0_0_1px_var(--color-line)]" : done ? "text-ink hover:bg-hover" : "text-muted"}`}
                  >
                    <span className={`num grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-go text-white" : here ? "bg-ink text-sheet" : "border border-line"}`}>
                      {done ? (
                        <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2.5 6.2l2.2 2.2 4.8-4.8" /></svg>
                      ) : (
                        i + 1
                      )}
                    </span>
                    {label}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-6 hidden md:block">
            <Intro />
          </div>
        </aside>

        <div className="min-w-0">
          {page === 0 && (
            <div className="mb-5 md:hidden">
              <Intro />
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (page < PAGES.length - 1) next();
              else void send();
            }}
            className="space-y-5 rounded-xl border border-line bg-sheet p-4 sm:p-6"
            data-testid={`ap-page-${page + 1}`}
            noValidate
          >
            <div>
              <p className="text-xs font-medium text-muted">Step {page + 1} of 4</p>
              <h2 className="text-xl font-semibold">{titles[page]}</h2>
              <p className="mt-1 text-sm text-muted">{hints[page]}</p>
            </div>

            {/* Honeypot: hidden from people, bots fill it in. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={(e) => set("website", e.target.value)} />
              </label>
            </div>

            {page === 0 && <PersonalFields f={form} set={set} errors={errors} />}
            {page === 1 && (
              terms.length === 0 && info ? (
                <p className="rounded-r-md border-l-2 border-warn bg-warn/8 p-3 text-sm text-warn">Enrollment is closed right now. Please check again later.</p>
              ) : (
                <ProgramFields f={form} set={set} errors={errors} terms={terms} />
              )
            )}
            {page === 2 && <PapersPage form={form} files={files} setFiles={(f) => { setFiles(f); setErrors({}); }} errors={errors} />}
            {page === 3 && (
              <ConfirmPage form={form} files={files} set={set} errors={errors} today={today} terms={terms} onEdit={go} />
            )}

            {sendError && <p className="rounded-r-md border-l-2 border-stop bg-stop/7 px-3 py-2 text-sm font-medium text-stop" role="alert" data-testid="ap-send-error">{sendError}</p>}

            <div className="flex gap-2 border-t border-line pt-4">
              {page > 0 && (
                <Button variant="secondary" className="min-h-11 flex-1 md:flex-none md:px-6" onClick={() => go(page - 1)} data-testid="ap-back">
                  Back
                </Button>
              )}
              <Button type="submit" className="min-h-11 flex-[2] md:ml-auto md:flex-none md:px-8" disabled={busy || (page === 1 && !terms.length)} data-testid={page < 3 ? "ap-next" : "ap-submit"}>
                {page < 3 ? `Next: ${PAGES[page + 1]}` : busy ? "Sending" : "Send my application"}
              </Button>
            </div>
          </form>
          <p className="mt-4 text-center text-sm text-muted md:text-left">
            Already sent the form? <Link href="/portal" className="font-semibold text-ink underline">Open the Applicant Portal</Link>
          </p>
        </div>
      </div>
    </PublicShell>
  );
}

function Intro() {
  return (
    <section className="space-y-3 border-l-2 border-line pl-4 text-sm leading-relaxed text-muted" data-testid="ap-intro">
      <p>
        <span className="font-semibold text-ink">Who is this for?</span> New students and transferees for College, and parents or guardians enrolling a
        child in K to 12 (Kinder to Grade 12). Continuing students: ask the registrar.
      </p>
      <p>
        <span className="font-semibold text-ink">What to prepare:</span> a mobile number, the report card (Form 138), the PSA birth certificate and a clear
        picture of the student. Transferees: honorable dismissal and TOR too. Phone photos are OK.
      </p>
      <p>
        <span className="font-semibold text-ink">After you send it:</span> you get an applicant number and a temporary password for the Applicant Portal.
      </p>
    </section>
  );
}

function PapersPage({
  form,
  files,
  setFiles,
  errors,
}: {
  form: ApplicationForm;
  files: Partial<Record<DocType, File>>;
  setFiles: (f: Partial<Record<DocType, File>>) => void;
  errors: FormErrors;
}) {
  const docs = applicationDocs(form);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const p = files.photo;
    if (!p) return setPreview(null);
    const url = URL.createObjectURL(p);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [files.photo]);

  return (
    <ul className="space-y-3">
      {docs.map((d) => {
        const file = files[d.type];
        const err = errors[d.type];
        return (
          <li key={d.type} className={`rounded-md border p-3 ${err ? "border-stop" : file ? "border-go/50 bg-go/5" : "border-line"}`}>
            <div className="flex items-start gap-3">
              {d.type === "photo" && preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Student picture" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md text-base ${file ? "bg-go text-white" : "bg-paper text-muted"}`} aria-hidden>
                  {file ? (
                    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
                  ) : (
                    <span className="num text-sm font-semibold">{docs.indexOf(d) + 1}</span>
                  )}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {DOC_LABEL[d.type]}
                  {d.required ? <span className="text-danger"> *</span> : <span className="font-normal text-muted"> (can follow)</span>}
                </p>
                <p className="text-xs text-muted">{DOC_HELP[d.type]}</p>
                {file && <p className="mt-1 truncate text-xs font-medium text-go">{file.name}</p>}
                {err && <p className="mt-1 text-xs font-medium text-danger" role="alert">{err}</p>}
              </div>
            </div>
            <label className="mt-2 flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-sm font-medium hover:bg-paper">
              {file ? "Change file" : d.type === "photo" ? "Add picture" : "Add photo or PDF"}
              <input
                type="file"
                className="sr-only"
                data-testid={`ap-file-${d.type}`}
                accept={d.type === "photo" ? "image/*" : "image/*,application/pdf"}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFiles({ ...files, [d.type]: f });
                  e.target.value = "";
                }}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function ConfirmPage({
  form,
  files,
  set,
  errors,
  today,
  terms,
  onEdit,
}: {
  form: ApplicationForm;
  files: Partial<Record<DocType, File>>;
  set: <K extends keyof ApplicationForm>(k: K, v: ApplicationForm[K]) => void;
  errors: FormErrors;
  today: string;
  terms: ApplyInfo["terms"];
  onEdit: (page: number) => void;
}) {
  const term = terms.find((t) => t.id === form.term_id);
  const isCollege = form.track === "college";
  const name = [form.first_name, form.middle_name, form.last_name].filter((x) => x.trim()).join(" ");
  const docs = applicationDocs(form);
  return (
    <div className="space-y-4">
      <SummaryBlock title="Personal" onEdit={() => onEdit(0)} rows={[
        ["Name", `${form.last_name}, ${form.first_name}${form.middle_name ? ` ${form.middle_name}` : ""}`],
        ["Birthdate", form.birth_date ? longDate(form.birth_date) : "—"],
        ["Gender", form.sex === "M" ? "Male" : form.sex === "F" ? "Female" : "—"],
        ["Civil status", form.civil_status],
        ["Citizenship", form.citizenship],
        ["Contact number", form.contact_no],
        ["Email", form.email || "—"],
        ["Address", form.address],
        ["Guardian", `${form.guardian_name}, ${form.guardian_contact}`],
      ]} />
      <SummaryBlock title="Program" onEdit={() => onEdit(1)} rows={[
        ["Track", isCollege ? "College" : "K to 12"],
        ["School year", term ? `${term.school_year}${term.semester ? `, ${term.semester} semester` : ""}` : "None"],
        ...(isCollege
          ? ([["Course", form.course], ["Year level", form.level]] as [string, string][])
          : ([
              ["Grade level", `${form.level}${form.strand ? ` ${form.strand}` : ""}`],
              ["LRN", form.lrn || "—"],
              ["ESC / voucher", form.esc_voucher ? "Yes" : "No"],
              ["Tuition plan", PLAN_INFO[form.tuition_plan].label],
            ] as [string, string][])),
        ["Student type", form.student_type.charAt(0).toUpperCase() + form.student_type.slice(1)],
      ]} />
      <SummaryBlock title="Papers" onEdit={() => onEdit(2)} rows={docs.map((d) => [DOC_LABEL[d.type], files[d.type]?.name ?? "Will follow"])} />

      <label className={`flex items-start gap-3 rounded-md border p-3 text-sm ${errors.certify ? "border-stop" : "border-line"}`}>
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" data-testid="ap-certify" checked={form.certify} onChange={(e) => set("certify", e.target.checked)} />
        <span>
          I certify that all the information provided is true and correct.<span className="text-danger"> *</span>
          {errors.certify && <span className="mt-1 block text-xs font-medium text-danger" role="alert">{errors.certify}</span>}
        </span>
      </label>
      <Labeled label="Type your full name as your signature" required error={errors.signed_name} hint={name ? `For example: ${name}` : undefined}>
        <input data-testid="ap-signed-name" autoComplete="name" className={`${bigInput} font-medium${errors.signed_name ? " border-danger" : ""}`} value={form.signed_name} onChange={(e) => set("signed_name", e.target.value)} />
      </Labeled>
      <div>
        <p className="mb-1 text-sm font-medium">Signature (optional)</p>
        <SignaturePad onChange={(png) => set("signature", png)} />
      </div>
      <p className="text-sm text-muted">Date: <span className="font-medium text-ink" data-testid="ap-date">{longDate(today)}</span></p>
    </div>
  );
}

function SummaryBlock({ title, rows, onEdit }: { title: string; rows: [string, string][]; onEdit: () => void }) {
  return (
    <section className="rounded-md border border-line">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button type="button" className="min-h-9 px-2 text-sm font-semibold text-ink underline" onClick={onEdit}>Edit</button>
      </div>
      <dl className="divide-y divide-line px-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-1.5">
            <dt className="shrink-0 text-muted">{k}</dt>
            <dd className="min-w-0 break-words text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Success({ creds }: { creds: ApplicantCredentials }) {
  const [copied, setCopied] = useState(false);
  const portal = typeof window !== "undefined" ? `${window.location.origin}/portal` : "/portal";
  const text = `${creds.school_name} - Applicant Portal\nApplicant number: ${creds.applicant_no}\nTemporary password: ${creds.password}\nSign in at: ${portal}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mx-auto max-w-xl space-y-5" data-testid="ap-success">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-go text-white" aria-hidden>
          <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Application sent</h1>
          <p className="mt-1 text-sm text-muted">Thank you, {creds.full_name.split(" ")[0]}. The registrar will check your papers in 1 to 3 school days.</p>
        </div>
      </div>

      <section className="rounded-xl border border-ink/25 bg-sheet p-5">
        <p className="text-sm font-semibold">Save or screenshot this now</p>
        <p className="mt-0.5 text-sm text-muted">You need these to sign in. We show the password only once.</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Applicant number (your username)</dt>
            <dd className="num text-2xl font-semibold" data-testid="ap-cred-no">{creds.applicant_no}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Temporary password</dt>
            <dd className="num text-xl font-semibold break-words sm:text-2xl" data-testid="ap-cred-password">{creds.password}</dd>
          </div>
        </dl>
        <Button className="mt-4 min-h-11 w-full" variant="secondary" onClick={copy} data-testid="ap-copy">
          {copied ? "Copied" : "Copy number and password"}
        </Button>
      </section>

      <div className="space-y-2 text-sm text-muted">
        {creds.email_note === "confirm" && creds.email && (
          <p>We sent a message to <strong className="text-ink">{creds.email}</strong>. Open it and tap the link to confirm your email <strong className="text-ink">before</strong> you sign in.</p>
        )}
        {creds.email_note === "none" && creds.email && (
          <p>You can also sign in with your email, <strong className="text-ink">{creds.email}</strong>. We did not email the password, so keep it safe.</p>
        )}
        {creds.email_note === "demo" && (
          <p>Demo mode: no email is sent{creds.email ? `, but you can also sign in with ${creds.email}` : ""}.</p>
        )}
        {creds.notice && <p className="text-warn">{creds.notice}</p>}
        {!creds.papers_uploaded && <p className="text-warn">Your papers were not uploaded yet. Add them in the Applicant Portal after you sign in.</p>}
        <p>On your first sign-in you will pick your own password.</p>
      </div>

      <Link href="/portal" className="flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary hover:opacity-90" data-testid="ap-go-portal">
        Go to the Applicant Portal
      </Link>
    </div>
  );
}
