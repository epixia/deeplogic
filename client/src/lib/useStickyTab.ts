import { useEffect, useState } from 'react'

// Remember the last-chosen tab per page (and per org) across reloads and
// navigation. Backed by localStorage; the stored value is validated against the
// allowed set so a renamed/removed tab can never wedge the UI on a dead value.
export function useStickyTab<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[],
): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored && (allowed as readonly string[]).includes(stored) ? (stored as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try { localStorage.setItem(key, val) } catch { /* storage unavailable */ }
  }, [key, val])
  return [val, setVal]
}
