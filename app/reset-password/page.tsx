"use client";

// Set a new password after opening the link from "Forgot password?".
// The link goes through /auth/callback, which signs the person in for this
// one step; here they pick the new password (supabase.auth.updateUser).
// Demo mode shows the same form and saves nothing.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { isDemoMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import { SupabaseStore } from "@/lib/data/supabase-store";
import AuthCard from "@/components/AuthCard";
import PasswordForm from "@/components/PasswordForm";

function ResetPassword() {
  const linkError = useSearchParams().get("error");
  /** undefined = checking, null = no recovery session */
  const [email, setEmail] = useState<string | null | undefined>(isDemoMode ? "demo" : undefined);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isDemoMode) return;
    void createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  if (email === undefined) return <p className="text-center text-sm text-muted">Checking the link</p>;

  if (email === null || (linkError && !isDemoMode)) {
    return (
      <div className="space-y-4 rounded-xl border border-line bg-sheet p-6" data-testid="reset-expired">
        <h1 className="text-xl font-semibold">This link does not work</h1>
        <p className="text-sm text-muted">It may be old or already used. Ask for a new one and open it on this device.</p>
        <Link href="/forgot-password" className="flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary">
          Send a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4 rounded-xl border border-line bg-sheet p-6" data-testid="reset-done">
        <h1 className="text-xl font-semibold">Password saved</h1>
        <p className="text-sm text-muted">
          {isDemoMode ? "Demo mode: nothing was changed. In the real app you are now signed in with the new password." : "You are signed in with your new password."}
        </p>
        <Link href="/" className="flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary">
          Open the app
        </Link>
      </div>
    );
  }

  return (
    <PasswordForm
      boxed
      testPrefix="reset"
      heading={
        <div>
          <h1 className="text-xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-sm text-muted">
            {isDemoMode ? "Demo mode: practice only." : <>For <span className="font-medium text-ink">{email}</span>.</>} At least 8 characters, with a number.
          </p>
        </div>
      }
      onSave={async (next) => {
        if (!isDemoMode) await new SupabaseStore().changePassword(next);
      }}
      onDone={() => setDone(true)}
    />
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard>
      <Suspense fallback={<p className="text-center text-sm text-muted">Checking the link</p>}>
        <ResetPassword />
      </Suspense>
    </AuthCard>
  );
}
