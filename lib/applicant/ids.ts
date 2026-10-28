// Applicant numbers and login names.
// Applicant number: APP-{year}-{seq, 5 digits}, e.g. APP-2026-00012 (one sequence per school and year).
// Applicants without an email sign in with a made-up auth email built from that number.

export function formatApplicantNo(year: string | number, seq: number): string {
  return `APP-${String(year).slice(0, 4)}-${String(seq).padStart(5, "0")}`;
}

/** Next sequence number for a school + year, given the applicant numbers already used. */
export function nextApplicantSeq(existing: (string | null | undefined)[], year: string | number): number {
  const prefix = `APP-${String(year).slice(0, 4)}-`;
  let max = 0;
  for (const no of existing) {
    if (no && no.toUpperCase().startsWith(prefix)) {
      const n = parseInt(no.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
}

const APPLICANT_NO = /^APP-\d{4}-\d{3,}$/i;

export function isApplicantNo(login: string): boolean {
  return APPLICANT_NO.test(login.trim());
}

/** The auth email of an applicant who gave no email: app-2026-00012@applicants.sa.local */
export function applicantAuthEmail(applicantNo: string, schoolCode: string): string {
  return `${applicantNo.trim().toLowerCase()}@applicants.${schoolCode.trim().toLowerCase()}.local`;
}

/** What the person typed in the login box. */
export function loginKind(login: string): "email" | "applicant_no" | "student_no" {
  const v = login.trim();
  if (v.includes("@")) return "email";
  if (isApplicantNo(v)) return "applicant_no";
  return "student_no";
}
