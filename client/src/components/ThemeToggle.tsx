// Dark / light theme toggle. Persists to localStorage('dl-theme') and applies
// the value via document.documentElement[data-theme] — matching the landing page.

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'dl-theme'

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return 'dark'
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))

  return (
    <button
      type="button"
      className="btn btn-icon theme-toggle"
      aria-label="Toggle light / dark mode"
      title="Toggle theme"
      onClick={toggle}
    >
      {theme === 'light' ? '☀️' : '🌙'}
    </button>
  )
}
