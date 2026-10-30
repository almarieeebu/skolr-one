// Simple 20px line icons for the module rail and the bottom tab bar.

import type { ReactNode } from "react";

export type IconName =
  | "enrollment"
  | "applicants"
  | "cashier"
  | "grades"
  | "setup"
  | "classes"
  | "students"
  | "progress"
  | "details"
  | "papers"
  | "messages"
  | "account"
  | "fees"
  | "search";

const PATHS: Record<IconName, ReactNode> = {
  enrollment: (
    <>
      <rect x="4" y="3.5" width="12" height="14" rx="1.8" />
      <path d="M7.5 3.5V2.5h5v1M7 8h6M7 11h6M7 14h3.5" />
    </>
  ),
  applicants: (
    <>
      <path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h10a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 15 14H9l-3.5 2.8V14H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M7 8h6M7 10.8h4" />
    </>
  ),
  cashier: (
    <>
      <rect x="2.5" y="5" width="15" height="10.5" rx="1.8" />
      <path d="M2.5 8.5h15M6 12.5h3" />
    </>
  ),
  grades: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1.8" />
      <path d="M3 7.5h14M8 7.5V17M12.5 7.5V17" />
    </>
  ),
  setup: (
    <>
      <path d="M4 5.5h7M14.5 5.5H16M4 10h2M9.5 10H16M4 14.5h8M15.5 14.5h.5" />
      <circle cx="12.8" cy="5.5" r="1.7" />
      <circle cx="7.8" cy="10" r="1.7" />
      <circle cx="13.8" cy="14.5" r="1.7" />
    </>
  ),
  classes: (
    <>
      <path d="M3.5 4.5c2.3-.9 4.5-.9 6.5.5 2-1.4 4.2-1.4 6.5-.5v11c-2.3-.9-4.5-.9-6.5.5-2-1.4-4.2-1.4-6.5-.5z" />
      <path d="M10 5v11" />
    </>
  ),
  students: (
    <>
      <circle cx="8" cy="7" r="2.8" />
      <path d="M2.8 16.5c.5-2.9 2.6-4.5 5.2-4.5s4.7 1.6 5.2 4.5" />
      <path d="M13.2 4.6a2.6 2.6 0 0 1 0 4.9M15 12.3c1.3.6 2.1 2 2.3 4.2" />
    </>
  ),
  progress: (
    <>
      <circle cx="4.5" cy="10" r="1.8" />
      <circle cx="10" cy="10" r="1.8" />
      <circle cx="15.5" cy="10" r="1.8" />
      <path d="M6.3 10h1.9M11.8 10h1.9" />
    </>
  ),
  details: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.8" />
      <circle cx="7" cy="9.3" r="1.7" />
      <path d="M4.6 13.2c.4-1.2 1.3-1.9 2.4-1.9s2 .7 2.4 1.9M11.5 8.5h3.5M11.5 11.5h2.5" />
    </>
  ),
  papers: (
    <>
      <path d="M5 2.8h6.5L15.5 7v10.2H5z" />
      <path d="M11.5 2.8V7h4M7.5 10.5h5M7.5 13.5h5" />
    </>
  ),
  messages: (
    <>
      <path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h10a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 15 14H9l-3.5 2.8V14H5a1.5 1.5 0 0 1-1.5-1.5z" />
    </>
  ),
  account: (
    <>
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
    </>
  ),
  fees: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M8 14V6h2.6a2.2 2.2 0 0 1 0 4.4H8M6.5 8h7M6.5 9.8h7" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="M13 13l3.5 3.5" />
    </>
  ),
};

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
