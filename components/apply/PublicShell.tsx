"use client";

// Simple page frame for the public form and the applicant portal (no staff header).

import type { ReactNode } from "react";

export default function PublicShell({
  school,
  subtitle,
  right,
  demo,
  children,
}: {
  school: { name: string; code: string; logo_url: string | null } | null;
  subtitle: string;
  right?: ReactNode;
  demo?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {school?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
          ) : (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-white">
              {school?.code ?? "…"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{school?.name ?? "Loading…"}</p>
            <p className="truncate text-xs text-muted">
              {subtitle}
              {demo && <span className="ml-1.5 rounded-full bg-wait-soft px-1.5 py-px text-[11px] font-medium text-wait">Demo</span>}
            </p>
          </div>
          {right}
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-5 pb-16">{children}</main>
    </div>
  );
}
