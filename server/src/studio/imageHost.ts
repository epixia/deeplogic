// Image re-hosting — download an external image and store it in our own Supabase
// Storage bucket, so the app serves product thumbnails from our domain instead
// of hotlinking the source (which often blocks hotlinking or disappears).

import { createHash } from 'node:crypto';
import { serviceClient } from '../supabase.js';

const BUCKET = 'product-images';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; DeepLogic/1.0; +https://deeplogic.app)' };
const MAX_BYTES = 5_000_000;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
};

// Download `srcUrl` and upload it to the product-images bucket. Returns the
// public URL on success, or undefined (caller keeps the original / no image).
export async function hostImage(orgId: string, srcUrl: string): Promise<string | undefined> {
  try {
    if (!/^https?:\/\//i.test(srcUrl)) return undefined;
    const r = await fetch(srcUrl, { headers: UA, signal: AbortSignal.timeout(12_000), redirect: 'follow' });
    if (!r.ok) return undefined;
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ct.startsWith('image/')) return undefined;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return undefined;

    const ext = EXT[ct] ?? 'img';
    const hash = createHash('sha1').update(buf).digest('hex').slice(0, 20);
    const path = `${orgId}/${hash}.${ext}`;

    const up = await serviceClient.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
    if (up.error) return undefined;
    return serviceClient.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || undefined;
  } catch {
    return undefined;
  }
}
