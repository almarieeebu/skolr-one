-- Grades module: grade settings, grade sheets (one class + one period or
-- quarter + one learning area), entries, K to 12 score items, change grade
-- requests, history and the DepEd transmutation table.
--
-- Security model:
--   * Teachers write DRAFTS of their own classes only (RLS below). A guard
--     trigger stops anyone from changing a sheet's status, late flag or
--     posting fields directly: only the functions below may do that.
--   * Submit / approve / return / allow late, change requests and their
--     decisions go through SECURITY DEFINER functions that check the role
--     first and write a history row in the same transaction.
--   * The stored grade of an entry is worked out here (trigger), from the
--     percent or the WW / PT / QA scores, so the browser cannot choose it.
--   * Students and parents read only POSTED grades of their own enrollments.
--     The registrar and the dean read everything in the school.
--
-- The rules mirror lib/grades (college.ts, k12.ts, workflow.ts). Keep both in step.

-- ---------- columns, enums ----------
alter table offerings add column non_credit boolean not null default false;  -- e.g. NSTP: left out of the GWA

create type grade_sheet_status as enum ('draft', 'returned', 'submitted', 'posted');

-- ---------- tables ----------
create table grade_settings (
  school_id uuid primary key references schools(id) on delete cascade,
  college_average text not null default 'all_four' check (college_average in ('all_four', 'present', 'final_only')),
  period_weights jsonb not null default '{"prelim": 25, "midterm": 25, "semifinal": 25, "final": 25}'::jsonb,
  block_average_on_inc boolean not null default true,
  gwa_decimals int not null default 2 check (gwa_decimals between 0 and 4),
  passing_grade numeric not null default 3.00,
  -- [{min, max, grade}] whole percents, inclusive
  college_scale jsonb not null default '[
    {"min": 97, "max": 100, "grade": 1.00}, {"min": 94, "max": 96, "grade": 1.25},
    {"min": 91, "max": 93, "grade": 1.50}, {"min": 88, "max": 90, "grade": 1.75},
    {"min": 85, "max": 87, "grade": 2.00}, {"min": 82, "max": 84, "grade": 2.25},
    {"min": 79, "max": 81, "grade": 2.50}, {"min": 76, "max": 78, "grade": 2.75},
    {"min": 75, "max": 75, "grade": 3.00}, {"min": 0, "max": 74, "grade": 5.00}]'::jsonb,
  -- DO 8 s. 2015 weights per subject group
  k12_weights jsonb not null default '{
    "lang_ap_esp": {"ww": 30, "pt": 50, "qa": 20}, "sci_math": {"ww": 40, "pt": 40, "qa": 20},
    "mapeh_epp_tle": {"ww": 20, "pt": 60, "qa": 20}, "shs_core": {"ww": 25, "pt": 50, "qa": 25},
    "shs_academic": {"ww": 25, "pt": 45, "qa": 30}, "shs_immersion": {"ww": 35, "pt": 40, "qa": 25},
    "shs_tvl": {"ww": 20, "pt": 60, "qa": 20}}'::jsonb,
  deadlines jsonb not null default '[]'::jsonb,   -- [{term_id, period, due_date}]
  updated_at timestamptz not null default now()
);

-- DepEd Order No. 8, s. 2015 transmutation table (same as lib/grades/k12.ts).
-- A row covers initial grades from min_initial up to the next row.
create table deped_transmutation (
  min_initial numeric primary key,
  grade int not null unique
);
insert into deped_transmutation (min_initial, grade) values
  (100, 100), (98.40, 99), (96.80, 98), (95.20, 97), (93.60, 96), (92.00, 95), (90.40, 94),
  (88.80, 93), (87.20, 92), (85.60, 91), (84.00, 90), (82.40, 89), (80.80, 88), (79.20, 87),
  (77.60, 86), (76.00, 85), (74.40, 84), (72.80, 83), (71.20, 82), (69.60, 81), (68.00, 80),
  (66.40, 79), (64.80, 78), (63.20, 77), (61.60, 76), (60.00, 75), (56.00, 74), (52.00, 73),
  (48.00, 72), (44.00, 71), (40.00, 70), (36.00, 69), (32.00, 68), (28.00, 67), (24.00, 66),
  (20.00, 65), (16.00, 64), (12.00, 63), (8.00, 62), (4.00, 61), (0, 60);

create table grade_sheets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  term_id uuid not null references terms(id) on delete cascade,
  offering_id uuid not null references offerings(id) on delete cascade,
  learning_area text,                -- K to 12: 'MATH', 'MUS', 'KINDER'...; null for college
  subject_group text check (subject_group in
    ('lang_ap_esp', 'sci_math', 'mapeh_epp_tle', 'shs_core', 'shs_academic', 'shs_immersion', 'shs_tvl')),
  period text not null check (period in ('prelim', 'midterm', 'semifinal', 'final', 'q1', 'q2', 'q3', 'q4')),
  status grade_sheet_status not null default 'draft',
  teacher_id uuid references auth.users(id) on delete set null,
  return_note text,
  late_allowed boolean not null default false,
  submitted_at timestamptz,
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create unique index grade_sheets_one on grade_sheets (offering_id, period, coalesce(learning_area, ''));
create index on grade_sheets (school_id, status);

create table k12_score_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  sheet_id uuid not null references grade_sheets(id) on delete cascade,
  component text not null check (component in ('ww', 'pt', 'qa')),
  label text not null default '',
  max_score numeric not null check (max_score > 0),
  position int not null default 0
);
create index on k12_score_items (sheet_id);

create table grade_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  sheet_id uuid not null references grade_sheets(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete restrict,
  percent numeric check (percent between 0 and 100),
  mark text check (mark in ('INC', 'DRP', 'W')),
  scores jsonb not null default '{}'::jsonb,     -- {score_item_id: raw score}
  domains jsonb not null default '{}'::jsonb,    -- Kinder: {domain: 'B' | 'D' | 'C'}
  grade numeric,                                 -- set by trigger: college period grade / K to 12 quarterly grade
  updated_at timestamptz not null default now(),
  unique (sheet_id, enrollment_id)
);
create index on grade_entries (enrollment_id);

create table change_grade_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  sheet_id uuid not null references grade_sheets(id) on delete cascade,
  entry_id uuid not null references grade_entries(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete restrict,
  old_value jsonb not null,          -- {percent, mark, scores?}
  new_value jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references auth.users(id),
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text
);
create unique index change_grade_one_pending on change_grade_requests (entry_id) where status = 'pending';

create table grade_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  sheet_id uuid not null references grade_sheets(id) on delete cascade,
  entry_id uuid references grade_entries(id) on delete set null,
  action text not null,
  from_status grade_sheet_status,
  to_status grade_sheet_status not null,
  note text,
  actor_id uuid not null references auth.users(id),
  actor_name text,
  created_at timestamptz not null default now()
);
create index on grade_history (sheet_id, created_at);

-- Every school gets a settings row (defaults above).
insert into grade_settings (school_id) select id from schools on conflict do nothing;
create function grades_new_school() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into grade_settings (school_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger schools_grade_settings after insert on schools
  for each row execute function grades_new_school();

-- ---------- helpers (security definer to avoid RLS recursion) ----------
create function grades_teaches(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from offerings where id = p_offering and teacher_id = auth.uid());
$$;

create function grades_sheet_of(p_sheet uuid) returns grade_sheets
language sql stable security definer set search_path = public as $$
  select * from grade_sheets where id = p_sheet;
$$;

-- Teacher of the class, and the sheet is still a draft (or returned).
create function grades_can_edit(p_sheet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from grade_sheets s join offerings o on o.id = s.offering_id
    where s.id = p_sheet and o.teacher_id = auth.uid() and s.status in ('draft', 'returned')
  );
$$;

-- Registrar / dean of the school, or the teacher of the class.
create function grades_staff_of_sheet(p_sheet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from grade_sheets s join offerings o on o.id = s.offering_id
    where s.id = p_sheet and (has_role(s.school_id, '{registrar,dean}') or o.teacher_id = auth.uid())
  );
$$;

-- Students and parents: posted sheets that hold one of their own grades.
create function grades_owner_can_see(p_sheet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from grade_sheets s join grade_entries g on g.sheet_id = s.id
    where s.id = p_sheet and s.status = 'posted' and owns_enrollment(g.enrollment_id)
  );
$$;

-- The enrollment is in this sheet's class.
create function grades_in_class(p_sheet uuid, p_enrollment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from grade_sheets s join enrollment_loads l on l.offering_id = s.offering_id
    where s.id = p_sheet and l.enrollment_id = p_enrollment
  );
$$;

-- ---------- computing grades (mirrors lib/grades) ----------
-- College: percent (rounded to a whole number) -> the school's scale.
create function grades_college_grade(p_school uuid, p_percent numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select (r->>'grade')::numeric
  from grade_settings gs, jsonb_array_elements(gs.college_scale) r
  where gs.school_id = p_school
    and round(greatest(0, least(100, p_percent))) between (r->>'min')::numeric and (r->>'max')::numeric
  limit 1;
$$;

-- DepEd: initial grade -> quarterly grade.
create function grades_deped_transmute(p_initial numeric) returns int
language sql stable security definer set search_path = public as $$
  select grade from deped_transmutation
  where min_initial <= round(greatest(0, least(100, p_initial)), 2)
  order by min_initial desc limit 1;
$$;

-- K to 12 quarterly grade from raw scores: PS per component, x weight, sum, transmute.
create function grades_k12_quarterly(p_sheet uuid, p_scores jsonb) returns int
language plpgsql stable security definer set search_path = public as $$
declare sh grade_sheets; w jsonb; c text; v_raw numeric; v_max numeric; v_ps numeric; v_ig numeric := 0;
begin
  select * into sh from grade_sheets where id = p_sheet;
  if sh.subject_group is null then return null; end if;
  if not exists (select 1 from k12_score_items i where i.sheet_id = p_sheet
                 and jsonb_typeof(p_scores -> i.id::text) = 'number') then
    return null;
  end if;
  select gs.k12_weights -> sh.subject_group into w from grade_settings gs where gs.school_id = sh.school_id;
  foreach c in array array['ww', 'pt', 'qa'] loop
    select coalesce(sum(least(coalesce((p_scores ->> i.id::text)::numeric, 0), i.max_score)), 0), coalesce(sum(i.max_score), 0)
      into v_raw, v_max
      from k12_score_items i where i.sheet_id = p_sheet and i.component = c;
    if v_max > 0 then
      v_ps := round(v_raw / v_max * 100, 2);
      v_ig := v_ig + round(v_ps * (w ->> c)::numeric / 100, 2);
    end if;
  end loop;
  return grades_deped_transmute(round(v_ig, 2));
end $$;

-- The stored grade is always worked out here.
create function grades_entry_compute() returns trigger
language plpgsql security definer set search_path = public as $$
declare o offerings;
begin
  select o2.* into o from grade_sheets s join offerings o2 on o2.id = s.offering_id where s.id = new.sheet_id;
  if o.kind = 'subject' then
    new.grade := case when new.mark is null and new.percent is not null then grades_college_grade(o.school_id, new.percent) end;
  elsif coalesce(o.level, '') ilike '%kinder%' then
    new.grade := null;
  else
    new.grade := grades_k12_quarterly(new.sheet_id, new.scores);
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger grade_entries_compute before insert or update on grade_entries
  for each row execute function grades_entry_compute();

-- Only the functions below may move a sheet along (they set grades.internal).
create function grades_sheet_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('grades.internal', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.late_allowed or new.posted_at is not null or new.posted_by is not null
       or new.submitted_at is not null or new.return_note is not null then
      raise exception 'A new grade sheet starts as a draft.';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status or new.late_allowed is distinct from old.late_allowed
     or new.posted_at is distinct from old.posted_at or new.posted_by is distinct from old.posted_by
     or new.submitted_at is distinct from old.submitted_at or new.return_note is distinct from old.return_note
     or new.offering_id is distinct from old.offering_id or new.period is distinct from old.period
     or new.learning_area is distinct from old.learning_area then
    raise exception 'Use submit / approve / return to change a grade sheet.';
  end if;
  return new;
end $$;
create trigger grade_sheets_guard before insert or update on grade_sheets
  for each row execute function grades_sheet_guard();

-- Entries and items of a submitted or posted sheet are locked (change requests go through grades_decide_change).
create function grades_entry_guard() returns trigger language plpgsql as $$
declare v_status grade_sheet_status;
begin
  if coalesce(current_setting('grades.internal', true), '') = 'on' then return coalesce(new, old); end if;
  select status into v_status from grade_sheets where id = coalesce(new.sheet_id, old.sheet_id);
  if v_status not in ('draft', 'returned') then
    raise exception 'These grades are % and locked. Ask for a grade change instead.', v_status;
  end if;
  return coalesce(new, old);
end $$;
create trigger grade_entries_guard before insert or update or delete on grade_entries
  for each row execute function grades_entry_guard();
create trigger k12_score_items_guard before insert or update or delete on k12_score_items
  for each row execute function grades_entry_guard();

-- ---------- Row Level Security ----------
alter table grade_settings enable row level security;
alter table deped_transmutation enable row level security;
alter table grade_sheets enable row level security;
alter table k12_score_items enable row level security;
alter table grade_entries enable row level security;
alter table change_grade_requests enable row level security;
alter table grade_history enable row level security;

create policy grade_settings_read on grade_settings for select using (is_member(school_id));
create policy grade_settings_write on grade_settings for update
  using (has_role(school_id, '{registrar}')) with check (has_role(school_id, '{registrar}'));

create policy deped_transmutation_read on deped_transmutation for select using (true);

create policy grade_sheets_read on grade_sheets for select using (
  has_role(school_id, '{registrar,dean}') or grades_teaches(offering_id) or grades_owner_can_see(id)
);
create policy grade_sheets_teacher_insert on grade_sheets for insert with check (
  is_member(school_id) and grades_teaches(offering_id) and teacher_id = auth.uid()
  and term_id = (select term_id from offerings where id = offering_id)
);
create policy grade_sheets_teacher_update on grade_sheets for update
  using (grades_teaches(offering_id) and status in ('draft', 'returned'))
  with check (grades_teaches(offering_id) and status in ('draft', 'returned'));

create policy score_items_read on k12_score_items for select
  using (grades_staff_of_sheet(sheet_id) or grades_owner_can_see(sheet_id));
create policy score_items_write on k12_score_items for all
  using (grades_can_edit(sheet_id))
  with check (grades_can_edit(sheet_id) and school_id = (grades_sheet_of(sheet_id)).school_id);

create policy grade_entries_read on grade_entries for select using (
  grades_staff_of_sheet(sheet_id)
  or (owns_enrollment(enrollment_id) and (grades_sheet_of(sheet_id)).status = 'posted')
);
create policy grade_entries_write on grade_entries for all
  using (grades_can_edit(sheet_id))
  with check (
    grades_can_edit(sheet_id) and grades_in_class(sheet_id, enrollment_id)
    and school_id = (grades_sheet_of(sheet_id)).school_id
  );

-- Read only; written by the functions below.
create policy change_requests_read on change_grade_requests for select using (grades_staff_of_sheet(sheet_id));
create policy grade_history_read on grade_history for select using (grades_staff_of_sheet(sheet_id));

-- ---------- RPC: submit / approve / return / allow late ----------
create function grades_history(p_sheet grade_sheets, p_entry uuid, p_action text, p_from grade_sheet_status,
                               p_to grade_sheet_status, p_note text) returns void
language sql security definer set search_path = public as $$
  insert into grade_history (school_id, sheet_id, entry_id, action, from_status, to_status, note, actor_id, actor_name)
  values (p_sheet.school_id, p_sheet.id, p_entry, p_action, p_from, p_to, p_note, auth.uid(), fees_actor_name(p_sheet.school_id));
$$;

-- Students in the class with no grade yet (submit needs every row).
create function grades_missing(p_sheet uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from grade_sheets s
  join offerings o on o.id = s.offering_id
  join enrollment_loads l on l.offering_id = s.offering_id
  join enrollments e on e.id = l.enrollment_id and e.status = 'officially_enrolled'
  left join grade_entries g on g.sheet_id = s.id and g.enrollment_id = e.id
  where s.id = p_sheet and (
    g.id is null
    or (o.kind = 'subject' and g.percent is null and g.mark is null)
    or (o.kind = 'section' and coalesce(o.level, '') ilike '%kinder%'
        and (select count(*) from jsonb_object_keys(g.domains)) < 6)
    or (o.kind = 'section' and coalesce(o.level, '') not ilike '%kinder%' and (
          not exists (select 1 from k12_score_items i where i.sheet_id = s.id)
          or exists (select 1 from k12_score_items i where i.sheet_id = s.id and jsonb_typeof(g.scores -> i.id::text) is distinct from 'number')))
  );
$$;

create function grades_sheet_action(p_sheet uuid, p_action text, p_note text default null) returns grade_sheets
language plpgsql security definer set search_path = public as $$
declare
  s grade_sheets; o offerings; v_dean boolean; v_approver app_role; v_due date; v_missing int;
  v_from grade_sheet_status; v_late boolean;
begin
  select * into s from grade_sheets where id = p_sheet for update;
  if s.id is null then raise exception 'Grade sheet not found.'; end if;
  select * into o from offerings where id = s.offering_id;
  v_from := s.status;
  v_dean := coalesce((select (settings->>'use_dean_approval')::boolean from schools where id = s.school_id), false);
  v_approver := case when v_dean then 'dean'::app_role else 'registrar'::app_role end;
  select (d->>'due_date')::date into v_due
    from grade_settings gs, jsonb_array_elements(gs.deadlines) d
    where gs.school_id = s.school_id and d->>'term_id' = s.term_id::text and d->>'period' = s.period limit 1;
  v_late := v_due is not null and (now() at time zone 'Asia/Manila')::date > v_due;
  perform set_config('grades.internal', 'on', true);

  if p_action = 'submit' then
    if not (o.teacher_id = auth.uid() and has_role(s.school_id, '{teacher}')) then
      raise exception 'Only the teacher of this class can submit grades.';
    end if;
    if s.status not in ('draft', 'returned') then raise exception 'These grades are already %.', s.status; end if;
    v_missing := grades_missing(s.id);
    if v_missing > 0 then
      raise exception '% student(s) have no grade yet. Enter a score, a percent or a mark (INC) for everyone.', v_missing;
    end if;
    if v_late and not s.late_allowed then
      raise exception 'The deadline (%) has passed. The registrar must allow a late submission.', v_due;
    end if;
    update grade_sheets set status = 'submitted', submitted_at = now(), return_note = null, updated_at = now()
      where id = s.id returning * into s;
    perform grades_history(s, null, 'submit', v_from, 'submitted',
      case when s.late_allowed then 'Late submission (allowed by the registrar)' end);

  elsif p_action = 'approve' then
    if not has_role(s.school_id, array[v_approver]) then raise exception 'Only the % approves grades.', v_approver; end if;
    if s.status <> 'submitted' then raise exception 'Only submitted grades can be approved.'; end if;
    update grade_sheets set status = 'posted', posted_at = now(), posted_by = auth.uid(), updated_at = now()
      where id = s.id returning * into s;
    perform grades_history(s, null, 'approve', v_from, 'posted', null);

  elsif p_action = 'return' then
    if not has_role(s.school_id, array['registrar'::app_role, v_approver]) then raise exception 'Not allowed to return grades.'; end if;
    if s.status <> 'submitted' then raise exception 'Only submitted grades can be returned.'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Write a note for the teacher.'; end if;
    update grade_sheets set status = 'returned', return_note = trim(p_note), updated_at = now()
      where id = s.id returning * into s;
    perform grades_history(s, null, 'return', v_from, 'returned', trim(p_note));

  elsif p_action = 'allow_late' then
    if not has_role(s.school_id, '{registrar}') then raise exception 'Only the registrar can allow a late submission.'; end if;
    if s.status not in ('draft', 'returned') then raise exception 'These grades are already %.', s.status; end if;
    update grade_sheets set late_allowed = true, updated_at = now() where id = s.id returning * into s;
    perform grades_history(s, null, 'allow_late', v_from, v_from, 'Late submission allowed');

  else
    raise exception 'Unknown action %.', p_action;
  end if;
  return s;
end $$;

-- ---------- RPC: change grade requests ----------
create function grades_request_change(
  p_entry uuid, p_percent numeric, p_mark text, p_scores jsonb, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare g grade_entries; s grade_sheets; o offerings; v_id uuid; v_old jsonb; v_new jsonb;
begin
  select * into g from grade_entries where id = p_entry;
  if g.id is null then raise exception 'Grade not found.'; end if;
  select * into s from grade_sheets where id = g.sheet_id;
  select * into o from offerings where id = s.offering_id;
  if not (o.teacher_id = auth.uid() and has_role(s.school_id, '{teacher}')) then
    raise exception 'Only the teacher of this class can ask for a grade change.';
  end if;
  if s.status <> 'posted' then raise exception 'Only posted grades need a change request. Edit the draft instead.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Type the reason for the change.'; end if;
  if exists (select 1 from change_grade_requests where entry_id = g.id and status = 'pending') then
    raise exception 'There is already a pending change request for this grade.';
  end if;
  if p_scores is null then
    if p_mark is null and p_percent is null then raise exception 'Enter a percent or a mark (INC, DRP, W).'; end if;
    if p_mark is null and not (p_percent between 0 and 100) then raise exception 'A percent must be from 0 to 100.'; end if;
    v_old := jsonb_build_object('percent', g.percent, 'mark', g.mark);
    v_new := jsonb_build_object('percent', case when p_mark is null then p_percent end, 'mark', p_mark);
  else
    v_old := jsonb_build_object('percent', g.percent, 'mark', g.mark, 'scores', g.scores);
    v_new := jsonb_build_object('percent', null, 'mark', null, 'scores', p_scores);
  end if;
  if v_old = v_new then raise exception 'The new grade is the same as the posted one.'; end if;
  insert into change_grade_requests (school_id, sheet_id, entry_id, enrollment_id, old_value, new_value, reason,
                                     requested_by, requested_by_name)
  values (s.school_id, s.id, g.id, g.enrollment_id, v_old, v_new, trim(p_reason), auth.uid(),
          (select full_name from profiles where id = auth.uid()))
  returning id into v_id;
  perform grades_history(s, g.id, 'request_change', s.status, s.status, trim(p_reason));
  return v_id;
end $$;

create function grades_decide_change(p_request uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r change_grade_requests; s grade_sheets; v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_desc_old text; v_desc_new text;
begin
  select * into r from change_grade_requests where id = p_request for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not has_role(r.school_id, '{registrar}') then raise exception 'Only the registrar can decide on grade changes.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already decided.'; end if;
  if not p_approve and v_note is null then raise exception 'Write why the change is not approved.'; end if;
  select * into s from grade_sheets where id = r.sheet_id;
  v_desc_old := coalesce(r.old_value->>'mark', (r.old_value->>'percent') || '%', 'scores');
  v_desc_new := coalesce(r.new_value->>'mark', (r.new_value->>'percent') || '%', 'scores');
  update change_grade_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = r.id;
  if p_approve then
    perform set_config('grades.internal', 'on', true);
    update grade_entries set
      percent = (r.new_value->>'percent')::numeric,
      mark = r.new_value->>'mark',
      scores = case when r.new_value ? 'scores' then scores || (r.new_value->'scores') else scores end
    where id = r.entry_id;
    perform grades_history(s, r.entry_id, 'change_grade', s.status, s.status,
      'Grade changed ' || v_desc_old || ' → ' || v_desc_new || '. Reason: ' || r.reason || coalesce(' | ' || v_note, ''));
  else
    perform grades_history(s, r.entry_id, 'change_rejected', s.status, s.status,
      'Change ' || v_desc_old || ' → ' || v_desc_new || ' not approved: ' || v_note);
  end if;
end $$;

-- Helpers are internal: only the RPCs above are meant to be called.
revoke execute on function grades_history(grade_sheets, uuid, text, grade_sheet_status, grade_sheet_status, text) from public, anon, authenticated;
revoke execute on function grades_missing(uuid) from public, anon, authenticated;
