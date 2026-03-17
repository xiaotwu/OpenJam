# Phase 2: Design System + Drawing Engine + Polish — Design Specification

**Date:** 2026-03-17
**Status:** Draft
**Scope:** Liquid Glass design system, drawing engine overhaul, keyboard/menu fixes, widget customization

---

## 1. Overview

Phase 2 builds on the Phase 1 foundation (Go embed, canvas decomposition, event emitter) to deliver four workstreams: a complete Liquid Glass design system with dark mode, a drawing engine upgrade using `perfect-freehand`, keyboard/menu bug fixes, and a widget property inspector for customization.

### Success Criteria

- All UI surfaces (toolbar, menu bar, panels, dialogs, context menus, zoom controls) render with glass treatment in both light and dark mode
- Dark mode toggle persists across sessions via localStorage
- Pen tool produces smooth, tapered strokes via `perfect-freehand` with live preview during drawing
- Drawing supports free curves where mouse direction controls curvature
- Every menu item has a working keyboard shortcut
- Command palette lists all tools including marker
- Property inspector panel allows customizing widget properties (table size, timer duration, etc.)

---

## 2. Chunk 1 — Keyboard & Menu Fixes

### 2.1 Missing Keyboard Shortcuts

The following shortcuts are advertised in `MenuBar.tsx` menus but not implemented in `useKeyboardShortcuts.ts`:

| Shortcut | Action | Implementation |
|----------|--------|---------------|
| Ctrl+S | Save | Call `onSave` callback |
| Ctrl+N | New board | Navigate to create new board (or create inline) |
| Ctrl+X | Cut | New `onCut` — copy selected + delete |
| Ctrl+Shift+L | Lock/Unlock | New `onToggleLock` callback |
| Ctrl+G | Group | New `onGroup` callback |
| Ctrl+Shift+G | Ungroup | New `onUngroup` callback |

Ctrl+O (Open) remains disabled — no file open dialog exists yet.

### 2.2 Changes to useKeyboardShortcuts

Add new callbacks to `UseKeyboardShortcutsOptions`:
- `onSave: () => void`
- `onCut: () => void`
- `onToggleLock: () => void`
- `onGroup: () => void`
- `onUngroup: () => void`

Add keyboard handlers for each in the `handleKeyDown` function.

### 2.3 Changes to useClipboard

Add `cutSelected()` function that calls `copySelected()` then deletes selected elements.

### 2.4 Command Palette Fix

Add missing marker tool entry to `CommandPalette.tsx`:
```typescript
{ id: 'marker', label: 'Marker tool', category: 'Tools', shortcut: 'M', action: () => setCurrentTool('marker') }
```

### 2.5 Group/Ungroup & Lock Implementation

These operations need to be wired through `OpenJamCanvas.tsx` to the element store:
- **Group**: Create a logical group from selected elements (store group ID on each element)
- **Ungroup**: Remove group association from selected elements
- **Lock/Unlock**: Toggle `locked` property on selected elements via `elementStore.updateElement()`

---

## 3. Chunk 2 — Liquid Glass Design System

### 3.1 Design Token System

Add CSS custom properties to `app/src/index.css` under `:root` (light) and `.dark` (dark mode) selectors:

**Light mode tokens:**
```css
:root {
  --glass-bg: rgba(255, 255, 255, 0.65);
  --glass-bg-elevated: rgba(255, 255, 255, 0.78);
  --glass-bg-subtle: rgba(255, 255, 255, 0.45);
  --glass-border: rgba(255, 255, 255, 0.35);
  --glass-border-strong: rgba(0, 0, 0, 0.08);
  --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  --glass-shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.12);
  --glass-blur: 24px;
  --glass-blur-heavy: 40px;
  --text-primary: rgba(0, 0, 0, 0.87);
  --text-secondary: rgba(0, 0, 0, 0.6);
  --text-tertiary: rgba(0, 0, 0, 0.38);
  --accent: #F59E0B;
  --accent-hover: #D97706;
  --accent-gradient: linear-gradient(135deg, #F59E0B, #F97316);
  --surface-canvas: #f5f5f5;
  --surface-overlay: rgba(0, 0, 0, 0.3);
}
```

**Dark mode tokens:**
```css
.dark {
  --glass-bg: rgba(30, 30, 40, 0.7);
  --glass-bg-elevated: rgba(40, 40, 55, 0.8);
  --glass-bg-subtle: rgba(20, 20, 30, 0.5);
  --glass-border: rgba(255, 255, 255, 0.1);
  --glass-border-strong: rgba(255, 255, 255, 0.15);
  --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  --glass-shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.4);
  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.6);
  --text-tertiary: rgba(255, 255, 255, 0.38);
  --accent: #FBBF24;
  --accent-hover: #F59E0B;
  --accent-gradient: linear-gradient(135deg, #FBBF24, #F59E0B);
  --surface-canvas: #1a1a2e;
  --surface-overlay: rgba(0, 0, 0, 0.5);
}
```

### 3.2 Glass Utility Classes

Add utility classes to `index.css`:

```css
.glass {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
}

.glass-elevated {
  background: var(--glass-bg-elevated);
  backdrop-filter: blur(var(--glass-blur-heavy));
  -webkit-backdrop-filter: blur(var(--glass-blur-heavy));
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow-lg);
}

.glass-subtle {
  background: var(--glass-bg-subtle);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
}
```

### 3.3 Dark Mode Toggle

**State management:** Store theme in localStorage key `openjam-theme` with values `'light'` | `'dark'` | `'system'`. Apply `.dark` class to `<html>` element.

**Hook:** Create `app/src/lib/useTheme.ts`:
- Reads initial theme from localStorage (default: `'system'`)
- Listens to `prefers-color-scheme` media query for system mode
- Returns `{ theme, setTheme, isDark }`
- On change: toggle `.dark` class on `document.documentElement`, persist to localStorage

**Toggle UI:** Add a sun/moon icon button to MenuBar (right side, near collaborators).

### 3.4 Component Restyling

Each component gets glass treatment by replacing opaque `bg-white` classes with glass utility classes:

| Component | File | Current | New |
|-----------|------|---------|-----|
| MenuBar | `MenuBar.tsx` | `bg-white border-b border-gray-200` | `glass-elevated` + remove border-b |
| BottomToolbar | `BottomToolbar.tsx` | `bg-white rounded-xl shadow-xl border border-gray-200` | `glass-elevated rounded-2xl` |
| ZoomControls | `ZoomControls.tsx` | `bg-white rounded-lg shadow-lg border border-gray-200` | `glass rounded-xl` |
| MultiSelectToolbar | `MultiSelectToolbar.tsx` | `bg-white rounded-lg shadow-lg border border-gray-200` | `glass-elevated rounded-xl` |
| CommandPalette | `CommandPalette.tsx` | `bg-white rounded-xl shadow-2xl` | `glass-elevated rounded-2xl` |
| ContextMenu | `ContextMenu.tsx` | `bg-white rounded-lg shadow-xl border border-gray-200` | `glass-elevated rounded-xl` |
| ShareDialog | `ShareDialog.tsx` | `bg-white rounded-xl shadow-xl` | `glass-elevated rounded-2xl` |
| HelpPanel | `HelpPanel.tsx` | `bg-white rounded-xl shadow-xl` | `glass-elevated rounded-2xl` |
| VersionHistoryPanel | `VersionHistoryPanel.tsx` | `bg-white` | `glass-elevated` |
| FileInfoDialog | `FileInfoDialog.tsx` | `bg-white rounded-xl` | `glass-elevated rounded-2xl` |
| ImageUploadDialog | `ImageUploadDialog.tsx` | `bg-white rounded-xl` | `glass-elevated rounded-2xl` |
| WidgetsPanel | `WidgetsPanel.tsx` | `bg-white` | `glass-elevated` |
| PagesPanel | `PagesPanel.tsx` | `bg-white` | `glass-elevated` |
| CollaboratorPanel | `CollaboratorPanel.tsx` | `bg-white` | `glass-elevated` |
| UserMenu | `UserMenu.tsx` | `bg-white` | `glass-elevated` |

**Text colors:** Replace hardcoded `text-gray-700`, `text-gray-500`, etc. with CSS variable references using inline styles or additional utility classes:
- Primary text: `text-[color:var(--text-primary)]`
- Secondary text: `text-[color:var(--text-secondary)]`

**Canvas background:** Change from hardcoded `#ffffff` to `var(--surface-canvas)`.

**Modal overlays:** Change from `bg-black/50` to `bg-[var(--surface-overlay)]`.

### 3.5 Micro-interactions

Add to `index.css`:

```css
/* Tool button hover */
.glass-btn {
  transition: transform 0.15s ease, background 0.15s ease;
}
.glass-btn:hover {
  transform: scale(1.05);
  background: var(--glass-bg-elevated);
}
.glass-btn:active {
  transform: scale(0.97);
}

/* Panel slide transitions */
.glass-panel-enter {
  animation: glass-slide-in 0.2s ease-out;
}
@keyframes glass-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Selection glow */
.selection-glow {
  box-shadow: 0 0 0 2px var(--accent), 0 0 12px rgba(245, 158, 11, 0.3);
}
```

Apply `glass-btn` class to toolbar buttons. Apply `glass-panel-enter` to dropdown menus and panels on open.

### 3.6 Tailwind Config Extensions

Extend `tailwind.config.js` to support dark mode class strategy:

```javascript
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
        },
      },
    },
  },
  plugins: [],
};
```

---

## 4. Chunk 3 — Drawing Engine Overhaul

### 4.1 Install perfect-freehand

```bash
cd app && bun add perfect-freehand
```

This is a ~3KB MIT-licensed library that converts input points into smooth stroke outlines.

### 4.2 Drawing Preview — Live Pen Traces

**Current problem:** `DrawingPreview.tsx` renders straight line segments (`M ... L ... L ...`) during drawing, producing jagged preview. The final `Drawing.tsx` uses quadratic bezier curves but only after the stroke is complete.

**Solution:** Replace the straight-line preview with `perfect-freehand` rendering in real-time.

**New `DrawingPreview.tsx`:**
```typescript
import { getStroke } from 'perfect-freehand';

// Convert stroke outline points to SVG path
function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q']
  );
  d.push('Z');
  return d.join(' ');
}

// In render: use getStroke(drawingPath, options) → getSvgPathFromStroke() → filled <path>
```

This gives the user immediate visual feedback with smooth, tapered strokes as they draw.

### 4.3 Final Stroke Rendering

**Update `Drawing.tsx`** to also use `perfect-freehand`:
- Replace the manual quadratic bezier curve building with `getStroke()` + `getSvgPathFromStroke()`
- Render as a filled `<path>` instead of a stroked `<path>`
- This makes preview and final rendering visually identical

### 4.4 Stroke Options by Tool

```typescript
// Pen tool — smooth, tapered strokes
const PEN_OPTIONS = {
  size: strokeWidth,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
  start: { taper: true, cap: true },
  end: { taper: true, cap: true },
};

// Marker tool — flat, wide, semi-transparent
const MARKER_OPTIONS = {
  size: strokeWidth * 3,
  thinning: 0.1,
  smoothing: 0.7,
  streamline: 0.6,
  simulatePressure: false,
  start: { taper: false },
  end: { taper: false },
};
```

### 4.5 Free Curve Creation

**Current behavior:** The pen/draw tool already supports freehand drawing where mouse direction naturally controls the shape. With `perfect-freehand`, the user's mouse movement produces smooth curves — drawing fast creates smooth flowing lines, drawing slowly creates precise curves, and changing direction creates curves with varying curvature.

**This is inherent to `perfect-freehand`'s design** — no additional curve mode is needed. The `streamline` and `smoothing` options control how responsive the stroke is to mouse input:
- Higher `streamline` = smoother, more flowing curves (good for artistic work)
- Lower `streamline` = more responsive to quick direction changes (good for precise work)

The user can generate curves with varying directions and curvatures simply by moving the mouse — this replaces the current behavior where curves only appeared after stroke completion.

### 4.6 Storage Compatibility

Drawing elements continue to store raw input points. `getStroke()` is applied at render time. This means:
- Existing drawings render through the new engine automatically
- No data migration needed
- CRDT sync operates on raw input points (unchanged)
- Undo/redo works as before

### 4.7 Eraser Compatibility

The eraser tool operates on point-by-point intersection detection. Since we store raw points (not rendered outlines), eraser logic is unchanged. The visual rendering of eraser strokes can also use `perfect-freehand` for consistency but this is optional — eraser strokes are removed, not preserved.

---

## 5. Chunk 4 — Widget Customization

### 5.1 Property Inspector Panel

Create a right sidebar panel that appears when an element is selected. It shows properties specific to the selected element type.

**File:** `app/src/components/PropertyInspector.tsx`

**Layout:**
- Glass-styled sidebar, slides in from right
- Collapsible sections: "Layout" (x, y, width, height, rotation), "Style" (colors, stroke), "Element-specific" (varies by type)
- Closes when selection is cleared

### 5.2 Element-Specific Property Sections

**Table Widget:**
- Rows × Columns inputs (number spinners)
- "Add Row" / "Add Column" buttons
- Cell default color picker

**Timer Widget:**
- Duration input: minutes and seconds fields (not just presets)
- Keep preset buttons as quick-select options
- Auto-start toggle
- Sound on completion toggle (if audio is available)

**Sticky Note:**
- Color picker (existing 7 colors + custom)
- Font size slider
- Text alignment buttons

**Shape:**
- Shape type selector (visual grid of shape icons)
- Fill color picker (with transparent option)
- Stroke color picker
- Stroke width slider

**Text:**
- Font family selector
- Font size input
- Bold/Italic/Underline toggles
- Text alignment buttons
- Text color picker

**Connector:**
- Style selector (straight/elbow/curved)
- Start/End arrow type selectors
- Stroke color and width

**Drawing:**
- Stroke color (read-only display — can't change after drawn)
- Stroke width (read-only display)

### 5.3 Creation-Time Customization

For widgets, show a creation dialog when the widget is first dropped on canvas:

**Table creation dialog:**
- "Create Table" title
- Rows: number input (default 3, range 1-20)
- Columns: number input (default 3, range 1-10)
- "Create" button

**Timer creation dialog:**
- "Set Timer" title
- Minutes/Seconds inputs
- Preset buttons (1, 3, 5, 10, 15, 30 min)
- "Start" button

These dialogs use glass styling and appear centered over the canvas.

### 5.4 Property Inspector Integration

The inspector reads selected element data via `elementStore.getElement(selectedId)` and writes changes via `elementStore.updateElement(id, changes)`. Changes are immediately reflected on canvas and broadcast via the existing CRDT/WebSocket pipeline.

---

## 6. File Structure

### New Files

```
app/src/
├── lib/
│   ├── useTheme.ts                    # Dark mode hook
│   └── strokeUtils.ts                 # perfect-freehand helpers (getStroke wrapper, getSvgPathFromStroke)
├── components/
│   ├── PropertyInspector.tsx           # Right sidebar property editor
│   ├── PropertyInspector/
│   │   ├── TableProperties.tsx         # Table-specific properties
│   │   ├── TimerProperties.tsx         # Timer-specific properties
│   │   ├── StickyProperties.tsx        # Sticky note properties
│   │   ├── ShapeProperties.tsx         # Shape properties
│   │   ├── TextProperties.tsx          # Text properties
│   │   ├── ConnectorProperties.tsx     # Connector properties
│   │   └── LayoutProperties.tsx        # Shared x/y/w/h/rotation
│   └── widgets/
│       ├── TableCreationDialog.tsx      # Initial table config
│       └── TimerCreationDialog.tsx      # Initial timer config
```

### Modified Files

```
app/src/
├── index.css                           # Glass tokens, utility classes, animations
├── components/
│   ├── MenuBar.tsx                     # Glass styling + dark mode toggle
│   ├── BottomToolbar.tsx               # Glass styling + glass-btn class
│   ├── ZoomControls.tsx                # Glass styling
│   ├── MultiSelectToolbar.tsx          # Glass styling
│   ├── CommandPalette.tsx              # Glass styling + add marker tool
│   ├── ContextMenu.tsx                 # Glass styling
│   ├── ShareDialog.tsx                 # Glass styling
│   ├── HelpPanel.tsx                   # Glass styling
│   ├── VersionHistoryPanel.tsx         # Glass styling
│   ├── FileInfoDialog.tsx              # Glass styling
│   ├── ImageUploadDialog.tsx           # Glass styling
│   ├── WidgetsPanel.tsx                # Glass styling + creation dialogs
│   ├── PagesPanel.tsx                  # Glass styling
│   ├── CollaboratorPanel.tsx           # Glass styling
│   ├── UserMenu.tsx                    # Glass styling
│   ├── OpenJamCanvas.tsx               # Integrate property inspector, wire new shortcuts
│   ├── canvas/
│   │   ├── DrawingPreview.tsx          # perfect-freehand live preview
│   │   └── hooks/
│   │       ├── useKeyboardShortcuts.ts # Add missing shortcuts
│   │       └── useClipboard.ts         # Add cut operation
│   └── elements/
│       └── Drawing.tsx                 # perfect-freehand rendering
├── lib/
│   └── elements.ts                     # Add group-related fields if needed
app/tailwind.config.js                  # darkMode: 'class'
app/package.json                        # Add perfect-freehand
```

---

## 7. Implementation Order

### Chunk 1: Keyboard & Menu Fixes (fast, unblocks testing)
1. Add missing callbacks to `useKeyboardShortcuts` options interface
2. Implement Ctrl+S, Ctrl+X, Ctrl+Shift+L, Ctrl+G, Ctrl+Shift+G handlers
3. Add `cutSelected()` to `useClipboard`
4. Wire new callbacks in `OpenJamCanvas.tsx`
5. Add marker tool to `CommandPalette.tsx`
6. Add Lock/Unlock and Group/Ungroup operations to element store

### Chunk 2: Liquid Glass Design System
7. Add CSS custom properties (light + dark tokens) to `index.css`
8. Add glass utility classes and animation classes to `index.css`
9. Create `useTheme` hook with localStorage persistence
10. Update `tailwind.config.js` for `darkMode: 'class'`
11. Add dark mode toggle to `MenuBar.tsx`
12. Restyle `MenuBar.tsx` and `BottomToolbar.tsx` (highest impact)
13. Restyle remaining panels and dialogs (batch)
14. Update canvas background and overlay colors
15. Apply `glass-btn` micro-interactions to toolbar buttons

### Chunk 3: Drawing Engine
16. Install `perfect-freehand`
17. Create `strokeUtils.ts` with `getSvgPathFromStroke` and tool option presets
18. Update `DrawingPreview.tsx` for live pen traces
19. Update `Drawing.tsx` for final stroke rendering
20. Update `useDrawing.ts` to pass tool-specific options
21. Verify eraser compatibility and existing drawing backward compatibility

### Chunk 4: Widget Customization
22. Create `LayoutProperties.tsx` (shared x/y/w/h section)
23. Create element-specific property components (Table, Timer, Sticky, Shape, Text, Connector)
24. Create `PropertyInspector.tsx` main panel
25. Create `TableCreationDialog.tsx` and `TimerCreationDialog.tsx`
26. Integrate property inspector into `OpenJamCanvas.tsx`
27. Wire creation dialogs into `WidgetsPanel.tsx`

---

## 8. Non-Goals for This Phase

- React Router / page navigation (Phase 3)
- OAuth / magic link auth (Phase 3)
- Dashboard / settings pages (Phase 3)
- Widget thumbnails on dashboard
- Tablet pressure sensitivity (would require hardware)
- Mobile/touch responsiveness
- Undo/redo for property inspector changes (uses existing elementStore undo)
