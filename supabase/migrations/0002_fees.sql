-- Fees module: fee setups, discounts, payments, a ledger, OR number series and
-- term closing.
--
-- Security model (fixes the weak spot of 0001):
--   * Nobody writes fee rows from the browser. Charges, discounts, payments,
--     voids and carried balances are posted ONLY by the SECURITY DEFINER
--     functions below, which check the caller's role first.
--   * A payment, its ledger row, the status change and the history row are
--     saved by one function call, so they succeed or fail together.
--   * Ledger rows can never be updated or deleted (trigger). Voids post a
--     reversing row.
--   * Teachers see nothing about fees. Students and parents see their own.
--
-- The fee rules mirror lib/fees (assess.ts, ledger.ts, schedule.ts,
-- closing.ts). Keep both in step.

-- ---------- enums and columns ----------
create type ledger_kind as enum (
  'charge', 'discount', 'payment', 'penalty', 'void', 'previous_balance', 'carry_forward'
);
create type payment_mode as enum ('cash', 'gcash', 'bank', 'check');

alter table terms add column closed_at timestamptz;
alter table offerings add column is_major boolean not null default false;

alter table payments
  add column mode payment_mode not null default 'cash',
  add column reference text,
  add column voided_at timestamptz,
  add column void_reason text,
  add column voided_by uuid references auth.users(id);

-- ---------- tables ----------
create table fee_setups (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  term_id uuid not null references terms(id) on delete cascade,
  track track_kind not null,
  scope_course text,                  -- college only; null = all courses
  scope_level text,                   -- year level / grade level; null = all
  min_downpayment numeric not null default 0 check (min_downpayment >= 0),
  misc_items jsonb not null default '[]'::jsonb,        -- [{name, amount, group}]
  rate_per_unit numeric not null default 0 check (rate_per_unit >= 0),
  major_rate_per_unit numeric not null default 0 check (major_rate_per_unit >= 0),
  exam_periods jsonb not null default '[]'::jsonb,      -- [{name, percent, due_date}]
  plans jsonb not null default '[]'::jsonb,             -- [{plan, items, surcharge_pct, due_dates}]
  esc_amount numeric not null default 0,
  shs_voucher_amount numeric not null default 0,
  updated_at timestamptz not null default now()
);
create unique index fee_setups_scope on fee_setups
  (term_id, track, coalesce(scope_course, ''), coalesce(scope_level, ''));

create table discounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete restrict,
  name text not null,
  scope text not null check (scope in ('item', 'group', 'total')),
  target text,                        -- item: fee line code; group: tuition/lab/misc/other
  kind text not null check (kind in ('amount', 'percent')),
  value numeric not null check (value > 0),
  reason text not null,
  applied_by uuid not null references auth.users(id),
  applied_by_name text,
  applied_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);

create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,   -- posting order
  school_id uuid not null references schools(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete restrict,
  student_id uuid not null references students(id) on delete restrict,
  term_id uuid not null references terms(id) on delete restrict,
  kind ledger_kind not null,
  code text not null,
  fee_group text check (fee_group in ('tuition', 'lab', 'misc', 'other')),
  description text not null,
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  payment_id uuid references payments(id),
  reverses_id uuid references ledger_entries(id),
  reason text,
  actor_id uuid references auth.users(id),   -- null only for rows moved over from 0001
  actor_name text,
  posted_at timestamptz not null default now()
);
create index on ledger_entries (enrollment_id, seq);
create index on ledger_entries (student_id);
-- A row can be reversed only once.
create unique index ledger_reversed_once on ledger_entries (reverses_id) where reverses_id is not null;

create table or_series (
  school_id uuid primary key references schools(id) on delete cascade,
  prefix text not null default '',
  next_no bigint not null default 1 check (next_no > 0),
  pad int not null default 6 check (pad between 1 and 12)
);

-- Ledger rows are never edited or deleted. Post a void instead.
create function ledger_is_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'Ledger rows cannot be changed or deleted. Post a void (reversing row) instead.';
end $$;
create trigger ledger_append_only before update or delete on ledger_entries
  for each row execute function ledger_is_append_only();

-- ---------- move 0001 fee lines and payments into the ledger ----------
insert into ledger_entries (school_id, enrollment_id, student_id, term_id, kind, code, description, debit, credit, posted_at)
select f.school_id, f.enrollment_id, e.student_id, e.term_id,
       (case when f.amount < 0 then 'discount' else 'charge' end)::ledger_kind,
       'legacy:' || f.id, f.label, greatest(f.amount, 0), greatest(-f.amount, 0), e.updated_at
from fee_lines f join enrollments e on e.id = f.enrollment_id;

insert into ledger_entries (school_id, enrollment_id, student_id, term_id, kind, code, description, debit, credit,
                            payment_id, actor_id, posted_at)
select p.school_id, p.enrollment_id, e.student_id, e.term_id, 'payment', 'pay:' || p.id,
       'Payment, OR #' || p.or_no || ' (Cash)', 0, p.amount, p.id, p.cashier_id, p.paid_at
from payments p join enrollments e on e.id = p.enrollment_id;

-- Fee lines were writable by students in 0001. The ledger replaces them.
drop table fee_lines;

-- Payments are only written by fees_take_payment / fees_void_payment now.
drop policy payments_insert on payments;
drop policy payments_read on payments;

-- ---------- visibility ----------
-- Staff of the school, or the student / parent of the enrollment. Not teachers.
create function fees_visible(p_enrollment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e
    where e.id = p_enrollment and (is_staff(e.school_id) or owns_enrollment(e.id))
  );
$$;

alter table fee_setups enable row level security;
alter table discounts enable row level security;
alter table ledger_entries enable row level security;
alter table or_series enable row level security;

create policy fee_setups_read on fee_setups for select
  using (has_role(school_id, '{registrar,cashier,dean,student,parent}'));
create policy fee_setups_write on fee_setups for all
  using (has_role(school_id, '{registrar}')) with check (has_role(school_id, '{registrar}'));

create policy or_series_read on or_series for select using (is_staff(school_id));
create policy or_series_write on or_series for all
  using (has_role(school_id, '{registrar}')) with check (has_role(school_id, '{registrar}'));

-- Read only. There are NO insert/update/delete policies: rows come from the functions below.
create policy payments_read on payments for select using (fees_visible(enrollment_id));
create policy discounts_read on discounts for select using (fees_visible(enrollment_id));
create policy ledger_read on ledger_entries for select using (fees_visible(enrollment_id));

-- ---------- small helpers ----------
create function fees_cents(p numeric) returns bigint language sql immutable as $$
  select round(coalesce(p, 0) * 100)::bigint;
$$;

-- Same format as peso() in lib/fees/money.ts: ₱1,234.50
create function fees_peso(p numeric) returns text language sql immutable as $$
  select (case when p < 0 then '-₱' else '₱' end) || to_char(abs(round(p, 2)), 'FM999,999,999,990.00');
$$;

create function fees_term_label(p_term uuid) returns text language sql stable security definer set search_path = public as $$
  select case when semester is null then school_year || ' (K to 12)' else school_year || ' ' || semester || ' sem' end
  from terms where id = p_term;
$$;

create function fees_actor_name(p_school uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from profiles where id = auth.uid()), 'User')
    || ' (' || coalesce((select role::text from memberships where user_id = auth.uid() and school_id = p_school
                          order by array_position(array['registrar','cashier','dean','teacher','parent','student']::text[], role::text)
                          limit 1), '?') || ')';
$$;

-- Live rows: not a void, and not reversed by a void.
create function fees_live(p_enrollment uuid) returns setof ledger_entries
language sql stable security definer set search_path = public as $$
  select r.* from ledger_entries r
  where r.enrollment_id = p_enrollment and r.kind <> 'void'
    and not exists (select 1 from ledger_entries v where v.reverses_id = r.id)
  order by r.seq;
$$;

create function fees_post(
  p_enrollment uuid, p_kind ledger_kind, p_code text, p_group text, p_description text,
  p_debit numeric, p_credit numeric, p_payment uuid, p_reverses uuid, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare e enrollments; v_id uuid;
begin
  select * into e from enrollments where id = p_enrollment;
  insert into ledger_entries (school_id, enrollment_id, student_id, term_id, kind, code, fee_group, description,
                              debit, credit, payment_id, reverses_id, reason, actor_id, actor_name)
  values (e.school_id, e.id, e.student_id, e.term_id, p_kind, p_code, p_group, p_description,
          p_debit, p_credit, p_payment, p_reverses, p_reason, auth.uid(),
          case when auth.uid() is null then null else fees_actor_name(e.school_id) end)
  returning id into v_id;
  return v_id;
end $$;

create function fees_reverse(p_row ledger_entries, p_reason text) returns uuid
language sql security definer set search_path = public as $$
  select fees_post(p_row.enrollment_id, 'void', p_row.code, p_row.fee_group, 'Void: ' || p_row.description,
                   p_row.credit, p_row.debit, p_row.payment_id, p_row.id, p_reason);
$$;

-- The fee setup for an enrollment: most specific scope wins (course+level, course, level, all).
create function fees_setup_for(p_enrollment uuid) returns fee_setups
language sql stable security definer set search_path = public as $$
  select s.* from enrollments e
  join fee_setups s on s.term_id = e.term_id and s.track = e.track
   and (s.scope_course is null or s.scope_course is not distinct from e.course)
   and (s.scope_level is null or s.scope_level = e.level)
  where e.id = p_enrollment
  order by (case when s.scope_course is not null then 2 else 0 end)
         + (case when s.scope_level is not null then 1 else 0 end) desc
  limit 1;
$$;

-- ---------- assessment (mirrors lib/fees/assess.ts) ----------
-- Charge lines as jsonb: [{code, label, group, cents}]
create function fees_charge_lines(p_enrollment uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e enrollments; s fee_setups; out jsonb := '[]'::jsonb;
  v_reg numeric; v_maj numeric; r record; p jsonb; v_tuition bigint := 0; v_pct numeric; v_plan text;
begin
  select * into e from enrollments where id = p_enrollment;
  s := fees_setup_for(p_enrollment);
  if s.id is null then return null; end if;

  if e.track = 'college' then
    select coalesce(sum(o.units) filter (where not o.is_major), 0), coalesce(sum(o.units) filter (where o.is_major), 0)
      into v_reg, v_maj
      from enrollment_loads l join offerings o on o.id = l.offering_id
     where l.enrollment_id = e.id and o.kind = 'subject';
    if v_reg > 0 then
      out := out || jsonb_build_object('code', 'tuition', 'group', 'tuition',
        'label', 'Tuition (' || trim_scale(v_reg) || ' units x ' || fees_peso(s.rate_per_unit) || ')',
        'cents', round(v_reg * fees_cents(s.rate_per_unit)));
    end if;
    if v_maj > 0 then
      out := out || jsonb_build_object('code', 'tuition_major', 'group', 'tuition',
        'label', 'Tuition, major subjects (' || trim_scale(v_maj) || ' units x ' || fees_peso(s.major_rate_per_unit) || ')',
        'cents', round(v_maj * fees_cents(s.major_rate_per_unit)));
    end if;
    for r in select o.code, o.lab_fee from enrollment_loads l join offerings o on o.id = l.offering_id
              where l.enrollment_id = e.id and o.kind = 'subject' and o.lab_fee > 0 order by o.code loop
      out := out || jsonb_build_object('code', 'lab:' || r.code, 'group', 'lab',
        'label', 'Lab fee - ' || r.code, 'cents', fees_cents(r.lab_fee));
    end loop;
  else
    v_plan := coalesce(e.tuition_plan::text, 'annual');
    select x into p from jsonb_array_elements(s.plans) x where x->>'plan' = v_plan limit 1;
    if p is null then p := s.plans->0; end if;
    if p is null then return out; end if;
    for r in select x as item from jsonb_array_elements(p->'items') x loop
      if coalesce(r.item->>'group', 'tuition') = 'tuition' then
        v_tuition := v_tuition + fees_cents((r.item->>'amount')::numeric);
      end if;
      if (r.item->>'amount')::numeric > 0 then
        out := out || jsonb_build_object('code', 'plan:' || (r.item->>'name'), 'group', coalesce(r.item->>'group', 'tuition'),
          'label', r.item->>'name', 'cents', fees_cents((r.item->>'amount')::numeric));
      end if;
    end loop;
    v_pct := coalesce((p->>'surcharge_pct')::numeric, 0);
    if v_pct > 0 and v_tuition > 0 then
      out := out || jsonb_build_object('code', 'surcharge', 'group', 'other',
        'label', 'Installment surcharge (' || trim_scale(v_pct) || '% of tuition, ' || (p->>'plan') || ' plan)',
        'cents', round(v_tuition * round(v_pct * 100) / 10000.0));
    end if;
  end if;

  for r in select x as item from jsonb_array_elements(s.misc_items) x loop
    if (r.item->>'amount')::numeric > 0 then
      out := out || jsonb_build_object('code', 'misc:' || (r.item->>'name'), 'group', coalesce(r.item->>'group', 'misc'),
        'label', r.item->>'name', 'cents', fees_cents((r.item->>'amount')::numeric));
    end if;
  end loop;
  return out;
end $$;

-- Discount lines from charge lines, item -> group -> total (mirrors discountLines()).
create function fees_discount_lines(p_enrollment uuid, p_charges jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e enrollments; s fee_setups; out jsonb := '[]'::jsonb; d record; c record;
  item_left jsonb := '{}'::jsonb; group_left jsonb := '{}'::jsonb; total_left bigint := 0;
  v_base bigint; v_cents bigint; v_group text; v_what text; v_voucher numeric := 0; v_vname text;
begin
  select * into e from enrollments where id = p_enrollment;
  s := fees_setup_for(p_enrollment);
  for c in select x->>'code' as code, x->>'group' as grp, (x->>'cents')::bigint as cents from jsonb_array_elements(p_charges) x loop
    item_left := jsonb_set(item_left, array[c.code], to_jsonb(coalesce((item_left->>c.code)::bigint, 0) + c.cents));
    if c.grp is not null then
      group_left := jsonb_set(group_left, array[c.grp], to_jsonb(coalesce((group_left->>c.grp)::bigint, 0) + c.cents));
    end if;
    total_left := total_left + c.cents;
  end loop;

  -- ESC grant (Grades 7-10) / SHS voucher (Grades 11-12) as a fixed discount on the total.
  if e.track = 'k12' and e.esc_voucher and s.id is not null then
    if e.level ~ 'Grade 1[12]\y' then v_voucher := s.shs_voucher_amount; v_vname := 'SHS voucher';
    elsif e.level ~ 'Grade (7|8|9|10)\y' then v_voucher := s.esc_amount; v_vname := 'ESC grant';
    end if;
  end if;

  for d in
    select * from (
      select 'voucher' as id, v_vname as name, 'total' as scope, null::text as target, 'amount' as kind,
             v_voucher as value, '-infinity'::timestamptz as applied_at, 2 as stage, '' as sort_id
       where v_voucher > 0
      union all
      select x.id::text, x.name, x.scope, x.target, x.kind, x.value, x.applied_at,
             case x.scope when 'item' then 0 when 'group' then 1 else 2 end, x.id::text
        from discounts x where x.enrollment_id = p_enrollment and x.voided_at is null
    ) q order by stage, applied_at, sort_id
  loop
    if d.scope = 'item' then v_base := coalesce((item_left->>d.target)::bigint, 0);
    elsif d.scope = 'group' then v_base := coalesce((group_left->>d.target)::bigint, 0);
    else v_base := total_left;
    end if;
    v_base := greatest(0, v_base);
    v_cents := case when d.kind = 'percent' then round(v_base * round(d.value * 100) / 10000.0) else fees_cents(d.value) end;
    v_cents := greatest(0, least(v_cents, v_base));
    v_group := null;
    if d.scope = 'item' then
      select x->>'group' into v_group from jsonb_array_elements(p_charges) x where x->>'code' = d.target limit 1;
      item_left := jsonb_set(item_left, array[d.target], to_jsonb(v_base - v_cents));
      if v_group is not null then
        group_left := jsonb_set(group_left, array[v_group], to_jsonb(coalesce((group_left->>v_group)::bigint, 0) - v_cents));
      end if;
    elsif d.scope = 'group' then
      v_group := d.target;
      group_left := jsonb_set(group_left, array[d.target], to_jsonb(v_base - v_cents));
    end if;
    total_left := total_left - v_cents;

    v_what := case d.scope
      when 'total' then 'total'
      when 'group' then case d.target when 'tuition' then 'tuition' when 'lab' then 'lab fees'
                                      when 'misc' then 'miscellaneous' when 'other' then 'other fees' else d.target end
      else coalesce((select x->>'label' from jsonb_array_elements(p_charges) x where x->>'code' = d.target limit 1), d.target)
    end;
    out := out || jsonb_build_object('code', 'disc:' || d.id, 'group', v_group,
      'label', d.name || ' (' || case when d.kind = 'percent' then trim_scale(d.value) || '% of ' else fees_peso(d.value) || ' off ' end || v_what || ')',
      'cents', -v_cents);
  end loop;
  return out;
end $$;

-- Make the live rows of these kinds match the lines; unchanged lines are left alone (mirrors syncLines()).
create function fees_sync(p_enrollment uuid, p_lines jsonb, p_kind ledger_kind, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare v_code text; v_have bigint; v_want bigint; l jsonb; r ledger_entries; n int := 0;
begin
  for v_code in
    select code from fees_live(p_enrollment) where kind = p_kind
    union
    select x->>'code' from jsonb_array_elements(p_lines) x where (x->>'cents')::bigint <> 0
  loop
    select coalesce(sum(fees_cents(debit) - fees_cents(credit)), 0) into v_have
      from fees_live(p_enrollment) where kind = p_kind and code = v_code;
    select x into l from jsonb_array_elements(p_lines) x where x->>'code' = v_code and (x->>'cents')::bigint <> 0 limit 1;
    v_want := coalesce((l->>'cents')::bigint, 0);
    continue when v_have = v_want;
    for r in select * from fees_live(p_enrollment) where kind = p_kind and code = v_code loop
      perform fees_reverse(r, p_reason);
      n := n + 1;
    end loop;
    if v_want <> 0 then
      perform fees_post(p_enrollment, p_kind, v_code, l->>'group', l->>'label',
                        greatest(v_want, 0) / 100.0, greatest(-v_want, 0) / 100.0, null, null, null);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Posted charge lines (live rows, label of the latest row), as jsonb for fees_discount_lines.
create function fees_posted_charges(p_enrollment uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'group', grp, 'label', label, 'cents', cents)), '[]'::jsonb)
  from (
    select code, (array_agg(fee_group order by seq desc))[1] as grp, (array_agg(description order by seq desc))[1] as label,
           sum(fees_cents(debit) - fees_cents(credit)) as cents
    from fees_live(p_enrollment) where kind = 'charge' group by code
  ) q where cents <> 0;
$$;

create function fees_history(p_enrollment uuid, p_to enrollment_status, p_action text, p_reason text) returns void
language sql security definer set search_path = public as $$
  insert into enrollment_history (school_id, enrollment_id, from_status, to_status, action, reason, actor_id, actor_name)
  select e.school_id, e.id, e.status, p_to, p_action, p_reason, auth.uid(), fees_actor_name(e.school_id)
  from enrollments e where e.id = p_enrollment;
$$;

-- ---------- RPC: assess after a load change ----------
-- Registrar, or the student/parent while picking the load. Computed here from
-- the saved load and the fee setup, so the browser cannot choose the amounts.
create function fees_assess(p_enrollment uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e enrollments; v_charges jsonb; n int;
begin
  select * into e from enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'Enrollment not found.'; end if;
  if not (has_role(e.school_id, '{registrar}')
          or (owns_enrollment(e.id) and e.status in ('student_made', 'load_set'))) then
    raise exception 'Not allowed to assess this enrollment.';
  end if;
  if (select closed_at from terms where id = e.term_id) is not null then raise exception 'This term is closed.'; end if;
  v_charges := fees_charge_lines(e.id);
  if v_charges is null then raise exception 'No fee setup for this term yet. Ask the registrar to set up fees.'; end if;
  n := fees_sync(e.id, v_charges, 'charge', 'Reassessed after a load change');
  n := n + fees_sync(e.id, fees_discount_lines(e.id, v_charges), 'discount', 'Reassessed after a load change');
  return n;
end $$;

-- ---------- RPC: discounts (registrar) ----------
create function fees_apply_discount(
  p_enrollment uuid, p_name text, p_scope text, p_target text, p_kind text, p_value numeric, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare e enrollments; v_id uuid; v_charges jsonb;
begin
  select * into e from enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'Enrollment not found.'; end if;
  if not has_role(e.school_id, '{registrar}') then raise exception 'Only the registrar can apply discounts.'; end if;
  if (select closed_at from terms where id = e.term_id) is not null then raise exception 'This term is closed.'; end if;
  if e.status in ('rejected', 'withdrawn') then raise exception 'This enrollment is closed.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the discount a name.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Type the reason for the discount.'; end if;
  if not (p_value > 0) then raise exception 'Enter an amount or percent greater than zero.'; end if;
  if p_kind = 'percent' and p_value > 100 then raise exception 'A percent discount is at most 100%%.'; end if;
  v_charges := fees_posted_charges(e.id);
  if jsonb_array_length(v_charges) = 0 then raise exception 'No fees assessed yet. Set the load first.'; end if;
  if p_scope = 'item' and not exists (select 1 from jsonb_array_elements(v_charges) x where x->>'code' = p_target) then
    raise exception 'Pick the fee line to discount.';
  end if;
  if p_scope = 'group' and p_target not in ('tuition', 'lab', 'misc', 'other') then raise exception 'Pick the fee group to discount.'; end if;

  insert into discounts (school_id, enrollment_id, name, scope, target, kind, value, reason, applied_by, applied_by_name)
  values (e.school_id, e.id, trim(p_name), p_scope, case when p_scope = 'total' then null else p_target end,
          p_kind, p_value, trim(p_reason), auth.uid(), (select full_name from profiles where id = auth.uid()))
  returning id into v_id;
  perform fees_sync(e.id, fees_discount_lines(e.id, v_charges), 'discount', 'Discount applied: ' || trim(p_name));
  perform fees_history(e.id, e.status, 'apply_discount',
    trim(p_name) || ': ' || case when p_kind = 'percent' then trim_scale(p_value) || '%' else fees_peso(p_value) end
    || ' off ' || coalesce(p_target, 'total') || '. ' || trim(p_reason));
  return v_id;
end $$;

create function fees_remove_discount(p_discount uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d discounts; e enrollments;
begin
  select * into d from discounts where id = p_discount for update;
  if d.id is null or d.voided_at is not null then raise exception 'Discount not found.'; end if;
  select * into e from enrollments where id = d.enrollment_id for update;
  if not has_role(e.school_id, '{registrar}') then raise exception 'Only the registrar can remove discounts.'; end if;
  if (select closed_at from terms where id = e.term_id) is not null then raise exception 'This term is closed.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Type the reason for removing the discount.'; end if;
  update discounts set voided_at = now(), void_reason = trim(p_reason) where id = d.id;
  perform fees_sync(e.id, fees_discount_lines(e.id, fees_posted_charges(e.id)), 'discount', 'Discount removed: ' || trim(p_reason));
  perform fees_history(e.id, e.status, 'remove_discount', d.name || ' removed. ' || trim(p_reason));
end $$;

-- ---------- RPC: payments (cashier) — one transaction ----------
-- Saves the payment, its ledger row, the OR series, the status change
-- (load_set -> assessed_paid once the downpayment is reached) and history.
-- p_or_no empty = use the next number of the school's OR series.
create function fees_take_payment(
  p_enrollment uuid, p_amount numeric, p_mode payment_mode, p_reference text, p_or_no text
) returns payments language plpgsql security definer set search_path = public as $$
declare
  e enrollments; s fee_setups; ser or_series; v_or text; v_auto text; p payments; v_ref text;
  v_prev bigint; v_pen bigint; v_cur bigint; v_paid bigint; v_req bigint; v_to enrollment_status;
begin
  select * into e from enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'Enrollment not found.'; end if;
  if not has_role(e.school_id, '{cashier}') then raise exception 'Only the cashier can take payments.'; end if;
  if e.status not in ('load_set', 'assessed_paid', 'officially_enrolled') then
    raise exception 'Payments are taken once the load is set.';
  end if;
  if (select closed_at from terms where id = e.term_id) is not null then
    raise exception 'This term is closed. Take the payment on the next-term enrollment.';
  end if;
  if not (p_amount > 0) then raise exception 'Enter an amount greater than zero.'; end if;
  if round(p_amount, 2) <> p_amount then raise exception 'Amounts have at most 2 decimals (centavos).'; end if;
  v_ref := nullif(trim(coalesce(p_reference, '')), '');
  if p_mode <> 'cash' and v_ref is null then raise exception 'Enter the reference / check number.'; end if;

  insert into or_series (school_id) values (e.school_id) on conflict (school_id) do nothing;
  select * into ser from or_series where school_id = e.school_id for update;
  v_auto := ser.prefix || lpad(ser.next_no::text, ser.pad, '0');
  v_or := coalesce(nullif(trim(coalesce(p_or_no, '')), ''), v_auto);
  if exists (select 1 from payments where school_id = e.school_id and or_no = v_or) then
    raise exception 'OR #% is already used.', v_or;
  end if;
  if v_or = v_auto then update or_series set next_no = next_no + 1 where school_id = e.school_id; end if;

  insert into payments (school_id, enrollment_id, amount, or_no, mode, reference, cashier_id)
  values (e.school_id, e.id, p_amount, v_or, p_mode, v_ref, auth.uid()) returning * into p;
  perform fees_post(e.id, 'payment', 'pay:' || p.id, null,
    'Payment, OR #' || v_or || ' (' || case p_mode when 'cash' then 'Cash' when 'gcash' then 'GCash'
      when 'bank' then 'Bank transfer' else 'Check' end || coalesce(' ' || v_ref, '') || ')',
    0, p_amount, p.id, null, null);

  -- Downpayment reached? Back account + penalties + min(downpayment, this term's net fees).
  s := fees_setup_for(e.id);
  select coalesce(sum(fees_cents(debit) - fees_cents(credit)) filter (where kind = 'previous_balance'), 0),
         coalesce(sum(fees_cents(debit) - fees_cents(credit)) filter (where kind = 'penalty'), 0),
         coalesce(sum(fees_cents(debit) - fees_cents(credit)) filter (where kind in ('charge', 'discount')), 0),
         -coalesce(sum(fees_cents(debit) - fees_cents(credit)) filter (where kind = 'payment'), 0)
    into v_prev, v_pen, v_cur, v_paid
    from fees_live(e.id);
  v_req := greatest(v_prev, 0) + greatest(v_pen, 0)
         + case when v_cur > 0 then least(fees_cents(coalesce(s.min_downpayment, 0)), v_cur) else 0 end;
  v_to := case when e.status = 'load_set' and v_paid >= v_req then 'assessed_paid'::enrollment_status else e.status end;
  if v_to <> e.status then update enrollments set status = v_to, updated_at = now() where id = e.id; end if;
  perform fees_history(e.id, v_to, 'take_payment', 'Paid ' || fees_peso(p_amount) || ', OR #' || v_or);
  return p;
end $$;

-- Cashier: same day (Philippine time) only. Registrar: any day, as an override.
create function fees_void_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare p payments; e enrollments; r ledger_entries; v_why text;
begin
  select * into p from payments where id = p_payment for update;
  if p.id is null then raise exception 'Payment not found.'; end if;
  if p.voided_at is not null then raise exception 'This payment is already void.'; end if;
  select * into e from enrollments where id = p.enrollment_id for update;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Type the reason for the void.'; end if;
  if has_role(e.school_id, '{cashier}')
     and (p.paid_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date then
    v_why := trim(p_reason);
  elsif has_role(e.school_id, '{registrar}') then
    v_why := 'Registrar override: ' || trim(p_reason);
  elsif has_role(e.school_id, '{cashier}') then
    raise exception 'Cashiers can only void payments made today. Ask the registrar to override.';
  else
    raise exception 'Not allowed to void payments.';
  end if;
  if (select closed_at from terms where id = e.term_id) is not null then raise exception 'This term is closed.'; end if;
  select * into r from fees_live(e.id) where kind = 'payment' and payment_id = p.id limit 1;
  if r.id is null then raise exception 'The payment''s ledger row is missing.'; end if;
  perform fees_reverse(r, v_why);
  update payments set voided_at = now(), void_reason = v_why, voided_by = auth.uid() where id = p.id;
  perform fees_history(e.id, e.status, 'void_payment', 'Voided OR #' || p.or_no || ' (' || fees_peso(p.amount) || '). ' || v_why);
end $$;

-- ---------- term closing (registrar) ----------
create function fees_next_enrollment(p_student uuid, p_closing_term uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select e.id from enrollments e join terms t on t.id = e.term_id
  where e.student_id = p_student and e.term_id <> p_closing_term and t.closed_at is null and e.status <> 'rejected'
  order by e.created_at desc limit 1;
$$;

create function fees_close_term(p_term uuid) returns table (closed int, total numeric)
language plpgsql security definer set search_path = public as $$
declare t terms; r record; v_next uuid; v_label text; n int := 0; v_total numeric := 0;
begin
  select * into t from terms where id = p_term for update;
  if t.id is null then raise exception 'Term not found.'; end if;
  if not has_role(t.school_id, '{registrar}') then raise exception 'Only the registrar can close a term.'; end if;
  if t.closed_at is not null then raise exception 'This term is already closed.'; end if;
  v_label := fees_term_label(t.id);
  for r in
    select e.id, e.student_id, e.status, sum(fees_cents(l.debit) - fees_cents(l.credit)) as cents
    from enrollments e join ledger_entries l on l.enrollment_id = e.id
    where e.term_id = t.id
      and not exists (select 1 from ledger_entries c where c.enrollment_id = e.id and c.kind = 'carry_forward' and c.code = 'carry:' || e.id)
    group by e.id
    having sum(fees_cents(l.debit) - fees_cents(l.credit)) > 0
    order by e.created_at
  loop
    perform fees_post(r.id, 'carry_forward', 'carry:' || r.id, null,
      'Balance carried to next term (' || v_label || ' closed)', 0, r.cents / 100.0, null, null, 'Term closing');
    v_next := fees_next_enrollment(r.student_id, t.id);
    if v_next is not null then
      perform fees_post(v_next, 'previous_balance', 'prev:' || r.id, null,
        'Previous balance (' || v_label || ')', r.cents / 100.0, 0, null, null, 'Carried forward at term closing');
    end if;
    perform fees_history(r.id, r.status, 'close_term',
      'Balance of ' || fees_peso(r.cents / 100.0) || ' carried to ' || case when v_next is null then 'the next enrollment' else 'the next-term enrollment' end);
    n := n + 1;
    v_total := v_total + r.cents / 100.0;
  end loop;
  update terms set closed_at = now(), is_open = false where id = t.id;
  return query select n, v_total;
end $$;

-- A balance carried out of an earlier term lands on the student's next
-- enrollment as "Previous balance" as soon as that enrollment is created.
create function fees_carry_in() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select c.enrollment_id, fees_cents(c.credit) as cents, fees_term_label(c.term_id) as label
    from ledger_entries c
    where c.student_id = new.student_id and c.kind = 'carry_forward' and c.enrollment_id <> new.id
      and not exists (select 1 from ledger_entries v where v.reverses_id = c.id)
      and not exists (select 1 from ledger_entries p where p.kind = 'previous_balance' and p.code = 'prev:' || c.enrollment_id
                        and not exists (select 1 from ledger_entries v2 where v2.reverses_id = p.id))
  loop
    perform fees_post(new.id, 'previous_balance', 'prev:' || r.enrollment_id, null,
      'Previous balance (' || r.label || ')', r.cents / 100.0, 0, null, null, 'Carried forward at enrollment');
  end loop;
  return new;
end $$;

create trigger enrollments_carry_in after insert on enrollments
  for each row execute function fees_carry_in();

-- Helpers are internal: only the RPCs above are meant to be called.
revoke execute on function fees_post(uuid, ledger_kind, text, text, text, numeric, numeric, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function fees_reverse(ledger_entries, text) from public, anon, authenticated;
revoke execute on function fees_sync(uuid, jsonb, ledger_kind, text) from public, anon, authenticated;
revoke execute on function fees_history(uuid, enrollment_status, text, text) from public, anon, authenticated;
revoke execute on function fees_charge_lines(uuid) from public, anon, authenticated;
revoke execute on function fees_discount_lines(uuid, jsonb) from public, anon, authenticated;
revoke execute on function fees_posted_charges(uuid) from public, anon, authenticated;
revoke execute on function fees_live(uuid) from public, anon, authenticated;
