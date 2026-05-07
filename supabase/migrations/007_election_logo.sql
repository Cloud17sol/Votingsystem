-- Election branding: public URL to logo image (Supabase Storage).
alter table public.elections
  add column if not exists logo_url text;

comment on column public.elections.logo_url is 'Public URL for election logo (e.g. Supabase Storage public URL).';

-- Storage bucket for election logos (public read; admins write via is_admin()).
insert into storage.buckets (id, name, public)
values ('election-logos', 'election-logos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Election logos public read" on storage.objects;
create policy "Election logos public read"
on storage.objects for select
using (bucket_id = 'election-logos');

drop policy if exists "Admins insert election logos" on storage.objects;
create policy "Admins insert election logos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'election-logos' and public.is_admin());

drop policy if exists "Admins update election logos" on storage.objects;
create policy "Admins update election logos"
on storage.objects for update
to authenticated
using (bucket_id = 'election-logos' and public.is_admin())
with check (bucket_id = 'election-logos' and public.is_admin());

drop policy if exists "Admins delete election logos" on storage.objects;
create policy "Admins delete election logos"
on storage.objects for delete
to authenticated
using (bucket_id = 'election-logos' and public.is_admin());
