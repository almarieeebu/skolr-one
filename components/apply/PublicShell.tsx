"use client";

// Page frame for the public form, the portal sign-in and /login (no staff rail).

import type { ReactNode } from "react";

export default function PublicShell({
  school,
  subtitle,
  right,
  demo,
  narrow = false,
  wide = false,
  children,
}: {
  school: { name: string; code: string; logo_url: string | null } | null;
  subtitle: string;
  right?: ReactNode;
  demo?: boolean;
  /** A single centered card (sign in, new password). */
  narrow?: boolean;
  /** The enrollment form: step list on the left, fields on the right. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-paper text-base md:text-sm">
      <header className="sticky top-0 z-30 border-b border-line bg-sheet">
        <div className={`mx-auto flex items-center gap-3 px-4 py-3 ${wide ? "max-w-6xl md:px-6" : "max-w-2xl"}`}>
          {school?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logo_url} alt="" className="h-9 w-9 rounded-[10px] object-cover" />
          ) : (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-rail text-sm font-bold text-on-rail">
              {school?.code ?? ""}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{school?.name ?? "Loading"}</p>
            <p className="flex items-center gap-2 truncate text-xs text-muted">
              {subtitle}
              {demo && <span className="pill pill-muted">Demo</span>}
            </p>
          </div>
          {right}
        </div>
      </header>
      <main className={`mx-auto w-full px-4 pt-5 pb-16 ${wide ? "max-w-6xl md:px-6 md:pt-8" : narrow ? "max-w-md md:pt-12" : "max-w-2xl"}`}>{children}</main>
    </div>
  );
}
