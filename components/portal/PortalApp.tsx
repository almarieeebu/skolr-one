"use client";

// Applicant Portal (/portal): sign in with the applicant number (or email) and
// the temporary password, pick a new password, then follow the application:
// progress, update details, papers, follow-up requests to the registrar.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DataStore, PortalData } from "@/lib/data/store";
import type { DocType, EnrollmentDetail } from "@/lib/enrollment/types";
import { STEPS, stepIndex } from "@/lib/enrollment/status";
import { DOC_LABEL, requiredDocs } from "@/lib/enrollment/checks";
import { canUploadPapers } from "@/lib/enrollment/actions";
import {
  REQUEST_TYPE_LABEL,
  applicantStage,
  canEditApplication,
  checkNewPassword,
  cleanPersonal,
  cleanProgram,
  emptyApplication,
  stepDates,
  validatePersonal,
  validateProgram,
  type ApplicationForm,
  type FormErrors,
  type RequestType,
} from "@/lib/applicant";
import { DemoStore } from "@/lib/data/demo-store";
import { SupabaseStore } from "@/lib/data/supabase-store";
import { fullName, termLabel } from "@/lib/data/store";
import { Button, Section } from "../ui";
import PublicShell from "../apply/PublicShell";
import { Labeled, PersonalFields, ProgramFields, bigInput } from "../apply/FormFields";
import { ProgressBar, UploadButton } from "../StudentCard";
import RequestList from "../RequestList";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function PortalApp({ demo }: { demo: boolean }) {
  const [store, setStore] = useState<DataStore | null>(null);
  /** undefined = loading, null = signed out */
  const [data, setData] = useState<PortalData | null | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStore(demo ? new DemoStore({ portal: true }) : new SupabaseStore());
  }, [demo]);

  const load = useCallback(async () => {
    if (!store) return;
    try {
      setData(await store.getPortal());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    }
  }, [store]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const done = async (msg: string) => {
    setToast(msg);
    await load();
  };

  const school = data?.session.school ?? null;
  const signOut = async () => {
    await store?.signOut();
    setData(null);
  };

  let body: React.ReactNode;
  if (!store || data === undefined) body = <p className="py-16 text-center text-sm text-muted">Loading…</p>;
  else if (data === null) body = <Login store={store} demo={demo} onDone={load} error={error} />;
  else if (data.must_change_password) body = <NewPassword store={store} first onDone={() => done("Password saved. Welcome!")} />;
  else body = <Home data={data} store={store} demo={demo} onChanged={done} onSignOut={signOut} />;

  return (
    <PublicShell
      school={school}
      subtitle="Applicant Portal"
      demo={demo}
      right={
        data ? (
          <Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={signOut} data-testid="portal-signout">
            Sign out
          </Button>
        ) : undefined
      }
    >
      {body}
      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-center text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </PublicShell>
  );
}

// ---------- sign in ----------

function Login({ store, demo, onDone, error }: { store: DataStore; demo: boolean; onDone: () => void; error: string | null }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(error);
  return (
    <div className="space-y-4">
      <form
        className="space-y-4 rounded-2xl border border-line bg-surface p-5"
        data-testid="portal-login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await store.signIn(login, password);
            onDone();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted">Use the applicant number and password you got after sending the form.</p>
        </div>
        <Labeled label="Applicant number or email">
          <input data-testid="portal-login-id" autoCapitalize="characters" autoComplete="username" placeholder="APP-2026-00012" className={bigInput} value={login} onChange={(e) => setLogin(e.target.value)} required />
        </Labeled>
        <Labeled label="Password">
          <input data-testid="portal-login-password" type="password" autoComplete="current-password" className={bigInput} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Labeled>
        {msg && <p className="text-sm font-medium text-danger" role="alert">{msg}</p>}
        <Button type="submit" disabled={busy} className="min-h-11 w-full" data-testid="portal-login-submit">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-xs text-muted">Students can also sign in here with their student number.</p>
      </form>
      <p className="text-center text-sm text-muted">
        No account yet? <Link href="/apply" className="font-medium text-brand underline">Fill in the enrollment form</Link>
      </p>
      {demo && (
        <p className="rounded-xl bg-wait-soft p-3 text-xs text-wait">
          Demo logins: <span className="font-mono">APP-2026-00001</span> / <span className="font-mono">mango-river-sunny-27</span> (first sign-in),
          or <span className="font-mono">APP-2026-00002</span> / <span className="font-mono">password123</span> (needs a fix).
        </p>
      )}
    </div>
  );
}

function NewPassword({ store, first, onDone }: { store: DataStore; first?: boolean; onDone: () => void }) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={first ? "space-y-4 rounded-2xl border border-line bg-surface p-5" : "space-y-3"}
      data-testid="portal-new-password"
      onSubmit={async (e) => {
        e.preventDefault();
        const p = checkNewPassword(next, confirm);
        setProblems(p);
        if (p.length) return;
        setBusy(true);
        try {
          await store.changePassword(next);
          setNext("");
          setConfirm("");
          onDone();
        } catch (err) {
          setProblems([err instanceof Error ? err.message : String(err)]);
        } finally {
          setBusy(false);
        }
      }}
    >
      {first && (
        <div>
          <h1 className="text-xl font-semibold">Pick your own password</h1>
          <p className="text-sm text-muted">Your password was temporary. Choose a new one you will remember (at least 8 characters, with a number).</p>
        </div>
      )}
      <Labeled label="New password">
        <input data-testid="portal-new-pw" type="password" autoComplete="new-password" className={bigInput} value={next} onChange={(e) => setNext(e.target.value)} />
      </Labeled>
      <Labeled label="Type it again">
        <input data-testid="portal-new-pw2" type="password" autoComplete="new-password" className={bigInput} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Labeled>
      {problems.length > 0 && (
        <ul className="space-y-0.5 text-sm font-medium text-danger" role="alert">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <Button type="submit" disabled={busy} className="min-h-11 w-full" data-testid="portal-new-pw-save">
        {busy ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}

// ---------- home ----------

const TONE: Record<string, string> = {
  wait: "border-sky-200 bg-sky-50 text-sky-900",
  fix: "border-wait/40 bg-wait-soft text-wait",
  good: "border-brand/30 bg-brand-soft text-brand-dark",
  done: "border-emerald-300 bg-emerald-50 text-emerald-900",
  stop: "border-danger/30 bg-danger-soft text-danger",
};

function Home({
  data,
  store,
  demo,
  onChanged,
  onSignOut,
}: {
  data: PortalData;
  store: DataStore;
  demo: boolean;
  onChanged: (msg: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const d = data.detail;
  const role = data.session.actor.role;
  if (!d) {
    return (
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-5 text-sm" data-testid="portal-empty">
        <p className="text-base font-semibold">Hi, {data.session.actor.name}!</p>
        <p className="text-muted">
          {role === "applicant" || role === "student"
            ? "We could not find an application for this account."
            : "This portal is for applicants. Staff, students and parents use the main app."}
        </p>
        <Link href="/" className="font-medium text-brand underline">Open the main app</Link>
      </div>
    );
  }
  const e = d.enrollment;
  const s = d.student;
  const lastReason = [...d.history].reverse().find((h) => h.to_status === e.status)?.reason ?? null;
  const stage = applicantStage(e, s, lastReason);
  const dates = stepDates(d.history);
  const isStudent = role === "student";
  const edit = canEditApplication(e.status);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-lg font-semibold">Hi, {s.first_name}!</p>
        <p className="text-sm text-muted">
          {data.applicant_no && <span className="font-mono" data-testid="portal-applicant-no">{data.applicant_no}</span>}
          {data.applicant_no && " · "}
          {e.track === "college" ? `${e.course ?? ""} ${e.level}` : `${e.level}${e.strand ? ` ${e.strand}` : ""}`} · {termLabel(d.term)}
        </p>
        <div className={`mt-3 rounded-xl border p-3 ${TONE[stage.tone]}`} data-testid="portal-stage">
          <p className="font-semibold">{stage.title}</p>
          {stage.body && <p className="mt-1 text-sm">{stage.body}</p>}
          <p className="mt-2 text-sm"><strong>What to do next:</strong> {stage.next}</p>
        </div>
        {isStudent && (
          <div className="mt-3 rounded-xl bg-emerald-600 p-4 text-white" data-testid="portal-now-student">
            <p className="font-semibold">🎓 You are now a student</p>
            <p className="mt-1 text-sm text-white/90">
              Student number <span className="font-mono font-semibold">{s.student_no}</span>. Use the same password; you can sign in with your student number too.
            </p>
            <a
              href="/"
              data-testid="portal-open-main"
              onClick={() => {
                if (demo) DemoStore.openMainAppAs(data.session.actor.user_id);
              }}
              className="mt-3 flex min-h-11 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-emerald-800"
            >
              Open the student app →
            </a>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4" data-testid="portal-progress">
        <h2 className="mb-3 text-sm font-semibold">Your progress</h2>
        <ProgressBar status={e.status} />
        <ol className="mt-4 space-y-2">
          {STEPS.map((st, i) => {
            const reached = dates[st.status];
            const here = stepIndex(e.status) === i && e.status !== "officially_enrolled";
            return (
              <li key={st.status} className="flex items-center justify-between gap-3 text-sm">
                <span className={here ? "font-semibold" : reached ? "" : "text-muted"}>
                  {i + 1}. {st.label}
                  {here && <span className="ml-2 rounded-full bg-wait-soft px-2 py-px text-[11px] font-medium text-wait">now</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{reached ? fmtDate(reached) : "—"}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <Section title="Update details" aside={edit.ok ? "You can still edit" : "Locked"} defaultOpen={false}>
          <DetailsForm detail={d} store={store} onChanged={onChanged} />
        </Section>
        <Section title="Papers" aside={`${d.documents.filter((x) => x.file_name).length} uploaded`} defaultOpen={!!e.fix_note}>
          <Papers detail={d} store={store} role={role} onChanged={onChanged} />
        </Section>
        <Section
          title="Messages to the registrar"
          aside={(d.requests ?? []).some((r) => r.status === "answered") ? "New reply" : `${(d.requests ?? []).length} sent`}
          defaultOpen
        >
          <Requests detail={d} store={store} onChanged={onChanged} />
        </Section>
        <Section title="Account" defaultOpen={false}>
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Signed in as <span className="font-medium text-ink">{data.applicant_no ?? data.session.email}</span>
              {data.applicant_no && !data.session.email.endsWith(".local") && <> or {data.session.email}</>}.
            </p>
            <NewPassword store={store} onDone={() => void onChanged("Password changed.")} />
            <Button variant="secondary" className="min-h-11 w-full" onClick={onSignOut}>Sign out</Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function toForm(d: EnrollmentDetail): ApplicationForm {
  const s = d.student;
  const e = d.enrollment;
  return {
    ...emptyApplication(e.track),
    last_name: s.last_name, first_name: s.first_name, middle_name: s.middle_name ?? "", birth_date: s.birth_date ?? "",
    sex: s.sex ?? "", civil_status: s.civil_status ?? "Single", citizenship: s.citizenship ?? "Filipino",
    contact_no: s.contact_no ?? "", email: s.email ?? "", address: s.address ?? "",
    guardian_name: s.guardian_name ?? "", guardian_contact: s.guardian_contact ?? "",
    track: e.track, term_id: e.term_id, level: e.level, course: e.course ?? "", strand: e.strand ?? "",
    student_type: e.student_type, lrn: s.lrn ?? "", esc_voucher: e.esc_voucher, mother_tongue: e.mother_tongue ?? "",
    ip_group: e.ip_group ?? "", is_4ps: e.is_4ps, tuition_plan: e.tuition_plan ?? "annual",
  };
}

function DetailsForm({ detail, store, onChanged }: { detail: EnrollmentDetail; store: DataStore; onChanged: (m: string) => Promise<void> }) {
  const [f, setF] = useState<ApplicationForm>(() => toForm(detail));
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const edit = canEditApplication(detail.enrollment.status);
  if (!edit.ok) {
    return (
      <div className="space-y-3 text-sm" data-testid="portal-details-locked">
        <p className="rounded-lg bg-paper p-3">🔒 {edit.reason}</p>
        <dl className="divide-y divide-line">
          {[
            ["Name", fullName(detail.student)],
            ["Contact number", detail.student.contact_no ?? "—"],
            ["Address", detail.student.address ?? "—"],
            ["Guardian", `${detail.student.guardian_name ?? "—"} · ${detail.student.guardian_contact ?? ""}`],
            [detail.enrollment.track === "college" ? "Course" : "Grade level", detail.enrollment.track === "college" ? `${detail.enrollment.course} · ${detail.enrollment.level}` : detail.enrollment.level],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-1.5">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  const set = <K extends keyof ApplicationForm>(k: K, v: ApplicationForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  return (
    <form
      className="space-y-4"
      data-testid="portal-details"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
        const e = Object.fromEntries(
          Object.entries({ ...validatePersonal(f, today), ...validateProgram(f, [detail.term]) }).filter(([, v]) => v),
        ) as FormErrors;
        setErrors(e);
        if (Object.keys(e).length) return;
        setBusy(true);
        setMsg(null);
        try {
          const r = await store.updateApplicantDetails(detail.enrollment.id, { student: cleanPersonal(f), enrollment: cleanProgram(f) });
          if (r.ok) await onChanged("Saved. The registrar can see your changes.");
          else setMsg(r.error);
        } catch (err) {
          setMsg(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted">You can change these until the registrar checks your papers. Every change is saved in your history.</p>
      <PersonalFields f={f} set={set} errors={errors} />
      <div className="border-t border-line pt-4">
        <p className="mb-3 text-sm font-semibold">{detail.enrollment.track === "college" ? "College" : "K to 12"} · {termLabel(detail.term)}</p>
        <ProgramFields f={f} set={set} errors={errors} terms={[detail.term]} locked />
      </div>
      {msg && <p className="text-sm font-medium text-danger" role="alert">{msg}</p>}
      <Button type="submit" disabled={busy} className="min-h-11 w-full" data-testid="portal-details-save">
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

function Papers({
  detail,
  store,
  role,
  onChanged,
}: {
  detail: EnrollmentDetail;
  store: DataStore;
  role: PortalData["session"]["actor"]["role"];
  onChanged: (m: string) => Promise<void>;
}) {
  const e = detail.enrollment;
  const canUpload = canUploadPapers(role, e.status);
  const types: DocType[] = [...new Set<DocType>([...requiredDocs(e), "photo", ...detail.documents.map((d) => d.type)])];
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {!canUpload && <p className="rounded-lg bg-paper p-3 text-sm">🔒 Papers are locked after the registrar checks them.</p>}
      {e.fix_note && <p className="rounded-lg bg-wait-soft p-3 text-sm text-wait">Registrar&apos;s note: {e.fix_note}</p>}
      <ul className="divide-y divide-line" data-testid="portal-papers">
        {types.map((t) => {
          const doc = detail.documents.find((d) => d.type === t);
          return (
            <li key={t} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="min-w-0">
                {DOC_LABEL[t]}
                <span className="block truncate text-xs text-muted">
                  {doc?.file_name ? `${doc.file_name}${doc.uploaded_at ? ` · ${fmtDate(doc.uploaded_at)}` : ""}` : "Not uploaded yet"}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {doc?.file_name ? (
                  doc.checked ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Checked ✓</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Uploaded</span>
                  )
                ) : (
                  <span className="rounded-full bg-wait-soft px-2 py-0.5 text-xs text-wait">Missing</span>
                )}
                {canUpload && (
                  <UploadButton
                    testId={`portal-upload-${t}`}
                    label={doc?.file_name ? "Replace" : "Upload"}
                    onFile={async (file) => {
                      setErr(null);
                      try {
                        await store.uploadDocument(e.id, t, file);
                        await onChanged(`${DOC_LABEL[t]} uploaded.`);
                      } catch (x) {
                        setErr(x instanceof Error ? x.message : String(x));
                      }
                    }}
                  />
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
    </div>
  );
}

function Requests({ detail, store, onChanged }: { detail: EnrollmentDetail; store: DataStore; onChanged: (m: string) => Promise<void> }) {
  const [type, setType] = useState<RequestType>("follow_up");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const closed = detail.enrollment.status === "rejected" || detail.enrollment.status === "withdrawn";
  return (
    <div className="space-y-4">
      {!closed && (
        <form
          className="space-y-3"
          data-testid="portal-request-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              const r = await store.createApplicantRequest(detail.enrollment.id, type, message);
              if (r.ok) {
                setMessage("");
                await onChanged("Message sent to the registrar.");
              } else setErr(r.error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-paper p-1" role="radiogroup" aria-label="Type">
            {(Object.keys(REQUEST_TYPE_LABEL) as RequestType[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                data-testid={`portal-request-type-${t}`}
                onClick={() => setType(t)}
                className={`min-h-10 rounded-lg px-1 text-xs font-semibold sm:text-sm ${type === t ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
              >
                {REQUEST_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <textarea
            data-testid="portal-request-message"
            rows={3}
            maxLength={1000}
            className={bigInput}
            placeholder={type === "follow_up" ? "e.g. I uploaded my Form 138." : type === "change_request" ? "e.g. Can I change my course to BSIT?" : "Type your question…"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {err && <p className="text-sm font-medium text-danger" role="alert">{err}</p>}
          <Button type="submit" disabled={busy || !message.trim()} className="min-h-11 w-full" data-testid="portal-request-send">
            {busy ? "Sending…" : "Send to the registrar"}
          </Button>
        </form>
      )}
      <RequestList
        requests={detail.requests ?? []}
        busy={busy}
        onClose={async (r) => {
          setBusy(true);
          const res = await store.closeApplicantRequest(r.id);
          setBusy(false);
          if (res.ok) await onChanged("Marked as done.");
          else setErr(res.error);
        }}
      />
    </div>
  );
}
