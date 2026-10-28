// Money helpers. All rules work in whole centavos (integers) so sums are exact.

export const toCents = (pesos: number): number => Math.round(Number(pesos) * 100);
export const toPesos = (cents: number): number => cents / 100;
export const round2 = (n: number): number => toPesos(toCents(n));

/** pct% of an amount in centavos, rounded half up (pct may have 2 decimals). */
export function pctOf(cents: number, pct: number): number {
  return Math.round((cents * Math.round(pct * 100)) / 10000);
}

/**
 * Split an amount by percent weights. Each part is rounded down to the
 * centavo; the leftover centavos go on the LAST part so the parts add up to
 * the total exactly.
 */
export function splitByPercent(totalCents: number, percents: number[]): number[] {
  if (percents.length === 0) return [];
  const basis = percents.map((p) => Math.round(p * 100)); // basis points of 100%
  const sum = basis.reduce((a, b) => a + b, 0) || 1;
  const parts = basis.map((b) => Math.floor((totalCents * b) / sum));
  const used = parts.slice(0, -1).reduce((a, b) => a + b, 0);
  parts[parts.length - 1] = totalCents - used;
  return parts;
}

/** Split into n equal parts; leftover centavos go on the last part. */
export function splitEven(totalCents: number, n: number): number[] {
  return splitByPercent(totalCents, Array.from({ length: Math.max(1, n) }, () => 1));
}

export function peso(n: number): string {
  const v = round2(n);
  const s = Math.abs(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "-₱" : "₱") + s;
}
