"use client";

import { useMemo, useState } from "react";
import type { EnrollmentListItem } from "@/lib/data/store";
import type { Role, Status, Track } from "@/lib/enrollment/types";
import { STEPS } from "@/lib/enrollment/status";
import { peso } from "@/lib/fees";
import { Button, Chip, StatusBadge, inputClass } from "./ui";

const WAITING_LABEL: Record<Role, string> = {
  registrar: "Needs you",
  cashier: "Needs payment",
  dean: "Needs dean",
  student: "Your turn",
  parent: "Your turn",
  teacher: "",
};

export default function EnrollmentList({
  items,
  role,
  selectedId,
  onSelect,
  onNew,
}: {
  items: EnrollmentListItem[];
  role: Role;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew?: () => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "all" | "closed">("all");
  const [track, setTrack] = useState<Track | "all">("all");
  const [level, setLevel] = useState<string>("all");

  const levels = useMemo(
    () => [...new Set(items.filter((i) => track === "all" || i.track === track).map((i) => i.level))].sort(),
    [items, track],
  );

  const shown = items.filter((i) => {
    if (track !== "all" && i.track !== track) return false;
    if (level !== "all" && i.level !== level) return false;
    if (status === "closed") {
      if (i.status !== "rejected" && i.status !== "withdrawn") return false;
    } else if (status !== "all" && i.status !== status) return false;
    if (q) {
      const hay = `${i.student_name} ${i.student_no ?? ""} ${i.course ?? ""} ${i.level} ${i.strand ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const waitingCount = items.filter((i) => i.waiting).length;
  const isFamily = role === "student" || role === "parent";

  return (
    <aside className="flex flex-col rounded-2xl border border-line bg-surface lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)]">
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold">{isFamily ? "My enrollments" : role === "teacher" ? "My students" : "Enrollments"}</h1>
            {WAITING_LABEL[role] && (
              <p className="text-xs text-muted">
                {waitingCount} waiting on you
              </p>
            )}
          </div>
          {onNew && (
            <Button onClick={onNew} data-testid="new-application" className="min-h-9 px-3">
              + New application
            </Button>
          )}
        </div>
        <input
          type="search"
          placeholder="Search name, ID, course…"
          aria-label="Search"
          className={inputClass}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <Chip active={status === "all"} onClick={() => setStatus("all")}>All</Chip>
          {STEPS.map((s) => (
            <Chip key={s.status} active={status === s.status} onClick={() => setStatus(s.status)}>
              {s.short}
            </Chip>
          ))}
          <Chip active={status === "closed"} onClick={() => setStatus("closed")}>Closed</Chip>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={track === "all"} onClick={() => { setTrack("all"); setLevel("all"); }}>Both</Chip>
          <Chip active={track === "college"} onClick={() => { setTrack("college"); setLevel("all"); }}>College</Chip>
          <Chip active={track === "k12"} onClick={() => { setTrack("k12"); setLevel("all"); }}>K to 12</Chip>
          <select
            aria-label="Level"
            className="ml-auto rounded-full border border-line bg-surface px-2 py-1 text-xs text-muted"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="all">All levels</option>
            {levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      <ul className="flex-1 divide-y divide-line overflow-y-auto" data-testid="enrollment-list">
        {shown.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              data-testid={`row-${i.id}`}
              onClick={() => onSelect(i.id)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                selectedId === i.id ? "bg-brand-soft" : "hover:bg-paper"
              }`}
            >
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.waiting ? "bg-wait" : "bg-transparent"}`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{i.student_name}</span>
                  <StatusBadge status={i.status} />
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {i.track === "college" ? `${i.course ?? ""} · ${i.level}` : `${i.level}${i.strand ? ` · ${i.strand}` : ""}`}
                  {" · "}
                  {i.student_no ?? "no ID yet"}
                </span>
                <span className="block truncate text-[11px] text-muted/80">{i.term_label}</span>
                {(i.waiting || (role === "cashier" && i.balance > 0)) && (
                  <span className="mt-1 block text-xs font-medium text-wait">
                    {i.waiting ? WAITING_LABEL[role] : `Balance ${peso(i.balance)}`}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted">
            {items.length === 0
              ? isFamily
                ? "No enrollment yet. Tap “New application” to start."
                : "Nothing here yet."
              : "No match. Try another filter."}
          </li>
        )}
      </ul>
    </aside>
  );
}
