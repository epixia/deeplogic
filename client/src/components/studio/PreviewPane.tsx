// PreviewPane — the RIGHT pane of the Studio editor. Tabs: Preview / Code.
//   Preview = E2B sandboxed iframe (different origin, fully isolated).
//             Falls back to srcDoc while sandbox warms up or if E2B unavailable.
//   Code    = read-only <pre> of the HTML with Copy + Download (.html) actions.

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { createSandbox, killSandbox, updateSandbox } from '../../lib/api'
import { applyReportTheme, useAppTheme } from './reportTheme'

interface Props {
  orgId: string
  html: string
  generating: boolean
  fileBase: string
}

type PaneTab = 'preview' | 'code'

export default function PreviewPane({ orgId, html, generating, fileBase }: Props) {
  const [tab, setTab] = useState<PaneTab>('preview')
  const [copied, setCopied] = useState(false)
  const theme = useAppTheme()
  const { getAccessToken } = useAuth()

  // E2B sandbox state
  const [sandboxId, setSandboxId] = useState<string | null>(null)
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null)
  const [sandboxLoading, setSandboxLoading] = useState(false)
  const [sandboxError, setSandboxError] = useState<string | null>(null)
  // cache-bust the iframe src when HTML updates in an existing sandbox
  const [previewKey, setPreviewKey] = useState(0)

  const sandboxIdRef = useRef<string | null>(null)
  sandboxIdRef.current = sandboxId

  const safeBase =
    (fileBase || 'report').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'report'

  // Kill sandbox on unmount
  useEffect(() => {
    return () => {
      const id = sandboxIdRef.current
      if (!id) return
      getAccessToken().then((token) => {
        if (token) killSandbox(token, orgId, id).catch(() => {})
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // Create or update sandbox when generation finishes and we have HTML
  useEffect(() => {
    if (generating || !html) return

    let cancelled = false

    async function syncSandbox() {
      const token = await getAccessToken()
      if (!token || cancelled) return

      const currentId = sandboxIdRef.current

      if (currentId) {
        // Update existing sandbox
        try {
          await updateSandbox(token, orgId, currentId, applyReportTheme(html, theme))
          if (!cancelled) setPreviewKey((k) => k + 1)
        } catch (err: unknown) {
          // 410 = sandbox expired — create a fresh one
          const expired =
            err instanceof Error && err.message.includes('410')
          if (!expired) return
          setSandboxId(null)
          setSandboxUrl(null)
          sandboxIdRef.current = null
          await boot(token)
        }
      } else {
        await boot(token)
      }
    }

    async function boot(token: string) {
      if (cancelled) return
      setSandboxLoading(true)
      setSandboxError(null)
      try {
        const info = await createSandbox(token, orgId, applyReportTheme(html, theme))
        if (cancelled) {
          killSandbox(token, orgId, info.sandboxId).catch(() => {})
          return
        }
        setSandboxId(info.sandboxId)
        setSandboxUrl(info.previewUrl)
        setPreviewKey((k) => k + 1)
      } catch {
        if (!cancelled) setSandboxError('Sandbox unavailable — showing local preview.')
      } finally {
        if (!cancelled) setSandboxLoading(false)
      }
    }

    void syncSandbox()
    return () => { cancelled = true }
  }, [html, generating, orgId, getAccessToken, theme])

  async function copy() {
    try {
      await navigator.clipboard.writeText(html)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard unavailable */ }
  }

  function download() {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeBase}.html`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // Decide what to render in the preview tab
  const showSandbox = sandboxUrl && !sandboxLoading && !sandboxError
  const fallbackSrcDoc = html ? applyReportTheme(html, theme) : applyReportTheme(EMPTY_DOC, theme)

  return (
    <section className="studio-panel">
      <div className="studio-panel-head">
        <div className="editor-pane-tabs">
          <button
            type="button"
            className={`editor-pane-tab ${tab === 'preview' ? 'active' : ''}`}
            onClick={() => setTab('preview')}
          >
            Preview
          </button>
          <button
            type="button"
            className={`editor-pane-tab ${tab === 'code' ? 'active' : ''}`}
            onClick={() => setTab('code')}
          >
            Code
          </button>
        </div>

        <div className="editor-pane-actions">
          {tab === 'preview' && (
            <span className={`preview-sandbox-badge ${showSandbox ? 'active' : ''}`}>
              {sandboxLoading ? '⏳ Sandbox…' : showSandbox ? '🔒 Sandboxed' : '⚠ Local preview'}
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => void copy()}
            disabled={!html}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={download}
            disabled={!html}
          >
            Download
          </button>
        </div>
      </div>

      {tab === 'preview' ? (
        showSandbox ? (
          <iframe
            key={previewKey}
            className="studio-preview"
            src={sandboxUrl}
            title="Report preview (sandboxed)"
            sandbox="allow-scripts allow-forms allow-popups"
          />
        ) : (
          <iframe
            className="studio-preview"
            sandbox="allow-scripts allow-popups"
            srcDoc={fallbackSrcDoc}
            title="Report preview"
          />
        )
      ) : (
        <pre className="studio-code">{html || '<!-- no HTML yet -->'}</pre>
      )}

      {sandboxError && (
        <div className="preview-sandbox-warn">{sandboxError}</div>
      )}
    </section>
  )
}

const EMPTY_DOC =
  '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'html,body{height:100%;margin:0}' +
  'body{display:flex;align-items:center;justify-content:center;' +
  'font-family:ui-sans-serif,system-ui,sans-serif;color:#8ea3b8;' +
  'background:#070b12;font-size:14px}' +
  'html[data-theme="light"] body{background:#faf9f8;color:#605e5c}' +
  '</style></head><body>Your report preview will appear here.</body></html>'
