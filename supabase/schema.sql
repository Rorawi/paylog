-- Paylog stores one JSON document per Supabase Auth user. Anonymous sessions
-- use the authenticated Postgres role, so the same owner-only RLS rules apply.
create table if not exists public.paylog_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{"version":1,"agreements":[],"payments":[],"earnings":[],"expenses":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paylog_payload_is_object check (jsonb_typeof(payload) = 'object')
);

alter table public.paylog_data enable row level security;

grant usage on schema public to authenticated;
revoke all on table public.paylog_data from public, anon, authenticated;
grant select, insert, update on table public.paylog_data to authenticated;

drop policy if exists "Users can read their own Paylog data" on public.paylog_data;
create policy "Users can read their own Paylog data"
  on public.paylog_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own Paylog data" on public.paylog_data;
create policy "Users can create their own Paylog data"
  on public.paylog_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Paylog data" on public.paylog_data;
create policy "Users can update their own Paylog data"
  on public.paylog_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
