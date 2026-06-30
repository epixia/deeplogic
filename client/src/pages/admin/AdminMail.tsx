// Admin Mail — configure the outbound SMTP server used for platform emails
// (password resets, notifications). Stored server-side; the password is never
// sent back to the browser. Includes a "send test email" button.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { getMailSettings, saveMailSettings, testMailSettings, type MailSettings } from '../../lib/api'
import AdminLayout from './AdminLayout'
import './admin.css'

const BLANK: MailSettings = { host: '', port: 587, secure: false, username: '', password: '', fromName: '', fromEmail: '' }

export default function AdminMail() {
  const { getAccessToken } = useAuth()
  const [s, setS] = useState<MailSettings>(BLANK)
  const [hasPassword, setHasPassword] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const token = useCallback(async () => (await getAccessToken()) ?? '', [getAccessToken])
  useEffect(() => {
    void (async () => {
      try {
        const r = await getMailSettings(await token())
        setS({ ...r.settings, password: '' })
        setHasPassword(!!r.settings.hasPassword)
      } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load mail settings.') } finally { setLoading(false) }
    })()
  }, [token])

  const set = <K extends keyof MailSettings>(k: K, v: MailSettings[K]) => setS((p) => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true); setError(null); setNote(null)
    try {
      const r = await saveMailSettings(await token(), s)
      setS({ ...r.settings, password: '' }); setHasPassword(!!r.settings.hasPassword)
      setNote('Saved.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.') } finally { setSaving(false) }
  }

  async function test() {
    if (!testTo.trim()) { setError('Enter a recipient address for the test.'); return }
    setTesting(true); setError(null); setNote(null)
    try {
      await testMailSettings(await token(), { ...s, to: testTo.trim() })
      setNote(`Test email sent to ${testTo.trim()}.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Test send failed.') } finally { setTesting(false) }
  }

  return (
    <AdminLayout>
      <div className="bb">
        <h1 className="bb-h1">✉️ Mail Server</h1>
        <p className="bb-lead">Configure the SMTP server used to send platform emails. The password is stored on the server and never returned to the browser.</p>

        {error && <div className="bb-error">{error}</div>}
        {note && <div className="bb-note">{note}</div>}

        {loading ? <p className="bb-lead">Loading…</p> : (
          <>
            <section className="bb-card">
              <h2>SMTP connection</h2>
              <div className="bb-grid">
                <label className="studio-field" style={{ gridColumn: 'span 2' }}><span>Host</span><input className="studio-input" value={s.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.example.com" /></label>
                <label className="studio-field"><span>Port</span><input className="studio-input" type="number" value={s.port} onChange={(e) => set('port', Number(e.target.value))} /></label>
                <label className="studio-field"><span>Username</span><input className="studio-input" value={s.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" /></label>
                <label className="studio-field"><span>Password {hasPassword && <span className="bb-on">(set)</span>}</span><input className="studio-input" type="password" value={s.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" placeholder={hasPassword ? '•••••• (leave blank to keep)' : ''} /></label>
                <label className="studio-field" style={{ alignSelf: 'end' }}><span className="bb-check"><input type="checkbox" checked={s.secure} onChange={(e) => set('secure', e.target.checked)} /> Use TLS/SSL (port 465)</span></label>
              </div>
            </section>

            <section className="bb-card">
              <h2>Sender</h2>
              <div className="bb-grid">
                <label className="studio-field"><span>From name</span><input className="studio-input" value={s.fromName} onChange={(e) => set('fromName', e.target.value)} placeholder="DeepLogic" /></label>
                <label className="studio-field" style={{ gridColumn: 'span 2' }}><span>From email</span><input className="studio-input" value={s.fromEmail} onChange={(e) => set('fromEmail', e.target.value)} placeholder="no-reply@example.com" /></label>
              </div>
              <div className="bb-actions">
                <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
              </div>
            </section>

            <section className="bb-card">
              <h2>Send a test email</h2>
              <p className="bb-lead">Uses the values above (saved or not) to verify the connection and deliver a test message.</p>
              <div className="bb-grid">
                <label className="studio-field" style={{ gridColumn: 'span 2' }}><span>Recipient</span><input className="studio-input" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" /></label>
              </div>
              <div className="bb-actions">
                <button className="btn btn-ghost" onClick={() => void test()} disabled={testing}>{testing ? 'Sending…' : '✉️ Send test'}</button>
              </div>
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
