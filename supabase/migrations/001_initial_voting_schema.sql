-- Phase 1: Alumni election voting schema (Supabase / PostgreSQL)
-- Includes tables, constraints, indexes, triggers, and RLS policies.

begin;

-- Required for gen_random_uuid()
create extension if not exists pgcrypto;

-- =========================
-- Utility functions
-- =========================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- Core tables
-- =========================

-- Eligible alumni and admins.
-- id maps directly to auth.users.id (OTP login identity).
create table if not exists public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null check (btrim(full_name) <> ''),
  graduation_year integer check (graduation_year is null or graduation_year between 1900 and 2100),
  is_eligible boolean not null default true,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One election row total (MVP scope).
create table if not exists public.elections (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  starts_at timestamptz,
  ends_at timestamptz not null,
  created_by uuid references public.members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at > starts_at)
);

-- Offices/positions in an election.
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (election_id, name),
  unique (id, election_id)
);

-- Candidates under a specific position.
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  manifesto text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (position_id, full_name),
  unique (id, position_id)
);

-- One submitted vote per member per election.
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (election_id, member_id),
  unique (id, election_id)
);

-- Selected candidate per position within a vote.
create table if not exists public.vote_items (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null,
  election_id uuid not null,
  position_id uuid not null,
  candidate_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (vote_id, election_id)
    references public.votes(id, election_id)
    on delete cascade,
  foreign key (position_id, election_id)
    references public.positions(id, election_id)
    on delete restrict,
  foreign key (candidate_id, position_id)
    references public.candidates(id, position_id)
    on delete restrict,
  unique (vote_id, position_id)
);

-- Enforce MVP: only one election can exist.
create unique index if not exists one_election_only_idx on public.elections ((true));
create unique index if not exists members_email_lower_unique_idx on public.members (lower(email));

-- Helper functions that depend on created tables.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.is_admin from public.members m where m.id = auth.uid()),
    false
  );
$$;

create or replace function public.is_eligible_member(member_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.is_eligible
      from public.members m
      where m.id = member_uuid
    ),
    false
  );
$$;

create or replace function public.election_is_open(e public.elections)
returns boolean
language sql
stable
as $$
  select
    e.status = 'open'
    and (e.starts_at is null or now() >= e.starts_at)
    and now() < e.ends_at;
$$;

-- =========================
-- Indexes
-- =========================

create index if not exists members_admin_idx on public.members (is_admin) where is_admin = true;
create index if not exists members_eligible_idx on public.members (is_eligible) where is_eligible = true;

create index if not exists positions_election_sort_idx on public.positions (election_id, sort_order);
create index if not exists candidates_position_idx on public.candidates (position_id);

create index if not exists votes_election_submitted_idx on public.votes (election_id, submitted_at);
create index if not exists votes_member_idx on public.votes (member_id);

create index if not exists vote_items_vote_idx on public.vote_items (vote_id);
create index if not exists vote_items_candidate_idx on public.vote_items (candidate_id);
create index if not exists vote_items_position_idx on public.vote_items (position_id);

-- =========================
-- Triggers
-- =========================

create trigger members_set_updated_at
before update on public.members
for each row execute function public.set_updated_at();

create trigger elections_set_updated_at
before update on public.elections
for each row execute function public.set_updated_at();

create trigger positions_set_updated_at
before update on public.positions
for each row execute function public.set_updated_at();

create trigger candidates_set_updated_at
before update on public.candidates
for each row execute function public.set_updated_at();

-- Prevent vote creation when election is closed/expired or member is ineligible.
create or replace function public.validate_vote_insert()
returns trigger
language plpgsql
as $$
declare
  election_row public.elections;
begin
  if new.member_id <> auth.uid() then
    raise exception 'You can only create your own vote.';
  end if;

  if not public.is_eligible_member(new.member_id) then
    raise exception 'Member is not eligible to vote.';
  end if;

  select *
  into election_row
  from public.elections e
  where e.id = new.election_id;

  if election_row.id is null then
    raise exception 'Election not found.';
  end if;

  if not public.election_is_open(election_row) then
    raise exception 'Voting is closed for this election.';
  end if;

  if exists (
    select 1
    from public.votes v
    where v.election_id = new.election_id
      and v.member_id = new.member_id
  ) then
    raise exception 'Member has already submitted a vote for this election.';
  end if;

  return new;
end;
$$;

create trigger votes_validate_insert
before insert on public.votes
for each row execute function public.validate_vote_insert();

-- Prevent item creation when election is closed/expired.
create or replace function public.validate_vote_item_insert()
returns trigger
language plpgsql
as $$
declare
  election_row public.elections;
  vote_member uuid;
begin
  select v.member_id
  into vote_member
  from public.votes v
  where v.id = new.vote_id
    and v.election_id = new.election_id;

  if vote_member is null then
    raise exception 'Parent vote not found.';
  end if;

  if vote_member <> auth.uid() then
    raise exception 'You can only add items to your own vote.';
  end if;

  select *
  into election_row
  from public.elections e
  where e.id = new.election_id;

  if election_row.id is null then
    raise exception 'Election not found.';
  end if;

  if not public.election_is_open(election_row) then
    raise exception 'Voting is closed for this election.';
  end if;

  if exists (
    select 1
    from public.vote_items vi
    where vi.vote_id = new.vote_id
      and vi.position_id = new.position_id
  ) then
    raise exception 'A selection for this position already exists in this vote.';
  end if;

  return new;
end;
$$;

create trigger vote_items_validate_insert
before insert on public.vote_items
for each row execute function public.validate_vote_item_insert();

-- =========================
-- Row Level Security (RLS)
-- =========================

alter table public.members enable row level security;
alter table public.elections enable row level security;
alter table public.positions enable row level security;
alter table public.candidates enable row level security;
alter table public.votes enable row level security;
alter table public.vote_items enable row level security;
alter table public.members force row level security;
alter table public.elections force row level security;
alter table public.positions force row level security;
alter table public.candidates force row level security;
alter table public.votes force row level security;
alter table public.vote_items force row level security;

-- MEMBERS
-- Admin full access.
create policy members_admin_all
on public.members
for all
using (public.is_admin())
with check (public.is_admin());

-- Logged-in user can read own membership row.
create policy members_self_read
on public.members
for select
using (id = auth.uid());

-- ELECTIONS
-- Public can read election metadata needed for voting if election is currently open.
create policy elections_public_read_open
on public.elections
for select
to anon, authenticated
using (public.election_is_open(elections));

-- Admin full access.
create policy elections_admin_all
on public.elections
for all
using (public.is_admin())
with check (public.is_admin());

-- POSITIONS
-- Public can read positions for currently open election.
create policy positions_public_read_open
on public.positions
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.elections e
    where e.id = positions.election_id
      and public.election_is_open(e)
  )
);

-- Admin full access.
create policy positions_admin_all
on public.positions
for all
using (public.is_admin())
with check (public.is_admin());

-- CANDIDATES
-- Public can read candidates for currently open election.
create policy candidates_public_read_open
on public.candidates
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.positions p
    join public.elections e on e.id = p.election_id
    where p.id = candidates.position_id
      and public.election_is_open(e)
  )
);

-- Admin full access.
create policy candidates_admin_all
on public.candidates
for all
using (public.is_admin())
with check (public.is_admin());

-- VOTES
-- Member can insert exactly one own vote per election (DB uniqueness + RLS + trigger).
create policy votes_member_insert_own
on public.votes
for insert
to authenticated
with check (
  member_id = auth.uid()
  and public.is_eligible_member(member_id)
  and exists (
    select 1
    from public.elections e
    where e.id = votes.election_id
      and public.election_is_open(e)
  )
);

-- Member can read own vote(s).
create policy votes_member_read_own
on public.votes
for select
to authenticated
using (member_id = auth.uid());

-- Admin full access.
create policy votes_admin_all
on public.votes
for all
using (public.is_admin())
with check (public.is_admin());

-- VOTE ITEMS
-- Member can insert only items that belong to own vote in open election.
create policy vote_items_member_insert_own
on public.vote_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.votes v
    join public.elections e on e.id = v.election_id
    where v.id = vote_items.vote_id
      and v.election_id = vote_items.election_id
      and v.member_id = auth.uid()
      and public.election_is_open(e)
  )
);

-- Member can read own vote items.
create policy vote_items_member_read_own
on public.vote_items
for select
to authenticated
using (
  exists (
    select 1
    from public.votes v
    where v.id = vote_items.vote_id
      and v.member_id = auth.uid()
  )
);

-- Admin full access.
create policy vote_items_admin_all
on public.vote_items
for all
using (public.is_admin())
with check (public.is_admin());

commit;
