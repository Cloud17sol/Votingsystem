begin;

alter table public.members
  add column if not exists password_set boolean not null default false;

comment on column public.members.password_set is
  'True after the member has completed first-time password setup (email OTP then set password).';

-- Anon-safe: whether the email is registered and whether they should use password vs OTP on the login page.
create or replace function public.get_member_login_auth_state(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'registered', true,
        'password_set', m.password_set
      )
      from public.members m
      where lower(m.email) = lower(btrim(p_email))
      limit 1
    ),
    jsonb_build_object('registered', false, 'password_set', false)
  );
$$;

grant execute on function public.get_member_login_auth_state(text) to anon, authenticated;

-- Called by the signed-in user after Supabase auth.updateUser({ password }).
create or replace function public.mark_member_password_set()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_n int;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  update public.members m
  set password_set = true,
      updated_at = now()
  where lower(m.email) = v_email;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Member row not found for this account';
  end if;
end;
$$;

grant execute on function public.mark_member_password_set() to authenticated;

commit;
