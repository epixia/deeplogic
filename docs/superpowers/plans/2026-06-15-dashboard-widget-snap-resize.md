# Dashboard Widget Snap Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add S/M/L/T/W preset size buttons to each dashboard widget's drag handle (hover-only), fix all 8 resize handle directions in CSS, and show a live size badge during free resize.

**Architecture:** All changes are in-place across two files — `DashboardEditor.tsx` and `dashboards.css`. No new files, no server changes. The preset buttons call `applyPreset` which optimistically updates `localLayout` and `board` state then persists via `updateWidget`. Resize handle visibility uses CSS `opacity` on `.wg-cell:hover`.

**Tech Stack:** React 18, TypeScript, react-grid-layout v2.2.3, CSS custom properties (var(--cyan))

---

## File Map

| File | Change |
|------|--------|
| `client/src/pages/DashboardEditor.tsx` | Add `PRESETS` constant, `applyPreset` callback, `resizing` state, `onResize` handler; update `onResizeStop`; add preset buttons + size badge to JSX; wire `onResize` to `<ReactGridLayout>` |
| `client/src/pages/dashboards.css` | Add `.wg-preset-btns`, `.wg-preset-btn`, `.wg-size-badge` styles; replace resize handle block with all-8-direction rules |

---

## Task 1: Add preset button CSS and size badge CSS

**Files:**
- Modify: `client/src/pages/dashboards.css`

- [ ] **Step 1: Append preset button and size badge styles to dashboards.css**

Open `client/src/pages/dashboards.css` and append the following block at the end of the file (after `.wb-save:disabled`):

```css
/* ── Widget preset size buttons ────────────────────────────── */
.wg-preset-btns {
  display: none;
  gap: 2px;
  align-items: center;
}
.wg-drag-handle:hover .wg-preset-btns { display: flex; }

.wg-preset-btn {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(111, 227, 240, 0.08);
  border: 1px solid rgba(111, 227, 240, 0.2);
  color: var(--cyan);
  font-size: 9px;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.6;
  transition: background 0.1s, border-color 0.1s;
  letter-spacing: 0.02em;
}
.wg-preset-btn:hover {
  background: rgba(111, 227, 240, 0.18);
  border-color: rgba(111, 227, 240, 0.45);
}
.wg-preset-btn.active {
  background: rgba(111, 227, 240, 0.22);
  border-color: rgba(111, 227, 240, 0.55);
  font-weight: 700;
}

/* ── Live size badge during free resize ────────────────────── */
.wg-size-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(4, 18, 27, 0.85);
  border: 1px solid rgba(111, 227, 240, 0.4);
  color: var(--cyan);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 5px;
  pointer-events: none;
  letter-spacing: 0.04em;
  backdrop-filter: blur(4px);
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/dashboards.css
git commit -m "style: add preset button and size badge CSS"
```

---

## Task 2: Fix resize handle CSS for all 8 directions

**Files:**
- Modify: `client/src/pages/dashboards.css`

- [ ] **Step 1: Replace the existing resize handle block**

Find and replace this block in `client/src/pages/dashboards.css` (around line 479):

```css
/* resize handles — let the library control show/hide; just theme the corner arrow */
.react-grid-item > .react-resizable-handle::after {
  border-right-color: var(--cyan);
  border-bottom-color: var(--cyan);
}
.react-grid-item > .react-resizable-handle { background-image: none; }
```

Replace it with:

```css
/* resize handles — hide until cell hovered, theme all 8 directions */
.react-grid-item > .react-resizable-handle {
  background-image: none;
  opacity: 0;
  transition: opacity 0.15s;
}
.wg-cell:hover .react-resizable-handle { opacity: 1; }

/* Corner handles — L-shaped cyan border, one rule per corner for correct positioning */
.react-grid-item > .react-resizable-handle-se::after,
.react-grid-item > .react-resizable-handle-sw::after,
.react-grid-item > .react-resizable-handle-ne::after,
.react-grid-item > .react-resizable-handle-nw::after {
  content: '';
  position: absolute;
  width: 8px;
  height: 8px;
  border-color: var(--cyan);
  border-style: solid;
  border-width: 0;
}
.react-grid-item > .react-resizable-handle-se::after {
  bottom: 3px; right: 3px;
  border-right-width: 2px; border-bottom-width: 2px;
}
.react-grid-item > .react-resizable-handle-sw::after {
  bottom: 3px; left: 3px;
  border-left-width: 2px; border-bottom-width: 2px;
}
.react-grid-item > .react-resizable-handle-ne::after {
  top: 3px; right: 3px;
  border-right-width: 2px; border-top-width: 2px;
}
.react-grid-item > .react-resizable-handle-nw::after {
  top: 3px; left: 3px;
  border-left-width: 2px; border-top-width: 2px;
}

/* Edge handles — short centred bar */
.react-grid-item > .react-resizable-handle-e::after,
.react-grid-item > .react-resizable-handle-w::after,
.react-grid-item > .react-resizable-handle-s::after,
.react-grid-item > .react-resizable-handle-n::after {
  content: '';
  position: absolute;
  background: var(--cyan);
  border-radius: 2px;
}
.react-grid-item > .react-resizable-handle-e::after {
  top: 50%; transform: translateY(-50%);
  right: 3px; width: 2px; height: 24px;
}
.react-grid-item > .react-resizable-handle-w::after {
  top: 50%; transform: translateY(-50%);
  left: 3px; width: 2px; height: 24px;
}
.react-grid-item > .react-resizable-handle-s::after {
  left: 50%; transform: translateX(-50%);
  bottom: 3px; height: 2px; width: 24px;
}
.react-grid-item > .react-resizable-handle-n::after {
  left: 50%; transform: translateX(-50%);
  top: 3px; height: 2px; width: 24px;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/dashboards.css
git commit -m "style: fix all 8 resize handle directions with themed CSS"
```

---

## Task 3: Add PRESETS, applyPreset, resizing state, and onResize to DashboardEditor

**Files:**
- Modify: `client/src/pages/DashboardEditor.tsx`

- [ ] **Step 1: Add PRESETS constant after TYPE_ICONS**

In `client/src/pages/DashboardEditor.tsx`, find the line:

```ts
const TYPE_ICONS: Record<string, string> = {
  kpi: '📊', chart: '📈', table: '📋', insight: '💡', alert: '🔔', embed: '🔗',
}
```

Add immediately after it:

```ts
const PRESETS = [
  { label: 'S', w: 1, h: 1 },
  { label: 'M', w: 2, h: 1 },
  { label: 'L', w: 3, h: 1 },
  { label: 'T', w: 1, h: 2 },
  { label: 'W', w: 3, h: 2 },
]
```

- [ ] **Step 2: Add resizing state inside the component**

Find this line inside the `DashboardEditor` component (after the other `useState` declarations, around the `saving` state line):

```ts
const [saving, setSaving] = useState(false)
```

Add immediately after it:

```ts
const [resizing, setResizing] = useState<{ i: string; w: number; h: number } | null>(null)
```

- [ ] **Step 3: Add onResize callback**

Find:

```ts
const onDragStop = useCallback((layout: Layout) => { void saveLayoutItems(layout) }, [saveLayoutItems])
const onResizeStop = useCallback((layout: Layout) => { void saveLayoutItems(layout) }, [saveLayoutItems])
```

Replace with:

```ts
const onDragStop = useCallback((layout: Layout) => { void saveLayoutItems(layout) }, [saveLayoutItems])
const onResize = useCallback((_layout: Layout, _old: LayoutItem, newItem: LayoutItem) => {
  setResizing({ i: newItem.i, w: newItem.w, h: newItem.h })
}, [])
const onResizeStop = useCallback((layout: Layout) => {
  setResizing(null)
  void saveLayoutItems(layout)
}, [saveLayoutItems])
```

- [ ] **Step 4: Add applyPreset callback**

Add immediately after the `onResizeStop` line:

```ts
const applyPreset = useCallback(async (widgetId: string, w: number, h: number) => {
  if (!board || !orgId || !dashboardId) return
  const widget = board.widgets.find((x) => x.id === widgetId)
  if (!widget || (widget.gridW === w && widget.gridH === h)) return
  setLocalLayout((prev) => prev.map((l) => l.i === widgetId ? { ...l, w, h } : l))
  setBoard((prev) => {
    if (!prev) return prev
    return { ...prev, widgets: prev.widgets.map((x) => x.id === widgetId ? { ...x, gridW: w, gridH: h } : x) }
  })
  await updateWidget(token, orgId, dashboardId, widgetId, { gridW: w, gridH: h }).catch(console.error)
}, [board, token, orgId, dashboardId])
```

- [ ] **Step 5: Run TypeScript check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors. If you see `_layout` or `_old` unused-variable errors, they are suppressed by the underscore prefix — TypeScript should accept them.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DashboardEditor.tsx
git commit -m "feat: add PRESETS constant, applyPreset, onResize, and resizing state"
```

---

## Task 4: Wire onResize, add preset buttons and size badge to JSX

**Files:**
- Modify: `client/src/pages/DashboardEditor.tsx`

- [ ] **Step 1: Add onResize prop to ReactGridLayout**

Find the `<ReactGridLayout` opening props block:

```tsx
            onLayoutChange={onLayoutChange}
            onDragStop={onDragStop}
            onResizeStop={onResizeStop}
```

Replace with:

```tsx
            onLayoutChange={onLayoutChange}
            onDragStop={onDragStop}
            onResize={onResize}
            onResizeStop={onResizeStop}
```

- [ ] **Step 2: Add preset buttons to the drag handle**

Find this block inside `board.widgets.map((w) => ...)`:

```tsx
                  <div className="wg-cell-actions" onClick={(e) => e.stopPropagation()}>
```

Add the preset buttons immediately before that line:

```tsx
                  <div className="wg-preset-btns" onClick={(e) => e.stopPropagation()}>
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className={`wg-preset-btn${w.gridW === p.w && w.gridH === p.h ? ' active' : ''}`}
                        onClick={() => void applyPreset(w.id, p.w, p.h)}
                        title={`${p.label}: ${p.w}×${p.h}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
```

- [ ] **Step 3: Add size badge inside .wg-content**

Find this entire block:

```tsx
                <div className="wg-content">
                  {generating[w.id] ? (
                    <div className="wg-placeholder">
                      <div className="wg-generating">
                        <span className="wg-spinner" />
                        Generating…
                      </div>
                    </div>
                  ) : w.html ? (
                    <WidgetFrame html={w.html} />
                  ) : (
                    <div className="wg-placeholder">
                      <div className="wg-placeholder-icon">{TYPE_ICONS[w.type] ?? '📊'}</div>
                      <div className="wg-placeholder-name">{w.name}</div>
                      <div className="wg-placeholder-prompt">
                        {w.prompt ? 'Click ✨ to generate' : 'Click Edit to add a prompt'}
                      </div>
                    </div>
                  )}
                </div>
```

Replace it with:

```tsx
                <div className="wg-content">
                  {resizing?.i === w.id && (
                    <div className="wg-size-badge">
                      {(() => {
                        const match = PRESETS.find((p) => p.w === resizing.w && p.h === resizing.h)
                        return match
                          ? `${match.label} (${resizing.w}×${resizing.h})`
                          : `${resizing.w}×${resizing.h}`
                      })()}
                    </div>
                  )}
                  {generating[w.id] ? (
                    <div className="wg-placeholder">
                      <div className="wg-generating">
                        <span className="wg-spinner" />
                        Generating…
                      </div>
                    </div>
                  ) : w.html ? (
                    <WidgetFrame html={w.html} />
                  ) : (
                    <div className="wg-placeholder">
                      <div className="wg-placeholder-icon">{TYPE_ICONS[w.type] ?? '📊'}</div>
                      <div className="wg-placeholder-name">{w.name}</div>
                      <div className="wg-placeholder-prompt">
                        {w.prompt ? 'Click ✨ to generate' : 'Click Edit to add a prompt'}
                      </div>
                    </div>
                  )}
                </div>
```

- [ ] **Step 4: Run TypeScript check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DashboardEditor.tsx
git commit -m "feat: add preset size buttons and live resize badge to dashboard widgets"
```

---

## Task 5: Manual verification

**Files:** none (browser-based verification)

- [ ] **Step 1: Start the dev server**

```bash
cd client && npm run dev
```

Navigate to a dashboard editor page (a URL like `/org/<id>/dashboards/<id>`).

- [ ] **Step 2: Verify preset buttons appear on hover**

Hover over a widget's drag handle bar. Confirm:
- S, M, L, T, W buttons appear to the right of the widget name
- Edit / ✨ / ✕ buttons also appear (unchanged)
- Moving the mouse away hides the buttons
- The button matching the widget's current size is visually highlighted (brighter border)

- [ ] **Step 3: Verify preset buttons change widget size**

Click **L** on a 1×1 widget. Confirm:
- Widget immediately expands to full 3-column width
- After ~1s the new size persists if you refresh the page (server saved)
- The L button now shows as active; other buttons are dimmed

Click **S** on the same widget. Confirm it snaps back to 1×1.

- [ ] **Step 4: Verify resize handles appear on hover**

Hover over a widget. Confirm:
- Cyan L-shaped corner indicators appear at all four corners (SE, SW, NE, NW)
- Cyan bar indicators appear on all four edges (E, W, S, N)
- All handles disappear when you move the mouse away

- [ ] **Step 5: Verify live size badge during free resize**

Drag the SE corner handle of any widget. Confirm:
- A badge like `M (2×1)` or `3×2` appears in the bottom-right of the widget content area while dragging
- Badge text updates live as you drag
- Badge disappears when you release

- [ ] **Step 6: Verify T (1×2) and W (3×2) presets**

Click **T** on a widget. Confirm it becomes 1 column wide and 2 rows tall (~412px).
Click **W**. Confirm it becomes 3 columns wide and 2 rows tall.

- [ ] **Step 7: Commit if all checks pass**

```bash
git add -A
git commit -m "chore: verified widget snap resize feature end-to-end"
```

---

## Spec Coverage Check

| Spec requirement | Covered by |
|-----------------|------------|
| PRESETS constant with S/M/L/T/W | Task 3 Step 1 |
| applyPreset — optimistic localLayout + board update | Task 3 Step 4 |
| applyPreset — server persist via updateWidget | Task 3 Step 4 |
| applyPreset — no-op if same size | Task 3 Step 4 |
| Preset buttons in drag handle, hover-only | Task 1, Task 4 Step 2 |
| Active preset highlighted | Task 4 Step 2 (`.active` class) |
| Clicks stop propagation | Task 4 Step 2 |
| All 8 resize handle directions visible | Task 2 |
| Handles fade in on cell hover | Task 2 |
| Live size badge during resize | Task 3 Step 3, Task 4 Step 3 |
| Badge shows preset label when matched | Task 4 Step 3 |
| Badge clears on resize stop | Task 3 Step 3 (onResizeStop) |
