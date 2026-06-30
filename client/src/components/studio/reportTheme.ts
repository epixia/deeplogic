// Helpers to make rendered reports respect the app's light/dark theme.
// Reports are self-contained HTML; we inject the active theme as a data-theme
// attribute on their <html> so report CSS (which defines [data-theme="light"]
// overrides) flips with the app toggle.

import { useEffect, useState } from 'react'
import { skinFrameCss, SKIN_EVENT } from '../../styles/skins'

/** Current app theme ('light' | 'dark'), reacting to the nav toggle. */
export function useAppTheme(): string {
  const read = () =>
    document.documentElement.getAttribute('data-theme') || 'dark'
  const [theme, setTheme] = useState<string>(read)
  const [, force] = useState(0)
  useEffect(() => {
    const update = () => setTheme(read())
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    // Re-render theme consumers (and re-read the active skin) on skin change.
    const onSkin = () => force((n) => n + 1)
    window.addEventListener(SKIN_EVENT, onSkin)
    update()
    return () => { mo.disconnect(); window.removeEventListener(SKIN_EVENT, onSkin) }
  }, [])
  return theme
}

/**
 * Make a report respect the app theme: set data-theme on <html> AND inject the
 * platform palette CSS variables (so report CSS using var(--ink), var(--bg) … —
 * as instructed by the system prompt — resolves and flips with the theme).
 */
export function applyReportTheme(html: string, theme: string): string {
  if (!html) return html
  let out = html
  // 1) data-theme on <html>
  if (/<html[\s>]/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, (_m, attrs: string) => {
      const cleaned = attrs.replace(/\s*data-theme="[^"]*"/i, '')
      return `<html${cleaned} data-theme="${theme}">`
    })
  } else {
    out = `<!doctype html><html data-theme="${theme}"><head></head><body>${out}</body></html>`
  }
  // 2) inject the active skin's palette variables (replace any prior block)
  const styleTag = `<style id="dl-theme-vars">${skinFrameCss()}</style>`
  out = out.replace(/<style id="dl-theme-vars">[\s\S]*?<\/style>/i, '')
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, (m) => `${m}${styleTag}`)
  } else {
    out = out.replace(/<html([^>]*)>/i, (m) => `${m}<head>${styleTag}</head>`)
  }
  // 3) external links (http/https) open in a new tab, not inside the platform.
  const linkScript = `<script>(function(){function fix(){var a=document.querySelectorAll('a[href]');for(var i=0;i<a.length;i++){var h=a[i].getAttribute('href')||'';if(/^https?:\\/\\//i.test(h)){a[i].target='_blank';a[i].rel='noopener noreferrer';}}}if(document.readyState!=='loading')fix();else document.addEventListener('DOMContentLoaded',fix);try{new MutationObserver(fix).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}})();</script>`
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${linkScript}</body>`) : out + linkScript
  return out
}
