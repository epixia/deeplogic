// PreviewPane — the RIGHT pane of the Studio editor. Tabs: Preview / Code.
//   Preview = sandboxed <iframe srcDoc={html}> filling the pane.
//   Code    = read-only <pre> of the HTML with Copy + Download (.html) actions.
// Used by both the owner editor and the read-only viewer.

import { useState } from 'react'
import { applyReportTheme, useAppTheme } from './reportTheme'

interface Props {
  html: string
  /** used to name the downloaded file (project slug or name) */
  fileBase: string
}

type PaneTab = 'preview' | 'code'

export default function PreviewPane({ html, fileBase }: Props) {
  const [tab, setTab] = useState<PaneTab>('preview')
  const [copied, setCopied] = useState(false)
  const theme = useAppTheme()

  const safeBase =
    (fileBase || 'report').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') ||
    'report'

  async function copy() {
    try {
      await navigator.clipboard.writeText(html)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable — no-op */
    }
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
        <iframe
          className="studio-preview"
          sandbox="allow-scripts"
          srcDoc={html ? applyReportTheme(html, theme) : applyReportTheme(EMPTY_DOC, theme)}
          title="Report preview"
        />
      ) : (
        <pre className="studio-code">{html || '<!-- no HTML yet -->'}</pre>
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
