"use client";

// The list column for the enrollment modules (Enrollment, Applicants, Cashier,
// Students, and the family's own enrollments). Dense 56px rows; a yellow
// stripe marks the ones waiting on the current user.

import { useMemo, useState, type RefObject } from "react";
import type { EnrollmentListItem } from "@/lib/data/store";
import type { Role, Status, Track } from "@/lib/enrollment/types";
import { STEPS } from "@/lib/enrollment/status";
import { peso } from "@/lib/fees";
import { Button, Chip, StatusBadge } from "./ui";
import { ListPane, ListRow } from "./shell/Shell";

export type ListModule = "enrollment" | "applicants" | "cashier" | "students" | "family";

type Filter = "all" | "waiting" | Status | "closed" | "requests" | "new" | "fix" | "balance" | "needs_payment";

const TITLE: Record<ListModule, string> = {
  enrollment: "Enrollment",
  applicants: "Applicants",
  cashier: "Cashier",
  students: "My students",
  family: "My enrollments",
};

/** Which enrollments a module lists. */
export function inModule(module: ListModule, i: EnrollmentListItem): boolean {
  if (module === "applicants") return (i.open_requests ?? 0) > 0 || i.status === "applied";
  if (module === "cashier") return i.status === "load_set" || i.balance > 0;
  return true;
}

/** Does this row wait on the current user, in this module? */
export function waitsIn(module: ListModule, role: Role, i: EnrollmentListItem): boolean {
  if (!i.waiting) return false;
  if (module === "applicants") return (i.open_requests ?? 0) > 0 || (i.status === "applied" && !i.fix_note);
  if (module === "cashier") return role === "cashier";
  return true;
}

const FILTERS: Record<ListModule, { id: Filter; label: string }[]> = {
  enrollment: [
    { id: "all", label: "All" },
    { id: "waiting", label: "Waiting on you" },
    ...STEPS.map((s) => ({ id: s.status as Filter, label: s.short })),
    { id: "closed", label: "Closed" },
  ],
  applicants: [
    { id: "all", label: "All" },
    { id: "requests", label: "Open requests" },
    { id: "new", label: "New" },
    { id: "fix", label: "Needs fix" },
  ],
  cashier: [
    { id: "all", label: "All" },
    { id: "needs_payment", label: "Needs downpayment" },
    { id: "balance", label: "With balance" },
  ],
  students: [],
  family: [],
};

/** "2026-2027 1st sem" -> "1st sem 26-27"; "2026-2027 (K to 12)" -> "SY 26-27". */
export function shortTerm(label: string): string {
  const m = /^(\d{4})-(\d{4})\s+(.*)$/.exec(label);
  if (!m) return label;
  const years = `${m[1].slice(2)}-${m[2].slice(2)}`;
  return m[3].startsWith("(") ? `SY ${years}` : `${m[3]} ${years}`;
}

function matches(f: Filter, i: EnrollmentListItem, waiting: boolean): boolean {
  switch (f) {
    case "all":
      return true;
    case "waiting":
      return waiting;
    case "closed":
      return i.status === "rejected" || i.status === "withdrawn";
    case "requests":
      return (i.open_requests ?? 0) > 0;
    case "new":
      return i.status === "applied" && !i.fix_note;
    case "fix":
      return i.status === "applied" && !!i.fix_note;
    case "balance":
      return i.balance > 0;
    case "needs_payment":
      return i.status === "load_set";
    default:
      return i.status === f;
  }
}

export default function EnrollmentList({
  module,
  items,
  role,
  selectedId,
  onSelect,
  onNew,
  searchRef,
  listRef,
}: {
  module: ListModule;
  items: EnrollmentListItem[];
  role: Role;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew?: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [track, setTrack] = useState<Track | "all">("all");
  const [level, setLevel] = useState<string>("all");

  const mine = useMemo(() => items.filter((i) => inModule(module, i)), [items, module]);
  const levels = useMemo(
    () => [...new Set(mine.filter((i) => track === "all" || i.track === track).map((i) => i.level))].sort(),
    [mine, track],
  );

  const shown = mine.filter((i) => {
    if (!matches(filter, i, waitsIn(module, role, i))) return false;
    if (track !== "all" && i.track !== track) return false;
    if (level !== "all" && i.level !== level) return false;
    if (q) {
      const hay = `${i.student_name} ${i.student_no ?? ""} ${i.course ?? ""} ${i.level} ${i.strand ?? ""} ${i.term_label}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const waitingCount = mine.filter((i) => waitsIn(module, role, i)).length;
  const isFamily = module === "family";
  const filters = FILTERS[module];
  const showTrack = module === "enrollment" || module === "cashier" || module === "students";

  const subtitle =
    module === "family" || module === "students"
      ? `${mine.length} ${mine.length === 1 ? "enrollment" : "enrollments"}`
      : waitingCount > 0
        ? `${waitingCount} waiting on you, ${mine.length} in all`
        : `${mine.length} in all, none waiting on you`;

  return (
    <ListPane
      ref={listRef}
      title={TITLE[module]}
      subtitle={subtitle}
      testId={`list-${module}`}
      listTestId="enrollment-list"
      action={
        onNew ? (
          <Button size="sm" onClick={onNew} data-testid="new-application">
            New application
          </Button>
        ) : undefined
      }
      search={
        isFamily
          ? undefined
          : { value: q, onChange: setQ, placeholder: "Search name, ID, course", inputRef: searchRef }
      }
      filters={
        filters.length > 0 || showTrack ? (
          <div className="space-y-2">
            {filters.length > 0 && (
              <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" role="group" aria-label="Filter">
                {filters.map((f) => (
                  <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)} testId={`filter-${f.id}`}>
                    {f.label}
                    {f.id === "waiting" && waitingCount > 0 && <span className="num">{waitingCount}</span>}
                    {f.id === "requests" && <span className="num">{mine.filter((i) => (i.open_requests ?? 0) > 0).length}</span>}
                  </Chip>
                ))}
              </div>
            )}
            {showTrack && (
              <div className="flex gap-2">
                <select
                  aria-label="Track"
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-sheet px-2 text-xs text-ink"
                  value={track}
                  onChange={(e) => {
                    setTrack(e.target.value as Track | "all");
                    setLevel("all");
                  }}
                >
                  <option value="all">College and K to 12</option>
                  <option value="college">College</option>
                  <option value="k12">K to 12</option>
                </select>
                <select
                  aria-label="Level"
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-sheet px-2 text-xs text-ink"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                >
                  <option value="all">All levels</option>
                  {levels.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : undefined
      }
      empty={
        shown.length === 0 ? (
          <li className="px-6 py-10 text-center text-sm text-muted">
            {mine.length === 0
              ? isFamily
                ? "No enrollment yet. Press New application to start."
                : module === "applicants"
                  ? "No new applications or open requests. New ones from the online form show up here."
                  : module === "cashier"
                    ? "No balances to collect. Students show up here once their load is set."
                    : "Nothing here yet. Press New application to add a student."
              : "No match. Clear the search or pick another filter."}
          </li>
        ) : undefined
      }
    >
      {shown.map((i) => {
        const waiting = waitsIn(module, role, i);
        const meta = i.track === "college" ? `${i.course ?? ""} ${i.level}`.trim() : `${i.level}${i.strand ? ` ${i.strand}` : ""}`;
        return (
          <ListRow key={i.id} selected={selectedId === i.id} waiting={waiting} onClick={() => onSelect(i.id)} testId={`row-${i.id}`}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{i.student_name}</span>
                {module === "cashier" ? (
                  <span className={`num shrink-0 text-sm font-semibold ${i.balance > 0 ? "text-ink" : "text-go"}`}>{peso(i.balance)}</span>
                ) : (
                  <StatusBadge status={i.status} needsFix={!!i.fix_note} />
                )}
              </span>
              <span className="mt-0.5 flex items-center gap-2.5 text-xs text-muted">
                <span className="truncate">{meta}</span>
                <span className="num shrink-0">{i.student_no ?? "No ID yet"}</span>
                <span className="ml-auto shrink-0 truncate">
                  {(i.open_requests ?? 0) > 0 ? (
                    <span className="font-medium text-ink">{i.open_requests} {i.open_requests === 1 ? "request" : "requests"}</span>
                  ) : module === "cashier" ? (
                    <StatusBadge status={i.status} />
                  ) : (
                    shortTerm(i.term_label)
                  )}
                </span>
              </span>
            </span>
          </ListRow>
        );
      })}
    </ListPane>
  );
}
