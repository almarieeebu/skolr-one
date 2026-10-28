"use client";

// Left list in "classes" mode: the teacher's classes, or (registrar / dean)
// the classes with grades to approve and change requests.

import { useState } from "react";
import type { ClassListItem } from "@/lib/data/store";
import type { Role } from "@/lib/enrollment/types";
import { Chip, inputClass } from "./ui";

export default function ClassList({
  items,
  role,
  selectedId,
  onSelect,
}: {
  items: ClassListItem[];
  role: Role;
  selectedId: string | null;
  onSelect: (offeringId: string) => void;
}) {
  const isTeacher = role === "teacher";
  const [onlyWaiting, setOnlyWaiting] = useState(!isTeacher);
  const [q, setQ] = useState("");
  const waiting = items.filter((i) => i.waiting).length;
  const shown = items.filter((i) => {
    if (onlyWaiting && !i.waiting) return false;
    if (q && !`${i.code} ${i.title} ${i.teacher_name ?? ""} ${i.level ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <aside className="flex flex-col rounded-2xl border border-line bg-surface lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)]" data-testid="class-list">
      <div className="space-y-3 border-b border-line p-4">
        <div>
          <h1 className="text-base font-semibold">{isTeacher ? "My classes" : "Grades"}</h1>
          <p className="text-xs text-muted">
            {isTeacher ? `${items.length} classes · open one to enter grades` : `${waiting} waiting on you`}
          </p>
        </div>
        <input
          type="search"
          placeholder="Search class, subject, teacher…"
          aria-label="Search classes"
          className={inputClass}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          <Chip active={onlyWaiting} onClick={() => setOnlyWaiting(true)}>
            {isTeacher ? "Needs you" : "Grades to approve"} ({waiting})
          </Chip>
          <Chip active={!onlyWaiting} onClick={() => setOnlyWaiting(false)}>All classes</Chip>
        </div>
      </div>
      <ul className="flex-1 divide-y divide-line overflow-y-auto" data-testid="class-rows">
        {shown.map((i) => (
          <li key={i.offering_id}>
            <button
              type="button"
              data-testid={`class-${i.code}`}
              onClick={() => onSelect(i.offering_id)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                selectedId === i.offering_id ? "bg-brand-soft" : "hover:bg-paper"
              }`}
            >
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.waiting ? "bg-wait" : "bg-transparent"}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    <span className="font-mono text-xs">{i.code}</span> · {i.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{i.students} {i.students === 1 ? "student" : "students"}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {i.term_label}
                  {!isTeacher && i.teacher_name ? ` · ${i.teacher_name}` : ""}
                </span>
                {(i.submitted > 0 || i.pending_changes > 0 || i.returned > 0) && (
                  <span className="mt-1 flex flex-wrap gap-x-3 text-xs font-medium text-wait">
                    {i.submitted > 0 && <span>{i.submitted} submitted</span>}
                    {i.pending_changes > 0 && <span>{i.pending_changes} change request{i.pending_changes > 1 ? "s" : ""}</span>}
                    {i.returned > 0 && <span className="text-danger">{i.returned} returned</span>}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted">
            {onlyWaiting ? "Nothing waiting. 🎉" : "No classes."}
          </li>
        )}
      </ul>
    </aside>
  );
}
