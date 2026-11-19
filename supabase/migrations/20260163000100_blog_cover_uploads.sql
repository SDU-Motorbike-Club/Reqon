-- =============================================================================
--  Public site: blog cover images are uploaded, not linked.
--
--  The website's public `blog-images` bucket already exists on the hosted project (images only, 10 MB each),
--  but nothing let Reqon write to it. Blog or Developer (can_post_blog()) may now add, replace and remove
--  files there; everyone reads them through the bucket's public URL, as the website does.
--
--  IMPLEMENTATION NOTE (migration policy)
--    Purpose        Let Reqon upload blog cover images into the website's bucket.
--    Existing data  Untouched. The bucket is created only where it is missing (a fresh database).
--    Locking        CREATE POLICY on storage.objects: brief.
--    Rollback       DROP POLICY reqon_blog_images_write ON storage.objects;
--    Deploy order   After 20260162000100 (can_post_blog()).
-- =============================================================================

-- Only where Supabase Storage exists (the disposable test database has none).
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('blog-images', 'blog-images', true, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
    on conflict (id) do nothing;

    execute 'drop policy if exists reqon_blog_images_write on storage.objects';
    execute $p$create policy reqon_blog_images_write on storage.objects for all to authenticated
      using (bucket_id = 'blog-images' and public.can_post_blog())
      with check (bucket_id = 'blog-images' and public.can_post_blog())$p$;
  end if;
end $$;
