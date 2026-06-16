// Ingest — pick a bundled sample or upload a .pbix/.pbit, then watch the agent
// pipeline animate over SSE. On the stream's 'done' event, navigate to the
// auto-generated dashboard for the resulting model.

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ingestSample, ingestUpload } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import SamplePicker from '../components/ingest/SamplePicker'
import DropZone from '../components/ingest/DropZone'
import PipelineConsole from '../components/ingest/PipelineConsole'
import './ingest.css'

type Phase = 'pick' | 'starting' | 'running'

export default function Ingest() {
  const navigate = useNavigate()
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()
  const [phase, setPhase] = useState<Phase>('pick')
  const [modelId, setModelId] = useState<string | null>(null)
  const [modelName, setModelName] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // tracks which sample card is mid-request (for its button label)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function startSample(sampleId: string, name: string) {
    setError(null)
    setBusyId(sampleId)
    setPhase('starting')
    setModelName(name)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Your session has expired — please sign in again.')
      const { modelId } = await ingestSample(token, orgId, sampleId)
      setModelId(modelId)
      setPhase('running')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ingestion failed.')
      setPhase('pick')
    } finally {
      setBusyId(null)
    }
  }

  async function startUpload(file: File) {
    setError(null)
    setPhase('starting')
    // derive a friendly name from the file while ingesting
    setModelName(file.name.replace(/\.(pbix|pbit)$/i, ''))
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Your session has expired — please sign in again.')
      const { modelId } = await ingestUpload(token, orgId, file)
      setModelId(modelId)
      setPhase('running')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
      setPhase('pick')
    }
  }

  const busy = phase === 'starting' || phase === 'running'

  return (
    <main className="wrap dl-ingest">
      <header className="dli-head">
        <h1 className="dli-h1">
          Turn your reports into a{' '}
          <span className="grad-text">thinking control room</span>.
        </h1>
        <p className="dli-lead">
          Pick a bundled sample or upload your own report. DeepLogic's agent crew
          will map connectors, extract KPIs, hunt anomalies and draft a brief —
          then open your dashboard.
        </p>
      </header>

      {error ? (
        <div className="dli-error dli-error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {phase === 'running' && modelId ? (
        <PipelineConsole
          modelId={modelId}
          modelName={modelName}
          onDone={() => navigate(`/app/${orgId}/dashboard/${modelId}`)}
        />
      ) : phase === 'starting' ? (
        <div className="dli-console dli-starting">
          <div className="dli-con-top">
            <i className="dli-dot dli-dot-r" />
            <i className="dli-dot dli-dot-y" />
            <i className="dli-dot dli-dot-g" />
            <span className="dli-con-title">DeepLogic · Agent pipeline</span>
          </div>
          <div className="dli-feed-empty">
            Resolving {modelName ? `"${modelName}"` : 'model'} and starting the
            agent crew…
          </div>
        </div>
      ) : (
        <div className="dli-pick">
          <SamplePicker
            onPick={startSample}
            disabled={busy}
            busyId={busyId}
          />
          <div className="dli-or">
            <span>or</span>
          </div>
          <DropZone onFile={startUpload} disabled={busy} busy={busy} />
        </div>
      )}
    </main>
  )
}
