"use client";

// Registrar "Setup" module: a short list of settings groups on the left; the
// chosen form fills the detail pane (no floating panels).

import { useEffect, useState, type RefObject } from "react";
import type { DataStore, SessionInfo } from "@/lib/data/store";
import { termLabel } from "@/lib/data/store";
import type { Term } from "@/lib/enrollment/types";
import { DetailPane, ListPane, ListRow } from "./shell/Shell";
import { Pill } from "./ui";
import FeeSetupPanel from "./FeeSetupPanel";
import GradeSettingsPanel from "./GradeSettingsPanel";
import CloseTermPanel from "./CloseTermPanel";

export type SetupId = "fees" | "grades" | "terms" | "close" | "school";

export const SETUP_GROUPS: { id: SetupId; title: string; hint: string }[] = [
  { id: "fees", title: "Fee setup", hint: "Rates, misc fees, plans, OR numbers" },
  { id: "grades", title: "Grade settings", hint: "Scale, weights, deadlines" },
  { id: "terms", title: "Terms", hint: "School years and semesters" },
  { id: "close", title: "Close term", hint: "Carry balances forward" },
  { id: "school", title: "School", hint: "Name, code, enrollment rules" },
];

export function SetupList({
  selected,
  onSelect,
  listRef,
}: {
  selected: SetupId | null;
  onSelect: (id: SetupId) => void;
  listRef: RefObject<HTMLUListElement | null>;
}) {
  return (
    <ListPane ref={listRef} title="Setup" subtitle="School-wide settings. Changes apply to new work." testId="setup-list" listTestId="setup-rows">
      {SETUP_GROUPS.map((g) => (
        <ListRow key={g.id} selected={selected === g.id} waiting={false} onClick={() => onSelect(g.id)} testId={`setup-${g.id}`}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{g.title}</span>
            <span className="block truncate text-xs text-muted">{g.hint}</span>
          </span>
        </ListRow>
      ))}
    </ListPane>
  );
}

export function SetupDetail({
  id,
  store,
  session,
  onChanged,
  onBack,
}: {
  id: SetupId;
  store: DataStore;
  session: SessionInfo;
  onChanged: (msg: string) => void;
  onBack: () => void;
}) {
  const g = SETUP_GROUPS.find((x) => x.id === id)!;
  // Remount the form after a save so it reloads what was saved.
  const [version, setVersion] = useState(0);
  const done = (msg: string) => {
    onChanged(msg);
    setVersion((v) => v + 1);
  };
  const intro: Record<SetupId, string> = {
    fees: "One setup per term and track. Add a more specific one per course, year or grade level; the most specific match wins. New rates apply when a load is picked or changed.",
    grades: "How grades are averaged and weighted, and when grade sheets are due.",
    terms: "The school years and semesters in use. New applications go to open terms.",
    close: "Closing moves each unpaid balance to the student's next-term enrollment and locks the term.",
    school: "The school's details and the rules the enrollment checks use.",
  };
  return (
    <DetailPane
      onBack={onBack}
      backLabel="Setup"
      testId={`setup-detail-${id}`}
      header={
        <div>
          <h2 className="text-xl font-semibold">{g.title}</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-muted">{intro[id]}</p>
        </div>
      }
    >
      <div className={id === "fees" || id === "grades" ? "" : "max-w-3xl"} key={version}>
        {id === "fees" && <FeeSetupPanel store={store} onDone={done} />}
        {id === "grades" && <GradeSettingsPanel store={store} onDone={done} />}
        {id === "close" && <CloseTermPanel store={store} onDone={done} />}
        {id === "terms" && <TermsView store={store} />}
        {id === "school" && <SchoolView session={session} />}
      </div>
    </DetailPane>
  );
}

function TermsView({ store }: { store: DataStore }) {
  const [terms, setTerms] = useState<Term[] | null>(null);
  useEffect(() => {
    void store.listAllTerms().then(setTerms);
  }, [store]);
  if (!terms) return <p className="text-sm text-muted">Loading terms</p>;
  const sorted = [...terms].sort((a, b) => b.school_year.localeCompare(a.school_year) || a.track.localeCompare(b.track) || (a.semester ?? "").localeCompare(b.semester ?? ""));
  return (
    <div data-testid="terms-view">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">Term</th>
            <th className="py-2 pr-3 font-medium">Track</th>
            <th className="py-2 pr-3 font-medium">Applications</th>
            <th className="py-2 font-medium">Accounts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {sorted.map((t) => (
            <tr key={t.id}>
              <td className="num py-2.5 pr-3 font-medium">{termLabel(t)}</td>
              <td className="py-2.5 pr-3">{t.track === "college" ? "College (CHED)" : "K to 12 (DepEd)"}</td>
              <td className="py-2.5 pr-3">{t.is_open ? <Pill tone="go">Open</Pill> : <Pill tone="muted">Not open</Pill>}</td>
              <td className="py-2.5">{t.closed_at ? <Pill tone="muted">Closed</Pill> : <Pill tone="ink">Taking payments</Pill>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-muted">Adding or opening terms is done in the database for now. Close a term from Close term.</p>
    </div>
  );
}

function SchoolView({ session }: { session: SessionInfo }) {
  const { school } = session;
  const rows: [string, React.ReactNode][] = [
    ["Name", school.name],
    ["Code", <span key="c" className="num">{school.code}</span>],
    ["Most units per term (college)", <span key="u" className="num">{school.settings.max_units}</span>],
    ["Dean approval step", school.settings.use_dean_approval ? "On: the dean approves before the registrar" : "Off"],
    ["Student ID format", <span key="f" className="num">{school.code}-2026-0001</span>],
    ["Online form", <a key="a" className="font-medium text-ink underline" href={`/apply/${school.code}`}>/apply/{school.code}</a>],
  ];
  return (
    <div data-testid="school-view">
      <dl className="grid gap-x-8 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="border-b border-line/70 py-2.5">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5 text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted">These settings are kept in the school record. A settings form is planned; for now change them in the database.</p>
    </div>
  );
}
