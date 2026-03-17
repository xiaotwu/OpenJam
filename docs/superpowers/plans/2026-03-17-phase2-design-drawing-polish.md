# Phase 2: Design System + Drawing Engine + Polish — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Liquid Glass design to all UI surfaces with dark mode, upgrade drawing to smooth strokes via perfect-freehand, fix all keyboard/menu gaps, and add a property inspector for widget customization.

**Architecture:** CSS custom properties define the glass design tokens (light/dark). A `useTheme` hook manages dark mode state and toggles the `.dark` class on `<html>`. The drawing engine replaces manual SVG path building with `perfect-freehand`'s `getStroke()` at both preview and render time. A property inspector sidebar reads/writes element properties through the existing `ElementStore`.

**Tech Stack:** React 19, TypeScript 5.8, Tailwind CSS 4, perfect-freehand, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-03-17-phase2-design-drawing-glass-design.md`

---

## Chunk 1: Keyboard & Menu Fixes

### Task 1: Add missing keyboard shortcuts to useKeyboardShortcuts

**Files:**
- Modify: `app/src/components/canvas/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Add new callbacks to the options interface**

Add these to `UseKeyboardShortcutsOptions`:

```typescript
onSave: () => void;
onCut: () => void;
onToggleLock: () => void;
onGroup: () => void;
onUngroup: () => void;
```

- [ ] **Step 2: Add Ctrl+S handler**

Insert after the Ctrl+K block (before the `if (options.editingId) return` guard since save should work during editing):

```typescript
if ((e.ctrlKey || e.metaKey) && e.key === 's') {
  e.preventDefault();
  options.onSave();
  return;
}
```

- [ ] **Step 3: Add Ctrl+X, Ctrl+Shift+L, Ctrl+G, Ctrl+Shift+G handlers**

Insert after the existing Ctrl+A handler (these should NOT fire when editing):

```typescript
// Cut (Ctrl+X)
if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
  e.preventDefault();
  options.onCut();
  return;
}

// Lock/Unlock (Ctrl+Shift+L)
if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'l') {
  e.preventDefault();
  options.onToggleLock();
  return;
}

// Group (Ctrl+G)
if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'g') {
  e.preventDefault();
  options.onGroup();
  return;
}

// Ungroup (Ctrl+Shift+G)
if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'g') {
  e.preventDefault();
  options.onUngroup();
  return;
}
```

- [ ] **Step 4: Verify the full shortcut handler compiles**

Run: `cd app && npx tsc --noEmit`
Expected: No errors related to useKeyboardShortcuts.

### Task 2: Add cutSelected to useClipboard

**Files:**
- Modify: `app/src/components/canvas/hooks/useClipboard.ts`

- [ ] **Step 1: Add onDelete callback to options and cutSelected function**

Add `onDelete: () => void` to `UseClipboardOptions`.

Add after `copySelected`:

```typescript
const cutSelected = useCallback(() => {
  const selectedElements = elements.filter((el) => selectedIds.has(el.id));
  setClipboard(selectedElements);
  onDelete();
}, [elements, selectedIds, onDelete]);
```

- [ ] **Step 2: Return cutSelected from the hook**

Update return: `return { clipboard, duplicateSelected, copySelected, cutSelected, pasteElements };`

### Task 3: Wire new shortcuts in OpenJamCanvas

**Files:**
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Pass onDelete to useClipboard**

Find the `useClipboard` call and add `onDelete: deleteSelected` to the options object.

- [ ] **Step 2: Destructure cutSelected from useClipboard**

Update destructuring: `const { clipboard, duplicateSelected, copySelected, cutSelected, pasteElements } = useClipboard(...)`.

- [ ] **Step 3: Pass new callbacks to useKeyboardShortcuts**

Find the `useKeyboardShortcuts` call and add:

```typescript
onSave: saveToDatabase,
onCut: cutSelected,
onToggleLock: lockSelected,
onGroup: groupSelected,
onUngroup: ungroupSelected,
```

- [ ] **Step 4: Verify compilation**

Run: `cd app && npx tsc --noEmit`

### Task 4: Add marker tool to command palette

**Files:**
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Add marker entry to commands array**

Find the `const commands = useMemo(...)` block (line ~1291). After the `draw` entry, add:

```typescript
{ id: 'marker', label: 'Marker tool', category: 'Tools', shortcut: 'M', action: () => setCurrentTool('marker') },
```

- [ ] **Step 2: Commit Chunk 1**

```bash
git add app/src/components/canvas/hooks/useKeyboardShortcuts.ts \
       app/src/components/canvas/hooks/useClipboard.ts \
       app/src/components/OpenJamCanvas.tsx
git commit -m "fix: add missing keyboard shortcuts, cut operation, and marker in command palette"
```

---

## Chunk 2: Liquid Glass Design System

### Task 5: Add glass design tokens to index.css

**Files:**
- Modify: `app/src/index.css`

- [ ] **Step 1: Replace existing `:root` block with glass tokens**

Replace the current `:root { ... }` block with:

```css
:root {
  /* Glass design tokens — light mode */
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

  /* Retained from original */
  color: var(--text-primary);
  background-color: var(--surface-canvas);
  font-family: 'Inter', system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 2: Add dark mode tokens**

Add after the `:root` block:

```css
/* Dark mode tokens */
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

  color: var(--text-primary);
  background-color: var(--surface-canvas);
}

.dark body, .dark #root {
  background: var(--surface-canvas);
}
```

- [ ] **Step 3: Add glass utility classes**

Add after the dark mode block:

```css
/* Glass utility classes */
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

- [ ] **Step 4: Add micro-interaction classes**

Add after the glass classes:

```css
/* Glass button interactions */
.glass-btn {
  transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.glass-btn:hover {
  transform: scale(1.05);
  background: var(--glass-bg-elevated);
}
.glass-btn:active {
  transform: scale(0.97);
}

/* Panel slide animation */
.glass-panel-enter {
  animation: glass-slide-in 0.2s ease-out;
}
@keyframes glass-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Selection glow (amber accent) */
.selection-glow {
  box-shadow: 0 0 0 2px var(--accent), 0 0 12px rgba(245, 158, 11, 0.3);
}
```

### Task 6: Create useTheme hook

**Files:**
- Create: `app/src/lib/useTheme.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';

function getSystemPreference(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyDarkClass(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('openjam-theme') as Theme | null;
    return stored || 'system';
  });

  const isDark = theme === 'dark' || (theme === 'system' && getSystemPreference());

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('openjam-theme', newTheme);
  }, []);

  // Apply dark class on mount and when theme changes
  useEffect(() => {
    applyDarkClass(isDark);
  }, [isDark]);

  // Listen for system preference changes
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => applyDarkClass(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return { theme, setTheme, isDark };
}
```

### Task 7: Update Tailwind config for dark mode

**Files:**
- Modify: `app/tailwind.config.js`

- [ ] **Step 1: Add darkMode class strategy**

Replace entire file:

```javascript
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {},
    },
    plugins: [],
};
```

### Task 8: Add dark mode toggle to MenuBar

**Files:**
- Modify: `app/src/components/MenuBar.tsx`
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Add theme props to MenuBarProps**

Add to `MenuBarProps` interface in `MenuBar.tsx`:

```typescript
isDark?: boolean;
onToggleTheme?: () => void;
```

- [ ] **Step 2: Add theme toggle button to MenuBar**

Find the right side of the MenuBar (near collaborator avatars / share button). Add a sun/moon toggle button:

```tsx
{onToggleTheme && (
  <button
    onClick={onToggleTheme}
    className="glass-btn p-2 rounded-lg"
    title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
  >
    {isDark ? (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ) : (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    )}
  </button>
)}
```

- [ ] **Step 3: Use useTheme in OpenJamCanvas and pass to MenuBar**

In `OpenJamCanvas.tsx`, add:

```typescript
import { useTheme } from '../lib/useTheme';
// Inside the component:
const { isDark, setTheme } = useTheme();
```

Pass to MenuBar:

```tsx
isDark={isDark}
onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
```

- [ ] **Step 4: Commit design tokens + dark mode infrastructure**

```bash
git add app/src/index.css app/src/lib/useTheme.ts app/tailwind.config.js \
       app/src/components/MenuBar.tsx app/src/components/OpenJamCanvas.tsx
git commit -m "feat: add Liquid Glass design tokens, dark mode toggle, and glass utility classes"
```

### Task 9: Restyle MenuBar with glass treatment

**Files:**
- Modify: `app/src/components/MenuBar.tsx`

- [ ] **Step 1: Replace opaque background with glass**

Find the root container of MenuBar. Replace classes like `bg-white border-b border-gray-200` with `glass-elevated`. For example:

```
Old: className="... bg-white border-b border-gray-200 ..."
New: className="... glass-elevated ..."
```

- [ ] **Step 2: Update text colors to use CSS variables**

Replace hardcoded Tailwind text colors:
- `text-gray-700` → `style={{ color: 'var(--text-primary)' }}`
- `text-gray-500` → `style={{ color: 'var(--text-secondary)' }}`
- `text-gray-400` → `style={{ color: 'var(--text-tertiary)' }}`

For hover states on menu items, use `hover:bg-white/10` (works in both light/dark) or inline style.

- [ ] **Step 3: Update dropdown menus to use glass**

Find dropdown/popover containers in MenuBar. Replace `bg-white rounded-lg shadow-xl border border-gray-200` with `glass-elevated rounded-xl glass-panel-enter`.

### Task 10: Restyle BottomToolbar with glass treatment

**Files:**
- Modify: `app/src/components/BottomToolbar.tsx`

- [ ] **Step 1: Replace toolbar container background**

Find the main toolbar container. Replace `bg-white rounded-xl shadow-xl border border-gray-200` with `glass-elevated rounded-2xl`.

- [ ] **Step 2: Add glass-btn class to tool buttons**

Add `glass-btn` class to each tool button element. Remove any hardcoded `hover:bg-gray-100` and replace with the glass-btn hover behavior.

- [ ] **Step 3: Update tool option popovers**

Any popover/dropdown panels within BottomToolbar (color pickers, shape selectors, etc.) should use `glass-elevated rounded-xl glass-panel-enter`.

- [ ] **Step 4: Update text and icon colors to use variables**

Replace `text-gray-600`, `text-gray-700` etc. with `style={{ color: 'var(--text-primary)' }}` or `style={{ color: 'var(--text-secondary)' }}`.

### Task 11: Restyle ZoomControls with glass treatment

**Files:**
- Modify: `app/src/components/ZoomControls.tsx`

- [ ] **Step 1: Replace container background**

Replace `bg-white rounded-lg shadow-lg border border-gray-200` with `glass rounded-xl`.

- [ ] **Step 2: Update button hover and text colors**

Replace `hover:bg-gray-100` with `glass-btn` class. Replace `text-gray-600` with `style={{ color: 'var(--text-secondary)' }}`.

- [ ] **Step 3: Update divider colors**

Replace `bg-gray-200` dividers with `style={{ background: 'var(--glass-border-strong)' }}`.

### Task 12: Restyle remaining panels and dialogs (batch)

**Files:**
- Modify: `app/src/components/CommandPalette.tsx`
- Modify: `app/src/components/ContextMenu.tsx`
- Modify: `app/src/components/ShareDialog.tsx`
- Modify: `app/src/components/HelpPanel.tsx`
- Modify: `app/src/components/MultiSelectToolbar.tsx`
- Modify: `app/src/components/WidgetsPanel.tsx`
- Modify: `app/src/components/PagesPanel.tsx`
- Modify: `app/src/components/UserMenu.tsx`
- Modify: `app/src/components/VersionHistoryPanel.tsx` (if exists)
- Modify: `app/src/components/FileInfoDialog.tsx` (if exists)
- Modify: `app/src/components/ImageUploadDialog.tsx` (if exists)
- Modify: `app/src/components/CollaboratorPanel.tsx` (if exists)
- Modify: `app/src/components/elements/Drawing.tsx` (PenSettings component)

For each file, apply the same pattern:

- [ ] **Step 1: CommandPalette — glass treatment**

Replace container `bg-white rounded-xl shadow-2xl` → `glass-elevated rounded-2xl`.
Replace backdrop `bg-black/20` → `bg-[var(--surface-overlay)]`.
Replace input `bg-gray-100` → `bg-white/10`.
Replace text colors with CSS variable equivalents.

- [ ] **Step 2: ContextMenu — glass treatment**

Replace `bg-white rounded-lg shadow-xl border border-gray-200` → `glass-elevated rounded-xl glass-panel-enter`.
Replace `hover:bg-gray-100` → `hover:bg-white/10`.
Replace divider `bg-gray-200` → `bg-[var(--glass-border-strong)]`.

- [ ] **Step 3: ShareDialog — glass treatment**

Replace dialog container with `glass-elevated rounded-2xl`.
Replace modal overlay with `bg-[var(--surface-overlay)]`.

- [ ] **Step 4: HelpPanel — glass treatment**

Replace container with `glass-elevated rounded-2xl`.
Replace overlay with `bg-[var(--surface-overlay)]`.

- [ ] **Step 5: MultiSelectToolbar — glass treatment**

Replace `bg-white rounded-lg shadow-lg border border-gray-200` → `glass-elevated rounded-xl`.

- [ ] **Step 6: WidgetsPanel, PagesPanel, UserMenu — glass treatment**

Replace `bg-white` backgrounds with `glass-elevated`. Add `glass-panel-enter` for slide-in animation.

- [ ] **Step 7: Remaining dialogs — glass treatment**

Apply glass-elevated to VersionHistoryPanel, FileInfoDialog, ImageUploadDialog, CollaboratorPanel.

- [ ] **Step 8: PenSettings in Drawing.tsx — glass treatment**

Replace `bg-white rounded-lg shadow-lg border` with `glass-elevated rounded-xl`.
Replace `hover:bg-gray-100` with `hover:bg-white/10`.
Replace `bg-gray-200` dividers.

### Task 13: Update canvas background and overlays

**Files:**
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Update canvas background**

Find `className="relative w-full h-full overflow-hidden bg-gray-50"` in the root div.
Replace `bg-gray-50` with `bg-[var(--surface-canvas)]`.

- [ ] **Step 2: Verify compilation and commit**

Run: `cd app && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: apply Liquid Glass design to all UI surfaces with dark mode support"
```

---

## Chunk 3: Drawing Engine

### Task 14: Install perfect-freehand and create stroke utilities

**Files:**
- Create: `app/src/lib/strokeUtils.ts`
- Modify: `app/package.json`

- [ ] **Step 1: Install perfect-freehand**

```bash
cd app && bun add perfect-freehand
```

- [ ] **Step 2: Create strokeUtils.ts**

```typescript
import { getStroke, type StrokeOptions } from 'perfect-freehand';

// Convert perfect-freehand outline points to an SVG path string
export function getSvgPathFromStroke(stroke: number[][]): string {
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

// Stroke options for pen tool — smooth, tapered
export function getPenOptions(size: number): StrokeOptions {
  return {
    size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: true,
    start: { taper: true, cap: true },
    end: { taper: true, cap: true },
  };
}

// Stroke options for marker tool — flat, wide
export function getMarkerOptions(size: number): StrokeOptions {
  return {
    size: Math.max(size * 3, 12),
    thinning: 0.1,
    smoothing: 0.7,
    streamline: 0.6,
    simulatePressure: false,
    start: { taper: false },
    end: { taper: false },
  };
}

// Generate SVG path from raw points using perfect-freehand
export function getStrokePath(
  points: { x: number; y: number }[],
  options: StrokeOptions
): string {
  if (points.length === 0) return '';
  const stroke = getStroke(
    points.map((p) => [p.x, p.y]),
    options
  );
  return getSvgPathFromStroke(stroke);
}
```

### Task 15: Update DrawingPreview for live pen traces

**Files:**
- Modify: `app/src/components/canvas/DrawingPreview.tsx`

- [ ] **Step 1: Replace straight-line preview with perfect-freehand rendering**

Replace the entire file:

```typescript
import { useMemo } from 'react';
import { getStrokePath, getPenOptions, getMarkerOptions } from '../../lib/strokeUtils';

interface DrawingPreviewProps {
  drawingPath: { x: number; y: number }[];
  isMarker: boolean;
  strokeWidth: number;
  strokeColor: string;
}

export default function DrawingPreview({ drawingPath, isMarker, strokeWidth, strokeColor }: DrawingPreviewProps) {
  const options = isMarker ? getMarkerOptions(strokeWidth) : getPenOptions(strokeWidth);
  const previewColor = isMarker ? strokeColor + '80' : strokeColor;

  const pathD = useMemo(
    () => getStrokePath(drawingPath, options),
    [drawingPath, options]
  );

  if (!pathD) return null;

  return (
    <svg
      className="absolute pointer-events-none"
      style={{
        left: 0,
        top: 0,
        width: '10000px',
        height: '10000px',
        overflow: 'visible',
      }}
    >
      <path
        d={pathD}
        fill={previewColor}
        stroke="none"
      />
    </svg>
  );
}
```

Key change: the path is now a **filled** shape (from `getStroke` outline) instead of a **stroked** line. This produces smooth, tapered strokes in real-time.

### Task 16: Update Drawing element rendering

**Files:**
- Modify: `app/src/components/elements/Drawing.tsx`

- [ ] **Step 1: Replace quadratic bezier path building with perfect-freehand**

Import stroke utilities:

```typescript
import { getStrokePath, getPenOptions, getMarkerOptions } from '../../lib/strokeUtils';
```

Replace the `pathD` useMemo (the one that builds quadratic bezier curves) with:

```typescript
const pathD = useMemo(() => {
  const points = element.points;
  if (points.length === 0) return '';

  // Offset points by bounds origin for correct positioning within SVG
  const offsetPoints = points.map(p => ({
    x: p.x - bounds.x,
    y: p.y - bounds.y,
  }));

  // Detect marker by semi-transparent color (ends with '80' hex alpha)
  const isMarker = element.stroke.length === 9 && element.stroke.endsWith('80');
  const options = isMarker
    ? getMarkerOptions(element.strokeWidth / 3)
    : getPenOptions(element.strokeWidth);

  return getStrokePath(offsetPoints, options);
}, [element.points, element.strokeWidth, element.stroke, bounds]);
```

- [ ] **Step 2: Change SVG path from stroked to filled**

Replace the main path rendering:

```tsx
{/* Main path — filled shape from perfect-freehand */}
<path
  d={pathD}
  fill={element.isEraser ? 'white' : element.stroke}
  stroke="none"
  style={element.isEraser ? { mixBlendMode: 'difference' } : undefined}
/>
```

Replace the selection highlight path similarly — use filled instead of stroked, with a slightly larger size option for the highlight.

- [ ] **Step 3: Update selection highlight**

Replace the selection highlight `<path>` with:

```tsx
{isSelected && pathD && (
  <path
    d={pathD}
    fill="#3B82F6"
    stroke="none"
    opacity={0.15}
  />
)}
```

### Task 17: Verify drawing backward compatibility and commit

- [ ] **Step 1: Verify compilation**

```bash
cd app && npx tsc --noEmit
```

- [ ] **Step 2: Verify the app builds**

```bash
cd app && bun run build
```

- [ ] **Step 3: Commit drawing engine changes**

```bash
git add app/package.json app/bun.lock app/src/lib/strokeUtils.ts \
       app/src/components/canvas/DrawingPreview.tsx \
       app/src/components/elements/Drawing.tsx
git commit -m "feat: upgrade drawing engine to perfect-freehand for smooth tapered strokes"
```

---

## Chunk 4: Widget Customization

### Task 18: Create LayoutProperties component

**Files:**
- Create: `app/src/components/PropertyInspector/LayoutProperties.tsx`

- [ ] **Step 1: Write the shared layout properties component**

```typescript
import type { Element } from '../../lib/elements';

interface LayoutPropertiesProps {
  element: Element;
  onUpdate: (changes: Partial<Element>) => void;
}

export default function LayoutProperties({ element, onUpdate }: LayoutPropertiesProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase" style={{ color: 'var(--text-tertiary)' }}>
        Layout
      </h4>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>X</span>
          <input
            type="number"
            value={Math.round(element.x)}
            onChange={(e) => onUpdate({ x: Number(e.target.value) })}
            className="w-full px-2 py-1 rounded text-sm bg-white/10 border border-[var(--glass-border-strong)]"
            style={{ color: 'var(--text-primary)' }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Y</span>
          <input
            type="number"
            value={Math.round(element.y)}
            onChange={(e) => onUpdate({ y: Number(e.target.value) })}
            className="w-full px-2 py-1 rounded text-sm bg-white/10 border border-[var(--glass-border-strong)]"
            style={{ color: 'var(--text-primary)' }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>W</span>
          <input
            type="number"
            value={Math.round(element.width)}
            onChange={(e) => onUpdate({ width: Number(e.target.value) })}
            className="w-full px-2 py-1 rounded text-sm bg-white/10 border border-[var(--glass-border-strong)]"
            style={{ color: 'var(--text-primary)' }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>H</span>
          <input
            type="number"
            value={Math.round(element.height)}
            onChange={(e) => onUpdate({ height: Number(e.target.value) })}
            className="w-full px-2 py-1 rounded text-sm bg-white/10 border border-[var(--glass-border-strong)]"
            style={{ color: 'var(--text-primary)' }}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Rotation</span>
        <input
          type="number"
          value={Math.round(element.rotation || 0)}
          onChange={(e) => onUpdate({ rotation: Number(e.target.value) })}
          className="w-full px-2 py-1 rounded text-sm bg-white/10 border border-[var(--glass-border-strong)]"
          style={{ color: 'var(--text-primary)' }}
          min={0}
          max={360}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Opacity</span>
        <input
          type="range"
          value={element.opacity ?? 1}
          onChange={(e) => onUpdate({ opacity: Number(e.target.value) })}
          className="w-full"
          min={0}
          max={1}
          step={0.05}
        />
      </label>
    </div>
  );
}
```

### Task 19: Create element-specific property components

**Files:**
- Create: `app/src/components/PropertyInspector/TableProperties.tsx`
- Create: `app/src/components/PropertyInspector/TimerProperties.tsx`
- Create: `app/src/components/PropertyInspector/StickyProperties.tsx`
- Create: `app/src/components/PropertyInspector/ShapeProperties.tsx`
- Create: `app/src/components/PropertyInspector/TextProperties.tsx`
- Create: `app/src/components/PropertyInspector/ConnectorProperties.tsx`

- [ ] **Step 1: Write TableProperties**

```typescript
interface TablePropertiesProps {
  widgetData: { rows: number; cols: number; cells: unknown[][] };
  onUpdateWidget: (data: Record<string, unknown>) => void;
}

export default function TableProperties({ widgetData, onUpdateWidget }: TablePropertiesProps) {
  const addRow = () => {
    const newRow = Array(widgetData.cols).fill(null).map(() => ({ content: '', backgroundColor: '#ffffff' }));
    onUpdateWidget({
      rows: widgetData.rows + 1,
      cells: [...widgetData.cells, newRow],
    });
  };

  const addCol = () => {
    const newCells = widgetData.cells.map(row => [...row, { content: '', backgroundColor: '#ffffff' }]);
    onUpdateWidget({
      cols: widgetData.cols + 1,
      cells: newCells,
    });
  };

  const removeRow = () => {
    if (widgetData.rows <= 1) return;
    onUpdateWidget({
      rows: widgetData.rows - 1,
      cells: widgetData.cells.slice(0, -1),
    });
  };

  const removeCol = () => {
    if (widgetData.cols <= 1) return;
    onUpdateWidget({
      cols: widgetData.cols - 1,
      cells: widgetData.cells.map(row => row.slice(0, -1)),
    });
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase" style={{ color: 'var(--text-tertiary)' }}>Table</h4>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Rows: {widgetData.rows}</span>
          <button onClick={addRow} className="glass-btn px-2 py-0.5 rounded text-xs">+</button>
          <button onClick={removeRow} className="glass-btn px-2 py-0.5 rounded text-xs">−</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Cols: {widgetData.cols}</span>
          <button onClick={addCol} className="glass-btn px-2 py-0.5 rounded text-xs">+</button>
          <button onClick={removeCol} className="glass-btn px-2 py-0.5 rounded text-xs">−</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write TimerProperties**

```typescript
import { useState } from 'react';

interface TimerPropertiesProps {
  widgetData: { minutes?: number };
  onUpdateWidget: (data: Record<string, unknown>) => void;
}

const PRESETS = [1, 3, 5, 10, 15, 30];

export default function TimerProperties({ widgetData, onUpdateWidget }: TimerPropertiesProps) {
  const [customMin, setCustomMin] = useState(String(widgetData.minutes || 5));

  const applyDuration = (minutes: number) => {
    setCustomMin(String(minutes));
    onUpdateWidget({ minutes });
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase" style={{ color: 'var(--text-tertiary)' }}>Timer</h4>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Duration (minutes)</span>
        <input
          type="number"
          value={customMin}
          onChange={(e) => {
            setCustomMin(e.target.value);
            const v = Number(e.target.value);
            if (v > 0 && v <= 180) onUpdateWidget({ minutes: v });
          }}
          className="w-full px-2 py-1 rounded text-sm bg-white/10 border border-[var(--glass-border-strong)]"
          style={{ color: 'var(--text-primary)' }}
          min={1}
          max={180}
        />
      </label>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((m) => (
          <button
            key={m}
            onClick={() => applyDuration(m)}
            className={`glass-btn px-2 py-0.5 rounded text-xs ${
              widgetData.minutes === m ? 'bg-[var(--accent)] text-white' : ''
            }`}
          >
            {m}m
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write StickyProperties**

```typescript
interface StickyPropertiesProps {
  color: string;
  fontSize: number;
  onUpdate: (changes: Record<string, unknown>) => void;
}

const COLORS = [
  { name: 'Yellow', value: 'yellow' },
  { name: 'Orange', value: 'orange' },
  { name: 'Pink', value: 'pink' },
  { name: 'Purple', value: 'purple' },
  { name: 'Blue', value: 'blue' },
  { name: 'Green', value: 'green' },
  { name: 'Gray', value: 'gray' },
];

const COLOR_MAP: Record<string, string> = {
  yellow: '#FEF3C7', orange: '#FED7AA', pink: '#FBCFE8',
  purple: '#E9D5FF', blue: '#BFDBFE', green: '#BBF7D0', gray: '#E5E7EB',
};

export default function StickyProperties({ color, fontSize, onUpdate }: StickyPropertiesProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase" style={{ color: 'var(--text-tertiary)' }}>Sticky Note</h4>
      <div className="flex gap-1 flex-wrap">
        {COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => onUpdate({ color: c.value })}
            className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: COLOR_MAP[c.value],
              borderColor: color === c.value ? 'var(--accent)' : 'transparent',
            }}
            title={c.name}
          />
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Font size</span>
        <input
          type="range"
          value={fontSize}
          onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
          min={10}
          max={32}
          step={1}
          className="w-full"
        />
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{fontSize}px</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Write ShapeProperties**

```typescript
interface ShapePropertiesProps {
  fill: string;
  stroke: string;
  strokeWidth: number;
  onUpdate: (changes: Record<string, unknown>) => void;
}

export default function ShapeProperties({ fill, stroke, strokeWidth, onUpdate }: ShapePropertiesProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase" style={{ color: 'var(--text-tertiary)' }}>Shape</h4>
      <label className="flex items-center gap-2">
        <span className="text-xs w-12" style={{ color: 'var(--text-secondary)' }}>Fill</span>
        <input type="color" value={fill || '#ffffff'} onChange={(e) => onUpdate({ fill: e.target.value })} className="w-8 h-8 rounded cursor-pointer" />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-xs w-12" style={{ color: 'var(--text-secondary)' }}>Stroke</span>
        <input type="color" value={stroke || '#1F2937'} onChange={(e) => onUpdate({ stroke: e.target.value })} className="w-8 h-8 rounded cursor-pointer" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Stroke width</span>
        <input type="range" value={strokeWidth} onChange={(e) => onUpdate({ strokeWidth: Number(e.target.value) })} min={0} max={8} step={1} className="w-full" />
      </label>
    </div>
  );
}
```

- [ ] **Step 5: Write TextProperties**

```typescript
interface TextPropertiesProps {
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  color: string;
  onUpdate: (changes: Record<string, unknown>) => void;
}

export default function TextProperties({ fontSize, fontWeight, fontStyle, textAlign, color, onUpdate }: TextPropertiesProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase" style={{ color: 'var(--text-tertiary)' }}>Text</h4>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Font size</span>
        <input type="number" value={fontSize} onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })} min={8} max={96} className="w-full px-2 py-1 rounded text-sm bg-white/10 border border-[var(--glass-border-strong)]" style={{ color: 'var(--text-primary)' }} />
      </label>
      <div className="flex gap-1">
        <button onClick={() => onUpdate({ fontWeight: fontWeight === 'bold' ? 'normal' : 'bold' })} className={`glass-btn px-2 py-1 rounded text-sm font-bold ${fontWeight === 'bold' ? 'bg-[var(--accent)] text-white' : ''}`}>B</button>
        <button onClick={() => onUpdate({ fontStyle: fontStyle === 'italic' ? 'normal' : 'italic' })} className={`glass-btn px-2 py-1 rounded text-sm italic ${fontStyle === 'italic' ? 'bg-[var(--accent)] text-white' : ''}`}>I</button>
      </div>
      <div className="flex gap-1">
        {(['left', 'center', 'right'] as const).map((align) => (
          <button key={align} onClick={() => onUpdate({ textAlign: align })} className={`glass-btn px-2 py-1 rounded text-xs ${textAlign === align ? 'bg-[var(--accent)] text-white' : ''}`}>{align}</button>
        ))}
      </div>
      <label className="flex items-center gap-2">
        <span className="text-xs w-12" style={{ color: 'var(--text-secondary)' }}>Color</span>
        <input type="color" value={color || '#000000'} onChange={(e) => onUpdate({ color: e.target.value })} className="w-8 h-8 rounded cursor-pointer" />
      </label>
    </div>
  );
}
```

- [ ] **Step 6: Write ConnectorProperties**

```typescript
interface ConnectorPropertiesProps {
  style: string;
  startArrow: string;
  endArrow: string;
  stroke: string;
  strokeWidth: number;
  onUpdate: (changes: Record<string, unknown>) => void;
}

export default function ConnectorProperties({ style, startArrow, endArrow, stroke, strokeWidth, onUpdate }: ConnectorPropertiesProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase" style={{ color: 'var(--text-tertiary)' }}>Connector</h4>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Style</span>
        <div className="flex gap-1">
          {(['straight', 'elbow', 'curved'] as const).map((s) => (
            <button key={s} onClick={() => onUpdate({ style: s })} className={`glass-btn px-2 py-1 rounded text-xs ${style === s ? 'bg-[var(--accent)] text-white' : ''}`}>{s}</button>
          ))}
        </div>
      </label>
      <label className="flex items-center gap-2">
        <span className="text-xs w-12" style={{ color: 'var(--text-secondary)' }}>Color</span>
        <input type="color" value={stroke || '#1F2937'} onChange={(e) => onUpdate({ stroke: e.target.value })} className="w-8 h-8 rounded cursor-pointer" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Width</span>
        <input type="range" value={strokeWidth} onChange={(e) => onUpdate({ strokeWidth: Number(e.target.value) })} min={1} max={6} step={1} className="w-full" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Start</span>
          <select value={startArrow} onChange={(e) => onUpdate({ startArrow: e.target.value })} className="px-2 py-1 rounded text-xs bg-white/10 border border-[var(--glass-border-strong)]" style={{ color: 'var(--text-primary)' }}>
            <option value="none">None</option>
            <option value="arrow">Arrow</option>
            <option value="dot">Dot</option>
            <option value="diamond">Diamond</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>End</span>
          <select value={endArrow} onChange={(e) => onUpdate({ endArrow: e.target.value })} className="px-2 py-1 rounded text-xs bg-white/10 border border-[var(--glass-border-strong)]" style={{ color: 'var(--text-primary)' }}>
            <option value="none">None</option>
            <option value="arrow">Arrow</option>
            <option value="dot">Dot</option>
            <option value="diamond">Diamond</option>
          </select>
        </label>
      </div>
    </div>
  );
}
```

### Task 20: Create PropertyInspector main panel

**Files:**
- Create: `app/src/components/PropertyInspector.tsx`

- [ ] **Step 1: Write the main inspector component**

```typescript
import { useCallback } from 'react';
import type { Element, StickyElement, ShapeElement, TextElement, ConnectorElement, WidgetElement } from '../lib/elements';
import type { ElementStore } from '../lib/elementStore';
import LayoutProperties from './PropertyInspector/LayoutProperties';
import StickyProperties from './PropertyInspector/StickyProperties';
import ShapeProperties from './PropertyInspector/ShapeProperties';
import TextProperties from './PropertyInspector/TextProperties';
import ConnectorProperties from './PropertyInspector/ConnectorProperties';
import TableProperties from './PropertyInspector/TableProperties';
import TimerProperties from './PropertyInspector/TimerProperties';

interface PropertyInspectorProps {
  element: Element | null;
  elementStore: ElementStore;
}

export default function PropertyInspector({ element, elementStore }: PropertyInspectorProps) {
  if (!element) return null;

  const onUpdate = useCallback(
    (changes: Partial<Element>) => {
      elementStore.updateElement(element.id, changes);
    },
    [element.id, elementStore]
  );

  const onUpdateWidget = useCallback(
    (data: Record<string, unknown>) => {
      const widget = element as WidgetElement;
      elementStore.updateElement(element.id, {
        widgetData: { ...widget.widgetData, ...data },
      } as Partial<Element>);
    },
    [element.id, elementStore]
  );

  return (
    <div className="glass-elevated rounded-l-2xl glass-panel-enter w-64 p-4 space-y-4 overflow-y-auto max-h-full">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        Properties
      </h3>

      <LayoutProperties element={element} onUpdate={onUpdate} />

      <div className="h-px" style={{ background: 'var(--glass-border-strong)' }} />

      {element.type === 'sticky' && (
        <StickyProperties
          color={(element as StickyElement).color}
          fontSize={(element as StickyElement).fontSize || 16}
          onUpdate={onUpdate}
        />
      )}

      {element.type === 'shape' && (
        <ShapeProperties
          fill={(element as ShapeElement).fill}
          stroke={(element as ShapeElement).stroke}
          strokeWidth={(element as ShapeElement).strokeWidth}
          onUpdate={onUpdate}
        />
      )}

      {element.type === 'text' && (
        <TextProperties
          fontSize={(element as TextElement).fontSize}
          fontWeight={(element as TextElement).fontWeight || 'normal'}
          fontStyle={(element as TextElement).fontStyle || 'normal'}
          textAlign={(element as TextElement).textAlign || 'left'}
          color={(element as TextElement).color}
          onUpdate={onUpdate}
        />
      )}

      {element.type === 'connector' && (
        <ConnectorProperties
          style={(element as ConnectorElement).style || 'straight'}
          startArrow={(element as ConnectorElement).startArrow || 'none'}
          endArrow={(element as ConnectorElement).endArrow || 'arrow'}
          stroke={(element as ConnectorElement).stroke}
          strokeWidth={(element as ConnectorElement).strokeWidth}
          onUpdate={onUpdate}
        />
      )}

      {element.type === 'widget' && (element as WidgetElement).widgetType === 'table' && (
        <TableProperties
          widgetData={(element as WidgetElement).widgetData as { rows: number; cols: number; cells: unknown[][] }}
          onUpdateWidget={onUpdateWidget}
        />
      )}

      {element.type === 'widget' && ((element as WidgetElement).widgetType === 'timer' || (element as WidgetElement).widgetType === 'stopwatch') && (
        <TimerProperties
          widgetData={(element as WidgetElement).widgetData as { minutes?: number }}
          onUpdateWidget={onUpdateWidget}
        />
      )}
    </div>
  );
}
```

### Task 21: Create widget creation dialogs

**Files:**
- Create: `app/src/components/widgets/TableCreationDialog.tsx`
- Create: `app/src/components/widgets/TimerCreationDialog.tsx`

- [ ] **Step 1: Write TableCreationDialog**

```typescript
import { useState } from 'react';

interface TableCreationDialogProps {
  onConfirm: (rows: number, cols: number) => void;
  onCancel: () => void;
}

export default function TableCreationDialog({ onConfirm, onCancel }: TableCreationDialogProps) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'var(--surface-overlay)' }}>
      <div className="glass-elevated rounded-2xl p-6 w-72 space-y-4 glass-panel-enter">
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Create Table</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Rows</span>
            <input type="number" value={rows} onChange={(e) => setRows(Math.max(1, Math.min(20, Number(e.target.value))))} min={1} max={20} className="px-3 py-2 rounded-lg bg-white/10 border border-[var(--glass-border-strong)]" style={{ color: 'var(--text-primary)' }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Columns</span>
            <input type="number" value={cols} onChange={(e) => setCols(Math.max(1, Math.min(10, Number(e.target.value))))} min={1} max={10} className="px-3 py-2 rounded-lg bg-white/10 border border-[var(--glass-border-strong)]" style={{ color: 'var(--text-primary)' }} />
          </label>
        </div>
        <div className="text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Preview: {rows} × {cols} table
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="glass-btn px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--text-secondary)' }}>Cancel</button>
          <button onClick={() => onConfirm(rows, cols)} className="px-4 py-2 rounded-lg text-sm text-white font-medium" style={{ background: 'var(--accent)' }}>Create</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write TimerCreationDialog**

```typescript
import { useState } from 'react';

interface TimerCreationDialogProps {
  onConfirm: (minutes: number) => void;
  onCancel: () => void;
}

const PRESETS = [1, 3, 5, 10, 15, 30];

export default function TimerCreationDialog({ onConfirm, onCancel }: TimerCreationDialogProps) {
  const [minutes, setMinutes] = useState(5);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'var(--surface-overlay)' }}>
      <div className="glass-elevated rounded-2xl p-6 w-72 space-y-4 glass-panel-enter">
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Set Timer</h3>
        <label className="flex flex-col gap-1">
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Duration (minutes)</span>
          <input type="number" value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(180, Number(e.target.value))))} min={1} max={180} className="px-3 py-2 rounded-lg bg-white/10 border border-[var(--glass-border-strong)]" style={{ color: 'var(--text-primary)' }} />
        </label>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((m) => (
            <button key={m} onClick={() => setMinutes(m)} className={`glass-btn px-3 py-1.5 rounded-lg text-sm ${minutes === m ? 'text-white' : ''}`} style={minutes === m ? { background: 'var(--accent)' } : { color: 'var(--text-secondary)' }}>{m}m</button>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="glass-btn px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--text-secondary)' }}>Cancel</button>
          <button onClick={() => onConfirm(minutes)} className="px-4 py-2 rounded-lg text-sm text-white font-medium" style={{ background: 'var(--accent)' }}>Start</button>
        </div>
      </div>
    </div>
  );
}
```

### Task 22: Integrate PropertyInspector into OpenJamCanvas

**Files:**
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Import PropertyInspector**

Add at top:

```typescript
import PropertyInspector from './PropertyInspector';
```

- [ ] **Step 2: Compute selected element for inspector**

Inside the component, add:

```typescript
const selectedElement = useMemo(() => {
  if (selectedIds.size !== 1) return null;
  const id = Array.from(selectedIds)[0];
  return elements.find((el) => el.id === id) || null;
}, [selectedIds, elements]);
```

- [ ] **Step 3: Add PropertyInspector to JSX**

Find the right side of the canvas layout. Add the inspector positioned absolutely on the right:

```tsx
{/* Property Inspector */}
{selectedElement && (
  <div className="absolute top-16 right-0 bottom-0 z-40 pointer-events-auto">
    <PropertyInspector
      element={selectedElement}
      elementStore={elementStoreRef.current}
    />
  </div>
)}
```

- [ ] **Step 4: Verify compilation and commit**

Run: `cd app && npx tsc --noEmit`

```bash
git add app/src/components/PropertyInspector/ \
       app/src/components/widgets/TableCreationDialog.tsx \
       app/src/components/widgets/TimerCreationDialog.tsx \
       app/src/components/OpenJamCanvas.tsx
git commit -m "feat: add property inspector panel and widget creation dialogs"
```

### Task 23: Wire creation dialogs into WidgetsPanel

**Files:**
- Modify: `app/src/components/WidgetsPanel.tsx`
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Add creation dialog state to OpenJamCanvas**

Add state:

```typescript
const [showTableCreation, setShowTableCreation] = useState(false);
const [showTimerCreation, setShowTimerCreation] = useState(false);
```

- [ ] **Step 2: Import and render creation dialogs**

```typescript
import TableCreationDialog from './widgets/TableCreationDialog';
import TimerCreationDialog from './widgets/TimerCreationDialog';
```

Add in JSX:

```tsx
{showTableCreation && (
  <TableCreationDialog
    onConfirm={(rows, cols) => {
      // Create table with custom size
      const widgetData = createDefaultTable();
      // Adjust rows/cols in widgetData
      widgetData.rows = rows;
      widgetData.cols = cols;
      widgetData.cells = Array(rows).fill(null).map(() =>
        Array(cols).fill(null).map(() => ({ content: '', backgroundColor: '#ffffff' }))
      );
      const centerX = (-offset.x + window.innerWidth / 2) / scale;
      const centerY = (-offset.y + window.innerHeight / 2) / scale;
      elementStoreRef.current.addElement('widget', centerX - 200, centerY - 150, {
        widgetType: 'table',
        widgetData,
        width: 400,
        height: 300,
      } as Partial<Element>);
      setShowTableCreation(false);
    }}
    onCancel={() => setShowTableCreation(false)}
  />
)}

{showTimerCreation && (
  <TimerCreationDialog
    onConfirm={(minutes) => {
      const centerX = (-offset.x + window.innerWidth / 2) / scale;
      const centerY = (-offset.y + window.innerHeight / 2) / scale;
      elementStoreRef.current.addElement('widget', centerX - 100, centerY - 100, {
        widgetType: 'timer',
        widgetData: { minutes },
        width: 200,
        height: 200,
      } as Partial<Element>);
      setShowTimerCreation(false);
    }}
    onCancel={() => setShowTimerCreation(false)}
  />
)}
```

- [ ] **Step 3: Pass dialog openers to widget creation flow**

Find where table and timer widgets are created (likely in a widget add handler or WidgetsPanel callback). Instead of creating them directly, show the dialog:

For the table widget creation callback, replace direct creation with `setShowTableCreation(true)`.
For the timer widget creation callback, replace direct creation with `setShowTimerCreation(true)`.

This requires finding the `addWidget` handler or similar in OpenJamCanvas and modifying the table/timer cases.

- [ ] **Step 4: Final compilation check and commit**

Run: `cd app && npx tsc --noEmit && bun run build`

```bash
git add -A
git commit -m "feat: wire widget creation dialogs for table size and timer duration customization"
```

### Task 24: Final verification

- [ ] **Step 1: Full build test**

```bash
make build
```

- [ ] **Step 2: Commit any remaining changes**

```bash
git status
# If any uncommitted changes:
git add -A
git commit -m "chore: Phase 2 final polish and build verification"
```
