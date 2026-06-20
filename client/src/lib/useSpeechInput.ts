// useSpeechInput — lightweight speech-to-text via the browser's Web Speech API
// (SpeechRecognition). `supported` is false where the API is unavailable (e.g.
// Firefox) so callers can hide the mic. `onText` receives the live transcript
// (interim + final) so the caller can update an input as the user speaks.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from 'react'

export function useSpeechInput(onText: (text: string) => void) {
  const SR = typeof window !== 'undefined'
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : undefined
  const supported = !!SR
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)

  function start() {
    if (!supported || listening) return
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e: any) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      onText(text.trim())
    }
    rec.onend = () => { setListening(false); recRef.current = null }
    rec.onerror = () => { setListening(false); recRef.current = null }
    recRef.current = rec
    setListening(true)
    try { rec.start() } catch { setListening(false); recRef.current = null }
  }

  function stop() {
    try { recRef.current?.stop() } catch { /* ignore */ }
  }

  function toggle() {
    if (listening) stop()
    else start()
  }

  return { supported, listening, start, stop, toggle }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
