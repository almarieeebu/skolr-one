"use client";

// List column of the Grades module: the teacher's classes, or (registrar / dean)
// the classes with grade sheets to approve and change requests.

import { useState, type RefObject } from "react";
import type { ClassListItem } from "@/lib/data/store";
import type { Role } from "@/lib/enrollment/types";
import { Chip, Pill } from "./ui";
import { ListPane, ListRow } from "./shell/Shell";

export default function ClassList({
  items,
  role,
  selectedId,
  onSelect,
  searchRef,
  listRef,
}: {
  items: ClassListItem[];
  role: Role;
  selectedId: string | null;
  onSelect: (offeringId: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
}) {
  const isTeacher = role === "teacher";
  const [onlyWaiting, setOnlyWaiting] = useState(!isTeacher && items.some((i) => i.waiting));
  const [q, setQ] = useState("");
  const waiting = items.filter((i) => i.waiting).length;
  const shown = items.filter((i) => {
    if (onlyWaiting && !i.waiting) return false;
    if (q && !`${i.code} ${i.title} ${i.teacher_name ?? ""} ${i.level ?? ""} ${i.term_label}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <ListPane
      ref={listRef}
      title={isTeacher ? "My classes" : "Grades"}
      subtitle={
        isTeacher
          ? `${items.length} classes${waiting ? `, ${waiting} need you` : ""}`
          : waiting > 0
            ? `${waiting} waiting on you`
            : "Nothing waiting on you"
      }
      testId="class-list"
      listTestId="class-rows"
      search={{ value: q, onChange: setQ, placeholder: "Search class, subject, teacher", inputRef: searchRef, label: "Search classes" }}
      filters={
        <div className="flex gap-1.5">
          <Chip active={onlyWaiting} onClick={() => setOnlyWaiting(true)} testId="filter-waiting">
            {isTeacher ? "Needs you" : "Grades to approve"} <span className="num">{waiting}</span>
          </Chip>
          <Chip active={!onlyWaiting} onClick={() => setOnlyWaiting(false)} testId="filter-all">All classes</Chip>
        </div>
      }
      empty={
        shown.length === 0 ? (
          <li className="px-6 py-10 text-center text-sm text-muted">
            {onlyWaiting
              ? isTeacher
                ? "Nothing needs you now. Open All classes to type grades."
                : "No grade sheets to approve. Submitted sheets show up here."
              : "No classes match. Clear the search."}
          </li>
        ) : undefined
      }
    >
      {shown.map((i) => (
        <ListRow key={i.offering_id} selected={selectedId === i.offering_id} waiting={i.waiting} onClick={() => onSelect(i.offering_id)} testId={`class-${i.code}`}>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-sm">
                <span className="num font-semibold">{i.code}</span>
                <span className="ml-2 text-muted">{i.title}</span>
              </span>
              <span className="num shrink-0 text-xs text-muted">{i.students} {i.students === 1 ? "student" : "students"}</span>
            </span>
            <span className="mt-0.5 flex items-center gap-2.5 text-xs text-muted">
              <span className="truncate">{i.term_label}</span>
              {!isTeacher && i.teacher_name && <span className="truncate">{i.teacher_name}</span>}
              <span className="ml-auto flex shrink-0 gap-1">
                {i.submitted > 0 && <Pill tone="ink">{i.submitted} submitted</Pill>}
                {i.pending_changes > 0 && <Pill tone="ink">{i.pending_changes} change</Pill>}
                {i.returned > 0 && <Pill tone="warn">{i.returned} returned</Pill>}
              </span>
            </span>
          </span>
        </ListRow>
      ))}
    </ListPane>
  );
}
