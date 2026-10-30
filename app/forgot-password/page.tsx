"use client";

// "Forgot password?": asks for the email and sends a link to set a new one
// (Supabase resetPasswordForEmail). It always shows the same message, so it
// never tells whether an email is on file. Demo mode sends nothing.

import { useState } from "react";
import Link from "next/link";
import { isDemoMode } from "@/lib/config";
import { DemoStore } from "@/lib/data/demo-store";
import { SupabaseStore } from "@/lib/data/supabase-store";
import { RESET_SENT, isEmailAddress, resetRedirectUrl } from "@/lib/account";
import { Button, Field, inputClass } from "@/components/ui";
import AuthCard from "@/components/AuthCard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmailAddress(email)) {
      setError("Type the email address of your account (for example name@school.edu.ph).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const store = isDemoMode ? new DemoStore() : new SupabaseStore();
      await store.requestPasswordReset(email, resetRedirectUrl(window.location.origin));
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      {sent ? (
        <div className="space-y-4 rounded-xl border border-line bg-sheet p-6" data-testid="reset-sent">
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="text-sm" role="status">{RESET_SENT}</p>
          <p className="text-sm text-muted">The link works once and only for a short time. Open it on this device.</p>
          {isDemoMode && (
            <p className="rounded-md border border-line bg-paper p-3 text-xs text-muted">
              Demo mode: no email is sent. <Link href="/reset-password" className="font-semibold text-ink underline">Open the page the link would open</Link>.
            </p>
          )}
          <Link href="/login" className="flex min-h-10 items-center justify-center rounded-md border border-line px-4 text-sm font-semibold hover:bg-hover">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-sheet p-6" data-testid="forgot-form">
          <div>
            <h1 className="text-xl font-semibold">Forgot password?</h1>
            <p className="mt-1 text-sm text-muted">Type the email of your account. We will send a link to set a new password.</p>
          </div>
          <Field label="Email">
            <input type="email" required autoComplete="email" placeholder="name@school.edu.ph" className={`${inputClass} min-h-10`} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email" />
          </Field>
          {error && <p className="text-sm text-stop" role="alert">{error}</p>}
          <Button type="submit" disabled={busy} className="min-h-10 w-full" data-testid="forgot-submit">
            {busy ? "Sending" : "Send the link"}
          </Button>
          <p className="text-xs text-muted">
            Your account has no email (you sign in with an applicant number only)? Ask the registrar's office for help.
          </p>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted">
        Remembered it? <Link href="/login" className="font-semibold text-ink underline">Sign in</Link>
      </p>
    </AuthCard>
  );
}
