"use client";

import type { SessionInfo } from "@/lib/data/store";
import type { Role } from "@/lib/enrollment/types";
import { Button, inputClass } from "./ui";

const DEMO_ROLES: { role: Role; label: string }[] = [
  { role: "registrar", label: "Registrar" },
  { role: "cashier", label: "Cashier" },
  { role: "student", label: "Student" },
  { role: "parent", label: "Parent" },
  { role: "teacher", label: "Teacher" },
];

export default function Header({
  session,
  demo,
  onRole,
  onReset,
  onSignOut,
  onFeeSetup,
  onCloseTerm,
  onGradeSettings,
}: {
  session: SessionInfo;
  demo: boolean;
  onRole: (r: Role) => void;
  onReset: () => void;
  onSignOut: () => void;
  /** Registrar only: open the fee setup / term closing side panels. */
  onFeeSetup?: () => void;
  onCloseTerm?: () => void;
  /** Registrar only: grade settings side panel. */
  onGradeSettings?: () => void;
}) {
  const { school, actor } = session;
  // The dean only appears when the school uses the dean step.
  const roles = school.settings.use_dean_approval
    ? [...DEMO_ROLES, { role: "dean" as Role, label: "Dean" }]
    : DEMO_ROLES;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {school.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
          ) : (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-white">
              {school.code}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{school.name}</p>
            <p className="text-xs text-muted">Enrollment · Grades · S.Y. 2026-2027</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onFeeSetup && (
            <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={onFeeSetup} data-testid="open-fee-setup">
              Fee setup
            </Button>
          )}
          {onGradeSettings && (
            <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={onGradeSettings} data-testid="open-grade-settings">
              Grade settings
            </Button>
          )}
          {onCloseTerm && (
            <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={onCloseTerm} data-testid="open-close-term">
              Close term
            </Button>
          )}
          {demo ? (
            <>
              <span className="hidden rounded-full bg-wait-soft px-2.5 py-1 text-xs font-medium text-wait sm:inline">
                Demo mode
              </span>
              <label className="flex items-center gap-2 text-xs text-muted">
                <span className="hidden whitespace-nowrap sm:inline">Viewing as</span>
                <select
                  data-testid="role-switcher"
                  aria-label="Switch role"
                  className={`${inputClass} w-auto py-1.5`}
                  value={actor.role}
                  onChange={(e) => onRole(e.target.value as Role)}
                >
                  {roles.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="hidden text-xs text-muted md:inline">({actor.name})</span>
              <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={onReset}>
                Reset demo
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted">
                {actor.name} · <span className="capitalize">{actor.role}</span>
              </span>
              <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={onSignOut}>
                Sign out
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
