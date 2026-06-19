// Minimal, dependency-free Markdown → HTML for the Memory (Obsidian-style)
// notes. Supports headings, bold/italic, inline + fenced code, lists, quotes,
// hr, links, and the Obsidian extras: [[wikilinks]] and #tags. Input is HTML-
// escaped first, so rendered output is safe to inject.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const attr = (s: string) => esc(s).replace(/"/g, '&quot;')

/** All [[wikilink]] targets in a note (trimmed, de-duped). */
export function extractWikiLinks(md: string): string[] {
  const out = new Set<string>()
  for (const m of md.matchAll(/\[\[([^\]]+)\]\]/g)) out.add(m[1].trim())
  return [...out]
}

/** All #tags in a note. */
export function extractTags(md: string): string[] {
  const out = new Set<string>()
  for (const m of md.matchAll(/(?:^|[\s(])#([a-zA-Z][\w-]*)/g)) out.add(m[1])
  return [...out]
}

function inline(escaped: string): string {
  return escaped
    .replace(/\[\[([^\]]+)\]\]/g, (_m, n: string) => `<a class="md-wikilink" data-wikilink="${attr(n.trim())}">${n.trim()}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, u: string) =>
      /^https?:\/\//.test(u) ? `<a href="${attr(u)}" target="_blank" rel="noreferrer">${t}</a>` : t)
    .replace(/(^|[\s(])#([a-zA-Z][\w-]*)/g, (_m, pre: string, tag: string) => `${pre}<a class="md-tag" data-tag="${attr(tag)}">#${tag}</a>`)
}

export function renderMarkdown(src: string): string {
  const lines = (src || '').replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inCode = false
  const code: string[] = []
  let para: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(' ')))}</p>`); para = [] } }
  const flushList = () => {
    if (list) { out.push(`<${list.type}>${list.items.map((it) => `<li>${inline(esc(it))}</li>`).join('')}</${list.type}>`); list = null }
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code.length = 0; inCode = false }
      else { flushPara(); flushList(); inCode = true }
      continue
    }
    if (inCode) { code.push(line); continue }
    if (!line.trim()) { flushPara(); flushList(); continue }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`); continue }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); flushList(); out.push('<hr/>'); continue }
    if (/^>\s?/.test(line)) { flushPara(); flushList(); out.push(`<blockquote>${inline(esc(line.replace(/^>\s?/, '')))}</blockquote>`); continue }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ul) { flushPara(); if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] } } list.items.push(ul[1]); continue }
    if (ol) { flushPara(); if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] } } list.items.push(ol[1]); continue }

    flushList()
    para.push(line)
  }
  if (inCode) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
  flushPara(); flushList()
  return out.join('\n')
}
