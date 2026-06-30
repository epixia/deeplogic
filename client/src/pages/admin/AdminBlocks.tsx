// Admin Blocks — manage every Block in the gallery: admin-built (DB) blocks with
// enable/disable, edit (in the Builder), and delete; plus the built-in blocks
// that ship with the app (read-only, for reference).

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { adminListGalleryBlocks, adminSaveGalleryBlock, adminDeleteGalleryBlock, type DbGalleryBlock, type GalleryBlockDraft } from '../../lib/api'
import { BLOCK_GALLERY, type GalleryBlock } from '../../lib/blockGallery'
import AdminLayout from './AdminLayout'
import './admin.css'

function toDraft(b: DbGalleryBlock): GalleryBlockDraft {
  return { slug: b.slug, name: b.name, icon: b.icon, category: b.category, tagline: b.tagline, description: b.description, sizeW: b.size_w, sizeH: b.size_h, fields: b.fields, htmlTemplate: b.html_template, docsUrl: b.docs_url ?? undefined, enabled: b.enabled }
}

export default function AdminBlocks() {
  const { getAccessToken } = useAuth()
  const [blocks, setBlocks] = useState<DbGalleryBlock[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const token = useCallback(async () => (await getAccessToken()) ?? '', [getAccessToken])
  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await adminListGalleryBlocks(await token()); setBlocks(r.blocks) } catch { /* ignore */ } finally { setLoading(false) }
  }, [token])
  useEffect(() => { void load() }, [load])

  async function toggle(b: DbGalleryBlock) {
    setBusy(b.id)
    try { await adminSaveGalleryBlock(await token(), { ...toDraft(b), enabled: !b.enabled }); await load() } catch { /* ignore */ } finally { setBusy(null) }
  }
  async function del(b: DbGalleryBlock) {
    if (!confirm(`Delete "${b.name}" from the gallery? This cannot be undone.`)) return
    setBusy(b.id)
    try { await adminDeleteGalleryBlock(await token(), b.id); await load() } catch { /* ignore */ } finally { setBusy(null) }
  }

  // Built-in overrides: a DB row whose slug matches a built-in's id edits/hides it.
  const overrides = new Map(blocks.map((r) => [r.slug, r]))
  const builtinIds = new Set(BLOCK_GALLERY.map((b) => b.id))

  async function toggleBuiltin(b: GalleryBlock) {
    const ov = overrides.get(b.id)
    setBusy(b.id)
    try {
      await adminSaveGalleryBlock(await token(), {
        slug: b.id, name: ov?.name || b.name, icon: ov?.icon || b.icon,
        category: ov?.category || b.category, tagline: ov?.tagline ?? b.tagline ?? '',
        description: ov?.description ?? b.description ?? '',
        sizeW: ov?.size_w || b.size?.w || 2, sizeH: ov?.size_h || b.size?.h || 2,
        fields: ov?.fields ?? [], htmlTemplate: ov?.html_template ?? '',
        enabled: !(ov ? ov.enabled : true),
      })
      await load()
    } catch { /* ignore */ } finally { setBusy(null) }
  }
  async function resetBuiltin(b: GalleryBlock) {
    const ov = overrides.get(b.id)
    if (!ov) return
    if (!confirm(`Reset "${b.name}" to its built-in defaults?`)) return
    setBusy(b.id)
    try { await adminDeleteGalleryBlock(await token(), ov.id); await load() } catch { /* ignore */ } finally { setBusy(null) }
  }

  const ql = q.trim().toLowerCase()
  const match = (name: string, cat: string, tag: string) => !ql || name.toLowerCase().includes(ql) || cat.toLowerCase().includes(ql) || tag.toLowerCase().includes(ql)
  const custom = blocks.filter((r) => !builtinIds.has(r.slug) && match(r.name, r.category, r.tagline))
  const builtins = BLOCK_GALLERY.filter((b) => match(b.name, b.category, b.tagline))

  return (
    <AdminLayout>
      <div className="bb">
        <div className="bb-head-row">
          <h1 className="bb-h1">🧱 Blocks</h1>
          <Link to="/admin/block-builder" className="btn btn-primary btn-sm">✨ Block Builder</Link>
        </div>
        <p className="bb-lead">Manage every Block in the gallery. Custom blocks are admin-built and editable; built-ins ship with the app.</p>
        <input className="studio-input bb-search" placeholder="Search blocks…" value={q} onChange={(e) => setQ(e.target.value)} />

        <section className="bb-card">
          <h2>Custom blocks <span className="bb-count">{custom.length}</span></h2>
          {loading ? (
            <p className="bb-lead">Loading…</p>
          ) : custom.length === 0 ? (
            <p className="bb-lead">No admin-built blocks{ql ? ' match your search' : ' yet'}. Create one in the <Link to="/admin/block-builder">Block Builder</Link>.</p>
          ) : (
            <table className="bb-table">
              <thead><tr><th /><th>Name</th><th>Category</th><th>Size</th><th>Status</th><th /></tr></thead>
              <tbody>
                {custom.map((b) => (
                  <tr key={b.id} className={busy === b.id ? 'bb-busy' : ''}>
                    <td className="bb-t-ic">{b.icon}</td>
                    <td><div className="bb-t-name">{b.name}</div><div className="bb-t-sub">{b.tagline}</div></td>
                    <td>{b.category}</td>
                    <td>{b.size_w}×{b.size_h}</td>
                    <td>{b.enabled ? <span className="bb-on">Enabled</span> : <span className="bb-off">Disabled</span>}</td>
                    <td className="bb-t-actions">
                      <Link to={`/admin/block-builder?edit=${encodeURIComponent(b.slug)}`} className="btn btn-ghost btn-xs">Edit</Link>
                      <button className="btn btn-ghost btn-xs" disabled={busy === b.id} onClick={() => void toggle(b)}>{b.enabled ? 'Disable' : 'Enable'}</button>
                      <button className="btn btn-ghost btn-xs bb-del" disabled={busy === b.id} onClick={() => void del(b)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="bb-card">
          <h2>Built-in blocks <span className="bb-count">{builtins.length}</span></h2>
          <p className="bb-lead" style={{ marginTop: 0 }}>Built-in blocks ship in code. You can edit their name/icon/category/size, <strong>Disable</strong> to hide them from everyone&apos;s gallery, or <strong>Reset</strong> a customization. (Their HTML logic isn&apos;t editable.)</p>
          <table className="bb-table">
            <thead><tr><th /><th>Name</th><th>Category</th><th>Size</th><th>Status</th><th /></tr></thead>
            <tbody>
              {builtins.map((b) => {
                const ov = overrides.get(b.id)
                const en = ov ? ov.enabled : true
                return (
                  <tr key={b.id} className={busy === b.id ? 'bb-busy' : ''}>
                    <td className="bb-t-ic">{ov?.icon || b.icon}</td>
                    <td>
                      <div className="bb-t-name">{ov?.name || b.name} {ov && <span className="bb-on" style={{ fontSize: 10 }}>customized</span>}</div>
                      <div className="bb-t-sub">{ov?.tagline ?? b.tagline}</div>
                    </td>
                    <td>{ov?.category || b.category}</td>
                    <td>{(ov?.size_w || b.size?.w || 2)}×{(ov?.size_h || b.size?.h || 2)}</td>
                    <td>{en ? <span className="bb-on">Enabled</span> : <span className="bb-off">Hidden</span>}</td>
                    <td className="bb-t-actions">
                      <Link to={`/admin/block-builder?edit=${encodeURIComponent(b.id)}`} className="btn btn-ghost btn-xs">Edit</Link>
                      <button className="btn btn-ghost btn-xs" disabled={busy === b.id} onClick={() => void toggleBuiltin(b)}>{en ? 'Disable' : 'Enable'}</button>
                      {ov && <button className="btn btn-ghost btn-xs bb-del" disabled={busy === b.id} onClick={() => void resetBuiltin(b)}>Reset</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      </div>
    </AdminLayout>
  )
}
