"use client";

// Small grade helpers shared by the grade sheet, the student card and the report card.

import type { SheetStatus, SpecialMark } from "@/lib/grades";
import { SHEET_STATUS_LABEL } from "@/lib/grades";

const SHEET_STYLE: Record<SheetStatus | "none", string> = {
  none: "bg-slate-100 text-slate-600",
  draft: "bg-amber-100 text-amber-800",
  returned: "bg-danger-soft text-danger",
  submitted: "bg-sky-100 text-sky-800",
  posted: "bg-emerald-100 text-emerald-800",
};

export function SheetChip({ status }: { status: SheetStatus | null }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${SHEET_STYLE[status ?? "none"]}`}>
      {status ? SHEET_STATUS_LABEL[status] : "Not started"}
    </span>
  );
}

/** "88", "88.5" -> number; "inc" -> INC; "" -> blank. */
export type ParsedCell = { ok: true; percent: number | null; mark: SpecialMark | null } | { ok: false };

export function parseCollegeCell(text: string): ParsedCell {
  const t = text.trim().toUpperCase();
  if (!t) return { ok: true, percent: null, mark: null };
  if (t === "INC" || t === "DRP" || t === "W") return { ok: true, percent: null, mark: t };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return { ok: false };
  const n = Number(t);
  return n >= 0 && n <= 100 ? { ok: true, percent: n, mark: null } : { ok: false };
}

export function parseScore(text: string, max: number): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return n <= max ? n : undefined;
}

export const cellText = (percent: number | null | undefined, mark: string | null | undefined) =>
  mark ?? (percent == null ? "" : String(percent));

export const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export const fmtDue = (d: string | null) =>
  d ? new Date(`${d}T00:00:00+08:00`).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Manila" }) : null;

/** Move focus with Enter (down) / Shift+Enter (up) inside a grade table. */
export function onGridKey(ev: React.KeyboardEvent<HTMLElement>) {
  if (ev.key !== "Enter") return;
  const el = ev.target as HTMLElement;
  const row = Number(el.dataset.row);
  const col = el.dataset.col;
  if (Number.isNaN(row) || col == null) return;
  ev.preventDefault();
  const table = el.closest("table");
  const next = table?.querySelector<HTMLElement>(`[data-row="${row + (ev.shiftKey ? -1 : 1)}"][data-col="${col}"]`);
  if (next) {
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  }
}
