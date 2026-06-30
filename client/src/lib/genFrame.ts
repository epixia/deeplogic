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
html{margin:0;padding:0;width:100%;height:100%;color-scheme:${theme === 'light' ? 'light' : 'dark'};background:transparent}
body{margin:0;padding:0;width:100%;height:100%}
${skinFrameCss()}
/* themed, thin scrollbars inside the widget (default white bars look broken in dark mode) */
*{scrollbar-width:thin;scrollbar-color:var(--line) transparent}
*::-webkit-scrollbar{width:8px;height:8px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-corner{background:transparent}
*::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
body{
  background:transparent;
  color:var(--ink);
  color-scheme:${theme === 'light' ? 'light' : 'dark'};
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
}
</style></head><body>${html}
<script>(function(){function fix(){var a=document.querySelectorAll('a[href]');for(var i=0;i<a.length;i++){var h=a[i].getAttribute('href')||'';if(/^https?:\\/\\//i.test(h)){a[i].target='_blank';a[i].rel='noopener noreferrer';}}}fix();try{new MutationObserver(fix).observe(document.body,{childList:true,subtree:true});}catch(e){}})();</script>
</body></html>`
}
