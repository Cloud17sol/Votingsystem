begin;

create or replace function public.is_registered_voter_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members m
    where lower(m.email) = lower(btrim(p_email))
  );
$$;

grant execute on function public.is_registered_voter_email(text) to anon, authenticated;

commit;
