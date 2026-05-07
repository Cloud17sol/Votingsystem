begin;

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
begin
  v_member_id := auth.uid();

  if v_member_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_selections is null or jsonb_typeof(p_selections) <> 'object' then
    raise exception 'Invalid selections payload.';
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

grant execute on function public.submit_vote(uuid, jsonb) to authenticated;

commit;
