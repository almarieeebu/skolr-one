-- Security fixes for real users.
--
-- 1. Signing in with an applicant or student number no longer tells anyone the
--    email behind the number. login_email(p_login, p_password) returns the email
--    only when the password is right, and null otherwise (the same answer for an
--    unknown number and a wrong password). The old login_email(p_login) is dropped.
--    10 wrong tries for one number within 15 minutes lock number sign-in for that
--    number for 15 minutes (email sign-in still works).
-- 2. All-or-nothing saves: each user action that wrote several rows from the
--    browser is now ONE database function, so it is saved completely or not at all:
--      enrollment_create   new application (student, parent link, enrollment, history)
--      enrollment_apply    a step of the enrollment (student no., papers, load, status, fees, history)
--      document_record     an uploaded paper (document row + history)
--      fees_save_setup     a fee setup and the lab fee / major flag of its subjects
--      grades_save_draft   a grade sheet draft (sheet, activities, grades)
--    They check the same roles as the row security rules they replace.
--
-- Safe to run on a database that already has 0001-0004 (it keeps all data).

-- ---------- 1. sign in with a number ----------
drop function if exists login_email(text);

-- Wrong tries per login name (no policies: functions only).
create table if not exists login_failures (
  login text not null,
  created_at timestamptz not null default now()
);
create index if not exists login_failures_login on login_failures (login, created_at);
create index if not exists login_failures_created on login_failures (created_at);
alter table login_failures enable row level security;
revoke all on login_failures from anon, authenticated;

-- pgcrypto lives in "extensions" on Supabase and in "public" on a plain Postgres:
-- the search path covers both.
create or replace function login_email(p_login text, p_password text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_login text := upper(trim(coalesce(p_login, '')));
  v_email text;
  v_hash text;
begin
  if v_login = '' or position('@' in v_login) > 0 or coalesce(p_password, '') = '' then return null; end if;
  if (select count(*) from login_failures
      where login = v_login and created_at > now() - interval '15 minutes') >= 10 then
    return null;
  end if;
  select lower(u.email), u.encrypted_password into v_email, v_hash
    from students s join auth.users u on u.id = s.user_id
    where upper(s.applicant_no) = v_login or upper(s.student_no) = v_login
    order by s.created_at desc limit 1;
  if coalesce(v_hash, '') <> '' and crypt(p_password, v_hash) = v_hash then
    delete from login_failures where login = v_login;
    return v_email;
  end if;
  -- Unknown number: do the same slow check, so the answer takes as long.
  if coalesce(v_hash, '') = '' then
    perform crypt(p_password, '$2a$10$TX.yiVifgVc7T8iYxxqYcux6B7cuPYce7NL4WZWrN95mv02pKl5Sy');
  end if;
  insert into login_failures (login) values (v_login);
  delete from login_failures where created_at < now() - interval '1 day';
  return null;
end $$;

revoke execute on function login_email(text, text) from public;
grant execute on function login_email(text, text) to anon, authenticated;

-- ---------- 2a. new application ----------
-- p_as: the role the user works as ('registrar', 'student', 'parent', ...).
-- p_student: {lrn, first_name, middle_name, last_name, birth_date, sex} (new student only).
-- p_fields: {track, level, course, strand, student_type, esc_voucher, mother_tongue, ip_group, is_4ps, tuition_plan}.
create or replace function enrollment_create(
  p_term uuid, p_existing_student uuid, p_as text, p_student jsonb, p_fields jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare t terms; s students; v_id uuid; v_returning boolean;
begin
  select * into t from terms where id = p_term;
  if t.id is null or not is_member(t.school_id) then raise exception 'Term not found.'; end if;

  if p_existing_student is not null then
    select * into s from students where id = p_existing_student;
    if s.id is null or s.school_id <> t.school_id or not can_see_student(s.id) then raise exception 'Student not found.'; end if;
  else
    -- Same rule as the students insert policy: the registrar, or a student / parent adding themselves / their child.
    if not (has_role(t.school_id, '{registrar}')
            or (p_as = 'student' and has_role(t.school_id, '{student}'))
            or (p_as = 'parent' and has_role(t.school_id, '{parent}'))) then
      raise exception 'You cannot add a student.';
    end if;
    insert into students (school_id, lrn, first_name, middle_name, last_name, birth_date, sex, user_id, guardian_user_id)
    values (t.school_id, nullif(p_student->>'lrn', ''), p_student->>'first_name', nullif(p_student->>'middle_name', ''),
            p_student->>'last_name', nullif(p_student->>'birth_date', '')::date, nullif(p_student->>'sex', ''),
            case when p_as = 'student' then auth.uid() end, case when p_as = 'parent' then auth.uid() end)
    returning * into s;
    if p_as = 'parent' then
      insert into parent_links (school_id, parent_user_id, student_id) values (t.school_id, auth.uid(), s.id);
    end if;
  end if;

  v_returning := s.student_no is not null;
  insert into enrollments (school_id, term_id, student_id, track, status, level, course, strand, student_type,
                           esc_voucher, mother_tongue, ip_group, is_4ps, tuition_plan)
  values (t.school_id, t.id, s.id, (p_fields->>'track')::track_kind,
          case when v_returning then 'student_made' else 'applied' end::enrollment_status,
          p_fields->>'level', p_fields->>'course', p_fields->>'strand',
          coalesce(p_fields->>'student_type', 'new')::student_kind,
          coalesce((p_fields->>'esc_voucher')::boolean, false), p_fields->>'mother_tongue', p_fields->>'ip_group',
          coalesce((p_fields->>'is_4ps')::boolean, false), (p_fields->>'tuition_plan')::tuition_plan)
  returning id into v_id;

  insert into enrollment_history (school_id, enrollment_id, from_status, to_status, action, reason, actor_id, actor_name)
  values (t.school_id, v_id, null, case when v_returning then 'student_made' else 'applied' end::enrollment_status,
          case when v_returning then 'returning' else 'submit' end,
          case when v_returning then 'Returning student - starts at the load step' end,
          auth.uid(), fees_actor_name(t.school_id));
  return v_id;
end $$;

-- ---------- 2b. one step of an enrollment ----------
-- The plan comes from lib/enrollment (planAction); this saves it in one go.
-- p_student:  {student_no} or null.        p_check_docs: mark every paper checked.
-- p_loads:    the new load (null = keep).  p_fields: {status, fix_note, dean_approved, overrides}.
-- p_assess:   work out the fees again.     p_history: {from_status, to_status, action, reason}.
create or replace function enrollment_apply(
  p_enrollment uuid, p_student jsonb, p_check_docs boolean, p_loads uuid[], p_fields jsonb,
  p_assess boolean, p_history jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  e enrollments; e2 enrollments; v_registrar boolean; v_owner boolean; k text;
begin
  select * into e from enrollments where id = p_enrollment for update;
  if e.id is null or not can_see_enrollment(e.id) then raise exception 'Enrollment not found.'; end if;
  if p_history->>'from_status' is not null and e.status::text <> p_history->>'from_status' then
    raise exception 'Someone else changed this enrollment just now. Reload and try again.';
  end if;
  v_registrar := has_role(e.school_id, '{registrar}');
  v_owner := owns_enrollment(e.id);

  -- Student number (assign ID): registrar only.
  if p_student is not null and p_student <> '{}'::jsonb then
    if not v_registrar then raise exception 'Only the registrar can change the student record.'; end if;
    update students set student_no = coalesce(p_student->>'student_no', student_no) where id = e.student_id;
  end if;

  -- Papers: registrar, or the owner while the application is at "Applied".
  if coalesce(p_check_docs, false) then
    if not (v_registrar or (v_owner and e.status = 'applied')) then raise exception 'You cannot check these papers.'; end if;
    update documents set checked = true where enrollment_id = e.id;
  end if;

  -- Load: registrar, or the student / parent while picking a load.
  if p_loads is not null then
    if not (v_registrar or (v_owner and e.status in ('student_made', 'load_set'))) then
      raise exception 'You cannot change this load.';
    end if;
    if exists (select 1 from unnest(p_loads) x(id) left join offerings o on o.id = x.id
               where o.id is null or o.term_id <> e.term_id) then
      raise exception 'Pick classes of this term only.';
    end if;
    delete from enrollment_loads where enrollment_id = e.id;
    insert into enrollment_loads (school_id, enrollment_id, offering_id)
      select e.school_id, e.id, x.id from (select distinct unnest(p_loads) as id) x;
  end if;

  -- Status and flags: staff, or the owner setting the load.
  for k in select jsonb_object_keys(coalesce(p_fields, '{}')) loop
    if k not in ('status', 'fix_note', 'dean_approved', 'overrides', 'updated_at') then
      raise exception 'Unknown field %.', k;
    end if;
  end loop;
  e2 := jsonb_populate_record(e, coalesce(p_fields, '{}') - 'updated_at');
  if not is_staff(e.school_id) then
    if not (v_owner and e.status in ('student_made', 'load_set') and e2.status = 'load_set'
            and e2.fix_note is not distinct from e.fix_note and e2.dean_approved = e.dean_approved
            and e2.overrides = e.overrides) then
      raise exception 'You cannot change this enrollment.';
    end if;
  end if;
  update enrollments set status = e2.status, fix_note = e2.fix_note, dean_approved = e2.dean_approved,
    overrides = coalesce(e2.overrides, '[]'::jsonb), updated_at = now()
  where id = e.id;

  -- Charges are worked out from the saved load (fees_assess checks the role again).
  if coalesce(p_assess, false) then perform fees_assess(e.id); end if;

  insert into enrollment_history (school_id, enrollment_id, from_status, to_status, action, reason, actor_id, actor_name)
  values (e.school_id, e.id, e.status, e2.status, coalesce(p_history->>'action', 'update'),
          nullif(p_history->>'reason', ''), auth.uid(), fees_actor_name(e.school_id));
end $$;

-- ---------- 2c. an uploaded paper ----------
-- The file is uploaded to storage first (path '{school_id}/{enrollment_id}/...'); this records it.
create or replace function document_record(
  p_enrollment uuid, p_type text, p_file_name text, p_path text, p_label text
) returns void
language plpgsql security definer set search_path = public as $$
declare e enrollments;
begin
  select * into e from enrollments where id = p_enrollment for update;
  if e.id is null or not can_see_enrollment(e.id) then raise exception 'Enrollment not found.'; end if;
  -- Same rule as the documents policy.
  if not (has_role(e.school_id, '{registrar}') or (owns_enrollment(e.id) and e.status = 'applied')) then
    raise exception 'Papers can only be changed while the application is at "Applied".';
  end if;
  if coalesce(p_path, '') not like e.school_id || '/' || e.id || '/%' then raise exception 'Upload the file again.'; end if;
  insert into documents (school_id, enrollment_id, type, file_name, file_path, checked, uploaded_at)
  values (e.school_id, e.id, p_type::doc_kind, p_file_name, p_path, false, now())
  on conflict (enrollment_id, type) do update
    set file_name = excluded.file_name, file_path = excluded.file_path, checked = false, uploaded_at = excluded.uploaded_at;
  insert into enrollment_history (school_id, enrollment_id, from_status, to_status, action, reason, actor_id, actor_name)
  values (e.school_id, e.id, e.status, e.status, 'upload_paper',
          coalesce(nullif(p_label, ''), p_type) || ' uploaded (' || coalesce(p_file_name, '') || ')',
          auth.uid(), fees_actor_name(e.school_id));
end $$;

-- ---------- 2d. fee setup (registrar) ----------
-- p_setup: a fee_setups row (no id = new). p_subjects: [{id, lab_fee, is_major}].
create or replace function fees_save_setup(p_setup jsonb, p_subjects jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v fee_setups; t terms; v_id uuid := nullif(p_setup->>'id', '')::uuid; v_school uuid;
begin
  v := jsonb_populate_record(null::fee_setups, p_setup);
  select * into t from terms where id = v.term_id;
  if t.id is null or not has_role(t.school_id, '{registrar}') then raise exception 'Only the registrar can change fee setups.'; end if;
  v_school := t.school_id;
  if v_id is not null then
    update fee_setups set term_id = v.term_id, track = v.track, scope_course = v.scope_course, scope_level = v.scope_level,
      min_downpayment = v.min_downpayment, misc_items = coalesce(v.misc_items, '[]'), rate_per_unit = v.rate_per_unit,
      major_rate_per_unit = v.major_rate_per_unit, exam_periods = coalesce(v.exam_periods, '[]'), plans = coalesce(v.plans, '[]'),
      esc_amount = v.esc_amount, shs_voucher_amount = v.shs_voucher_amount, updated_at = now()
    where id = v_id and school_id = v_school;
    if not found then raise exception 'Fee setup not found.'; end if;
  else
    insert into fee_setups (school_id, term_id, track, scope_course, scope_level, min_downpayment, misc_items,
                            rate_per_unit, major_rate_per_unit, exam_periods, plans, esc_amount, shs_voucher_amount)
    values (v_school, v.term_id, v.track, v.scope_course, v.scope_level, coalesce(v.min_downpayment, 0),
            coalesce(v.misc_items, '[]'), coalesce(v.rate_per_unit, 0), coalesce(v.major_rate_per_unit, 0),
            coalesce(v.exam_periods, '[]'), coalesce(v.plans, '[]'), coalesce(v.esc_amount, 0), coalesce(v.shs_voucher_amount, 0))
    returning id into v_id;
  end if;
  update offerings o set lab_fee = coalesce(x.lab_fee, 0), is_major = coalesce(x.is_major, false)
    from jsonb_to_recordset(coalesce(p_subjects, '[]')) as x(id uuid, lab_fee numeric, is_major boolean)
    where o.id = x.id and o.school_id = v_school;
  return v_id;
end $$;

-- ---------- 2e. grade sheet draft (teacher of the class) ----------
-- p_items: [{id, component, label, max_score, position}] (K to 12 activities; the rest are removed).
-- p_entries: [{enrollment_id, percent, mark, scores, domains}].
-- The guards of 0003 still apply: a submitted or posted sheet stays locked.
create or replace function grades_save_draft(
  p_offering uuid, p_period text, p_learning_area text, p_subject_group text, p_items jsonb, p_entries jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare o offerings; s grade_sheets; v_bad uuid;
begin
  select * into o from offerings where id = p_offering;
  if o.id is null or not is_member(o.school_id) then raise exception 'Class not found.'; end if;
  if o.teacher_id is distinct from auth.uid() then raise exception 'Only the teacher of this class can type grades.'; end if;

  select * into s from grade_sheets
    where offering_id = o.id and period = p_period and coalesce(learning_area, '') = coalesce(p_learning_area, '')
    for update;
  if s.id is null then
    insert into grade_sheets (school_id, term_id, offering_id, learning_area, subject_group, period, teacher_id)
    values (o.school_id, o.term_id, o.id, p_learning_area, p_subject_group, p_period, auth.uid())
    returning * into s;
  else
    if s.status not in ('draft', 'returned') then
      raise exception 'These grades are % and locked. Ask for a grade change instead.', s.status;
    end if;
    update grade_sheets set updated_at = now() where id = s.id;
  end if;

  -- Activities first: the database works out each grade from them.
  select x.id into v_bad
    from jsonb_to_recordset(coalesce(p_items, '[]')) as x(id uuid)
    join k12_score_items i on i.id = x.id and i.sheet_id <> s.id limit 1;
  if v_bad is not null then raise exception 'This activity belongs to another grade sheet.'; end if;
  delete from k12_score_items
    where sheet_id = s.id
      and id not in (select x.id from jsonb_to_recordset(coalesce(p_items, '[]')) as x(id uuid) where x.id is not null);
  insert into k12_score_items (id, school_id, sheet_id, component, label, max_score, position)
    select coalesce(x.id, gen_random_uuid()), s.school_id, s.id, x.component, coalesce(x.label, ''), coalesce(x.max_score, 0),
           coalesce(x.position, 0)
    from jsonb_to_recordset(coalesce(p_items, '[]'))
      as x(id uuid, component text, label text, max_score numeric, position int)
  on conflict (id) do update
    set component = excluded.component, label = excluded.label, max_score = excluded.max_score, position = excluded.position;

  select x.enrollment_id into v_bad
    from jsonb_to_recordset(coalesce(p_entries, '[]')) as x(enrollment_id uuid)
    where not grades_in_class(s.id, x.enrollment_id) limit 1;
  if v_bad is not null then raise exception 'A student in this list is not in this class.'; end if;
  insert into grade_entries (school_id, sheet_id, enrollment_id, percent, mark, scores, domains)
    select s.school_id, s.id, x.enrollment_id, x.percent, x.mark, coalesce(x.scores, '{}'), coalesce(x.domains, '{}')
    from jsonb_to_recordset(coalesce(p_entries, '[]'))
      as x(enrollment_id uuid, percent numeric, mark text, scores jsonb, domains jsonb)
  on conflict (sheet_id, enrollment_id) do update
    set percent = excluded.percent, mark = excluded.mark, scores = excluded.scores, domains = excluded.domains;
  return s.id;
end $$;

-- ---------- grants ----------
-- Signed-in only (each function checks the role itself).
revoke execute on function enrollment_create(uuid, uuid, text, jsonb, jsonb) from public, anon;
revoke execute on function enrollment_apply(uuid, jsonb, boolean, uuid[], jsonb, boolean, jsonb) from public, anon;
revoke execute on function document_record(uuid, text, text, text, text) from public, anon;
revoke execute on function fees_save_setup(jsonb, jsonb) from public, anon;
revoke execute on function grades_save_draft(uuid, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function enrollment_create(uuid, uuid, text, jsonb, jsonb) to authenticated;
grant execute on function enrollment_apply(uuid, jsonb, boolean, uuid[], jsonb, boolean, jsonb) to authenticated;
grant execute on function document_record(uuid, text, text, text, text) to authenticated;
grant execute on function fees_save_setup(jsonb, jsonb) to authenticated;
grant execute on function grades_save_draft(uuid, text, text, text, jsonb, jsonb) to authenticated;
