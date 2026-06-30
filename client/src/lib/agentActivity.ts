// Global agent-activity store — a tiny pub/sub surface so any in-flight agent /
// assistant run can broadcast "what it's doing right now" to a global toast,
// regardless of which component drives the work. Backed by useSyncExternalStore.

import { useSyncExternalStore } from 'react'

export interface ActivityStep { icon: string; text: string; url?: string }
export interface Activity {
  id: string
  title: string
  latest: ActivityStep
  steps: ActivityStep[] // running log of recent steps (live feedback)
  done: boolean
}

const MAX_STEPS = 50

let activities: Activity[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function startActivity(id: string, title: string, latest?: ActivityStep) {
  const t = timers.get(id)
  if (t) { clearTimeout(t); timers.delete(id) }
  const first = latest ?? { icon: '✦', text: 'Thinking…' }
  activities = [
    ...activities.filter((a) => a.id !== id),
    { id, title, latest: first, steps: [first], done: false },
  ]
  emit()
}

export function updateActivity(id: string, latest: ActivityStep) {
  activities = activities.map((a) => (a.id === id ? { ...a, latest, steps: [...a.steps, latest].slice(-MAX_STEPS) } : a))
  emit()
}

// Mark done, show the final line briefly, then drop it.
export function endActivity(id: string, finalText = 'Done', icon = '✓') {
  const final = { icon, text: finalText }
  activities = activities.map((a) => (a.id === id ? { ...a, done: true, latest: final, steps: [...a.steps, final].slice(-MAX_STEPS) } : a))
  emit()
  const timer = setTimeout(() => {
    activities = activities.filter((a) => a.id !== id)
    timers.delete(id)
    emit()
  }, 3200)
  timers.set(id, timer)
}

function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l) }
function snapshot() { return activities }

export function useAgentActivities(): Activity[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
