begin;

-- If this migration was already applied in an older form (email_redacted + mask_email_local_four),
-- run once: drop function if exists public.search_members_by_name_for_login(text);
--           drop function if exists public.mask_email_local_four(text);
-- then re-run this migration (e.g. `supabase db push` after fixing migration history) or paste this file in the SQL editor.

-- Split an email for login search display: ~20% of local part visible, ~80% blurred;
-- domain host (before final .tld like .com) uses the same rule; suffix (e.g. .com) stays clear.
create or replace function public.email_mask_parts(p_email text)
returns table (
  local_visible text,
  local_blur_len integer,
  domain_visible text,
  domain_blur_len integer,
  suffix text
)
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(trim(p_email));
  v_at integer;
  v_local text;
  v_domain text;
  n_lv integer;
  ll integer;
  prefix_dom text;
  sfx text;
  n_dv integer;
  dl integer;
begin
  v_at := position('@' in v);
  if v_at < 2 then
    return query select '', 0, '', 0, '';
    return;
  end if;

  v_local := substring(v from 1 for v_at - 1);
  v_domain := substring(v from v_at + 1);

  if length(v_local) = 0 then
    return query select '', 0, left(v_domain, 1), greatest(0, length(v_domain) - 1), '';
    return;
  end if;

  -- ceil(0.2 * n) via (2n + 9) / 10; at least 1 character visible when local is non-empty
  n_lv := least(length(v_local), greatest(1, (length(v_local) * 2 + 9) / 10));
  ll := greatest(0, length(v_local) - n_lv);

  if v_domain = '' then
    return query select substring(v_local from 1 for n_lv), ll, '', 0, '';
    return;
  end if;

  -- Suffix = from last dot (.com, .org, .co.uk only keeps final label + dot — e.g. .uk for yahoo.co.uk)
  if position('.' in v_domain) = 0 then
    prefix_dom := v_domain;
    sfx := '';
  else
    sfx := substring(v_domain from '\.[^.]+$');
    prefix_dom := left(v_domain, length(v_domain) - length(sfx));
  end if;

  if prefix_dom is null or length(prefix_dom) = 0 then
    return query select substring(v_local from 1 for n_lv), ll, '', 0, coalesce(sfx, '');
    return;
  end if;

  n_dv := least(length(prefix_dom), greatest(1, (length(prefix_dom) * 2 + 9) / 10));
  dl := greatest(0, length(prefix_dom) - n_dv);

  return query
    select
      substring(v_local from 1 for n_lv),
      ll,
      substring(prefix_dom from 1 for n_dv),
      dl,
      sfx;
end;
$$;

drop function if exists public.search_members_by_name_for_login(text);
drop function if exists public.mask_email_local_four(text);

create function public.search_members_by_name_for_login(p_query text)
returns table (
  full_name text,
  email_local_visible text,
  email_local_blur_len integer,
  email_domain_visible text,
  email_domain_blur_len integer,
  email_suffix text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.full_name,
    p.local_visible,
    p.local_blur_len,
    p.domain_visible,
    p.domain_blur_len,
    p.suffix
  from public.members m
  cross join lateral public.email_mask_parts(m.email) p
  where length(trim(p_query)) >= 3
    and strpos(lower(m.full_name), lower(trim(p_query))) > 0
  order by m.full_name
  limit 25;
$$;

grant execute on function public.search_members_by_name_for_login(text) to anon, authenticated;

commit;
