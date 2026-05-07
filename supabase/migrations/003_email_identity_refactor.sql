begin;

-- Make members independent from pre-linked auth UUIDs.
alter table public.members alter column id set default gen_random_uuid();

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'members_id_fkey'
      and conrelid = 'public.members'::regclass
  ) then
    alter table public.members drop constraint members_id_fkey;
  end if;
end
$$;

alter table public.members
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- Email-driven admin resolution.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.is_admin
      from public.members m
      where lower(m.email) = lower(auth.jwt() ->> 'email')
      limit 1
    ),
    false
  );
$$;

-- Vote insert validation now binds member row to authenticated email.
create or replace function public.validate_vote_insert()
returns trigger
language plpgsql
as $$
declare
  election_row public.elections;
  auth_email text;
  member_email text;
begin
  auth_email := lower(auth.jwt() ->> 'email');

  if auth.uid() is null or auth_email is null then
    raise exception 'Authentication required.';
  end if;

  select lower(m.email)
  into member_email
  from public.members m
  where m.id = new.member_id;

  if member_email is null or member_email <> auth_email then
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

-- Vote item validation now binds through vote -> member.email.
create or replace function public.validate_vote_item_insert()
returns trigger
language plpgsql
as $$
declare
  election_row public.elections;
  vote_member uuid;
  vote_member_email text;
  auth_email text;
begin
  auth_email := lower(auth.jwt() ->> 'email');

  select v.member_id
  into vote_member
  from public.votes v
  where v.id = new.vote_id
    and v.election_id = new.election_id;

  if vote_member is null then
    raise exception 'Parent vote not found.';
  end if;

  select lower(m.email)
  into vote_member_email
  from public.members m
  where m.id = vote_member;

  if vote_member_email is null or vote_member_email <> auth_email then
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

-- Replace member/vote RLS policies with email-based ownership rules.
drop policy if exists members_self_read on public.members;
create policy members_self_read
on public.members
for select
using (
  lower(email) = lower(auth.jwt() ->> 'email')
  or (auth_user_id is not null and auth_user_id = auth.uid())
);

drop policy if exists votes_member_insert_own on public.votes;
create policy votes_member_insert_own
on public.votes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.members m
    where m.id = votes.member_id
      and lower(m.email) = lower(auth.jwt() ->> 'email')
      and m.is_eligible = true
  )
  and exists (
    select 1
    from public.elections e
    where e.id = votes.election_id
      and public.election_is_open(e)
  )
);

drop policy if exists votes_member_read_own on public.votes;
create policy votes_member_read_own
on public.votes
for select
to authenticated
using (
  exists (
    select 1
    from public.members m
    where m.id = votes.member_id
      and lower(m.email) = lower(auth.jwt() ->> 'email')
  )
);

drop policy if exists vote_items_member_insert_own on public.vote_items;
create policy vote_items_member_insert_own
on public.vote_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.votes v
    join public.members m on m.id = v.member_id
    join public.elections e on e.id = v.election_id
    where v.id = vote_items.vote_id
      and v.election_id = vote_items.election_id
      and lower(m.email) = lower(auth.jwt() ->> 'email')
      and public.election_is_open(e)
  )
);

drop policy if exists vote_items_member_read_own on public.vote_items;
create policy vote_items_member_read_own
on public.vote_items
for select
to authenticated
using (
  exists (
    select 1
    from public.votes v
    join public.members m on m.id = v.member_id
    where v.id = vote_items.vote_id
      and lower(m.email) = lower(auth.jwt() ->> 'email')
  )
);

-- Submission RPC resolves member by authenticated email.
create or replace function public.submit_vote(
  p_election_id uuid,
  p_selections jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member_id uuid;
  v_vote_id uuid;
  v_election public.elections;
  v_total_positions integer;
  v_item record;
  v_position_id uuid;
  v_candidate_id uuid;
  v_auth_email text;
begin
  v_auth_email := lower(auth.jwt() ->> 'email');

  if auth.uid() is null or v_auth_email is null then
    raise exception 'Authentication required.';
  end if;

  if p_selections is null or jsonb_typeof(p_selections) <> 'object' then
    raise exception 'Invalid selections payload.';
  end if;

  select m.id
  into v_member_id
  from public.members m
  where lower(m.email) = v_auth_email
  limit 1;

  if v_member_id is null then
    raise exception 'Email is not in the eligible members list.';
  end if;

  if not public.is_eligible_member(v_member_id) then
    raise exception 'Member is not eligible to vote.';
  end if;

  select *
  into v_election
  from public.elections e
  where e.id = p_election_id;

  if v_election.id is null then
    raise exception 'Election not found.';
  end if;

  if not public.election_is_open(v_election) then
    raise exception 'Voting is closed for this election.';
  end if;

  select count(*)
  into v_total_positions
  from public.positions p
  where p.election_id = p_election_id;

  if v_total_positions = 0 then
    raise exception 'This election has no positions.';
  end if;

  if jsonb_object_length(p_selections) <> v_total_positions then
    raise exception 'Selections must include exactly one candidate per position.';
  end if;

  insert into public.votes (election_id, member_id)
  values (p_election_id, v_member_id)
  returning id into v_vote_id;

  for v_item in
    select key, value
    from jsonb_each_text(p_selections)
  loop
    v_position_id := v_item.key::uuid;
    v_candidate_id := v_item.value::uuid;

    if not exists (
      select 1
      from public.positions p
      where p.id = v_position_id
        and p.election_id = p_election_id
    ) then
      raise exception 'Invalid position in selections.';
    end if;

    if not exists (
      select 1
      from public.candidates c
      where c.id = v_candidate_id
        and c.position_id = v_position_id
    ) then
      raise exception 'Invalid candidate for position.';
    end if;

    insert into public.vote_items (vote_id, election_id, position_id, candidate_id)
    values (v_vote_id, p_election_id, v_position_id, v_candidate_id);
  end loop;

  return v_vote_id;
end;
$$;

-- Simple eligibility/status RPC for frontend checks.
create or replace function public.get_my_voter_status()
returns table (
  eligible boolean,
  reason text,
  election_id uuid,
  already_voted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_email text;
  v_member public.members;
  v_active_election public.elections;
begin
  v_auth_email := lower(auth.jwt() ->> 'email');

  if auth.uid() is null or v_auth_email is null then
    return query select false, 'Unable to verify eligibility right now.'::text, null::uuid, false;
    return;
  end if;

  select *
  into v_member
  from public.members m
  where lower(m.email) = v_auth_email
  limit 1;

  if v_member.id is null then
    return query select false, 'Email is not in the eligible members list.'::text, null::uuid, false;
    return;
  end if;

  if not v_member.is_eligible then
    return query select false, 'This account is not allowed to vote.'::text, null::uuid, false;
    return;
  end if;

  select *
  into v_active_election
  from public.elections e
  where public.election_is_open(e)
  order by e.created_at desc
  limit 1;

  if v_active_election.id is null then
    return query select false, 'There is no active election right now.'::text, null::uuid, false;
    return;
  end if;

  if exists (
    select 1
    from public.votes v
    where v.election_id = v_active_election.id
      and v.member_id = v_member.id
  ) then
    return query select false, 'You have already voted in this election.'::text, v_active_election.id, true;
    return;
  end if;

  return query select true, null::text, v_active_election.id, false;
end;
$$;

grant execute on function public.get_my_voter_status() to authenticated;

commit;
