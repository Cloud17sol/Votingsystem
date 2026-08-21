begin;

-- Public registration requests; admins approve before a members row is created.
create table public.member_registration_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (btrim(full_name) <> ''),
  email text not null check (btrim(email) <> ''),
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_email text
);

create index member_registration_requests_status_created_idx
  on public.member_registration_requests (status, created_at desc);

create unique index member_registration_requests_pending_email_uidx
  on public.member_registration_requests (lower(email))
  where status = 'pending';

alter table public.member_registration_requests enable row level security;
alter table public.member_registration_requests force row level security;

create policy member_registration_requests_admin_all
on public.member_registration_requests
for all
using (public.is_admin())
with check (public.is_admin());

-- Anon/authenticated: submit a pending request (no direct table insert).
create or replace function public.submit_member_registration_request(
  p_full_name text,
  p_email text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_name = '' or length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Please enter your full name.');
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Please enter a valid email address.');
  end if;

  if exists (
    select 1 from public.members m where lower(m.email) = v_email
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'This email is already registered. Please sign in instead.'
    );
  end if;

  if exists (
    select 1
    from public.member_registration_requests r
    where lower(r.email) = v_email
      and r.status = 'pending'
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'A registration request for this email is already pending review.'
    );
  end if;

  insert into public.member_registration_requests (full_name, email, note, status)
  values (v_name, v_email, v_note, 'pending');

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.submit_member_registration_request(text, text, text) to anon, authenticated;

create or replace function public.approve_member_registration_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.member_registration_requests;
  v_reviewer text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Admin access required.');
  end if;

  select * into v_req
  from public.member_registration_requests
  where id = p_request_id
  for update;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;

  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'This request was already reviewed.');
  end if;

  if exists (select 1 from public.members m where lower(m.email) = lower(v_req.email)) then
    update public.member_registration_requests
    set status = 'approved',
        reviewed_at = now(),
        reviewer_email = nullif(v_reviewer, '')
    where id = v_req.id;
    return jsonb_build_object(
      'ok', true,
      'message', 'Email was already a member; request marked approved.'
    );
  end if;

  insert into public.members (email, full_name, is_eligible, is_admin, password_set)
  values (lower(v_req.email), v_req.full_name, true, false, false);

  update public.member_registration_requests
  set status = 'approved',
      reviewed_at = now(),
      reviewer_email = nullif(v_reviewer, '')
  where id = v_req.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.approve_member_registration_request(uuid) to authenticated;

create or replace function public.reject_member_registration_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.member_registration_requests;
  v_reviewer text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Admin access required.');
  end if;

  select * into v_req
  from public.member_registration_requests
  where id = p_request_id
  for update;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;

  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'This request was already reviewed.');
  end if;

  update public.member_registration_requests
  set status = 'rejected',
      reviewed_at = now(),
      reviewer_email = nullif(v_reviewer, '')
  where id = v_req.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.reject_member_registration_request(uuid) to authenticated;

commit;
