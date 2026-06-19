// Themed iframe scaffolding for AI-generated widgets (and any self-contained
// fragment). Generated HTML renders in a sandboxed iframe that does NOT inherit
// the app's CSS, so we inject the ACTIVE SKIN's palette as CSS variables for
// BOTH themes and set data-theme. Generated markup that uses these variables
// adapts to light/dark AND follows the user's selected skin automatically.

import { skinFrameCss } from '../styles/skins'

/** Wrap a self-contained widget fragment in a themed, transparent document. */
export function widgetFrameSrcDoc(html: string, theme: string): string {
  return `<!doctype html><html data-theme="${theme === 'light' ? 'light' : 'dark'}"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;height:100%}
${skinFrameCss()}
body{
  background:transparent;
  color:var(--ink);
  color-scheme:${theme === 'light' ? 'light' : 'dark'};
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
}
</style></head><body>${html}</body></html>`
}
