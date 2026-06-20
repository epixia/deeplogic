-- Public storage bucket for product thumbnails we scrape & re-host (so we never
-- hotlink external sites). Writes happen server-side via the service role (which
-- bypasses storage RLS); the bucket is public so the browser can read the images.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;
