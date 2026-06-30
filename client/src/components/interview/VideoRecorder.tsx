// Webcam recorder for video interviews — shows the interviewee's self-view and
// records the session (video + audio). The parent gets a `stop()` via `register`
// that ends recording and resolves the webm Blob to upload.

import { useEffect, useRef, useState } from 'react'

export default function VideoRecorder({ onError, register }: {
  onError: (m: string) => void
  register: (api: { stop: () => Promise<Blob | null> }) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const [recording, setRecording] = useState(false)
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; void videoRef.current.play() }
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm'
        const rec = new MediaRecorder(stream, { mimeType: mime })
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data) }
        rec.start(1000)
        recRef.current = rec
        setRecording(true)
      } catch (e) {
        onError(e instanceof Error ? `Camera/mic unavailable: ${e.message}` : 'Could not access camera/mic.')
      }
    })()

    register({
      stop: () => new Promise<Blob | null>((resolve) => {
        const rec = recRef.current
        const done = () => {
          streamRef.current?.getTracks().forEach((t) => t.stop())
          resolve(chunks.current.length ? new Blob(chunks.current, { type: 'video/webm' }) : null)
        }
        if (!rec || rec.state === 'inactive') done()
        else { rec.onstop = done; rec.stop() }
      }),
    })

    return () => {
      cancelled = true
      try { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop() } catch { /* noop */ }
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  return (
    <div className="iv-video">
      <video ref={videoRef} className="iv-video-self" playsInline muted />
      {recording && <span className="iv-video-rec">● REC {mm}:{ss}</span>}
      <div className="iv-video-note">📹 You’re being recorded — the video saves to the Data Vault with the transcript.</div>
    </div>
  )
}
