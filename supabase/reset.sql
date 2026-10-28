-- skolr-one: CLEAN START. Removes everything an earlier (full or half) run of setup-all.sql made,
-- so the setup can run again from zero. Only touches skolr-one tables and the demo logins.
drop trigger if exists on_auth_user_created on auth.users;
drop policy if exists "documents bucket read" on storage.objects;
drop policy if exists "documents bucket upload" on storage.objects;
drop schema if exists public cascade;
delete from auth.users where email like '%@sample.edu.ph';
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
