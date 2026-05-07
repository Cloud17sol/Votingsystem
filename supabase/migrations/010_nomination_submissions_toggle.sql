begin;

-- Single-row settings for the public nominations form (not tied to a specific election).
create table public.nomination_config (
  id smallint primary key default 1 check (id = 1),
  submissions_open boolean not null default true
);

insert into public.nomination_config (id, submissions_open)
values (1, true)
on conflict (id) do nothing;

alter table public.nomination_config enable row level security;
alter table public.nomination_config force row level security;

create policy nomination_config_select_public
on public.nomination_config
for select
to anon, authenticated
using (true);

create policy nomination_config_admin_update
on public.nomination_config
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists nominations_insert_public on public.nominations;

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
  and exists (
    select 1
    from public.nomination_config c
    where c.id = 1
      and c.submissions_open = true
  )
);

commit;
