-- Applicant Portal: public enrollment form (/apply), temporary applicant
-- accounts, follow-up requests, and promotion to student on "Assign ID".
--
-- Security model:
--   * The public form calls applicant_submit() as anon. It checks every field
--     again, has a honeypot and a simple rate limit (per IP and per email),
--     and returns the applicant number plus a one-time claim token.
--   * The server (app/api/apply/route.ts) then creates the auth user (service
--     role key, or signUp as a fallback) and calls applicant_link_account()
--     with that token. Only then does the applicant get a membership.
--   * Applicants read their own application through the existing rules
--     (students.user_id = auth.uid()). They change details only through
--     applicant_update_details(), and only while the status is 'applied'
--     (this includes "needs fix"). Every change writes a history row.
--   * applicant_requests rows are written only by the functions below.
--     The applicant (owner) and the registrar of the school can read them.
--   * When the student ID is made (status -> student_made), a trigger turns
--     the applicant membership into a student membership (same login).
--
-- New enum values cannot be used in the same transaction that adds them, so
-- nothing below casts 'applicant' or 'photo' when it is created: policies
-- compare role::text, and plpgsql bodies only use the values when they run.
-- The rules mirror lib/applicant (rules.ts, validate.ts, ids.ts). Keep both in step.

-- ---------- enums, columns ----------
alter type app_role add value if not exists 'applicant';
alter type doc_kind add value if not exists 'photo';

alter table students
  add column applicant_no text,        -- APP-2026-00012 (login name of the applicant)
  add column civil_status text,
  add column citizenship text,
  add column contact_no text,          -- 09XXXXXXXXX
  add column email text,
  add column address text,
  add column guardian_name text,
  add column guardian_contact text,
  add constraint students_applicant_no_key unique (school_id, applicant_no);

-- {source: 'online', signed_name, signed_at, signature (PNG data URL or null)}
alter table enrollments add column application jsonb;

alter table profiles add column must_change_password boolean not null default false;

-- The first history row of an online application is written before the
-- applicant has an account; applicant_link_account() fills in the actor.
alter table enrollment_history alter column actor_id drop not null;

-- ---------- tables ----------
-- Applicant numbers: one sequence per school and year.
create table applicant_counters (
  school_id uuid not null references schools(id) on delete cascade,
  year int not null,
  last_no int not null default 0,
  primary key (school_id, year)
);

-- Rate limit log for the public form (no policies: functions only).
create table applicant_submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id) on delete cascade,
  ip text,
  email text,
  created_at timestamptz not null default now()
);
create index on applicant_submissions (created_at);

-- One-time token that lets the server link the new auth user to the application.
create table applicant_claims (
  student_id uuid primary key references students(id) on delete cascade,
  token_hash text not null,
  login_email text not null,
  created_at timestamptz not null default now()
);

create table applicant_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  type text not null check (type in ('follow_up', 'change_request', 'question')),
  message text not null check (length(trim(message)) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  reply text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  replied_by uuid references auth.users(id) on delete set null,
  replied_by_name text,
  created_at timestamptz not null default now(),
  replied_at timestamptz,
  closed_at timestamptz
);
create index on applicant_requests (enrollment_id, created_at);
create index on applicant_requests (school_id, status);

alter table applicant_counters enable row level security;
alter table applicant_submissions enable row level security;
alter table applicant_claims enable row level security;
alter table applicant_requests enable row level security;

-- Read only. Rows come from the functions below.
create policy applicant_requests_read on applicant_requests for select
  using (owns_enrollment(enrollment_id) or has_role(school_id, '{registrar}'));

-- ---------- helpers ----------
create function applicant_full_name(s students) returns text language sql immutable as $$
  select concat_ws(' ', s.first_name, nullif(s.middle_name, ''), s.last_name);
$$;

create function applicant_is_mobile(p text) returns boolean language sql immutable as $$
  select coalesce(p, '') ~ '^09[0-9]{9}$';
$$;

-- "+63 917-123-4567" / "639171234567" / "0917 123 4567" -> "09171234567" (same as normalizePhone()).
create function applicant_phone(p text) returns text language sql immutable as $$
  select case
    when v ~ '^\+639[0-9]{9}$' then '0' || substr(v, 4)
    when v ~ '^639[0-9]{9}$' then '0' || substr(v, 3)
    else v end
  from (select regexp_replace(coalesce(p, ''), '[\s\-().]', '', 'g') as v) x;
$$;

-- ---------- public: form info ----------
-- The school (by code; null = the only school) and its open terms.
create function applicant_form_info(p_school_code text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school schools;
begin
  if nullif(trim(coalesce(p_school_code, '')), '') is null then
    if (select count(*) from schools) <> 1 then raise exception 'Please open the form link your school gave you (for example /apply/SA).'; end if;
    select * into v_school from schools limit 1;
  else
    select * into v_school from schools where upper(code) = upper(trim(p_school_code));
  end if;
  if v_school.id is null then raise exception 'No school with the code "%".', p_school_code; end if;
  return jsonb_build_object(
    'school', jsonb_build_object('id', v_school.id, 'name', v_school.name, 'code', v_school.code, 'logo_url', v_school.logo_url),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'school_id', t.school_id, 'school_year', t.school_year, 'semester', t.semester,
        'track', t.track, 'is_open', t.is_open, 'closed_at', t.closed_at) order by t.school_year, t.semester)
      from terms t where t.school_id = v_school.id and t.is_open), '[]'::jsonb)
  );
end $$;

-- ---------- public: submit the form ----------
-- Returns {enrollment_id, student_id, school_id, school_name, applicant_no, login_email,
--          email_in_use, full_name, claim_token}.
-- p_need_real_email: the server has no service role key, so the account must use a real,
-- unused email (Supabase signUp sends the confirmation there).
create function applicant_submit(
  p_school_code text, p_form jsonb, p_ip text default null, p_need_real_email boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_school schools; t terms; s students; e enrollments;
  v_email text := nullif(lower(trim(coalesce(p_form->>'email', ''))), '');
  v_ip text := nullif(trim(coalesce(p_ip, '')), '');
  v_track text := p_form->>'track';
  v_level text := nullif(trim(coalesce(p_form->>'level', '')), '');
  v_course text := nullif(trim(coalesce(p_form->>'course', '')), '');
  v_strand text := nullif(trim(coalesce(p_form->>'strand', '')), '');
  v_lrn text := nullif(trim(coalesce(p_form->>'lrn', '')), '');
  v_contact text := applicant_phone(p_form->>'contact_no');
  v_guardian_contact text := applicant_phone(p_form->>'guardian_contact');
  v_birth date;
  v_shs boolean;
  v_year int; v_no int; v_applicant_no text; v_login text; v_in_use boolean := false;
  v_token text; v_name text;
begin
  -- Honeypot: people never see this field; bots fill it in.
  if nullif(trim(coalesce(p_form->>'website', '')), '') is not null then
    raise exception 'Something went wrong. Please try again.';
  end if;

  if nullif(trim(coalesce(p_school_code, '')), '') is null then
    if (select count(*) from schools) <> 1 then raise exception 'Please open the form link your school gave you.'; end if;
    select * into v_school from schools limit 1;
  else
    select * into v_school from schools where upper(code) = upper(trim(p_school_code));
  end if;
  if v_school.id is null then raise exception 'School not found.'; end if;

  -- Rate limit: 20 forms per network per hour (a school computer lab shares one
  -- address), 3 per email per day.
  if v_ip is not null and (select count(*) from applicant_submissions
       where ip = v_ip and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many applications from this network. Please wait an hour and try again.';
  end if;
  if v_email is not null and (select count(*) from applicant_submissions
       where email = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Too many applications with this email today. Please try again tomorrow.';
  end if;

  -- Page 1
  if nullif(trim(coalesce(p_form->>'last_name', '')), '') is null then raise exception 'Please enter the last name.'; end if;
  if nullif(trim(coalesce(p_form->>'first_name', '')), '') is null then raise exception 'Please enter the first name.'; end if;
  begin
    v_birth := (p_form->>'birth_date')::date;
  exception when others then v_birth := null;
  end;
  if v_birth is null or v_birth >= current_date then raise exception 'Please check the birthdate.'; end if;
  if coalesce(p_form->>'sex', '') not in ('M', 'F') then raise exception 'Please pick Male or Female.'; end if;
  if not applicant_is_mobile(v_contact) then raise exception 'Use a PH mobile number like 09171234567.'; end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Please check the email address.'; end if;
  if nullif(trim(coalesce(p_form->>'address', '')), '') is null then raise exception 'Please enter the complete address.'; end if;
  if nullif(trim(coalesce(p_form->>'guardian_name', '')), '') is null then raise exception 'Please enter the guardian''s name.'; end if;
  if not applicant_is_mobile(v_guardian_contact) then raise exception 'Use a PH mobile number like 09171234567 for the guardian.'; end if;

  -- Page 2
  begin
    select * into t from terms
      where id = (p_form->>'term_id')::uuid and school_id = v_school.id and is_open and track::text = v_track;
  exception when others then t := null;
  end;
  if t.id is null then raise exception 'Please pick the school year and semester.'; end if;
  if v_level is null then raise exception 'Please pick the level.'; end if;
  if coalesce(p_form->>'student_type', '') not in ('new', 'transferee', 'returnee', 'continuing') then
    raise exception 'Please pick the student type.';
  end if;
  v_shs := v_level in ('Grade 11', 'Grade 12');
  if v_track = 'college' and v_course is null then raise exception 'Please pick a course.'; end if;
  if v_track = 'k12' and v_shs and v_strand is null then raise exception 'Please pick a strand for senior high.'; end if;
  if v_track = 'k12' and v_lrn is not null and v_lrn !~ '^[0-9]{12}$' then raise exception 'The LRN has 12 digits.'; end if;

  -- Page 4
  if coalesce((p_form->>'certify')::boolean, false) is not true then raise exception 'Please tick the box to confirm.'; end if;
  if length(trim(coalesce(p_form->>'signed_name', ''))) < 3 then raise exception 'Please type your full name as your signature.'; end if;

  -- The account email: the applicant's own, or a made-up one from the applicant number.
  if v_email is not null and exists (select 1 from auth.users where lower(email) = v_email) then
    if p_need_real_email then
      raise exception 'This email already has an account. Sign in to the applicant portal, or use another email.';
    end if;
    v_in_use := true;
  end if;
  if v_email is null and p_need_real_email then
    raise exception 'Please give an email address. We use it to make your account.';
  end if;

  v_year := left(t.school_year, 4)::int;
  insert into applicant_counters as c (school_id, year, last_no) values (v_school.id, v_year, 1)
    on conflict (school_id, year) do update set last_no = c.last_no + 1
    returning last_no into v_no;
  -- Never reuse a number that is already taken (e.g. typed in by hand).
  while exists (select 1 from students where school_id = v_school.id
                and applicant_no = 'APP-' || v_year || '-' || lpad(v_no::text, 5, '0')) loop
    update applicant_counters set last_no = last_no + 1 where school_id = v_school.id and year = v_year returning last_no into v_no;
  end loop;
  v_applicant_no := 'APP-' || v_year || '-' || lpad(v_no::text, 5, '0');
  v_login := case when v_email is not null and not v_in_use then v_email
                  else lower(v_applicant_no) || '@applicants.' || lower(v_school.code) || '.local' end;

  insert into students (school_id, lrn, first_name, middle_name, last_name, birth_date, sex, applicant_no,
                        civil_status, citizenship, contact_no, email, address, guardian_name, guardian_contact)
  values (v_school.id, case when v_track = 'k12' then v_lrn end,
          trim(p_form->>'first_name'), nullif(trim(coalesce(p_form->>'middle_name', '')), ''), trim(p_form->>'last_name'),
          v_birth, p_form->>'sex', v_applicant_no,
          nullif(trim(coalesce(p_form->>'civil_status', '')), ''), nullif(trim(coalesce(p_form->>'citizenship', '')), ''),
          v_contact, v_email, trim(p_form->>'address'), trim(p_form->>'guardian_name'), v_guardian_contact)
  returning * into s;
  v_name := applicant_full_name(s);

  insert into enrollments (school_id, term_id, student_id, track, status, level, course, strand, student_type,
                           esc_voucher, mother_tongue, ip_group, is_4ps, tuition_plan, application)
  values (v_school.id, t.id, s.id, t.track, 'applied', v_level,
          case when v_track = 'college' then v_course end,
          case when v_track = 'k12' and v_shs then v_strand end,
          (p_form->>'student_type')::student_kind,
          v_track = 'k12' and coalesce((p_form->>'esc_voucher')::boolean, false),
          case when v_track = 'k12' then nullif(trim(coalesce(p_form->>'mother_tongue', '')), '') end,
          case when v_track = 'k12' then nullif(trim(coalesce(p_form->>'ip_group', '')), '') end,
          v_track = 'k12' and coalesce((p_form->>'is_4ps')::boolean, false),
          case when v_track = 'k12' then coalesce(nullif(p_form->>'tuition_plan', ''), 'annual')::tuition_plan end,
          jsonb_build_object('source', 'online', 'signed_name', trim(p_form->>'signed_name'), 'signed_at', now(),
                             'signature', case when left(coalesce(p_form->>'signature', ''), 22) = 'data:image/png;base64,'
                                                and length(p_form->>'signature') < 200000 then p_form->>'signature' end))
  returning * into e;

  insert into enrollment_history (school_id, enrollment_id, from_status, to_status, action, reason, actor_id, actor_name)
  values (v_school.id, e.id, null, 'applied', 'submit', 'Online application form (' || v_applicant_no || ')', null, v_name || ' (applicant)');

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into applicant_claims (student_id, token_hash, login_email)
  values (s.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_login);

  insert into applicant_submissions (school_id, ip, email) values (v_school.id, v_ip, v_email);

  return jsonb_build_object(
    'enrollment_id', e.id, 'student_id', s.id, 'school_id', v_school.id, 'school_name', v_school.name,
    'applicant_no', v_applicant_no, 'login_email', v_login, 'email_in_use', v_in_use,
    'full_name', v_name, 'claim_token', v_token);
end $$;

-- ---------- server: link the new auth user to the application ----------
create function applicant_link_account(p_student uuid, p_token text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c applicant_claims; s students; v_email text;
begin
  select * into c from applicant_claims where student_id = p_student for update;
  if c.student_id is null or c.token_hash <> encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') then
    raise exception 'This link is not valid.';
  end if;
  if c.created_at < now() - interval '1 hour' then raise exception 'This link has expired.'; end if;
  select lower(email) into v_email from auth.users where id = p_user;
  if v_email is null or v_email <> c.login_email then raise exception 'This account does not match the application.'; end if;
  select * into s from students where id = p_student;
  if s.user_id is not null then raise exception 'This application already has an account.'; end if;

  update students set user_id = p_user where id = s.id;
  insert into memberships (user_id, school_id, role) values (p_user, s.school_id, 'applicant')
    on conflict (user_id, school_id, role) do nothing;
  insert into profiles (id, full_name, email, must_change_password)
    values (p_user, applicant_full_name(s), v_email, true)
    on conflict (id) do update set full_name = excluded.full_name, must_change_password = true;
  update enrollment_history set actor_id = p_user
    where actor_id is null and action = 'submit'
      and enrollment_id in (select id from enrollments where student_id = s.id);
  delete from applicant_claims where student_id = s.id;
end $$;

-- ---------- public: login name -> auth email ----------
-- Lets people sign in with an applicant number (APP-2026-00012) or a student
-- number (SA-2026-0005) instead of an email. Returns null when not found.
create function login_email(p_login text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when position('@' in coalesce(p_login, '')) > 0 then lower(trim(p_login))
    else (
      select lower(u.email) from students s join auth.users u on u.id = s.user_id
      where upper(s.applicant_no) = upper(trim(p_login)) or upper(s.student_no) = upper(trim(p_login))
      order by s.created_at desc limit 1)
  end;
$$;

-- ---------- applicant: password changed ----------
create function applicant_password_changed() returns void
language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid();
$$;

-- ---------- applicant: update own details (only while 'applied') ----------
-- p_student / p_fields: only the keys that change. Returns the history summary.
create function applicant_update_details(p_enrollment uuid, p_student jsonb, p_fields jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  e enrollments; s students; s2 students; e2 enrollments; v_parts text[] := '{}'; k text; v_old text; v_new text;
  v_student_keys text[] := array['last_name', 'first_name', 'middle_name', 'birth_date', 'sex', 'civil_status', 'citizenship',
                                 'contact_no', 'email', 'address', 'guardian_name', 'guardian_contact', 'lrn'];
  v_enrollment_keys text[] := array['course', 'level', 'strand', 'student_type', 'esc_voucher', 'mother_tongue',
                                    'ip_group', 'is_4ps', 'tuition_plan'];
  v_s jsonb := '{}'; v_e jsonb := '{}';
  v_label jsonb := '{"last_name": "Last name", "first_name": "First name", "middle_name": "Middle name",
    "birth_date": "Birthdate", "sex": "Gender", "civil_status": "Civil status", "citizenship": "Citizenship",
    "contact_no": "Contact number", "email": "Email", "address": "Address", "guardian_name": "Guardian name",
    "guardian_contact": "Guardian number", "lrn": "LRN", "course": "Course", "level": "Level", "strand": "Strand",
    "student_type": "Student type", "esc_voucher": "ESC / voucher", "mother_tongue": "Mother tongue",
    "ip_group": "IP group", "is_4ps": "4Ps", "tuition_plan": "Tuition plan"}';
begin
  select * into e from enrollments where id = p_enrollment for update;
  if e.id is null or not owns_enrollment(e.id) then raise exception 'Enrollment not found.'; end if;
  if e.status <> 'applied' then
    raise exception 'Your papers were already checked, so your details are locked. Send a Change request to the registrar.';
  end if;
  select * into s from students where id = e.student_id for update;

  -- Keep only the allowed keys; empty text means "clear".
  for k in select jsonb_object_keys(coalesce(p_student, '{}')) loop
    if k = any (v_student_keys) then
      v_s := v_s || jsonb_build_object(k, case when jsonb_typeof(p_student->k) = 'string' and trim(p_student->>k) = '' then null
                                               when k in ('contact_no', 'guardian_contact') then to_jsonb(applicant_phone(p_student->>k))
                                               when k = 'email' then to_jsonb(lower(trim(p_student->>k)))
                                               else p_student->k end);
    end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(p_fields, '{}')) loop
    if k = any (v_enrollment_keys) then
      v_e := v_e || jsonb_build_object(k, case when jsonb_typeof(p_fields->k) = 'string' and trim(p_fields->>k) = '' then null
                                               else p_fields->k end);
    end if;
  end loop;

  s2 := jsonb_populate_record(s, v_s);
  e2 := jsonb_populate_record(e, v_e);
  if coalesce(trim(s2.first_name), '') = '' or coalesce(trim(s2.last_name), '') = '' then
    raise exception 'The first and last name cannot be empty.';
  end if;
  if s2.contact_no is not null and not applicant_is_mobile(s2.contact_no) then raise exception 'Use a PH mobile number like 09171234567.'; end if;
  if s2.guardian_contact is not null and not applicant_is_mobile(s2.guardian_contact) then
    raise exception 'Use a PH mobile number like 09171234567 for the guardian.';
  end if;
  if s2.email is not null and s2.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Please check the email address.'; end if;
  if s2.lrn is not null and s2.lrn !~ '^[0-9]{12}$' then raise exception 'The LRN has 12 digits.'; end if;
  if s2.sex is not null and s2.sex not in ('M', 'F') then raise exception 'Please pick Male or Female.'; end if;
  if coalesce(e2.level, '') = '' then raise exception 'Please pick a level.'; end if;
  if e2.track = 'college' and coalesce(e2.course, '') = '' then raise exception 'Please pick a course.'; end if;

  foreach k in array v_student_keys loop
    v_old := to_jsonb(s)->>k; v_new := to_jsonb(s2)->>k;
    if v_old is distinct from v_new then
      v_parts := v_parts || ((v_label->>k) || ': ' || coalesce(v_old, '—') || ' → ' || coalesce(v_new, '—'));
    end if;
  end loop;
  foreach k in array v_enrollment_keys loop
    v_old := to_jsonb(e)->>k; v_new := to_jsonb(e2)->>k;
    if v_old is distinct from v_new then
      v_parts := v_parts || ((v_label->>k) || ': '
        || coalesce(case v_old when 'true' then 'Yes' when 'false' then 'No' else v_old end, '—') || ' → '
        || coalesce(case v_new when 'true' then 'Yes' when 'false' then 'No' else v_new end, '—'));
    end if;
  end loop;
  if cardinality(v_parts) = 0 then raise exception 'Nothing changed.'; end if;

  update students set last_name = s2.last_name, first_name = s2.first_name, middle_name = s2.middle_name,
    birth_date = s2.birth_date, sex = s2.sex, civil_status = s2.civil_status, citizenship = s2.citizenship,
    contact_no = s2.contact_no, email = s2.email, address = s2.address, guardian_name = s2.guardian_name,
    guardian_contact = s2.guardian_contact, lrn = s2.lrn
  where id = s.id;
  update enrollments set course = e2.course, level = e2.level, strand = e2.strand, student_type = e2.student_type,
    esc_voucher = e2.esc_voucher, mother_tongue = e2.mother_tongue, ip_group = e2.ip_group, is_4ps = e2.is_4ps,
    tuition_plan = e2.tuition_plan, updated_at = now()
  where id = e.id;
  insert into enrollment_history (school_id, enrollment_id, from_status, to_status, action, reason, actor_id, actor_name)
  values (e.school_id, e.id, e.status, e.status, 'update_details', array_to_string(v_parts, '; '), auth.uid(),
          fees_actor_name(e.school_id));
  return array_to_string(v_parts, '; ');
end $$;

-- ---------- follow-up requests ----------
create function applicant_request_create(p_enrollment uuid, p_type text, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e enrollments; v_id uuid; v_msg text := trim(coalesce(p_message, ''));
begin
  select * into e from enrollments where id = p_enrollment;
  if e.id is null or not owns_enrollment(e.id) then raise exception 'Enrollment not found.'; end if;
  if e.status in ('rejected', 'withdrawn') then raise exception 'This application is closed.'; end if;
  if p_type not in ('follow_up', 'change_request', 'question') then raise exception 'Pick a request type.'; end if;
  if v_msg = '' then raise exception 'Please type your message.'; end if;
  if length(v_msg) > 1000 then raise exception 'Keep the message under 1000 characters.'; end if;
  if (select count(*) from applicant_requests where enrollment_id = e.id and status = 'open') >= 5 then
    raise exception 'You already have 5 requests waiting. Please wait for a reply.';
  end if;
  insert into applicant_requests (school_id, enrollment_id, type, message, created_by, created_by_name)
  values (e.school_id, e.id, p_type, v_msg, auth.uid(), fees_actor_name(e.school_id))
  returning id into v_id;
  update enrollments set updated_at = now() where id = e.id;
  return v_id;
end $$;

create function applicant_request_answer(p_request uuid, p_reply text, p_close boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r applicant_requests; v_reply text := trim(coalesce(p_reply, ''));
begin
  select * into r from applicant_requests where id = p_request for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not has_role(r.school_id, '{registrar}') then raise exception 'Only the registrar can reply to requests.'; end if;
  if r.status = 'closed' then raise exception 'This request is already closed.'; end if;
  if v_reply = '' then raise exception 'Please type a reply.'; end if;
  update applicant_requests set
    reply = v_reply, replied_by = auth.uid(), replied_by_name = fees_actor_name(r.school_id), replied_at = now(),
    status = case when p_close then 'closed' else 'answered' end,
    closed_at = case when p_close then now() end
  where id = r.id;
end $$;

create function applicant_request_close(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r applicant_requests;
begin
  select * into r from applicant_requests where id = p_request for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not (has_role(r.school_id, '{registrar}') or owns_enrollment(r.enrollment_id)) then
    raise exception 'You cannot close this request.';
  end if;
  if r.status = 'closed' then raise exception 'This request is already closed.'; end if;
  update applicant_requests set status = 'closed', closed_at = now() where id = r.id;
end $$;

-- ---------- promotion: applicant -> student when the student ID is made ----------
create function applicant_promote() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if new.status in ('student_made', 'load_set', 'assessed_paid', 'officially_enrolled')
     and old.status in ('applied', 'papers_checked') then
    select user_id into v_user from students where id = new.student_id;
    if v_user is not null then
      if exists (select 1 from memberships where user_id = v_user and school_id = new.school_id and role::text = 'student') then
        delete from memberships where user_id = v_user and school_id = new.school_id and role::text = 'applicant';
      else
        update memberships set role = 'student' where user_id = v_user and school_id = new.school_id and role::text = 'applicant';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger enrollments_promote_applicant after update of status on enrollments
  for each row execute function applicant_promote();

-- ---------- grants ----------
-- The public form and the login box run without a session (anon).
grant execute on function applicant_form_info(text) to anon, authenticated;
grant execute on function applicant_submit(text, jsonb, text, boolean) to anon, authenticated;
grant execute on function applicant_link_account(uuid, text, uuid) to anon, authenticated;
grant execute on function login_email(text) to anon, authenticated;
-- Signed-in only.
revoke execute on function applicant_password_changed() from public, anon;
revoke execute on function applicant_update_details(uuid, jsonb, jsonb) from public, anon;
revoke execute on function applicant_request_create(uuid, text, text) from public, anon;
revoke execute on function applicant_request_answer(uuid, text, boolean) from public, anon;
revoke execute on function applicant_request_close(uuid) from public, anon;
grant execute on function applicant_password_changed() to authenticated;
grant execute on function applicant_update_details(uuid, jsonb, jsonb) to authenticated;
grant execute on function applicant_request_create(uuid, text, text) to authenticated;
grant execute on function applicant_request_answer(uuid, text, boolean) to authenticated;
grant execute on function applicant_request_close(uuid) to authenticated;
-- Internal.
revoke execute on function applicant_promote() from public, anon, authenticated;
