// Admin Integrations — global, platform-wide service keys (HeyGen / Vapi) shared
// by all orgs. Values are stored in the server .env file; saving writes them
// back and applies them live. Keys are hidden by default — click "Show keys".

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { getAdminIntegrations, saveAdminIntegrations, type AdminIntegrations } from '../../lib/api'
import AdminLayout from './AdminLayout'
import './admin.css'

const BLANK: AdminIntegrations = {
  heygenApiKey: '', heygenAvatarId: '', heygenVoiceId: '',
  vapiApiKey: '', vapiPublicKey: '', vapiPhoneNumberId: '', vapiVoiceId: '', vapiWebhookSecret: '', publicApiUrl: '',
}

export default function AdminIntegrations() {
  const { getAccessToken } = useAuth()
  const [s, setS] = useState<AdminIntegrations>(BLANK)
  const [reveal, setReveal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const token = useCallback(async () => (await getAccessToken()) ?? '', [getAccessToken])

  useEffect(() => {
    void (async () => {
      try { setS({ ...BLANK, ...(await getAdminIntegrations(await token())) }) }
      catch (e) { setError(e instanceof Error ? e.message : 'Failed to load integrations.') }
      finally { setLoading(false) }
    })()
  }, [token])

  const set = <K extends keyof AdminIntegrations>(k: K, v: string) => setS((p) => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true); setError(null); setNote(null)
    try {
      setS({ ...BLANK, ...(await saveAdminIntegrations(await token(), s)) })
      setNote('Saved to .env and applied live.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.') }
    finally { setSaving(false) }
  }

  const keyType = reveal ? 'text' : 'password'

  return (
    <AdminLayout>
      <div className="bb">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 className="bb-h1" style={{ margin: 0 }}>🔌 Service Integrations</h1>
          <button className="btn btn-ghost btn-xs" style={{ marginLeft: 'auto' }} onClick={() => setReveal((r) => !r)}>
            {reveal ? '🙈 Hide keys' : '👁 Show keys'}
          </button>
        </div>
        <p className="bb-lead">Global API keys for the avatar &amp; voice interview services — shared by all organizations. Stored in the server <code>.env</code> file; saving applies them immediately (no restart).</p>

        {error && <div className="bb-error">{error}</div>}
        {note && <div className="bb-note">{note}</div>}

        {loading ? <p className="bb-lead">Loading…</p> : (
          <>
            <section className="bb-card">
              <h2>🧑‍💼 HeyGen / LiveAvatar <span className="bb-lead" style={{ fontWeight: 400 }}>— avatar interviewer</span></h2>
              <div className="bb-grid">
                <label className="studio-field" style={{ gridColumn: 'span 2' }}><span>LiveAvatar API key <code>HEYGEN_API_KEY</code></span>
                  <input className="studio-input" type={keyType} value={s.heygenApiKey} onChange={(e) => set('heygenApiKey', e.target.value)} autoComplete="off" spellCheck={false} placeholder="not set" /></label>
                <label className="studio-field"><span>Avatar ID <code>HEYGEN_AVATAR_ID</code></span><input className="studio-input" value={s.heygenAvatarId} onChange={(e) => set('heygenAvatarId', e.target.value)} placeholder="avatar UUID" /></label>
                <label className="studio-field"><span>Voice ID <code>HEYGEN_VOICE_ID</code></span><input className="studio-input" value={s.heygenVoiceId} onChange={(e) => set('heygenVoiceId', e.target.value)} placeholder="optional" /></label>
              </div>
              <p className="bb-lead">Get a key at <code>app.liveavatar.com/developers</code>.</p>
            </section>

            <section className="bb-card">
              <h2>📞 Vapi <span className="bb-lead" style={{ fontWeight: 400 }}>— phone &amp; in-browser voice interviews</span></h2>
              <div className="bb-grid">
                <label className="studio-field"><span>Private API key <code>VAPI_API_KEY</code></span>
                  <input className="studio-input" type={keyType} value={s.vapiApiKey} onChange={(e) => set('vapiApiKey', e.target.value)} autoComplete="off" spellCheck={false} placeholder="not set" /></label>
                <label className="studio-field"><span>Public key <code>VAPI_PUBLIC_KEY</code></span><input className="studio-input" value={s.vapiPublicKey} onChange={(e) => set('vapiPublicKey', e.target.value)} placeholder="browser voice calls" /></label>
                <label className="studio-field"><span>Phone number ID <code>VAPI_PHONE_NUMBER_ID</code></span><input className="studio-input" value={s.vapiPhoneNumberId} onChange={(e) => set('vapiPhoneNumberId', e.target.value)} placeholder="number to call FROM" /></label>
                <label className="studio-field"><span>Voice ID <code>VAPI_VOICE_ID</code></span><input className="studio-input" value={s.vapiVoiceId} onChange={(e) => set('vapiVoiceId', e.target.value)} placeholder="Elliot" /></label>
                <label className="studio-field"><span>Webhook secret <code>VAPI_WEBHOOK_SECRET</code></span>
                  <input className="studio-input" type={keyType} value={s.vapiWebhookSecret} onChange={(e) => set('vapiWebhookSecret', e.target.value)} autoComplete="off" spellCheck={false} placeholder="optional" /></label>
                <label className="studio-field" style={{ gridColumn: 'span 2' }}><span>Public API URL <code>PUBLIC_API_URL</code></span><input className="studio-input" value={s.publicApiUrl} onChange={(e) => set('publicApiUrl', e.target.value)} placeholder="https://api.yourdomain.com (for phone transcripts)" /></label>
              </div>
            </section>

            <div className="bb-actions">
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save to .env'}</button>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
