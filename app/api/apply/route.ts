// POST /api/apply: the public enrollment form in SUPABASE MODE.
// (Demo mode never calls this: the form is saved in the browser.)
//
// 1. applicant_submit()      (database, as anon) checks the form, rate-limits, makes the
//                             application and returns the applicant number + a one-time token.
// 2. create the auth user     with SUPABASE_SERVICE_ROLE_KEY (server only, optional), or,
//                             without it, with signUp (Supabase emails a confirmation link).
// 3. applicant_link_account() gives that user the "applicant" role on the application.
// 4. upload the papers        (service role, or as the new user when signUp gave a session).
//
// SUPABASE_SERVICE_ROLE_KEY must NEVER be a NEXT_PUBLIC_ variable: it skips every security rule.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isDemoMode } from "@/lib/config";
import { generateTempPassword, validateDocuments, type ApplicationForm } from "@/lib/applicant";
import type { DocType } from "@/lib/enrollment/types";
import type { ApplicantCredentials } from "@/lib/data/store";

const DOC_TYPES: DocType[] = ["psa_birth_cert", "form_138", "honorable_dismissal", "tor", "photo"];

interface Submitted {
  enrollment_id: string;
  student_id: string;
  school_id: string;
  school_name: string;
  applicant_no: string;
  login_email: string;
  email_in_use: boolean;
  full_name: string;
  claim_token: string;
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });

const serverClient = (key: string) =>
  createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function uploadPapers(sb: SupabaseClient, sub: Submitted, files: { type: DocType; file: File }[]) {
  for (const { type, file } of files) {
    const path = `${sub.school_id}/${sub.enrollment_id}/${type}-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const up = await sb.storage.from("documents").upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) throw new Error(up.error.message);
    const row = await sb.from("documents").upsert(
      {
        school_id: sub.school_id, enrollment_id: sub.enrollment_id, type, file_name: file.name, file_path: path,
        checked: false, uploaded_at: new Date().toISOString(),
      },
      { onConflict: "enrollment_id,type" },
    );
    if (row.error) throw new Error(row.error.message);
  }
}

export async function POST(request: Request) {
  if (isDemoMode) return fail("Demo mode saves the form in the browser.");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  let form: ApplicationForm;
  let schoolCode: string | null;
  const files: { type: DocType; file: File }[] = [];
  try {
    const data = await request.formData();
    form = JSON.parse(String(data.get("form") ?? "{}")) as ApplicationForm;
    schoolCode = String(data.get("school_code") ?? "").trim() || null;
    for (const type of DOC_TYPES) {
      const f = data.get(`file_${type}`);
      if (f && typeof f !== "string" && f.size > 0) files.push({ type, file: f });
    }
  } catch {
    return fail("We could not read the form. Please try again.");
  }
  const fileProblems = Object.values(validateDocuments(form, Object.fromEntries(files.map((f) => [f.type, f.file]))));
  if (fileProblems.length) return fail(fileProblems[0]!);

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;

  // 1. Save the application (the database checks everything again).
  const anon = serverClient(SUPABASE_ANON_KEY);
  const { signature, ...rest } = form;
  const submitted = await anon.rpc("applicant_submit", {
    p_school_code: schoolCode,
    p_form: { ...rest, signature },
    p_ip: ip,
    p_need_real_email: !serviceKey,
  });
  if (submitted.error) return fail(submitted.error.message);
  const sub = submitted.data as Submitted;
  const password = generateTempPassword();
  const keep = `We saved your application (${sub.applicant_no}), but could not make your account. Please call or visit the registrar.`;

  let emailNote: ApplicantCredentials["email_note"] = "none";
  let papersUploaded = files.length === 0;

  if (serviceKey) {
    // 2a. Make the account directly (no email needed).
    const admin = serverClient(serviceKey);
    const made = await admin.auth.admin.createUser({
      email: sub.login_email, password, email_confirm: true, user_metadata: { full_name: sub.full_name },
    });
    if (made.error || !made.data.user) return fail(keep, 500);
    const linked = await admin.rpc("applicant_link_account", { p_student: sub.student_id, p_token: sub.claim_token, p_user: made.data.user.id });
    if (linked.error) return fail(keep, 500);
    try {
      await uploadPapers(admin, sub, files);
      papersUploaded = true;
    } catch {
      papersUploaded = false;
    }
  } else {
    // 2b. No service key: sign up with the applicant's email. Supabase sends a confirmation link.
    const origin = new URL(request.url).origin;
    const made = await anon.auth.signUp({
      email: sub.login_email, password,
      options: { data: { full_name: sub.full_name }, emailRedirectTo: `${origin}/portal` },
    });
    if (made.error || !made.data.user) return fail(made.error?.message ? `${keep} (${made.error.message})` : keep, 500);
    const linked = await anon.rpc("applicant_link_account", { p_student: sub.student_id, p_token: sub.claim_token, p_user: made.data.user.id });
    if (linked.error) return fail(keep, 500);
    if (made.data.session) {
      // Email confirmation is off in this project: the applicant is signed in here, so upload as them.
      try {
        await uploadPapers(anon, sub, files);
        papersUploaded = true;
      } catch {
        papersUploaded = false;
      }
    } else {
      emailNote = "confirm";
    }
  }

  const body: ApplicantCredentials = {
    full_name: sub.full_name,
    school_name: sub.school_name,
    applicant_no: sub.applicant_no,
    password,
    email: sub.login_email.endsWith(".local") ? null : sub.login_email,
    email_note: emailNote,
    papers_uploaded: papersUploaded,
    notice: sub.email_in_use ? "This email already has an account, so sign in with your applicant number." : null,
  };
  return Response.json(body);
}
