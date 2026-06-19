// ThemeManager — applies the selected skin's CSS variables to <html> whenever
// the theme (data-theme) or skin changes. Renders nothing. Mounted once in App.

import { useEffect } from 'react'
import { useAppTheme } from './studio/reportTheme'
import { applySkin, readSkin, SKIN_EVENT, type ThemeMode } from '../styles/skins'

export default function ThemeManager() {
  const theme = useAppTheme() // re-renders on data-theme AND skin changes

  useEffect(() => {
    const mode: ThemeMode = theme === 'light' ? 'light' : 'dark'
    applySkin(readSkin(), mode)
  }, [theme])

  // Also re-apply immediately on skin change (independent of theme).
  useEffect(() => {
    const apply = () => {
      const mode: ThemeMode =
        (document.documentElement.getAttribute('data-theme') || 'dark') === 'light' ? 'light' : 'dark'
      applySkin(readSkin(), mode)
    }
    apply()
    window.addEventListener(SKIN_EVENT, apply)
    return () => window.removeEventListener(SKIN_EVENT, apply)
  }, [])

  return null
}
