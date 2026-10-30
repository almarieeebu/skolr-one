"use client";

// Shared building blocks so every pane, panel and form looks the same.
// Tokens live in app/globals.css (see docs/design.md).

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Status } from "@/lib/enrollment/types";
import { STATUS_LABEL } from "@/lib/enrollment/status";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:opacity-90 disabled:opacity-45",
  secondary: "bg-sheet text-ink border border-line hover:bg-hover disabled:opacity-50",
  danger: "bg-sheet text-stop border border-stop/35 hover:bg-stop/8 disabled:opacity-50",
  ghost: "text-muted hover:text-ink hover:bg-hover disabled:opacity-50",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "min-h-8 px-3 text-xs" : "min-h-9 px-3.5 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed ${sz} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export type Tone = "ink" | "muted" | "go" | "warn" | "stop";

export function Pill({ tone = "muted", children, className = "", ...rest }: { tone?: Tone; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`pill pill-${tone} ${className}`} {...rest}>
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<Status, Tone> = {
  applied: "muted",
  papers_checked: "ink",
  student_made: "ink",
  load_set: "ink",
  assessed_paid: "ink",
  officially_enrolled: "go",
  rejected: "stop",
  withdrawn: "stop",
};

export function StatusBadge({ status, needsFix = false }: { status: Status; needsFix?: boolean }) {
  if (needsFix && status === "applied") return <Pill tone="warn">Needs fix</Pill>;
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

/** Filter chip (toggle). */
export function Chip({
  active,
  children,
  onClick,
  testId,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
        active ? "border-primary bg-primary text-on-primary" : "border-line bg-sheet text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** A titled block inside a pane, separated by a line (not a card). */
export function PaneSection({
  title,
  aside,
  children,
  className = "",
  testId,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={`border-t border-line py-4 first:border-t-0 first:pt-0 ${className}`} data-testid={testId}>
      {(title || aside) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {aside && <span className="text-xs text-muted">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full min-w-0 rounded-md border border-line bg-sheet px-2.5 py-1.5 text-sm text-ink placeholder:text-muted/70 focus:border-ink focus:outline-none disabled:bg-paper";

export function Warnings({ items, tone = "wait" }: { items: string[]; tone?: "wait" | "danger" }) {
  if (!items.length) return null;
  const style = tone === "danger" ? "border-stop text-stop bg-stop/6" : "border-warn text-warn bg-warn/7";
  return (
    <ul role="alert" className={`space-y-0.5 rounded-r-md border-l-2 px-3 py-2 text-sm ${style}`}>
      {items.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

/** A note line (info / warn / stop / go) with a colored rule on the left. */
export function Note({ tone = "muted", children, testId, className = "" }: { tone?: Tone; children: ReactNode; testId?: string; className?: string }) {
  const style: Record<Tone, string> = {
    ink: "border-ink bg-ink/5 text-ink",
    muted: "border-line bg-paper text-muted",
    go: "border-go bg-go/8 text-go",
    warn: "border-warn bg-warn/8 text-warn",
    stop: "border-stop bg-stop/7 text-stop",
  };
  return (
    <div className={`rounded-r-md border-l-2 px-3 py-2 text-sm ${style[tone]} ${className}`} data-testid={testId}>
      {children}
    </div>
  );
}

/** A bar that sticks to the bottom of a scrolling pane (the form's main button). */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-sheet px-4 py-3 md:-bottom-5 md:-mx-6 md:-mb-5 md:px-6">
      {children}
    </div>
  );
}

/** Small label + value pair used in stat rows. */
export function Stat({ label, value, tone, testId }: { label: string; value: ReactNode; tone?: Tone; testId?: string }) {
  const color = tone === "go" ? "text-go" : tone === "warn" ? "text-warn" : tone === "stop" ? "text-stop" : "text-ink";
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num truncate text-base font-semibold ${color}`} data-testid={testId}>{value}</dd>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <p className="text-base font-semibold text-ink">{title}</p>
        {children && <div className="mt-1 text-sm text-muted">{children}</div>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

// ---------- dialogs ----------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Esc closes, Tab stays inside, focus returns to the opener on close. */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const box = ref.current;
    // Focus the first field (or the panel itself).
    requestAnimationFrame(() => {
      const first = box?.querySelector<HTMLElement>(
        '[data-autofocus], input:not([type="hidden"]):not([disabled]):not([type="checkbox"]):not([type="radio"]), select, textarea',
      );
      (first ?? box)?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);
  return ref;
}

function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

const CloseIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

/**
 * Side panel: 480px, slides over the detail from the right. Full-height sheet on phones.
 * `footer` sticks to the bottom of the panel (the panel's main button).
 */
export function SidePanel({
  title,
  subtitle,
  open,
  onClose,
  children,
  footer,
  testId,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
  wide?: boolean;
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex justify-end print:hidden">
        <button type="button" aria-label="Close panel" tabIndex={-1} className="absolute inset-0 animate-fade-in bg-[#0b1220]/35" onClick={onClose} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-testid={testId}
          className={`relative flex h-full w-full animate-panel-in flex-col bg-sheet shadow-[0_10px_40px_rgba(11,18,32,0.28)] outline-none md:rounded-l-xl ${wide ? "md:max-w-[640px]" : "md:max-w-[480px]"}`}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold">{title}</h2>
              {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink">
              <CloseIcon />
            </button>
          </div>
          <div className="pane-scroll flex-1 px-5 py-4">{children}</div>
          {footer && <div className="border-t border-line bg-sheet px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

/** Older name for the side panel. */
export function Drawer(props: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  return <SidePanel {...props} />;
}

/** Centered modal for short confirmations. */
export function Modal({
  title,
  open,
  onClose,
  children,
  testId,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-end p-0 sm:place-items-center sm:p-4 print:hidden">
        <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 animate-fade-in bg-[#0b1220]/40" onClick={onClose} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-testid={testId}
          className="relative w-full animate-modal-in rounded-t-xl bg-sheet shadow-[0_10px_40px_rgba(11,18,32,0.3)] outline-none sm:max-w-md sm:rounded-xl"
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-4">
            <h2 id={titleId} className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink">
              <CloseIcon />
            </button>
          </div>
          <div className="px-5 pt-2 pb-5">{children}</div>
        </div>
      </div>
    </Portal>
  );
}

// ---------- tabs ----------

export interface TabDef {
  id: string;
  label: string;
  badge?: ReactNode;
}

/**
 * Horizontal sub-tabs with a moving underline. Arrow keys move between tabs.
 * Panels use id `${idBase}-panel` and `aria-labelledby` the active tab.
 */
export function SubTabs({
  tabs,
  value,
  onChange,
  idBase,
  label,
  className = "",
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  idBase: string;
  label: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const measure = useCallback(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`);
    if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value]);
  useLayoutEffect(() => {
    measure();
  }, [measure, tabs.length]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);
  // Keep the active tab in view on narrow screens.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === value);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus());
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      data-subtabs
      onKeyDown={onKey}
      className={`relative flex gap-1 overflow-x-auto [scrollbar-width:none] ${className}`}
    >
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.id}`}
            data-tab={t.id}
            data-testid={`subtab-${t.id}`}
            aria-selected={on}
            aria-controls={`${idBase}-panel`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`relative flex h-10 shrink-0 items-center gap-1.5 rounded-t-md px-2.5 text-sm whitespace-nowrap transition-colors ${
              on ? "font-semibold text-ink" : "font-medium text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.badge != null && t.badge !== false && (
              <span className="num rounded-full bg-ink/8 px-1.5 text-xs font-medium text-muted">{t.badge}</span>
            )}
          </button>
        );
      })}
      {bar && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-ink transition-[left,width] duration-180 ease-out"
          style={{ left: bar.left, width: bar.width }}
        />
      )}
    </div>
  );
}

/** Toast at the bottom center. */
export function Toast({ message, tone = "ink" }: { message: string; tone?: "ink" | "stop" }) {
  return (
    <div
      role={tone === "stop" ? "alert" : "status"}
      className={`fixed bottom-20 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 animate-modal-in rounded-full px-4 py-2 text-center text-sm font-medium shadow-[0_6px_24px_rgba(11,18,32,0.25)] md:bottom-6 print:hidden ${
        tone === "stop" ? "bg-stop text-white" : "bg-primary text-on-primary"
      }`}
    >
      {message}
    </div>
  );
}
