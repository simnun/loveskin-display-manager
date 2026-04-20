-- Storage policies for media bucket
create policy "auth can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media');

create policy "auth can update" on storage.objects
  for update to authenticated
  using (bucket_id = 'media');

create policy "auth can delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media');

create policy "public can view" on storage.objects
  for select to anon
  using (bucket_id = 'media');
