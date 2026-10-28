// Student number format: {schoolcode}-{year}-{seq}, e.g. SA-2026-0007.

export function formatStudentNo(schoolCode: string, schoolYear: string, seq: number): string {
  const year = schoolYear.slice(0, 4);
  return `${schoolCode}-${year}-${String(seq).padStart(4, "0")}`;
}

/** Next sequence number for a school + year, given the numbers already used. */
export function nextSeq(existing: (string | null)[], schoolCode: string, schoolYear: string): number {
  const prefix = `${schoolCode}-${schoolYear.slice(0, 4)}-`;
  let max = 0;
  for (const no of existing) {
    if (no && no.startsWith(prefix)) {
      const n = parseInt(no.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
}
