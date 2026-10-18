-- Paylog stores one JSON document per Supabase Auth user. Anonymous sessions
-- use the authenticated Postgres role, so the same owner-only RLS rules apply.
create table if not exists public.paylog_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{"version":1,"agreements":[],"payments":[],"earnings":[],"maintenanceRecords":[],"expenses":[],"heldTransfers":[],"ownerAllocations":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paylog_payload_is_object check (jsonb_typeof(payload) = 'object')
);

alter table public.paylog_data
  alter column payload set default '{"version":1,"agreements":[],"payments":[],"earnings":[],"maintenanceRecords":[],"expenses":[],"heldTransfers":[],"ownerAllocations":[]}'::jsonb;

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

-- Payment receipt images live in a private Storage bucket. Each object path
-- starts with the owning Auth user's UUID, for example:
-- <auth.uid()>/<payment-id>/<random-file-name>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts',
  'payment-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/gif', 'image/bmp']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own payment receipts" on storage.objects;
create policy "Users can read their own payment receipts"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can upload their own payment receipts" on storage.objects;
create policy "Users can upload their own payment receipts"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own payment receipts" on storage.objects;
create policy "Users can delete their own payment receipts"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
