// Admin Appearance — the GLOBAL look of the platform: brand accent colour and
// the homepage animated background. Saved server-side; applies to the public
// homepage and as the platform-wide default for everyone (a signed-in user can
// still override locally in Settings → Appearance).

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { getAdminAppearance, saveAdminAppearance, type PlatformAppearance } from '../../lib/api'
import { BRANDS, SKINS, setGlobalBrand, setGlobalSkin, saveBrand, saveSkin, type BrandId } from '../../styles/skins'
import { BG_OPTIONS, setGlobalBg, saveBg, type BgId } from '../../lib/bgPrefs'
import BgCanvas from '../../components/BgCanvas'
import AdminLayout from './AdminLayout'
import './admin.css'
import './admin-appearance.css'

export default function AdminAppearance() {
  const { getAccessToken } = useAuth()
  const [brand, setBrand] = useState<BrandId>('blue')
  const [bg, setBg] = useState<BgId>('none')
  const [skin, setSkin] = useState<string>('aurora')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const token = useCallback(async () => (await getAccessToken()) ?? '', [getAccessToken])

  useEffect(() => {
    void (async () => {
      try { const a = await getAdminAppearance(await token()); setBrand(a.brand); setBg(a.bg); setSkin(a.skin) }
      catch { /* defaults */ } finally { setLoading(false) }
    })()
  }, [token])

  // Live preview as you pick. We write the local value too (saveBrand/etc.) so the
  // change is visible even on a device that has its own saved override — otherwise
  // the local choice would mask the global one.
  function pickBrand(b: BrandId) { setBrand(b); saveBrand(b); setGlobalBrand(b) }
  function pickBg(b: BgId) { setBg(b); saveBg(b); setGlobalBg(b) }
  function pickSkin(id: string) { setSkin(id); saveSkin(id); setGlobalSkin(id) }

  async function save() {
    setSaving(true); setNote(null)
    try {
      const saved = await saveAdminAppearance(await token(), { brand, bg, skin } as PlatformAppearance)
      saveBrand(saved.brand); saveBg(saved.bg); saveSkin(saved.skin)
      setGlobalBrand(saved.brand); setGlobalBg(saved.bg); setGlobalSkin(saved.skin)
      setNote('Saved — applied to the homepage and as the platform default.')
      setTimeout(() => setNote(null), 3000)
    } catch (e) { setNote(e instanceof Error ? e.message : 'Save failed.') } finally { setSaving(false) }
  }

  return (
    <AdminLayout>
      <div className="adm-appear">
        <h1>Appearance</h1>
        <p className="adm-appear-sub">
          Global look for the <strong>public homepage</strong> and the platform default. Signed-in users can still pick their own in Settings → Appearance.
        </p>

        {loading ? <div className="studio-empty">Loading…</div> : (
          <>
            <section className="adm-appear-card">
              <h2>Theme style</h2>
              <p className="adm-appear-hint">The palette for the whole platform (light &amp; dark). Generated Blocks &amp; reports follow it too.</p>
              <div className="adm-appear-skins">
                {SKINS.map((s) => (
                  <button key={s.id} type="button" className={`adm-skin${skin === s.id ? ' sel' : ''}`} onClick={() => pickSkin(s.id)}>
                    <span className="adm-skin-prev" style={{ background: s.swatch.bg }}>
                      <span className="adm-skin-card" style={{ background: s.swatch.card }}>
                        <span className="adm-skin-dot" style={{ background: s.swatch.accent }} />
                        <span className="adm-skin-line" style={{ background: s.swatch.ink }} />
                      </span>
                    </span>
                    <span className="adm-skin-name">{s.label}{skin === s.id && ' ✓'}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="adm-appear-card">
              <h2>Brand colour</h2>
              <div className="adm-appear-brands">
                {BRANDS.map((b) => (
                  <button key={b.id} type="button" className={`adm-brand${brand === b.id ? ' sel' : ''}`} onClick={() => pickBrand(b.id)}>
                    <span className="adm-brand-sw" style={{ background: b.swatch }} />
                    <span>{b.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="adm-appear-card">
              <h2>Homepage animated background</h2>
              <p className="adm-appear-hint">Shows on the <strong>public homepage</strong> only, in your brand colour. Pick one to preview it live below.</p>
              <div className="adm-appear-bgs">
                {BG_OPTIONS.map((o) => (
                  <button key={o.id} type="button" className={`adm-bg${bg === o.id ? ' sel' : ''}`} onClick={() => pickBg(o.id)}>
                    <span className="adm-bg-name">{o.label}{bg === o.id && ' ✓'}</span>
                    <span className="adm-bg-desc">{o.description}</span>
                  </button>
                ))}
              </div>
              <div className="adm-bg-preview">
                {bg === 'none'
                  ? <span className="adm-bg-preview-none">No animation</span>
                  : <BgCanvas bg={bg} className="adm-bg-preview-canvas" />}
              </div>
            </section>

            <div className="adm-appear-foot">
              {note && <span className="adm-appear-note">{note}</span>}
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save global appearance'}</button>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
