// Copy the standalone CSS entry (and its imports) into dist/ so consumers get
// `@deeplogic/ui/styles.css`. The CSS is plain (no bundler needed): we inline
// the @import chain into a single dist/styles.css for a self-contained artifact.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = resolve(root, 'src/styles')

// Resolve @import "x.css"; chains relative to src/styles, inlining into one file.
function inline(file, seen = new Set()) {
  const abs = resolve(srcDir, file)
  if (seen.has(abs)) return ''
  seen.add(abs)
  const css = readFileSync(abs, 'utf8')
  return css.replace(/@import\s+["']([^"']+)["'];?/g, (_, ref) => inline(ref, seen))
}

const out = inline('styles.css')
mkdirSync(resolve(root, 'dist'), { recursive: true })
writeFileSync(resolve(root, 'dist/styles.css'), out)
console.log(`[copy-assets] wrote dist/styles.css (${out.length} bytes)`)
