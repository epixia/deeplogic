// StudioEditor — the Lovable/Replit-style vibecoding editor for a single Studio
// project at /app/:orgId/studio/:projectId.
//
//  * Owner view: split layout — LEFT a chat column (history + composer + context
//    chips + grounding model picker + "what the AI sees" drawer), RIGHT a
//    Preview/Code pane. TOP bar has an editable name (PATCH on blur), a
//    visibility selector, a versions dropdown (restore), and a back link.
//  * Non-owner: a read-only viewer (top bar + preview/code only, no chat).
//
// All network calls go through client/src/lib/api.ts and use the access token
// from useAuth().getAccessToken(). Uses the design tokens + studio.css.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  generateStudioReport,
  getCompiledContext,
  getStudioProject,
  listModels,
  updateStudioProject,
  type PromptAttachment,
  type StudioMessage,
  type StudioProject,
  type StudioVersion,
  type StudioVisibility,
} from '../lib/api'
import type { ModelListItem } from '../types'
import ChatPanel from '../components/studio/ChatPanel'
import PreviewPane from '../components/studio/PreviewPane'
import DataVault from '../components/studio/DataVault'
import '../components/studio/studio.css'

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function StudioEditor() {
  const { orgId = '', projectId = '' } = useParams<{
    orgId: string
    projectId: string
  }>()
  const { getAccessToken } = useAuth()

  const [project, setProject] = useState<StudioProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // live editor state derived from the project but updated optimistically
  const [html, setHtml] = useState('')
  const [messages, setMessages] = useState<StudioMessage[]>([])
  const [versions, setVersions] = useState<StudioVersion[]>([])
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<StudioVisibility>('private')
  const [modelId, setModelId] = useState<string | null>(null)

  const [models, setModels] = useState<ModelListItem[]>([])

  // generation state
  const [generating, setGenerating] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [lastUsedAI, setLastUsedAI] = useState<boolean | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  // top-bar UI
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [compiled, setCompiled] = useState<string | null>(null)
  const [compiledLoading, setCompiledLoading] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)

  const token = useCallback(async () => {
    const t = await getAccessToken()
    if (!t) throw new Error('Session expired — please sign in again.')
    return t
  }, [getAccessToken])

  // ---- initial load ----
  const hydrate = useCallback((p: StudioProject) => {
    setProject(p)
    setHtml(p.html)
    setMessages(p.messages)
    setVersions(p.versions)
    setName(p.name)
    setVisibility(p.visibility)
    setModelId(p.modelId)
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const t = await token()
        const p = await getStudioProject(t, orgId, projectId)
        if (!active) return
        hydrate(p)
      } catch (e) {
        if (active)
          setLoadError(e instanceof Error ? e.message : 'Failed to load report.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [token, orgId, projectId, hydrate])

  const isOwner = project?.isOwner ?? false

  // lazy-load grounding models (owner only)
  useEffect(() => {
    if (!isOwner) return
    let active = true
    ;(async () => {
      try {
        const t = await token()
        const list = await listModels(t, orgId)
        if (active) setModels(list)
      } catch {
        /* grounding optional */
      }
    })()
    return () => {
      active = false
    }
  }, [isOwner, token, orgId])

  // close versions menu on outside click
  useEffect(() => {
    if (!versionsOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setVersionsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [versionsOpen])

  // ---- mutations ----
  async function patch(p: {
    name?: string
    visibility?: StudioVisibility
    html?: string
    modelId?: string | null
  }) {
    try {
      const t = await token()
      const updated = await updateStudioProject(t, orgId, projectId, p)
      // keep version list / messages in sync with server truth
      setProject(updated)
      setVersions(updated.versions)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Save failed.')
    }
  }

  function onNameBlur() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === project?.name) {
      setName(project?.name ?? '')
      return
    }
    setName(trimmed)
    void patch({ name: trimmed })
  }

  function onVisibilityChange(v: StudioVisibility) {
    setVisibility(v)
    void patch({ visibility: v })
  }

  function onModelChange(next: string | null) {
    setModelId(next)
    void patch({ modelId: next })
  }

  function restoreVersion(v: StudioVersion) {
    setVersionsOpen(false)
    setHtml(v.html)
    void patch({ html: v.html })
  }

  async function onSend(prompt: string, attachments: PromptAttachment[] = []) {
    setGenError(null)
    setGenerating(true)
    setPendingPrompt(prompt)
    try {
      const t = await token()
      const res = await generateStudioReport(t, orgId, projectId, prompt, attachments)
      setHtml(res.html)
      setLastUsedAI(res.usedAI)
      if (res.aiError) {
        setGenError(`AI provider error: ${res.aiError} — check Settings → AI providers.`)
      }
      // server appended both the user + assistant messages and pushed a version;
      // reflect that locally (append the user prompt then the assistant reply).
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: prompt, ts: res.message.ts },
        res.message,
      ])
      setVersions((prev) =>
        [
          { html: res.html, prompt, ts: res.message.ts },
          ...prev,
        ].slice(0, 10),
      )
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed.')
    } finally {
      setGenerating(false)
      setPendingPrompt(null)
    }
  }

  async function openDrawer() {
    setDrawerOpen(true)
    setCompiledLoading(true)
    try {
      const t = await token()
      const res = await getCompiledContext(t, orgId, projectId)
      setCompiled(res.markdown)
    } catch (e) {
      setCompiled(
        e instanceof Error ? `Failed to load context:\n${e.message}` : 'Failed to load context.',
      )
    } finally {
      setCompiledLoading(false)
    }
  }

  const fileBase = useMemo(
    () => project?.slug || name || 'report',
    [project?.slug, name],
  )

  if (loading) {
    return (
      <main className="wrap studio">
        <div className="placeholder-panel">
          <div className="dl-spinner" />
          <h2>Loading editor…</h2>
        </div>
      </main>
    )
  }

  if (loadError || !project) {
    return (
      <main className="wrap studio">
        <div className="studio-empty">
          <p>{loadError ?? 'Report not found.'}</p>
          <Link to={`/app/${orgId}/studio`} className="btn btn-ghost btn-xs">
            ← Back to Reports
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="wrap studio studio-editor">
      {/* ---------- top bar ---------- */}
      <div className="editor-bar">
        <div className="editor-bar-left">
          <Link to={`/app/${orgId}/studio`} className="editor-back">
            ← Reports
          </Link>
          <input
            className="editor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={onNameBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            readOnly={!isOwner}
            aria-label="Report name"
          />
          {!isOwner && (
            <span className="editor-readonly">
              · Read-only · owned by {project.ownerEmail || 'a teammate'}
            </span>
          )}
        </div>

        <div className="editor-bar-right">
          {isOwner && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setVaultOpen(true)}
            >
              Data Vault ({project.vault?.length ?? 0})
            </button>
          )}
          {isOwner && (
            <select
              className="editor-vis"
              value={visibility}
              onChange={(e) =>
                onVisibilityChange(e.target.value as StudioVisibility)
              }
              aria-label="Visibility"
            >
              <option value="private">Private</option>
              <option value="org">Org</option>
              <option value="published">Published</option>
            </select>
          )}

          <div className="editor-menu" ref={menuRef}>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setVersionsOpen((o) => !o)}
            >
              Versions ({versions.length})
            </button>
            {versionsOpen && (
              <div className="editor-menu-pop">
                {versions.length === 0 ? (
                  <div className="editor-menu-empty">
                    No versions yet. Each generation snapshots the report here.
                  </div>
                ) : (
                  versions.map((v, i) => (
                    <button
                      key={`${v.ts}-${i}`}
                      type="button"
                      className="editor-menu-item"
                      onClick={() => isOwner && restoreVersion(v)}
                      disabled={!isOwner}
                      title={v.prompt}
                    >
                      <span className="v-prompt">
                        {v.prompt || 'Untitled change'}
                      </span>
                      <span className="v-when">{fmtTime(v.ts)}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- body ---------- */}
      {isOwner ? (
        <div className="studio-split">
          <ChatPanel
            orgId={orgId}
            messages={messages}
            hasHtml={!!html}
            generating={generating}
            pendingPrompt={pendingPrompt}
            lastUsedAI={lastUsedAI}
            models={models}
            modelId={modelId}
            onModelChange={onModelChange}
            onSend={onSend}
            onShowContext={() => void openDrawer()}
            error={genError}
          />
          <PreviewPane html={html} fileBase={fileBase} />
        </div>
      ) : (
        <PreviewPane html={html} fileBase={fileBase} />
      )}

      {/* ---------- Data Vault drawer ---------- */}
      {vaultOpen && isOwner && (
        <div
          className="editor-drawer-backdrop"
          onClick={() => setVaultOpen(false)}
        >
          <aside className="editor-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="editor-drawer-head">
              <div>
                <h2>Report Data Vault</h2>
                <div className="sub">
                  Files, MCP servers, APIs &amp; notes the AI uses for this report.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setVaultOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="editor-drawer-body">
              <DataVault
                orgId={orgId}
                projectId={projectId}
                vault={project.vault ?? []}
                getToken={token}
                onChange={(p) => setProject(p)}
              />
            </div>
          </aside>
        </div>
      )}

      {/* ---------- "what the AI sees" drawer ---------- */}
      {drawerOpen && (
        <div
          className="editor-drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
        >
          <aside className="editor-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="editor-drawer-head">
              <div>
                <h2>What the AI sees</h2>
                <div className="sub">
                  Compiled CONTEXT.md — enabled context items + grounding model.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setDrawerOpen(false)}
              >
                Close
              </button>
            </div>
            <pre>
              {compiledLoading
                ? 'Compiling context…'
                : compiled ?? 'No context.'}
            </pre>
          </aside>
        </div>
      )}
    </main>
  )
}
