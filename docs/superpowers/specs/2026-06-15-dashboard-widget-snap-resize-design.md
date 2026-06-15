# Dashboard Widget Snap Resize — Design Spec
**Date:** 2026-06-15

## Overview

Add named size preset buttons (S/M/L/T/W) to each dashboard widget's drag handle, visible on hover. Free resize via react-grid-layout corner/edge handles is preserved and enhanced with a live size badge. All eight resize handle directions are made visible with themed CSS.

## Preset Constants

Five named presets defined in `DashboardEditor.tsx`:

| Label | gridW | gridH | Use case |
|-------|-------|-------|----------|
| S     | 1     | 1     | Compact KPI / single number |
| M     | 2     | 1     | Standard chart or table |
| L     | 3     | 1     | Full-width banner |
| T     | 1     | 2     | Tall narrow (leaderboard, list) |
| W     | 3     | 2     | Hero / large chart |

```ts
const PRESETS = [
  { label: 'S', w: 1, h: 1 },
  { label: 'M', w: 2, h: 1 },
  { label: 'L', w: 3, h: 1 },
  { label: 'T', w: 1, h: 2 },
  { label: 'W', w: 3, h: 2 },
]
```

## Apply Preset Function

`applyPreset(widgetId: string, w: number, h: number)` in `DashboardEditor.tsx`:

1. Updates `localLayout` immediately (optimistic — no flicker during save)
2. Updates `board` state so active preset highlights correctly
3. Calls `updateWidget(token, orgId, dashboardId, widgetId, { gridW: w, gridH: h })` to persist — same pattern as `saveLayoutItems`
4. Is a no-op if widget already has those dimensions

## Drag Handle UI

File: `client/src/pages/DashboardEditor.tsx` (widget render inside `ReactGridLayout`)

Layout of the drag handle bar on hover:
```
⋮⋮  Widget Name  [S] [M] [L] [T] [W]  Edit  ✨  ✕
← always shown → ←────────── hover only ───────────→
```

- A new `.wg-preset-btns` flex group sits between the widget name and `.wg-cell-actions`
- Both `.wg-preset-btns` and `.wg-cell-actions` use the existing `display:none` → `display:flex` on `.wg-drag-handle:hover` rule
- The active preset pill (matching current `gridW`/`gridH`) gets `.active` class: brighter cyan border + slightly higher background opacity
- Clicking a preset button calls `applyPreset` and calls `e.stopPropagation()` to prevent widget selection/deselection

## Resize Handle CSS

File: `client/src/pages/dashboards.css`

Currently all eight react-resizable handles are invisible (background image removed, only SE `::after` styled). Fixes:

- Handles are hidden by default; revealed on `.wg-cell:hover` with `opacity` fade-in transition
- **Corner handles** (se, sw, ne, nw): 10×10px, L-shaped two-side cyan border via `::after`, each rotated 90° to point into the correct corner
- **Edge handles** (e, w, s, n): a short 30px cyan line (3px thick) centred on their edge, via `::after`
- All inherit the existing `--cyan` colour variable

## Live Size Badge

File: `client/src/pages/DashboardEditor.tsx`

- New state: `const [resizing, setResizing] = useState<{ i: string; w: number; h: number } | null>(null)`
- `onResize` callback: `(layout, oldItem, newItem) => setResizing({ i: newItem.i, w: newItem.w, h: newItem.h })`
- `onResizeStop` callback: existing save logic runs, then `setResizing(null)` to dismiss badge
- Badge renders inside `.wg-content` as `position:absolute; bottom:8px; right:8px` — only when `resizing?.i === w.id`
- Badge text: matching preset label + dimensions (e.g. `M (2×1)`) or just dimensions if no preset matches (e.g. `2×3`)

## Files Changed

| File | Change |
|------|--------|
| `client/src/pages/DashboardEditor.tsx` | Add `PRESETS`, `applyPreset`, preset buttons in drag handle, `resizing` state, `onResize` handler, size badge |
| `client/src/pages/dashboards.css` | Fix all 8 resize handle directions; add `.wg-preset-btns` and `.wg-preset-btn` styles |

No new files. No changes to server, API, or database.

## Out of Scope

- Guided snap (auto-rounding free resize to nearest preset) — not needed; preset buttons already give one-click access
- WidgetBuilder size picker sync — the builder already persists `gridW`/`gridH`; preset buttons use the same field. No conflict.
- Mobile/touch resize — react-grid-layout handles touch natively; no extra work needed
