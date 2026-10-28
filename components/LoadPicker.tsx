"use client";

// Side panel to pick college subjects or a K to 12 section, with live checks.

import { useMemo, useState } from "react";
import type { DataStore, SessionInfo } from "@/lib/data/store";
import type { EnrollmentDetail } from "@/lib/enrollment/types";
import { checkCollegeLoad, checkSection, formatSchedule, totalUnits } from "@/lib/enrollment/checks";
import { assess, peso } from "@/lib/fees";
import { Button, Field, Warnings, inputClass } from "./ui";

export default function LoadPicker({
  detail,
  session,
  store,
  onDone,
}: {
  detail: EnrollmentDetail;
  session: SessionInfo;
  store: DataStore;
  onDone: () => void;
}) {
  const e = detail.enrollment;
  const settings = session.school.settings;
  const isCollege = e.track === "college";
  const isRegistrar = session.actor.role === "registrar";
  const [picked, setPicked] = useState<string[]>(detail.loads.map((l) => l.offering_id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReason, setNeedsReason] = useState(false);
  const [reason, setReason] = useState("");

  const options = detail.offerings.filter((o) => o.kind === (isCollege ? "subject" : "section"));
  // K to 12: show sections for this grade first.
  const sorted = isCollege
    ? options
    : [...options].sort((a, b) => Number(b.level === e.level) - Number(a.level === e.level));
  const chosen = options.filter((o) => picked.includes(o.id));

  const warnings = useMemo(
    () =>
      isCollege
        ? checkCollegeLoad({ picked: chosen, student: detail.student, settings, takenCounts: detail.takenCounts })
        : checkSection(chosen[0], e, detail.takenCounts),
    [isCollege, chosen, detail, settings, e],
  );
  // Estimate with the term's fee setup (the real charges are posted on save).
  const assessment = detail.feeSetup
    ? assess({ enrollment: e, setup: detail.feeSetup, subjects: isCollege ? chosen : [], discounts: detail.discounts })
    : null;

  const toggle = (id: string) => {
    setNeedsReason(false);
    setPicked((p) => (isCollege ? (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]) : [id]));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await store.runAction(e.id, {
        type: "set_load",
        offering_ids: picked,
        override_reason: needsReason ? reason : undefined,
      });
      if (r.ok) onDone();
      else {
        setError(r.error);
        setNeedsReason(r.canOverride);
      }
    } finally {
      setBusy(false);
    }
  };

  const seatsLeft = (id: string, slots: number) => Math.max(0, slots - (detail.takenCounts[id] ?? 0));

  return (
    <div className="space-y-4" data-testid="load-picker">
      <p className="text-sm text-muted">
        {isCollege
          ? `Pick the subjects for this term. Max ${settings.max_units} units. Prerequisites, time conflicts and slots are checked as you pick.`
          : `Pick one section for ${e.level}${e.strand ? ` (${e.strand})` : ""}.`}
      </p>

      <ul className="divide-y divide-line rounded-xl border border-line">
        {sorted.map((o) => {
          const on = picked.includes(o.id);
          const left = seatsLeft(o.id, o.slots);
          const offLevel = !isCollege && o.level !== e.level;
          return (
            <li key={o.id}>
              <label
                className={`flex cursor-pointer items-start gap-3 px-3 py-3 ${on ? "bg-brand-soft" : "hover:bg-paper"} ${offLevel ? "opacity-60" : ""}`}
              >
                <input
                  type={isCollege ? "checkbox" : "radio"}
                  name="pick"
                  className="mt-1 h-4 w-4 accent-[var(--color-brand)]"
                  checked={on}
                  onChange={() => toggle(o.id)}
                  data-testid={`pick-${o.code}`}
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium">
                      {isCollege && <span className="mr-1.5 font-mono text-xs text-muted">{o.code}</span>}
                      {o.title}
                    </span>
                    {isCollege && <span className="text-xs text-muted">{o.units} units</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {formatSchedule(o)} · {o.room}
                    {o.lab_fee > 0 && ` · lab ${peso(o.lab_fee)}`}
                    {o.is_major && " · major"}
                    {" · "}
                    <span className={left === 0 ? "font-medium text-danger" : ""}>
                      {left === 0 ? "Full" : `${left} ${isCollege ? "slots" : "seats"} left`}
                    </span>
                  </span>
                  {o.prerequisite_codes.length > 0 && (
                    <span className="mt-1 inline-block rounded bg-paper px-1.5 py-0.5 text-[11px] text-muted">
                      Needs {o.prerequisite_codes.join(", ")}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 rounded-xl bg-paper p-4 text-sm">
        {isCollege && (
          <p className="flex justify-between">
            <span>Total units</span>
            <span className="font-semibold" data-testid="units-total">
              {totalUnits(chosen)} / {settings.max_units}
            </span>
          </p>
        )}
        <p className="flex justify-between">
          <span>Estimated fees this term</span>
          <span className="font-semibold tabular-nums" data-testid="fee-estimate">{assessment ? peso(assessment.total) : "No fee setup yet"}</span>
        </p>
      </div>

      <Warnings items={warnings} />
      {error && <p className="text-sm font-medium text-danger">{error}</p>}

      {needsReason && isRegistrar && (
        <Field label="Override reason (saved in history)">
          <textarea
            className={inputClass}
            rows={2}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            placeholder="e.g. Graduating student, dean allowed overload"
          />
        </Field>
      )}

      <Button
        className="w-full"
        disabled={busy || picked.length === 0 || (needsReason && !reason.trim())}
        onClick={save}
        data-testid="save-load"
        variant={needsReason ? "danger" : "primary"}
      >
        {needsReason ? "Override with reason and save" : isCollege ? "Save subjects" : "Save section"}
      </Button>
      {warnings.length > 0 && !isRegistrar && (
        <p className="text-xs text-muted">Fix the warnings above first. Only the registrar can override them.</p>
      )}
    </div>
  );
}
