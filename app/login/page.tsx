"use client";

// Sign-in (Supabase mode) with an email, an applicant number (APP-2026-00012)
// or a student number (SA-2026-0005). Applicants go on to their portal.
// In demo mode it just links home.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isDemoMode } from "@/lib/config";
import { SupabaseStore } from "@/lib/data/supabase-store";
import { Button, Field, inputClass } from "@/components/ui";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-rail text-sm font-bold text-on-rail" aria-hidden>
            E
          </span>
          <div>
            <p className="text-base font-semibold leading-tight">School enrollment</p>
            <p className="text-xs text-muted">Registrar, cashier, teachers and families</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isDemoMode) {
    return (
      <Card>
        <div className="rounded-xl border border-line bg-sheet p-6">
          <h1 className="text-xl font-semibold">Demo mode</h1>
          <p className="mt-2 text-sm text-muted">
            No Supabase keys are set, so there is no sign-in. Open the app and switch roles from the account menu at the bottom of the left rail.
          </p>
          <Link href="/" className="mt-5 flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary">
            Open the app
          </Link>
          <div className="mt-4 flex justify-between gap-3 border-t border-line pt-4 text-sm">
            <Link href="/portal" className="font-semibold text-ink underline">Applicant Portal</Link>
            <Link href="/apply" className="font-semibold text-ink underline">Enroll online</Link>
          </div>
        </div>
      </Card>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const store = new SupabaseStore();
      await store.signIn(login, password);
      const s = await store.getSession();
      router.replace(s?.actor.role === "applicant" ? "/portal" : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-sheet p-6">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <Field label="Email, applicant number or student number">
          <input required autoComplete="username" placeholder="name@school.edu.ph" className={`${inputClass} min-h-10`} value={login} onChange={(e) => setLogin(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" required autoComplete="current-password" className={`${inputClass} min-h-10`} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-stop" role="alert">{error}</p>}
        <Button type="submit" disabled={busy} className="min-h-10 w-full">
          {busy ? "Signing in" : "Sign in"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        New student? <Link href="/apply" className="font-semibold text-ink underline">Enroll online</Link>
      </p>
    </Card>
  );
}
