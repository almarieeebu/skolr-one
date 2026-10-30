-- skolr-one: REMOVE THE PRACTICE LOGINS before real people use the app.
-- Run it once in the Supabase SQL Editor (safe to run again).
--
-- It finds the sample logins made by seed.sql (emails ending in @sample.edu.ph,
-- and the sample applicant APP-2026-00001) and:
--   1. takes away their access: memberships, parent links, and the link from a
--      student record to the login;
--   2. deletes the login when nothing else points to it;
--   3. otherwise (the login is named in the history, a payment, a grade...) it
--      cannot be deleted without losing that record, so the login is switched off
--      instead: banned, given a random password nobody knows, and signed out.
--
-- It does NOT delete the sample school, students, enrollments, fees or grades.
-- To wipe everything and start empty, run reset.sql instead.

do $$
declare
  r record;
  v_deleted int := 0;
  v_disabled int := 0;
begin
  perform set_config('search_path', 'public, extensions', true);

  for r in
    select id, email from auth.users
    where lower(email) like '%@sample.edu.ph'
       -- Every login made by seed.sql has a fixed id like this one.
       or id::text like '00000000-0000-4000-8000-%'
  loop
    delete from public.memberships where user_id = r.id;
    delete from public.parent_links where parent_user_id = r.id;
    update public.students set user_id = null where user_id = r.id;
    update public.students set guardian_user_id = null where guardian_user_id = r.id;

    begin
      delete from auth.users where id = r.id;
      v_deleted := v_deleted + 1;
    exception when foreign_key_violation then
      update auth.users
        set encrypted_password = crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')),
            banned_until = 'infinity',
            updated_at = now()
        where id = r.id;
      delete from auth.sessions where user_id = r.id;
      v_disabled := v_disabled + 1;
    end;
  end loop;

  raise notice 'Practice logins deleted: %, switched off (kept for the records): %', v_deleted, v_disabled;
end $$;
