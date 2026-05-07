begin;

-- Positions shown on the public nominations form (separate from election ballot positions).
create table public.nomination_positions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create unique index nomination_positions_name_lower_idx
  on public.nomination_positions (lower(btrim(name)));

create table public.nominations (
  id uuid primary key default gen_random_uuid(),
  nomination_position_id uuid not null references public.nomination_positions(id) on delete restrict,
  nominee_full_name text not null check (btrim(nominee_full_name) <> ''),
  created_at timestamptz not null default now()
);

create index nominations_position_idx on public.nominations (nomination_position_id);
create index nominations_created_idx on public.nominations (created_at desc);

alter table public.nomination_positions enable row level security;
alter table public.nominations enable row level security;
alter table public.nomination_positions force row level security;
alter table public.nominations force row level security;

create policy nomination_positions_select_public
on public.nomination_positions
for select
to anon, authenticated
using (true);

create policy nomination_positions_admin_all
on public.nomination_positions
for all
using (public.is_admin())
with check (public.is_admin());

create policy nominations_insert_public
on public.nominations
for insert
to anon, authenticated
with check (
  exists (
    select 1
    from public.nomination_positions p
    where p.id = nominations.nomination_position_id
  )
);

create policy nominations_admin_select
on public.nominations
for select
using (public.is_admin());

create policy nominations_admin_delete
on public.nominations
for delete
using (public.is_admin());

commit;
