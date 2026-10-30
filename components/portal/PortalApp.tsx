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
import { Button, EmptyState, Note, Pill, SidePanel, StatusBadge, Toast, type Tone } from "../ui";
import PublicShell from "../apply/PublicShell";
import Shell, { DetailPane, type ModuleTab } from "../shell/Shell";
import { Labeled, PersonalFields, ProgramFields, bigInput } from "../apply/FormFields";
import { ProgressBar, UploadButton } from "../StudentCard";
import RequestList from "../RequestList";
import PasswordForm from "../PasswordForm";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

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

  const toastEl = toast && <Toast message={toast} />;

  if (!store || data === undefined) {
    return <div className="grid h-dvh place-items-center text-sm text-muted">Loading</div>;
  }
  if (data === null || data.must_change_password) {
    return (
      <PublicShell school={school} subtitle="Applicant Portal" demo={demo} narrow>
        {data === null ? (
          <Login store={store} demo={demo} onDone={load} error={error} />
        ) : (
          <NewPassword store={store} first onDone={() => done("Password saved. Welcome!")} />
        )}
        {toastEl}
      </PublicShell>
    );
  }
  return (
    <>
      <Home data={data} store={store} demo={demo} onChanged={done} onSignOut={signOut} />
      {toastEl}
    </>
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
        className="space-y-4 rounded-xl border border-line bg-sheet p-6"
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
          <h1 className="text-xl font-semibold">Sign in to the Applicant Portal</h1>
          <p className="mt-1 text-sm text-muted">Use the applicant number and password you got after sending the form.</p>
        </div>
        <Labeled label="Applicant number or email">
          <input data-testid="portal-login-id" autoCapitalize="characters" autoComplete="username" placeholder="APP-2026-00012" className={bigInput} value={login} onChange={(e) => setLogin(e.target.value)} required />
        </Labeled>
        <Labeled label="Password">
          <input data-testid="portal-login-password" type="password" autoComplete="current-password" className={bigInput} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Labeled>
        {msg && <p className="text-sm font-medium text-stop" role="alert">{msg}</p>}
        <Button type="submit" disabled={busy} className="min-h-11 w-full" data-testid="portal-login-submit">
          {busy ? "Signing in" : "Sign in"}
        </Button>
        <p className="text-xs text-muted">Students can also sign in here with their student number.</p>
      </form>
      <p className="text-center text-sm text-muted">
        <Link href="/forgot-password" className="font-semibold text-ink underline" data-testid="portal-forgot-password">Forgot password?</Link>
        {" · "}
        No account yet? <Link href="/apply" className="font-semibold text-ink underline">Fill in the enrollment form</Link>
      </p>
      {demo && (
        <p className="rounded-md border border-line bg-sheet p-3 text-xs text-muted">
          Demo logins: <span className="num font-medium text-ink">APP-2026-00001</span> with <span className="num font-medium text-ink">mango-river-sunny-27</span> (first sign-in),
          or <span className="num font-medium text-ink">APP-2026-00002</span> with <span className="num font-medium text-ink">password123</span> (needs a fix).
        </p>
      )}
    </div>
  );
}

function NewPassword({ store, first, onDone }: { store: DataStore; first?: boolean; onDone: () => void }) {
  return (
    <PasswordForm
      onSave={(next) => store.changePassword(next)}
      onDone={onDone}
      boxed={first}
      testPrefix="portal"
      heading={
        first ? (
          <div>
            <h1 className="text-xl font-semibold">Pick your own password</h1>
            <p className="mt-1 text-sm text-muted">Your password was temporary. Choose a new one you will remember (at least 8 characters, with a number).</p>
          </div>
        ) : undefined
      }
    />
  );
}

// ---------- home: the same shell as the staff app, with portal tabs ----------

const TONE: Record<string, Tone> = {
  wait: "ink",
  fix: "warn",
  good: "go",
  done: "go",
  stop: "stop",
};

type PortalTab = "progress" | "details" | "papers" | "messages";

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
  const [tab, setTab] = useState<PortalTab>("progress");
  const [pwOpen, setPwOpen] = useState(false);
  const d = data.detail;
  const role = data.session.actor.role;
  const school = data.session.school;

  const menu = (close: () => void) => (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Signed in as <span className="num font-medium text-ink">{data.applicant_no ?? data.session.email}</span>
        {data.applicant_no && !data.session.email.endsWith(".local") && <> or {data.session.email}</>}
      </p>
      <Button variant="secondary" size="sm" className="w-full" onClick={() => { close(); setPwOpen(true); }} data-testid="portal-change-password">
        Change password
      </Button>
      <Button variant="ghost" size="sm" className="w-full" onClick={() => { close(); onSignOut(); }} data-testid="portal-signout">
        Sign out
      </Button>
    </div>
  );

  if (!d) {
    return (
      <Shell school={school} modules={[]} active="" onModule={() => {}} user={{ name: data.session.actor.name, role }} menu={menu} showDetailOnPhone testId="portal"
        detail={
          <EmptyState title={`Hi, ${data.session.actor.name}`} action={<Link href="/" className="font-semibold text-ink underline">Open the main app</Link>}>
            <span data-testid="portal-empty">
              {role === "applicant" || role === "student"
                ? "We could not find an application for this account."
                : "This portal is for applicants. Staff, students and parents use the main app."}
            </span>
          </EmptyState>
        }
      />
    );
  }

  const e = d.enrollment;
  const s = d.student;
  const lastReason = [...d.history].reverse().find((h) => h.to_status === e.status)?.reason ?? null;
  const stage = applicantStage(e, s, lastReason);
  const dates = stepDates(d.history);
  const isStudent = role === "student";
  const replies = (d.requests ?? []).filter((r) => r.status === "answered").length;
  const needsFix = e.status === "applied" && !!e.fix_note;

  const modules: ModuleTab[] = [
    { id: "progress", label: "Progress", icon: "progress" },
    { id: "details", label: "Details", icon: "details" },
    { id: "papers", label: "Papers", icon: "papers", waiting: needsFix ? 1 : 0 },
    { id: "messages", label: "Messages", icon: "messages", waiting: replies },
  ];

  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">Hi, {s.first_name}!</h1>
        <StatusBadge status={e.status} needsFix={needsFix} />
      </div>
      <p className="flex flex-wrap gap-x-4 text-sm text-muted">
        {data.applicant_no && <span className="num font-medium text-ink" data-testid="portal-applicant-no">{data.applicant_no}</span>}
        <span>{e.track === "college" ? `${e.course ?? ""} ${e.level}` : `${e.level}${e.strand ? ` ${e.strand}` : ""}`}</span>
        <span>{termLabel(d.term)}</span>
      </p>
      <ProgressBar status={e.status} />
    </div>
  );

  const title: Record<PortalTab, string> = {
    progress: "Your progress",
    details: "Update details",
    papers: "Papers",
    messages: "Messages to the registrar",
  };

  const body = (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-base font-semibold">{title[tab]}</h2>
      {tab === "progress" && (
        <>
          <Note tone={TONE[stage.tone]} testId="portal-stage">
            <p className="font-semibold">{stage.title}</p>
            {stage.body && <p className="mt-1 text-ink">{stage.body}</p>}
            <p className="mt-2 text-ink"><span className="font-semibold">What to do next:</span> {stage.next}</p>
          </Note>
          {isStudent && (
            <div className="flex flex-col gap-3 border-y border-line py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="portal-now-student">
              <div>
                <p className="font-semibold text-go">You are now a student</p>
                <p className="mt-0.5 text-sm text-muted">
                  Student number <span className="num font-semibold text-ink">{s.student_no}</span>. Use the same password; you can sign in with your student number too.
                </p>
              </div>
              <a
                href="/"
                data-testid="portal-open-main"
                onClick={() => {
                  if (demo) DemoStore.openMainAppAs(data.session.actor.user_id);
                }}
                className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary"
              >
                Open the student app
              </a>
            </div>
          )}
          <ol className="divide-y divide-line/70" data-testid="portal-progress">
            {STEPS.map((st, i) => {
              const reached = dates[st.status];
              const here = stepIndex(e.status) === i && e.status !== "officially_enrolled";
              return (
                <li key={st.status} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className={`flex items-center gap-3 ${here ? "font-semibold" : reached ? "" : "text-muted"}`}>
                    <span className={`num grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${reached && !here ? "bg-go text-white" : here ? "bg-ink text-sheet" : "border border-line"}`}>{i + 1}</span>
                    {st.label}
                    {here && <Pill tone="ink">Now</Pill>}
                  </span>
                  <span className="num shrink-0 text-xs text-muted">{reached ? fmtDate(reached) : "Not yet"}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {tab === "details" && <DetailsForm detail={d} store={store} onChanged={onChanged} />}
      {tab === "papers" && <Papers detail={d} store={store} role={role} onChanged={onChanged} />}
      {tab === "messages" && <Requests detail={d} store={store} onChanged={onChanged} />}
    </div>
  );

  return (
    <>
      <Shell
        school={school}
        modules={modules}
        active={tab}
        onModule={(m) => setTab(m as PortalTab)}
        user={{ name: data.session.actor.name, role }}
        menu={menu}
        showDetailOnPhone
        testId="portal"
        detail={<DetailPane header={header} testId={`portal-${tab}`}>{body}</DetailPane>}
      />
      <SidePanel title="Change password" open={pwOpen} onClose={() => setPwOpen(false)} testId="portal-password-panel">
        <NewPassword store={store} onDone={() => { setPwOpen(false); void onChanged("Password changed."); }} />
      </SidePanel>
    </>
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
        <Note>{edit.reason}</Note>
        <dl className="divide-y divide-line/70">
          {[
            ["Name", fullName(detail.student)],
            ["Contact number", detail.student.contact_no ?? "—"],
            ["Address", detail.student.address ?? "—"],
            ["Guardian", `${detail.student.guardian_name ?? "None"} ${detail.student.guardian_contact ?? ""}`.trim()],
            [detail.enrollment.track === "college" ? "Course" : "Grade level", detail.enrollment.track === "college" ? `${detail.enrollment.course} ${detail.enrollment.level}` : detail.enrollment.level],
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
        <p className="mb-3 text-sm font-semibold">{detail.enrollment.track === "college" ? "College" : "K to 12"}, {termLabel(detail.term)}</p>
        <ProgramFields f={f} set={set} errors={errors} terms={[detail.term]} locked />
      </div>
      {msg && <p className="text-sm font-medium text-danger" role="alert">{msg}</p>}
      <Button type="submit" disabled={busy} className="min-h-11 w-full" data-testid="portal-details-save">
        {busy ? "Saving" : "Save changes"}
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
      {!canUpload && <Note>Papers are locked after the registrar checks them.</Note>}
      {e.fix_note && e.status === "applied" && <Note tone="warn">Registrar&apos;s note: {e.fix_note}</Note>}
      <ul className="divide-y divide-line/70" data-testid="portal-papers">
        {types.map((t) => {
          const doc = detail.documents.find((d) => d.type === t);
          return (
            <li key={t} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{DOC_LABEL[t]}</span>
                <span className="block truncate text-xs text-muted">
                  {doc?.file_name ? `${doc.file_name}${doc.uploaded_at ? `, ${fmtDate(doc.uploaded_at)}` : ""}` : "Not uploaded yet"}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {doc?.file_name ? (doc.checked ? <Pill tone="go">Checked</Pill> : <Pill tone="ink">Uploaded</Pill>) : <Pill tone="warn">Missing</Pill>}
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
    <div className="grid gap-6 lg:grid-cols-2">
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
          <div className="grid grid-cols-3 gap-1 rounded-md border border-line bg-paper p-1" role="radiogroup" aria-label="Type">
            {(Object.keys(REQUEST_TYPE_LABEL) as RequestType[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                data-testid={`portal-request-type-${t}`}
                onClick={() => setType(t)}
                className={`min-h-9 rounded-md px-1 text-xs font-semibold sm:text-sm ${type === t ? "bg-sheet text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink"}`}
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
            placeholder={type === "follow_up" ? "e.g. I uploaded my Form 138." : type === "change_request" ? "e.g. Can I change my course to BSIT?" : "Type your question"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {err && <p className="text-sm font-medium text-danger" role="alert">{err}</p>}
          <Button type="submit" disabled={busy || !message.trim()} className="min-h-11 w-full" data-testid="portal-request-send">
            {busy ? "Sending" : "Send to the registrar"}
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
