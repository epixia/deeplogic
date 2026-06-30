// Public, unauthenticated platform settings — currently the global appearance
// (brand accent + animated background) that the admin sets and that applies to
// the public homepage and as the platform-wide default. Read-only here; writes
// go through the admin router (admin-gated).

import { Router, type Request, type Response } from 'express';
import { serviceClient } from '../supabase.js';

export const platformRouter = Router();

export type BgKind = 'none' | 'network' | 'waves' | 'orbs' | 'wavefield' | 'mesh' | 'starfield';
export const BG_KINDS: readonly BgKind[] = ['none', 'network', 'waves', 'orbs', 'wavefield', 'mesh', 'starfield'];
export interface AppearanceSettings { brand: 'blue' | 'green' | 'grey'; bg: BgKind; skin: string }
const DEFAULT_APPEARANCE: AppearanceSettings = { brand: 'blue', bg: 'none', skin: 'aurora' };

export async function loadAppearance(): Promise<AppearanceSettings> {
  try {
    const { data } = await serviceClient.from('platform_settings').select('value').eq('key', 'appearance').maybeSingle();
    const v = (data?.value ?? {}) as Partial<AppearanceSettings>;
    return {
      brand: (['blue', 'green', 'grey'] as const).includes(v.brand as 'blue') ? v.brand! : DEFAULT_APPEARANCE.brand,
      bg: BG_KINDS.includes(v.bg as BgKind) ? v.bg! : DEFAULT_APPEARANCE.bg,
      skin: typeof v.skin === 'string' && v.skin ? v.skin : DEFAULT_APPEARANCE.skin,
    };
  } catch { return DEFAULT_APPEARANCE; }
}

export async function saveAppearance(next: AppearanceSettings): Promise<void> {
  await serviceClient.from('platform_settings').upsert(
    { key: 'appearance', value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' },
  );
}

// GET /api/platform/appearance — public (homepage reads this pre-login).
platformRouter.get('/platform/appearance', async (_req: Request, res: Response) => {
  res.json(await loadAppearance());
});
