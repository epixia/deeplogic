// Studio — home for DeepLogic Studio (the Lovable/Replit-style report builder).
// Tabs: "My reports" (the caller's private silo), "Shared" (org/published from
// others), and the Context Library manager. A "New report" modal seeds a project
// from blank, an uploaded .html, or a grounding semantic model, then opens it.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStickyTab } from '../lib/useStickyTab'
import { useAuth } from '../auth/AuthContext'
import {
  createStudioProject,
  deleteStudioProject,
  listModels,
  listStudioProjects,
  type StudioProjectListItem,
  type StudioVisibility,
} from '../lib/api'
import type { ModelListItem } from '../types'
import ContextLibrary from '../components/studio/ContextLibrary'
import ReportThumb from '../components/studio/ReportThumb'
import SuggestIdeasModal from '../components/studio/SuggestIdeasModal'
import DashboardScopeBar, { useDashboardScope, ALL_SCOPE } from '../components/DashboardScope'
import type { Idea } from '../lib/api'
import '../components/studio/studio.css'

type Tab = 'mine' | 'shared' | 'context'
const TABS: readonly Tab[] = ['mine', 'shared', 'context']
type ViewMode = 'cards' | 'list'
const VIEWS: readonly ViewMode[] = ['cards', 'list']
type StartMode = 'blank' | 'upload' | 'model'

function visibilityPill(v: StudioVisibility) {
  if (v === 'published')
    return <span className="studio-pill studio-pill-published">Published</span>
  if (v === 'org')
    return <span className="studio-pill studio-pill-org">Org</span>
  return <span className="studio-pill studio-pill-private">Private</span>
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function Studio() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useStickyTab<Tab>(`studio.tab.${orgId}`, 'mine', TABS)
  const [view, setView] = useStickyTab<ViewMode>(`studio.view.${orgId}`, 'cards', VIEWS)
  const [scope, setScope] = useDashboardScope(orgId)
  const [projects, setProjects] = useState<StudioProjectListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // new-report modal
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  const [startMode, setStartMode] = useState<StartMode>('blank')
  const [seedHtml, setSeedHtml] = useState('')
  const [seedFileName, setSeedFileName] = useState('')
  const [models, setModels] = useState<ModelListItem[]>([])
  const [modelId, setModelId] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // "⚡ Generate" — suggest a report from the Data Vault, then scaffold it and
  // open the editor with the prompt queued to auto-generate.
  const [showGen, setShowGen] = useState(false)
  async function generateFromIdea(idea: Idea) {
    const token = await getAccessToken()
    if (!token) throw new Error('Session expired — please sign in again.')
    const project = await createStudioProject(token, orgId, {
      name: idea.title,
      dashboardId: scope === ALL_SCOPE ? undefined : scope,
    })
    navigate(`/app/${orgId}/studio/${project.id}`, { state: { autoPrompt: idea.prompt } })
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      setProjects(await listStudioProjects(token, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const inScope = (p: StudioProjectListItem) => scope === ALL_SCOPE || p.dashboardId === scope
  const mine = useMemo(() => projects.filter((p) => p.isOwner && inScope(p)), [projects, scope])
  const shared = useMemo(
    () =>
      projects.filter((p) => !p.isOwner && p.visibility !== 'private' && inScope(p)),
    [projects, scope],
  )

  function openNew() {
    setName('')
    setStartMode('blank')
    setSeedHtml('')
    setSeedFileName('')
    setModelId('')
    setFormError(null)
    if (fileRef.current) fileRef.current.value = ''
    setShowNew(true)
    // lazy-load models for the grounding option
    void (async () => {
      try {
        const token = await getAccessToken()
        if (!token) return
        setModels(await listModels(token, orgId))
      } catch {
        /* grounding optional */
      }
    })()
  }

  async function onSeedFile(file: File) {
    try {
      const text = await file.text()
      setSeedHtml(text)
      setSeedFileName(file.name)
      if (!name) setName(file.name.replace(/\.html?$/i, ''))
    } catch {
      setFormError('Could not read that .html file.')
    }
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!name.trim()) {
      setFormError('Give your report a name.')
      return
    }
    if (startMode === 'upload' && !seedHtml) {
      setFormError('Upload an .html file to seed from.')
      return
    }
    if (startMode === 'model' && !modelId) {
      setFormError('Pick a model to ground in.')
      return
    }
    setCreating(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      const project = await createStudioProject(token, orgId, {
        name: name.trim(),
        seedHtml: startMode === 'upload' ? seedHtml : undefined,
        modelId: startMode === 'model' ? modelId : undefined,
        dashboardId: scope === ALL_SCOPE ? undefined : scope,
      })
      navigate(`/app/${orgId}/studio/${project.id}`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create report.')
      setCreating(false)
    }
  }

  async function remove(p: StudioProjectListItem) {
    if (!p.isOwner) return
    setBusyId(p.id)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired.')
      await deleteStudioProject(token, orgId, p.id)
      setProjects((prev) => prev.filter((x) => x.id !== p.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setBusyId(null)
    }
  }

  function ProjectCard({
    p,
    canDelete,
  }: {
    p: StudioProjectListItem
    canDelete: boolean
  }) {
    return (
      <div className="studio-card" style={{ position: 'relative' }}>
        {canDelete && (
          <button
            type="button"
            className="sc-delete-btn"
            disabled={busyId === p.id}
            title="Delete report"
            onClick={() => void remove(p)}
          >
            ✕
          </button>
        )}
        <Link
          to={`/app/${orgId}/studio/${p.id}`}
          className="studio-card-link"
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <ReportThumb html={p.html} />
          <h3>{p.name}</h3>
          <div className="studio-card-meta">
            {visibilityPill(p.visibility)}
            <span>Updated {fmtDate(p.updatedAt)}</span>
          </div>
          <div className="studio-card-owner">
            <span className="studio-owner-av">
              {(p.isOwner ? 'You' : p.ownerEmail || '?').charAt(0).toUpperCase()}
            </span>
            <span className="studio-owner-name">
              {p.isOwner ? 'Owned by you' : `Owned by ${p.ownerEmail || 'a teammate'}`}
            </span>
          </div>
        </Link>
      </div>
    )
  }

  function ProjectRow({
    p,
    canDelete,
  }: {
    p: StudioProjectListItem
    canDelete: boolean
  }) {
    return (
      <div className="studio-row">
        <Link to={`/app/${orgId}/studio/${p.id}`} className="studio-row-link">
          <div className="studio-row-thumb">
            <ReportThumb html={p.html} />
          </div>
          <div className="studio-row-main">
            <h3>{p.name}</h3>
            <div className="studio-card-owner">
              <span className="studio-owner-av">
                {(p.isOwner ? 'You' : p.ownerEmail || '?').charAt(0).toUpperCase()}
              </span>
              <span className="studio-owner-name">
                {p.isOwner ? 'Owned by you' : `Owned by ${p.ownerEmail || 'a teammate'}`}
              </span>
            </div>
          </div>
          <div className="studio-row-meta">
            {visibilityPill(p.visibility)}
            <span>Updated {fmtDate(p.updatedAt)}</span>
          </div>
        </Link>
        {canDelete && (
          <button
            type="button"
            className="studio-row-del"
            disabled={busyId === p.id}
            title="Delete report"
            onClick={() => void remove(p)}
          >
            ✕
          </button>
        )}
      </div>
    )
  }

  function ReportCollection({
    items,
    canDelete,
    withNew,
  }: {
    items: StudioProjectListItem[]
    canDelete: boolean
    withNew?: boolean
  }) {
    if (view === 'list') {
      return (
        <div className="studio-list">
          {items.map((p) => (
            <ProjectRow key={p.id} p={p} canDelete={canDelete} />
          ))}
          {withNew && (
            <button
              type="button"
              className="studio-row studio-row-new"
              onClick={openNew}
            >
              <span className="plus">+</span>
              New report
            </button>
          )}
        </div>
      )
    }
    return (
      <div className="studio-grid">
        {items.map((p) => (
          <ProjectCard key={p.id} p={p} canDelete={canDelete} />
        ))}
        {withNew && (
          <button
            type="button"
            className="studio-card studio-card-new"
            onClick={openNew}
          >
            <span className="plus">+</span>
            New report
          </button>
        )}
      </div>
    )
  }

  return (
    <main className="wrap studio">
      <header className="studio-head">
        <div>
          <h1>
            <span className="grad-text">Reports</span>
          </h1>
          <p className="studio-lead">
            Chat to generate self-contained HTML reports with live preview, code,
            and versions. Ground them in your real KPIs and an augmented context
            library. Share to your org or publish.
          </p>
        </div>
        <div className="studio-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowGen(true)}>
            ⚡ Generate
          </button>
          <button type="button" className="btn btn-ghost" onClick={openNew}>
            + New report
          </button>
        </div>
      </header>

      <DashboardScopeBar orgId={orgId} scope={scope} onChange={setScope} noun="reports" />

      <div className="studio-tabs">
        <button
          type="button"
          className={`studio-tab ${tab === 'mine' ? 'active' : ''}`}
          onClick={() => setTab('mine')}
        >
          My reports<span className="count">{mine.length}</span>
        </button>
        <button
          type="button"
          className={`studio-tab ${tab === 'shared' ? 'active' : ''}`}
          onClick={() => setTab('shared')}
        >
          Shared<span className="count">{shared.length}</span>
        </button>
        <button
          type="button"
          className={`studio-tab ${tab === 'context' ? 'active' : ''}`}
          onClick={() => setTab('context')}
        >
          Library
        </button>

        {tab !== 'context' && (
          <div className="studio-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`studio-view-btn ${view === 'cards' ? 'active' : ''}`}
              aria-pressed={view === 'cards'}
              title="Card view"
              onClick={() => setView('cards')}
            >
              ▦
            </button>
            <button
              type="button"
              className={`studio-view-btn ${view === 'list' ? 'active' : ''}`}
              aria-pressed={view === 'list'}
              title="List view"
              onClick={() => setView('list')}
            >
              ☰
            </button>
          </div>
        )}
      </div>

      {error && <div className="studio-error">{error}</div>}

      {tab === 'context' ? (
        <ContextLibrary orgId={orgId} />
      ) : tab === 'mine' ? (
        loading ? (
          <div className="studio-empty">Loading your reports…</div>
        ) : (
          <ReportCollection items={mine} canDelete withNew />
        )
      ) : loading ? (
        <div className="studio-empty">Loading shared reports…</div>
      ) : shared.length === 0 ? (
        <div className="studio-empty">
          No shared reports yet. When teammates share to the org or publish,
          they appear here.
        </div>
      ) : (
        <ReportCollection items={shared} canDelete={false} />
      )}

      {showNew && (
        <div
          className="studio-modal-backdrop"
          onClick={() => !creating && setShowNew(false)}
        >
          <form
            className="studio-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitNew}
          >
            <h2>New report</h2>
            <p className="studio-modal-sub">
              Start blank, seed from an existing HTML report, or ground in one of
              your org&apos;s semantic models.
            </p>

            <label className="studio-field">
              <span>Name</span>
              <input
                className="studio-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q3 Revenue Review"
                autoFocus
              />
            </label>

            <label className="studio-field">
              <span>Start from</span>
              <div className="studio-seg">
                <button
                  type="button"
                  className={`studio-seg-btn ${
                    startMode === 'blank' ? 'active' : ''
                  }`}
                  onClick={() => setStartMode('blank')}
                >
                  Blank
                </button>
                <button
                  type="button"
                  className={`studio-seg-btn ${
                    startMode === 'upload' ? 'active' : ''
                  }`}
                  onClick={() => setStartMode('upload')}
                >
                  Upload .html
                </button>
                <button
                  type="button"
                  className={`studio-seg-btn ${
                    startMode === 'model' ? 'active' : ''
                  }`}
                  onClick={() => setStartMode('model')}
                >
                  From a model
                </button>
              </div>
            </label>

            {startMode === 'upload' && (
              <label className="studio-field">
                <span>HTML file</span>
                <input
                  ref={fileRef}
                  className="studio-file"
                  type="file"
                  accept=".html,.htm"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void onSeedFile(f)
                  }}
                />
                {seedFileName && (
                  <p className="studio-file" style={{ marginTop: 6 }}>
                    {seedFileName} · {seedHtml.length.toLocaleString()} chars
                  </p>
                )}
              </label>
            )}

            {startMode === 'model' && (
              <label className="studio-field">
                <span>Grounding model</span>
                <select
                  className="studio-select"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  <option value="">Select a model…</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {models.length === 0 && (
                  <p className="studio-file" style={{ marginTop: 6 }}>
                    No models ingested yet — ingest one first to ground reports
                    in real KPIs.
                  </p>
                )}
              </label>
            )}

            {formError && <div className="studio-error">{formError}</div>}

            <div className="studio-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowNew(false)}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creating}
              >
                {creating ? 'Creating…' : 'Create & open'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showGen && (
        <SuggestIdeasModal
          orgId={orgId}
          target="report"
          actionLabel="Generate →"
          closeOnPick={false}
          onPick={generateFromIdea}
          onClose={() => setShowGen(false)}
        />
      )}
    </main>
  )
}
