-- Fuzzy Needle waivers: run this once in Supabase → SQL Editor → New query.
--
-- After running it:
--   1. Authentication → Users → "Add user": create a login for each admin (email + password).
--   2. Make that user an admin (replace the email):
--        insert into public.admins (user_id)
--        select id from auth.users where email = 'you@example.com';
--   3. Authentication → Sign In / Providers: turn OFF "Allow new users to sign up".
--      (Admins are also checked against the admins table, so a stray sign-up still can't read waivers.)
--   4. Project Settings → API: copy the Project URL and the anon/publishable key into config.js.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.waivers (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  full_name       text not null check (char_length(full_name) between 2 and 200),
  dob             date not null,
  phone           text not null check (char_length(phone) <= 40),
  contact_method  text not null check (contact_method in ('Email', 'Instagram')),
  email           text check (char_length(email) <= 254),
  instagram       text check (char_length(instagram) <= 100),
  concerns        text check (char_length(concerns) <= 4000),
  signature       text not null check (char_length(signature) between 2 and 200),
  -- Snapshot of every statement shown, exactly as worded at signing time:
  -- [{ "tag": "Consent", "text": "...", "agreed": true }, ...]
  agreements      jsonb not null default '[]'::jsonb
                  check (jsonb_typeof(agreements) = 'array' and pg_column_size(agreements) < 40000),
  user_agent      text check (char_length(user_agent) <= 500),
  reviewed_at     timestamptz,
  reviewed_by     uuid references auth.users (id) on delete set null
);

-- Drawn signature: { "w": 480, "h": 200, "strokes": [[[x,y],[x,y],...], ...] } in pad pixels.
-- (Added after the first version, so it's an ALTER: re-running this whole file is safe.)
alter table public.waivers add column if not exists signature_strokes jsonb
  check (signature_strokes is null or (jsonb_typeof(signature_strokes) = 'object' and pg_column_size(signature_strokes) < 300000));

create index if not exists waivers_created_at_idx on public.waivers (created_at desc);

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper: is the current user an admin?
-- security definer so it can read admins without exposing that table.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Clients (anon) can only INSERT. They can never read anything back.
-- Admins can read, mark reviewed, and delete.
-- ---------------------------------------------------------------------------

alter table public.waivers enable row level security;
alter table public.admins  enable row level security;

drop policy if exists "clients can submit a waiver" on public.waivers;
create policy "clients can submit a waiver"
  on public.waivers for insert
  to anon, authenticated
  with check (reviewed_at is null and reviewed_by is null);

drop policy if exists "admins can read waivers" on public.waivers;
create policy "admins can read waivers"
  on public.waivers for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins can update waivers" on public.waivers;
create policy "admins can update waivers"
  on public.waivers for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins can delete waivers" on public.waivers;
create policy "admins can delete waivers"
  on public.waivers for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "admins can see their own admin row" on public.admins;
create policy "admins can see their own admin row"
  on public.admins for select
  to authenticated
  using (user_id = auth.uid());

-- Admins may only change the review fields, not what the client signed.
revoke update on public.waivers from anon, authenticated;
grant  update (reviewed_at, reviewed_by) on public.waivers to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates in the admin page (new waivers appear without refreshing)
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.waivers;
exception when duplicate_object then null;
end $$;
