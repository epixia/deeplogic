// Lightweight, synchronous classification for data-vault files. Runs on the
// upload path (and lazily in render for older items), so it must stay cheap —
// extension first, then a shallow content sniff. No AI, no network.

export type VaultCategory =
  | 'powerbi'
  | 'data'
  | 'schema'
  | 'query'
  | 'config'
  | 'docs'
  | 'web'
  | 'knowledge'
  | 'note'
  | 'other'

export const VAULT_CATEGORIES: VaultCategory[] = [
  'powerbi', 'data', 'schema', 'query', 'config', 'docs', 'web', 'knowledge', 'note', 'other',
]

export const CATEGORY_LABEL: Record<VaultCategory, string> = {
  powerbi:   'Power BI',
  data:      'Data',
  schema:    'Schema',
  query:     'Query',
  config:    'Config',
  docs:      'Docs',
  web:       'Web',
  knowledge: 'Knowledge',
  note:      'Note',
  other:     'File',
}

const SCHEMA_HINT =
  /\b(schema|erd|data dictionary|ddl|table definition|entity relationship|column definitions?)\b/i

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

// First markdown heading text (scans only the opening lines). Empty if none.
export function mdHeading(content: string): string {
  if (!content) return ''
  const lines = content.split(/\r?\n/, 40)
  for (const raw of lines) {
    const m = /^#{1,6}\s+(.+?)\s*#*$/.exec(raw.trim())
    if (m) return m[1].trim()
  }
  return ''
}

// Best-guess category from a file's name + (optional) text content.
export function classifyFile(name: string, content = ''): VaultCategory {
  const e = ext(name)
  if (e === 'pbix' || e === 'pbit') return 'powerbi'
  if (e === 'csv' || e === 'tsv') return 'data'
  if (e === 'sql') return 'query'
  if (e === 'json' || e === 'yaml' || e === 'yml' || e === 'xml') {
    // an array-of-records JSON reads more like a dataset than config
    if (e === 'json' && /^\s*\[\s*\{/.test(content.slice(0, 200))) return 'data'
    return 'config'
  }
  if (e === 'html' || e === 'htm') return 'web'
  if (e === 'md' || e === 'markdown' || e === 'txt' || e === 'log') {
    if (SCHEMA_HINT.test(name) || SCHEMA_HINT.test(mdHeading(content))) return 'schema'
    return 'docs'
  }
  return 'other'
}
