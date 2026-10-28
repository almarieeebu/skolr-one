// Official receipt (OR) numbers: one running series per school.
// The cashier gets the next number filled in and may type another one.

import type { OrSeries } from "./types";

export function formatOr(s: Pick<OrSeries, "prefix" | "next_no" | "pad">): string {
  return `${s.prefix}${String(s.next_no).padStart(s.pad, "0")}`;
}

/** After an OR is used: move the series on only if the suggested number was used. */
export function advanceOr(s: OrSeries, used: string): OrSeries {
  return used.trim() === formatOr(s) ? { ...s, next_no: s.next_no + 1 } : s;
}
