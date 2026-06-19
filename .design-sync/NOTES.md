# design-sync notes — DeepLogic

## Context
DeepLogic is a SaaS **app**, not a published component library. For design-sync we
**extracted reusable primitives** into a new package `packages/ui` (`@deeplogic/ui`)
rather than syncing app-coupled screens. That package is the sync source.

## The library (`packages/ui`)
- Built with **tsup** → `dist/index.js` (ESM) + `dist/index.d.ts`; `scripts/copy-assets.mjs`
  inlines the CSS `@import` chain into `dist/styles.css`.
- Build: `npm --prefix packages/ui run build` (also installs locally with `npm i` there).
- Components (16): Button, Card, Badge/StatusPill, Chip, Spinner, GradText, Input,
  Textarea, Select, Switch, Wrap, Modal, Tabs, Panel, Logo.
- Styling = **token + utility-class system** ported from the app's `client/src/styles/theme.css`
  (`:root` tokens) + `skins.ts` (aurora / slate, dark+light). Classes are `dl-*`
  (canonical) so the library is self-contained. `styles.css` = font @import (Inter from
  Google Fonts, remote) + tokens.css + components.css.
- Theme via `html[data-theme='light']`; skin via `html[data-skin='aurora'|'slate']`. Default = Aurora dark.

## Converter config (`.design-sync/config.json`)
- `cssEntry: dist/styles.css` — the compiled, self-contained stylesheet.
- `--entry packages/ui/dist/index.js`, `--node-modules packages/ui/node_modules`.

## Re-sync risks / watch-list
- **Fonts are remote** (Google Fonts `@import` for Inter) — `[FONT_REMOTE]` expected, no `@font-face` ships. If offline rendering matters, vendor Inter woff2 + `cfg.extraFonts`.
- The library is a NEW package not yet consumed by the app; keep it in sync with `theme.css`/`skins.ts` if those tokens change (currently copied, not imported).
- `color-mix()` is used in component CSS for badge/chip tints — fine in modern Chromium (render check), but note for older targets.
