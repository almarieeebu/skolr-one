"use client";

// Small shared building blocks so every panel looks the same.

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Status } from "@/lib/enrollment/types";
import { STATUS_LABEL } from "@/lib/enrollment/status";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark disabled:bg-brand/50",
  secondary: "bg-surface text-ink border border-line hover:bg-paper disabled:opacity-50",
  danger: "bg-surface text-danger border border-danger/30 hover:bg-danger-soft disabled:opacity-50",
  ghost: "text-muted hover:text-ink hover:bg-paper",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export const STATUS_STYLE: Record<Status, string> = {
  applied: "bg-slate-100 text-slate-700",
  papers_checked: "bg-sky-100 text-sky-800",
  student_made: "bg-violet-100 text-violet-800",
  load_set: "bg-amber-100 text-amber-800",
  assessed_paid: "bg-teal-100 text-teal-800",
  officially_enrolled: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  withdrawn: "bg-zinc-200 text-zinc-700",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
        active ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Collapsible card section. */
export function Section({
  title,
  aside,
  defaultOpen = true,
  children,
}: {
  title: string;
  aside?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Open by itself when it becomes relevant (e.g. a balance was carried in).
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  return (
    <section className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className={`inline-block text-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          {title}
        </span>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none";

export function Warnings({ items, tone = "wait" }: { items: string[]; tone?: "wait" | "danger" }) {
  if (!items.length) return null;
  const style = tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : "border-wait/30 bg-wait-soft text-wait";
  return (
    <ul role="alert" className={`space-y-1 rounded-lg border px-3 py-2 text-sm ${style}`}>
      {items.map((w) => (
        <li key={w}>⚠ {w}</li>
      ))}
    </ul>
  );
}

/** Slide-in side panel (used for the new application form and the load picker). */
export function Drawer({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close panel" className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
