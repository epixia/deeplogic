# DeepLogic UI — how to build with it

DeepLogic UI is a **token-driven** design system. Components ship fully styled; you
theme and lay out around them with CSS custom properties — there is **no utility-class
framework**, so don't invent class names.

## Setup
- Import the stylesheet once at the app root: `import '@deeplogic/ui/styles.css'`.
- No React provider/context is required — styling is global CSS driven by tokens.
- **Theme** via an attribute on `<html>`: default is dark; add `data-theme="light"` for light mode.
- **Skin** via `data-skin="aurora"` (signature cyan→indigo, default) or `data-skin="slate"` (calm flat greys). Both support light + dark.

## The styling idiom — use these tokens for your own layout glue
Style custom markup with `var(--token)`; never hardcode hex. Available tokens:

- **Surfaces:** `--bg`, `--bg2`, `--card`, `--card2`
- **Lines/borders:** `--line`
- **Text:** `--ink` (primary), `--mut` (secondary), `--mut2` (tertiary)
- **Accents:** `--cyan` (links/accents), `--blue`, `--grad` (gradient for primary CTAs)
- **Status:** `--good`, `--warn`, `--bad`
- **Type/shape:** `--dl-font`, `--dl-radius`, `--dl-radius-sm`

Example: `<p style={{ color: 'var(--mut)' }}>` for secondary text, `background: 'var(--card)'`
for a surface, `border: '1px solid var(--line)'` for a hairline.

## Components
`Button` (variant `primary|ghost|icon`, size `md|sm|xs`, `loading`), `Card` (`padded`, `hover`),
`Badge`/`StatusPill` (tone `neutral|accent|good|warn|bad`, `dot`), `Chip` (`active`, `onRemove`),
`Spinner` (size `sm|md|lg`), `GradText`, `Input`/`Textarea`/`Select` (each takes `label`, `hint`,
`invalid`), `Switch` (controlled: `checked`+`onChange`), `Tabs` (controlled: `items`+`value`+`onChange`),
`Modal` (`open`, `onClose`, `title`, `description`, `actions`), `Panel` (empty state: `title`+`actions`),
`Wrap` (page container), `Logo`. Read each component's `.d.ts` for the full prop contract and its
`.prompt.md` for usage.

## Where the truth lives
- `styles.css` → imports `tokens.css` (all `var(--*)` definitions, per theme + skin) and the component styles. Read it before styling.
- Per component: `<Name>.d.ts` (props) and `<Name>.prompt.md` (usage).

## Idiomatic snippet
```tsx
import { Card, Badge, Button } from '@deeplogic/ui'

function AgentCard() {
  return (
    <Card padded style={{ maxWidth: 340 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>Lead outreach</strong>
        <Badge tone="good" dot>Running</Badge>
      </div>
      <p style={{ fontSize: 13, color: 'var(--mut)', margin: '0 0 14px' }}>Contacting 50 prospects this week.</p>
      <Button variant="ghost" size="sm">View agent</Button>
    </Card>
  )
}
```
