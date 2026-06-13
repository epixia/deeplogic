// Helpers to make rendered reports respect the app's light/dark theme.
// Reports are self-contained HTML; we inject the active theme as a data-theme
// attribute on their <html> so report CSS (which defines [data-theme="light"]
// overrides) flips with the app toggle.

import { useEffect, useState } from 'react'

/** Current app theme ('light' | 'dark'), reacting to the nav toggle. */
export function useAppTheme(): string {
  const read = () =>
    document.documentElement.getAttribute('data-theme') || 'dark'
  const [theme, setTheme] = useState<string>(read)
  useEffect(() => {
    const update = () => setTheme(read())
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    update()
    return () => mo.disconnect()
  }, [])
  return theme
}

/** Inject (or replace) data-theme on the report's <html> tag. */
export function applyReportTheme(html: string, theme: string): string {
  if (!html) return html
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, (_m, attrs: string) => {
      const cleaned = attrs.replace(/\s*data-theme="[^"]*"/i, '')
      return `<html${cleaned} data-theme="${theme}">`
    })
  }
  return `<!doctype html><html data-theme="${theme}"><body>${html}</body></html>`
}
