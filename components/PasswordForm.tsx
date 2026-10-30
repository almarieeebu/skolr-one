"use client";

// New password + "type it again". Used by the Change password panel (staff app
// and Applicant Portal), the portal's first sign-in and /reset-password.
// Rules: lib/account (at least 8 characters, letters and a number, both the same).

import { useState, type ReactNode } from "react";
import { PASSWORD_HINT, checkNewPassword } from "@/lib/account";
import { Button } from "./ui";
import { Labeled, bigInput } from "./apply/FormFields";

export default function PasswordForm({
  onSave,
  onDone,
  heading,
  boxed = false,
  note,
  testPrefix = "account",
}: {
  /** Saves the new password; throw to show an error. */
  onSave: (next: string) => Promise<void>;
  onDone: () => void;
  /** Title and intro (first sign-in, reset page). Without it a short hint shows. */
  heading?: ReactNode;
  /** Card look for full pages; plain inside a side panel. */
  boxed?: boolean;
  /** Extra line under the button (e.g. the demo note). */
  note?: ReactNode;
  /** Prefix of the test ids: `${prefix}-new-pw`, `${prefix}-new-pw2`, `${prefix}-new-pw-save`. */
  testPrefix?: string;
}) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={boxed ? "space-y-4 rounded-xl border border-line bg-sheet p-6" : "space-y-4"}
      data-testid={`${testPrefix}-new-password`}
      onSubmit={async (e) => {
        e.preventDefault();
        const p = checkNewPassword(next, confirm);
        setProblems(p);
        if (p.length) return;
        setBusy(true);
        try {
          await onSave(next);
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
      {heading ?? <p className="text-sm text-muted">{PASSWORD_HINT}</p>}
      <Labeled label="New password">
        <input data-testid={`${testPrefix}-new-pw`} type="password" autoComplete="new-password" className={bigInput} value={next} onChange={(e) => setNext(e.target.value)} />
      </Labeled>
      <Labeled label="Type it again">
        <input data-testid={`${testPrefix}-new-pw2`} type="password" autoComplete="new-password" className={bigInput} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Labeled>
      {problems.length > 0 && (
        <ul className="space-y-0.5 text-sm font-medium text-stop" role="alert">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <Button type="submit" disabled={busy} className="min-h-11 w-full" data-testid={`${testPrefix}-new-pw-save`}>
        {busy ? "Saving" : "Save new password"}
      </Button>
      {note && <p className="text-xs text-muted">{note}</p>}
    </form>
  );
}
