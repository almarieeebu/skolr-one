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

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isDemoMode) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
          <h1 className="text-lg font-semibold">Demo mode</h1>
          <p className="mt-2 text-sm text-muted">
            No Supabase keys are set, so there is no sign-in. Use the role switcher at the top of the app.
          </p>
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand underline">
            Open the app
          </Link>
          <p className="mt-3 text-sm text-muted">
            Applicants: <Link href="/portal" className="font-medium text-brand underline">Applicant Portal</Link> ·{" "}
            <Link href="/apply" className="font-medium text-brand underline">Enroll online</Link>
          </p>
        </div>
      </main>
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
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6">
        <div>
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-sm text-muted">School enrollment</p>
        </div>
        <Field label="Email, applicant number or student number">
          <input required autoComplete="username" placeholder="name@school.edu.ph or APP-2026-00012" className={inputClass} value={login} onChange={(e) => setLogin(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" required autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-xs text-muted">
          New student? <Link href="/apply" className="font-medium text-brand underline">Enroll online</Link>
        </p>
      </form>
    </main>
  );
}
