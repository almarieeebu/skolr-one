-- School enrollment MVP: tables, enums, helper functions and Row Level Security.
-- Every school-owned table carries school_id. Users only see rows of schools
-- they belong to (memberships), and students/parents only see their own.

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type app_role as enum ('registrar', 'cashier', 'teacher', 'student', 'parent', 'dean');
create type track_kind as enum ('college', 'k12');
create type enrollment_status as enum (
  'applied', 'papers_checked', 'student_made', 'load_set',
  'assessed_paid', 'officially_enrolled', 'rejected', 'withdrawn'
);
create type student_kind as enum ('new', 'transferee', 'returnee', 'continuing');
create type doc_kind as enum ('psa_birth_cert', 'form_138', 'honorable_dismissal', 'tor');
create type offering_kind as enum ('subject', 'section');
create type tuition_plan as enum ('annual', 'quarterly', 'monthly');

-- ---------- tables ----------
create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  logo_url text,
  -- use_dean_approval, min_downpayment, max_units, rate_per_unit, misc_fee,
  -- k12_tuition, k12_default_tuition, k12_misc_fee, esc_amount, shs_voucher_amount
  settings jsonb not null default '{
    "use_dean_approval": false, "min_downpayment": 3000, "max_units": 24,
    "rate_per_unit": 1000, "misc_fee": 4000
  }'::jsonb,
  created_at timestamptz not null default now()
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null
);

create table terms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year text not null,          -- '2026-2027'
  semester text,                      -- '1st' / '2nd' / 'summer'; null for K to 12
  track track_kind not null,
  is_open boolean not null default true
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  role app_role not null,
  unique (user_id, school_id, role)
);

create table students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_no text,
  lrn text,
  first_name text not null,
  middle_name text,
  last_name text not null,
  birth_date date,
  sex text check (sex in ('M', 'F')),
  user_id uuid references auth.users(id) on delete set null,
  guardian_user_id uuid references auth.users(id) on delete set null,
  completed_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (school_id, student_no)
);

create table parent_links (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  parent_user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  unique (parent_user_id, student_id)
);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  term_id uuid not null references terms(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  track track_kind not null,
  status enrollment_status not null default 'applied',
  level text not null,
  course text,
  strand text,
  student_type student_kind not null default 'new',
  esc_voucher boolean not null default false,
  mother_tongue text,
  ip_group text,
  is_4ps boolean not null default false,
  tuition_plan tuition_plan,
  fix_note text,
  dean_approved boolean not null default false,
  overrides jsonb not null default '[]'::jsonb,   -- [{action, checks, reason, by, at}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_id, student_id)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  type doc_kind not null,
  file_name text,
  file_path text,
  checked boolean not null default false,
  uploaded_at timestamptz,
  unique (enrollment_id, type)
);

create table offerings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  term_id uuid not null references terms(id) on delete cascade,
  kind offering_kind not null,
  code text not null,
  title text not null,
  units numeric not null default 0,
  lab_fee numeric not null default 0,
  days text,                -- 'MWF', 'TTh', 'S'
  start_time text,          -- '08:00'
  end_time text,            -- '09:30'
  room text,
  teacher_id uuid references auth.users(id) on delete set null,
  slots int not null default 40,
  prerequisite_codes text[] not null default '{}',
  level text,               -- sections: grade level served
  strand text,              -- SHS sections
  unique (term_id, code)
);

create table enrollment_loads (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  offering_id uuid not null references offerings(id) on delete cascade,
  unique (enrollment_id, offering_id)
);

create table fee_lines (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  label text not null,
  amount numeric not null
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  amount numeric not null check (amount > 0),
  or_no text not null,
  cashier_id uuid not null references auth.users(id),
  paid_at timestamptz not null default now(),
  unique (school_id, or_no)
);

create table enrollment_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  from_status enrollment_status,
  to_status enrollment_status not null,
  action text not null,
  reason text,
  actor_id uuid not null references auth.users(id),
  actor_name text,
  created_at timestamptz not null default now()
);

create index on enrollments (school_id, status);
create index on enrollment_loads (offering_id);
create index on enrollment_history (enrollment_id, created_at);

-- New auth users get a profile row automatically.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- helper functions (security definer to avoid RLS recursion) ----------
create function has_role(p_school uuid, p_roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and school_id = p_school and role = any (p_roles)
  );
$$;

create function is_member(p_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and school_id = p_school);
$$;

create function is_staff(p_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_role(p_school, array['registrar', 'cashier', 'dean']::app_role[]);
$$;

-- Own record, child (parent), staff of the school, or a teacher of one of the student's classes.
create function can_see_student(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from students s
    where s.id = p_student and (
      is_staff(s.school_id)
      or s.user_id = auth.uid()
      or s.guardian_user_id = auth.uid()
      or exists (select 1 from parent_links pl where pl.student_id = s.id and pl.parent_user_id = auth.uid())
      or exists (
        select 1 from enrollments e
        join enrollment_loads l on l.enrollment_id = e.id
        join offerings o on o.id = l.offering_id
        where e.student_id = s.id and o.teacher_id = auth.uid()
      )
    )
  );
$$;

create function can_see_enrollment(p_enrollment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from enrollments e where e.id = p_enrollment and can_see_student(e.student_id));
$$;

-- Student or parent of this enrollment (not staff).
create function owns_enrollment(p_enrollment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e join students s on s.id = e.student_id
    where e.id = p_enrollment and (
      s.user_id = auth.uid() or s.guardian_user_id = auth.uid()
      or exists (select 1 from parent_links pl where pl.student_id = s.id and pl.parent_user_id = auth.uid())
    )
  );
$$;

create function enrollment_status_of(p_enrollment uuid) returns enrollment_status
language sql stable security definer set search_path = public as $$
  select status from enrollments where id = p_enrollment;
$$;

-- Seat counts per offering, without revealing who took them.
create function offering_taken_counts(p_term_id uuid, p_exclude_enrollment uuid)
returns table (offering_id uuid, taken bigint)
language sql stable security definer set search_path = public as $$
  select l.offering_id, count(*)
  from enrollment_loads l
  join enrollments e on e.id = l.enrollment_id
  join offerings o on o.id = l.offering_id
  where o.term_id = p_term_id
    and e.id <> p_exclude_enrollment
    and e.status not in ('rejected', 'withdrawn')
    and is_member(o.school_id)
  group by l.offering_id;
$$;

-- ---------- Row Level Security ----------
alter table schools enable row level security;
alter table branches enable row level security;
alter table terms enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table students enable row level security;
alter table parent_links enable row level security;
alter table enrollments enable row level security;
alter table documents enable row level security;
alter table offerings enable row level security;
alter table enrollment_loads enable row level security;
alter table fee_lines enable row level security;
alter table payments enable row level security;
alter table enrollment_history enable row level security;

-- schools / branches / terms / offerings: members read, registrar manages
create policy schools_read on schools for select using (is_member(id));
create policy schools_update on schools for update using (has_role(id, '{registrar}'));

create policy branches_read on branches for select using (is_member(school_id));
create policy branches_write on branches for all using (has_role(school_id, '{registrar}'))
  with check (has_role(school_id, '{registrar}'));

create policy terms_read on terms for select using (is_member(school_id));
create policy terms_write on terms for all using (has_role(school_id, '{registrar}'))
  with check (has_role(school_id, '{registrar}'));

create policy offerings_read on offerings for select using (is_member(school_id));
create policy offerings_write on offerings for all using (has_role(school_id, '{registrar}'))
  with check (has_role(school_id, '{registrar}'));

-- profiles: yourself, or anyone sharing a school with you
create policy profiles_read on profiles for select using (
  id = auth.uid() or exists (
    select 1 from memberships m where m.user_id = profiles.id and is_member(m.school_id)
  )
);
create policy profiles_update on profiles for update using (id = auth.uid());

-- memberships: your own, or all of them if you are the registrar
create policy memberships_read on memberships for select
  using (user_id = auth.uid() or has_role(school_id, '{registrar}'));
create policy memberships_write on memberships for all using (has_role(school_id, '{registrar}'))
  with check (has_role(school_id, '{registrar}'));

-- students
create policy students_read on students for select using (can_see_student(id));
create policy students_insert on students for insert with check (
  is_member(school_id) and (
    has_role(school_id, '{registrar}') or user_id = auth.uid() or guardian_user_id = auth.uid()
  )
);
create policy students_update on students for update using (has_role(school_id, '{registrar}'));

create policy parent_links_read on parent_links for select
  using (parent_user_id = auth.uid() or is_staff(school_id));
create policy parent_links_insert on parent_links for insert with check (
  (parent_user_id = auth.uid() and is_member(school_id)) or has_role(school_id, '{registrar}')
);

-- enrollments
create policy enrollments_read on enrollments for select using (can_see_student(student_id));
create policy enrollments_insert on enrollments for insert with check (
  is_member(school_id) and can_see_student(student_id)
  and status in ('applied', 'student_made')
);
-- Staff move enrollments along; students/parents may only set their load.
create policy enrollments_update_staff on enrollments for update
  using (is_staff(school_id)) with check (is_staff(school_id));
create policy enrollments_update_owner on enrollments for update
  using (owns_enrollment(id) and status in ('student_made', 'load_set'))
  with check (status = 'load_set');

-- documents
create policy documents_read on documents for select using (can_see_enrollment(enrollment_id));
create policy documents_write on documents for all using (
  has_role(school_id, '{registrar}')
  or (owns_enrollment(enrollment_id) and enrollment_status_of(enrollment_id) = 'applied')
) with check (
  has_role(school_id, '{registrar}')
  or (owns_enrollment(enrollment_id) and enrollment_status_of(enrollment_id) = 'applied')
);

-- loads and fee lines: registrar, or the student/parent while picking a load
create policy loads_read on enrollment_loads for select using (can_see_enrollment(enrollment_id));
create policy loads_write on enrollment_loads for all using (
  has_role(school_id, '{registrar}')
  or (owns_enrollment(enrollment_id) and enrollment_status_of(enrollment_id) in ('student_made', 'load_set'))
) with check (
  has_role(school_id, '{registrar}')
  or (owns_enrollment(enrollment_id) and enrollment_status_of(enrollment_id) in ('student_made', 'load_set'))
);

create policy fees_read on fee_lines for select using (can_see_enrollment(enrollment_id));
create policy fees_write on fee_lines for all using (
  has_role(school_id, '{registrar}')
  or (owns_enrollment(enrollment_id) and enrollment_status_of(enrollment_id) in ('student_made', 'load_set'))
) with check (
  has_role(school_id, '{registrar}')
  or (owns_enrollment(enrollment_id) and enrollment_status_of(enrollment_id) in ('student_made', 'load_set'))
);

-- payments: only the cashier records them
create policy payments_read on payments for select using (can_see_enrollment(enrollment_id));
create policy payments_insert on payments for insert
  with check (has_role(school_id, '{cashier}') and cashier_id = auth.uid());

-- history: anyone who can see the enrollment; rows are written as yourself and never edited
create policy history_read on enrollment_history for select using (can_see_enrollment(enrollment_id));
create policy history_insert on enrollment_history for insert
  with check (can_see_enrollment(enrollment_id) and actor_id = auth.uid());

-- ---------- storage for uploaded papers ----------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Files live under '{school_id}/{enrollment_id}/...'
create policy "documents bucket read" on storage.objects for select to authenticated using (
  bucket_id = 'documents'
  and can_see_enrollment(((storage.foldername(name))[2])::uuid)
);
create policy "documents bucket upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'documents'
  and can_see_enrollment(((storage.foldername(name))[2])::uuid)
);
