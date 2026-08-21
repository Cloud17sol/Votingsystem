begin;

-- Aggregate turnout only (no PII). Callable by authenticated members for open elections.
create or replace function public.get_election_turnout_stats(p_election_id uuid)
returns table (
  registered_eligible bigint,
  votes_cast bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return query select 0::bigint, 0::bigint;
    return;
  end if;

  if p_election_id is null
     or not exists (
       select 1
       from public.elections e
       where e.id = p_election_id
         and public.election_is_open(e)
     )
  then
    return query select 0::bigint, 0::bigint;
    return;
  end if;

  return query
  select
    (
      select count(*)::bigint
      from public.members m
      where m.is_eligible = true
    ),
    (
      select count(*)::bigint
      from public.votes v
      where v.election_id = p_election_id
    );
end;
$$;

grant execute on function public.get_election_turnout_stats(uuid) to authenticated;

commit;
