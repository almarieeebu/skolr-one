"use client";

// The one-page workspace frame (see docs/design.md):
//   rail (module tabs) | list | detail
// On phones the rail becomes a bottom tab bar and the list and the detail are
// two stacked views. Only the inner panes scroll; the page itself never does.

import { forwardRef, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "./icons";

export interface ModuleTab {
  id: string;
  label: string;
  icon: IconName;
  /** Items waiting on the current user (yellow badge). */
  waiting?: number;
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export default function Shell({
  school,
  modules,
  active,
  onModule,
  user,
  menu,
  list,
  detail,
  showDetailOnPhone,
  testId = "workspace",
}: {
  school: { name: string; code: string; logo_url: string | null } | null;
  modules: ModuleTab[];
  active: string;
  onModule: (id: string) => void;
  /** Bottom of the rail: who is signed in. */
  user: { name: string; role: string };
  /** Content of the account menu (role switcher, reset, sign out). */
  menu: (close: () => void) => ReactNode;
  /** The list column; leave out to give the detail the full width. */
  list?: ReactNode;
  detail: ReactNode;
  /** Phones: show the detail view (else the list). */
  showDetailOnPhone: boolean;
  testId?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasList = list != null;
  const tabs = modules.length > 1 ? modules : [];

  return (
    <div
      className={`grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-paper md:grid-rows-1 ${
        hasList ? "md:grid-cols-[76px_288px_minmax(0,1fr)] xl:grid-cols-[76px_320px_minmax(0,1fr)]" : "md:grid-cols-[76px_minmax(0,1fr)]"
      } print:hidden`}
      data-testid={testId}
    >
      {/* Rail (desktop) */}
      <nav aria-label="Modules" className="on-rail relative hidden min-h-0 flex-col items-stretch bg-rail text-on-rail md:flex" data-testid="rail">
        <div className="grid place-items-center py-3.5" title={school?.name}>
          {school?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logo_url} alt={school.name} className="h-10 w-10 rounded-[10px] object-cover" />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-white/12 text-sm font-bold tracking-normal">
              {school?.code ?? ""}
            </span>
          )}
        </div>
        <div role="tablist" aria-orientation="vertical" aria-label="Modules" className="flex flex-1 flex-col gap-1 px-1 pt-1">
          {tabs.map((m) => {
            const on = m.id === active;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`module-${m.id}`}
                onClick={() => onModule(m.id)}
                className={`relative flex flex-col items-center gap-1 rounded-[10px] px-0 py-2.5 text-xs font-medium tracking-[-0.01em] transition-colors ${
                  on ? "bg-white/14 text-white" : "text-white/70 hover:bg-white/7 hover:text-white"
                }`}
              >
                <span className="relative">
                  <Icon name={m.icon} size={22} />
                  {!!m.waiting && (
                    <span
                      className="num absolute -top-1.5 -right-3 min-w-[18px] rounded-full bg-highlight px-1 text-center text-xs leading-[18px] font-bold text-on-highlight"
                      aria-label={`${m.waiting} waiting on you`}
                      data-testid={`module-${m.id}-waiting`}
                    >
                      {m.waiting}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center leading-tight">{m.label}</span>
              </button>
            );
          })}
        </div>
        <div className="relative px-1.5 pb-3">
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            data-testid="account-button"
            className="flex w-full flex-col items-center gap-1 rounded-[10px] px-1 py-2 text-xs text-white/80 hover:bg-white/7 hover:text-white"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/16 text-xs font-semibold text-white">{initials(user.name)}</span>
            <span className="w-full truncate text-center capitalize">{user.role}</span>
          </button>
        </div>
      </nav>

      {/* List column */}
      {hasList && (
        <div className={`min-h-0 min-w-0 border-line bg-sheet md:block md:border-r ${showDetailOnPhone ? "hidden" : "block"}`}>{list}</div>
      )}

      {/* Detail */}
      <main className={`min-h-0 min-w-0 bg-sheet md:block ${hasList && !showDetailOnPhone ? "hidden" : "block"}`}>{detail}</main>

      {/* Bottom tab bar (phones) */}
      <nav aria-label="Modules" className="border-t border-line bg-sheet pb-[env(safe-area-inset-bottom)] md:hidden" data-testid="bottom-tabs">
        <div role="tablist" className="flex">
          {tabs.map((m) => {
            const on = m.id === active;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`tab-${m.id}`}
                onClick={() => onModule(m.id)}
                className={`relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0 text-[12px] font-medium tracking-[-0.01em] ${on ? "text-ink" : "text-muted"}`}
              >
                {on && <span aria-hidden className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-ink" />}
                <span className="relative">
                  <Icon name={m.icon} size={22} />
                  {!!m.waiting && (
                    <span className="num absolute -top-1 -right-3 min-w-[17px] rounded-full bg-highlight px-1 text-center text-xs leading-[17px] font-bold text-on-highlight">
                      {m.waiting}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center">{m.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            data-testid="tab-account"
            className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0 text-[12px] font-medium tracking-[-0.01em] text-muted"
          >
            <Icon name="account" size={22} />
            <span>Account</span>
          </button>
        </div>
      </nav>

      {menuOpen && <AccountMenu onClose={() => setMenuOpen(false)} user={user}>{menu(() => setMenuOpen(false))}</AccountMenu>}
    </div>
  );
}

function AccountMenu({ children, onClose, user }: { children: ReactNode; onClose: () => void; user: { name: string; role: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-testid="account-button"],[data-testid="tab-account"]')) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("select, button")?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#0b1220]/30 md:hidden" aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-label="Account"
        data-testid="account-menu"
        className="fixed inset-x-0 bottom-0 z-50 animate-modal-in rounded-t-xl border border-line bg-sheet p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_10px_40px_rgba(11,18,32,0.28)] md:inset-x-auto md:bottom-3 md:left-[84px] md:w-72 md:rounded-xl"
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink/8 text-xs font-semibold">{initials(user.name)}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="text-xs text-muted capitalize">{user.role}</p>
          </div>
        </div>
        {children}
      </div>
    </>
  );
}

// ---------- list column ----------

export const ListPane = forwardRef<HTMLUListElement, {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  search?: { value: string; onChange: (v: string) => void; placeholder: string; inputRef?: RefObject<HTMLInputElement | null>; label?: string };
  filters?: ReactNode;
  children: ReactNode;
  testId?: string;
  listTestId?: string;
  empty?: ReactNode;
}>(function ListPane({ title, subtitle, action, search, filters, children, testId, listTestId, empty }, ref) {
  return (
    <section className="flex h-full min-h-0 flex-col" data-testid={testId} aria-label={title}>
      <div className="space-y-2.5 border-b border-line px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{title}</h1>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
        {search && (
          <div className="relative">
            <Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <input
              ref={search.inputRef}
              type="search"
              data-search
              placeholder={search.placeholder}
              aria-label={search.label ?? "Search"}
              className="w-full rounded-md border border-line bg-paper py-1.5 pr-8 pl-8 text-sm placeholder:text-muted/80 focus:border-ink focus:bg-sheet focus:outline-none"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-sans text-xs text-muted md:block">/</kbd>
          </div>
        )}
        {filters}
      </div>
      <ul ref={ref} className="pane-scroll min-h-0 flex-1" data-testid={listTestId} data-list>
        {children}
        {empty}
      </ul>
      <p className="hidden items-center gap-x-2.5 border-t border-line px-4 py-2 text-xs whitespace-nowrap text-muted md:flex" aria-hidden>
        <span><Kbd>/</Kbd> search</span>
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span><Kbd>↵</Kbd> open</span>
        <span><Kbd>[</Kbd><Kbd>]</Kbd> tabs</span>
      </p>
    </section>
  );
});

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mr-1 inline-block min-w-[18px] rounded border border-line bg-paper px-1 text-center font-sans text-[11px] leading-[16px] font-semibold text-muted">{children}</kbd>;
}

/** A dense list row: 56px, yellow 4px stripe when it waits on you. */
export function ListRow({
  selected,
  waiting,
  onClick,
  testId,
  children,
}: {
  selected: boolean;
  waiting: boolean;
  onClick: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <li className="border-b border-line/70">
      <button
        type="button"
        data-testid={testId}
        data-row
        aria-current={selected ? "true" : undefined}
        onClick={onClick}
        className={`relative flex min-h-14 w-full items-center gap-3 py-2 pr-3 pl-4 text-left transition-colors focus-visible:-outline-offset-2 ${
          selected ? "bg-select" : "hover:bg-hover"
        }`}
      >
        {waiting && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-highlight" data-waiting />}
        {waiting && <span className="sr-only">Waiting on you.</span>}
        {children}
      </button>
    </li>
  );
}

// ---------- detail pane ----------

export function DetailPane({
  header,
  tabs,
  children,
  dock,
  onBack,
  backLabel = "Back",
  panelId,
  labelledBy,
  testId,
  bodyClassName = "",
  flush = false,
}: {
  header: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  dock?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  panelId?: string;
  labelledBy?: string;
  testId?: string;
  bodyClassName?: string;
  /** The body fills the pane without padding (grade sheet). */
  flush?: boolean;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <header className="border-b border-line px-4 pt-3 md:px-6 md:pt-4">
        {onBack && (
          <button type="button" onClick={onBack} className="-ml-1 mb-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium text-muted hover:text-ink md:hidden" data-testid="back">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-6 6 6 6" /></svg>
            {backLabel}
          </button>
        )}
        <div className={tabs ? "" : "pb-3 md:pb-4"}>{header}</div>
        {tabs && <div className="-mb-px mt-2">{tabs}</div>}
      </header>
      <div
        id={panelId}
        role={panelId ? "tabpanel" : undefined}
        aria-labelledby={labelledBy}
        tabIndex={panelId ? -1 : undefined}
        className={`pane-scroll min-h-0 flex-1 outline-none ${flush ? "" : "px-4 py-4 md:px-6 md:py-5"} ${bodyClassName}`}
        data-testid="detail-body"
      >
        {children}
      </div>
      {dock && (
        <footer className="border-t border-line bg-sheet px-4 py-2.5 md:px-6 md:py-3" data-testid="action-dock">
          {dock}
        </footer>
      )}
    </section>
  );
}

/** Keyboard: "/" search, Up/Down list rows, "[" "]" sub-tabs. Enter opens the focused row (native). */
export function useWorkspaceKeys({
  searchRef,
  listRef,
  onPrevTab,
  onNextTab,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
  onPrevTab?: () => void;
  onNextTab?: () => void;
}) {
  const tabsRef = useRef({ onPrevTab, onNextTab });
  tabsRef.current = { onPrevTab, onNextTab };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, select, [contenteditable=true]");
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.key === "/" && !typing) {
        if (searchRef.current) {
          e.preventDefault();
          searchRef.current.focus();
          searchRef.current.select();
        }
        return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (!typing || t === searchRef.current)) {
        const list = listRef.current;
        if (!list) return;
        const inList = list.contains(t);
        if (!inList && t !== searchRef.current && t !== document.body && !t.closest("[data-list-root]")) return;
        const rows = [...list.querySelectorAll<HTMLElement>("[data-row]")];
        if (!rows.length) return;
        e.preventDefault();
        const i = rows.indexOf(t);
        let next: HTMLElement | undefined;
        if (i < 0) next = rows.find((r) => r.getAttribute("aria-current") === "true") ?? rows[0];
        else next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
        next?.focus();
        next?.scrollIntoView({ block: "nearest" });
        return;
      }
      if ((e.key === "[" || e.key === "]") && !typing) {
        e.preventDefault();
        if (e.key === "[") tabsRef.current.onPrevTab?.();
        else tabsRef.current.onNextTab?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchRef, listRef]);
}
