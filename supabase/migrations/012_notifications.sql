begin;

-- Site announcements: public (login page) vs member-only (after sign-in).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  body text not null check (btrim(body) <> ''),
  audience text not null check (audience in ('public', 'member')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create index notifications_audience_sort_created_idx
  on public.notifications (audience, sort_order asc, created_at desc);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

create policy notifications_select_public
on public.notifications
for select
to anon, authenticated
using (audience = 'public');

create policy notifications_select_member
on public.notifications
for select
to authenticated
using (
  audience = 'member'
  and exists (
    select 1
    from public.members m
    where lower(trim(m.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
);

create policy notifications_admin_all
on public.notifications
for all
using (public.is_admin())
with check (public.is_admin());

commit;
