// DropZone — drag/drop (or click) a .pbix/.pbit file to upload it for
// ingestion. Posts via ingestUpload(); the parent handles the resulting
// modelId + SSE pipeline.

import { useRef, useState } from 'react'

interface Props {
  onFile: (file: File) => void
  disabled?: boolean
  busy?: boolean
}

const ACCEPT = '.pbix,.pbit,.pdf,.html,.htm,.csv,.xlsx,.xls,.json'
const ALLOWED = ['.pbix', '.pbit', '.pdf', '.html', '.htm', '.csv', '.xlsx', '.xls', '.json']

function isAllowed(name: string): boolean {
  const lower = name.toLowerCase()
  return ALLOWED.some((ext) => lower.endsWith(ext))
}

export default function DropZone({ onFile, disabled, busy }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    if (!isAllowed(file.name)) {
      // The server falls back gracefully, but nudge toward the right type.
      setWarn(`"${file.name}" is an unusual format — ingesting anyway.`)
    } else {
      setWarn(null)
    }
    onFile(file)
  }

  function openPicker() {
    if (disabled || busy) return
    inputRef.current?.click()
  }

  return (
    <div className="dli-upload">
      <div className="dli-section-head">
        <span className="eyebrow">Or upload your own</span>
        <p className="dli-section-sub">
          Drop a report or document — analyzed locally, never used to train
          shared models.
        </p>
      </div>

      <div
        className={`dli-drop ${dragging ? 'is-drag' : ''} ${
          disabled || busy ? 'is-disabled' : ''
        }`}
        role="button"
        tabIndex={0}
        aria-label="Upload a report or document"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPicker()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled && !busy) setDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (disabled || busy) return
          handleFiles(e.dataTransfer.files)
        }}
      >
        <div className="dli-drop-icon">{busy ? '◐' : '⤓'}</div>
        <strong>
          {busy ? 'Uploading…' : 'Upload your report'}
        </strong>
        <small>
          .pbix, .pdf, .html, .csv, .xlsx, .json — drag &amp; drop, or click to
          browse
        </small>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="dli-file-input"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={disabled || busy}
        />
      </div>

      {warn ? <div className="dli-warn">{warn}</div> : null}
    </div>
  )
}
