# Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the build infrastructure (Go embed + Makefile), fix the broken auth, decompose the 2,200-line canvas monolith, and replace the monkey-patching collaboration hook with a typed event emitter.

**Architecture:** The Go server embeds the frontend `dist/` directory at compile time, eliminating the fragile static-path fallback. The canvas component is split into ~15 focused modules communicating via a React context. The ElementStore gains a typed event emitter so the collaboration hook no longer monkey-patches methods.

**Tech Stack:** Go 1.22 (embed), React 19, TypeScript 5.8, Vite 7, Bun

**Spec:** `docs/superpowers/specs/2026-03-16-openjam-redesign-design.md` (Sections 2.1, 2.3, 3.1, 7.1, 7.2, 8/Phase 1, 11)

---

## Chunk 1: Build Infrastructure

### Task 1: Create Makefile

**Files:**
- Create: `Makefile`

- [ ] **Step 1: Write the Makefile**

```makefile
.PHONY: dev build clean docker frontend backend

# Build the complete application (single binary)
build: frontend backend
	@echo "✅ Build complete: ./openjam-server"

# Build frontend assets
frontend:
	cd app && bun install && bun run build

# Copy dist into server and build Go binary with embed
backend:
	rm -rf server/static && cp -r app/dist server/static
	cd server && CGO_ENABLED=0 go build -ldflags="-s -w" -o ../openjam-server .
	rm -rf server/static

# Start dev environment (requires docker-compose.dev.yml services running)
dev:
	@echo "Starting dev servers..."
	@echo "Run: docker compose -f docker-compose.dev.yml up -d"
	@echo "Then in separate terminals:"
	@echo "  cd server && go run main.go"
	@echo "  cd app && bun run dev"

# Docker compose build and up
docker:
	docker compose up --build -d

# Clean build artifacts
clean:
	rm -f openjam-server
	rm -rf server/static
	rm -rf app/dist
	rm -rf app/node_modules
```

- [ ] **Step 2: Verify `make build` works end-to-end**

Run: `make build`
Expected: Produces `./openjam-server` binary in root directory. Binary size ~30-40MB.

- [ ] **Step 3: Test the binary serves the frontend**

Run: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable ./openjam-server`
Expected: Server starts on :8080, serves the frontend at http://localhost:8080, health check at /health returns `{"status":"ok"}`.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat: add Makefile for unified build (frontend + Go embed → single binary)"
```

---

### Task 2: Add Go embed for frontend assets

**Files:**
- Create: `server/static.go`
- Modify: `server/main.go:104-120` (replace static path fallback)

- [ ] **Step 1: Create a placeholder for the static directory**

Create `server/static/.gitkeep` so the `go:embed` directive doesn't fail during development:
```bash
mkdir -p server/static
touch server/static/.gitkeep
```

Add to `.gitignore`:
```
server/static/*
!server/static/.gitkeep
```

This ensures `go:embed` always has a valid directory, and IDE Go tooling won't show compile errors.

- [ ] **Step 2: Create the embed file**

Create `server/static.go`:
```go
package main

import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed all:static
var staticFiles embed.FS

// StaticFS returns the embedded static files as an fs.FS rooted at "static/".
// Returns error if the static directory only contains .gitkeep (dev mode).
func StaticFS() (fs.FS, error) {
	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return nil, err
	}
	// Check if index.html exists (real build output vs placeholder)
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, fmt.Errorf("no frontend build found in embedded static files")
	}
	return sub, nil
}
```

Note: The `static/` directory is populated by `make backend` (copies `app/dist` → `server/static`). During development, it only contains `.gitkeep`. The Vite dev server handles frontend in dev mode.

- [ ] **Step 3: Update main.go to use embedded assets**

Replace lines 104-120 in `server/main.go` (the `staticPaths` fallback chain) with:

```go
	// Serve embedded frontend assets
	staticFS, err := StaticFS()
	if err != nil {
		log.Printf("Warning: No embedded static files found (run 'make build' to embed frontend)")
	} else {
		httpFS := http.FS(staticFS)
		r.StaticFS("/assets", httpFS)
		r.StaticFS("/icons", httpFS)
		r.NoRoute(func(c *gin.Context) {
			c.FileFromFS("index.html", httpFS)
		})
		log.Println("Serving embedded frontend assets")
	}
```

Also keep a dev fallback for when running `go run main.go` without embed:

```go
	// Fallback: serve from disk in development (when static/ dir doesn't exist in embed)
	if err != nil {
		devPaths := []string{"../app/dist", "./static", "./dist"}
		for _, path := range devPaths {
			if info, statErr := os.Stat(path); statErr == nil && info.IsDir() {
				r.Static("/assets", path+"/assets")
				r.Static("/icons", path+"/icons")
				r.NoRoute(func(c *gin.Context) {
					c.File(path + "/index.html")
				})
				log.Printf("Serving frontend from disk: %s (development mode)", path)
				break
			}
		}
	}
```

- [ ] **Step 4: Build and verify embed works**

Run: `make build && DATABASE_URL=postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable ./openjam-server`
Expected: Server starts, logs "Serving embedded frontend assets", frontend loads at http://localhost:8080.

- [ ] **Step 5: Verify dev mode still works**

Run: `cd server && go run main.go` (without building frontend embed)
Expected: Server starts, either logs "Serving frontend from disk" or "Warning: No embedded static files found". API endpoints work. Frontend served by Vite dev server in development.

- [ ] **Step 6: Commit**

```bash
git add server/static.go server/main.go
git commit -m "feat: embed frontend assets in Go binary via go:embed"
```

---

### Task 3: Investigate and fix auth bug

**Files:**
- Modify: `app/src/lib/api.ts` (likely token handling)
- Modify: `app/src/components/AuthContext.tsx` (likely token storage/retrieval)
- Modify: `server/internal/handler/auth.go` (if backend issue)
- Modify: `server/internal/middleware/auth.go` (if token extraction issue)

- [ ] **Step 1: Start the backend and test auth endpoints directly**

Run: `cd server && go run main.go`
Then test registration:
```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123","displayName":"Test User"}'
```
Expected: Returns `{"token":"...","user":{...}}` or an error. Record what happens.

- [ ] **Step 2: Test login**

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}'
```
Expected: Returns `{"token":"...","user":{...}}` or error. Record what happens.

- [ ] **Step 3: Test the token with /api/me**

Using the token from step 1 or 2:
```bash
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8080/api/me
```
Expected: Returns user info. If 401, the token validation is broken.

- [ ] **Step 4: Check frontend token handling**

Read `app/src/lib/api.ts` — find the `getToken()` / `setToken()` functions. Check:
- What key is used in localStorage?
- Does the `Authorization` header format match what the middleware expects?
- Does the frontend send credentials with requests?

Read `app/src/components/AuthContext.tsx` — check:
- Does it call `setToken()` after successful login/register?
- Does it call `getToken()` and set the Authorization header on mount?

Read `server/internal/middleware/auth.go` — check:
- Does `extractToken()` parse the Bearer header correctly?
- Does it fall back to query param and cookie?

- [ ] **Step 5: Fix the identified issue(s)**

Apply the fix based on investigation. Common fixes:
- If token key mismatch: align frontend localStorage key with backend expectation
- If CORS blocking credentials: ensure `AllowCredentials: true` is set (it is in current main.go)
- If session not created: check database migration ran (sessions table exists)
- If token format wrong: fix `extractToken()` parsing

- [ ] **Step 6: Verify the fix end-to-end**

Start both backend and frontend dev servers. Open http://localhost:5173. Register a new account. Verify:
- Registration succeeds (no console errors)
- Token stored in localStorage
- Page shows the canvas (authenticated state)
- Refresh the page — still authenticated (token persists)
- Logout works — returns to auth page

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/api.ts app/src/components/AuthContext.tsx server/internal/handler/auth.go server/internal/middleware/auth.go
git commit -m "fix: resolve authentication bug preventing login"
```

Note: Only stage files that were actually modified during the fix. Adjust the `git add` list based on what changed.

---

## Chunk 2: ElementStore Event Emitter

### Task 4: Add typed event emitter to ElementStore

**Files:**
- Modify: `app/src/lib/elementStore.ts:142-168` (add emitter to ElementStore class)

- [ ] **Step 1: Add the event emitter types and methods**

Add after line 158 (after the constructor) in `elementStore.ts`:

```typescript
  // --- Event emitter for collaboration ---
  private eventListeners = new Map<string, Set<Function>>();

  on<K extends keyof StoreEvents>(event: K, fn: StoreEvents[K]): () => void {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    this.eventListeners.get(event)!.add(fn);
    return () => { this.eventListeners.get(event)?.delete(fn); };
  }

  private emit<K extends keyof StoreEvents>(event: K, ...args: Parameters<StoreEvents[K]>): void {
    this.eventListeners.get(event)?.forEach(fn => (fn as Function)(...args));
  }
```

And add the type before the class definition (around line 141):

```typescript
type StoreEvents = {
  operation: (op: ElementOperation) => void;
};
```

- [ ] **Step 2: Emit 'operation' event in each mutation method**

In each of these methods, add `this.emit('operation', op);` right before the `return op;` statement:

- `addElement()` (around line 275) — add before `return op;`
- `updateElement()` (around line 295) — add before `return op;`
- `deleteElement()` (around line 305) — add before `return op;`
- `moveElement()` (around line 315) — add before `return op;`
- `resizeElement()` (around line 330) — add before `return op;`
- `reorderElement()` — find and add
- `lockElement()` — find and add
- `clearAll()` — find and add

Do NOT emit for `applyRemote()` — remote operations come from the network, not from local user actions.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd app && bun run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/elementStore.ts
git commit -m "feat: add typed event emitter to ElementStore for operation broadcasting"
```

---

### Task 5: Rewrite useCollaboration to use event emitter

**Files:**
- Modify: `app/src/lib/useCollaboration.ts` (remove monkey-patching, use emitter)

- [ ] **Step 1: Remove the monkey-patching code**

Delete the `originalMethodsRef` ref (lines 32-41) and the entire `useEffect` that wraps store methods (lines ~122-206 — the one that saves original methods, wraps each method, and restores on cleanup).

- [ ] **Step 2: Replace with event emitter subscription**

Add a new `useEffect` that subscribes to the ElementStore's operation event:

```typescript
  // Subscribe to local operations and broadcast them
  useEffect(() => {
    const unsub = elementStore.on('operation', (op) => {
      if (!wsClient.isConnected()) return;
      wsClient.sendOperation(op.opType, {
        opId: op.opId,
        elementId: op.elementId,
        timestamp: op.timestamp,
        ...extractOpData(op),
      } as never, op.opId);
    });
    return unsub;
  }, [elementStore]);
```

- [ ] **Step 3: Remove the `broadcastOperation` callback**

Delete the `broadcastOperation` useCallback (lines ~43-52) — it's now inlined in the effect above.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd app && bun run typecheck`
Expected: No errors.

- [ ] **Step 5: Verify the app still works**

Start both servers. Open the app. Create elements, move them, delete them. Open a second browser tab with the same board. Verify:
- Local operations appear immediately
- Remote operations sync between tabs
- No console errors about undefined methods

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/useCollaboration.ts
git commit -m "refactor: replace monkey-patching with event emitter in useCollaboration"
```

---

## Chunk 3: Canvas Decomposition — Context & Hooks

### Task 6: Create CanvasContext

**Files:**
- Create: `app/src/components/canvas/CanvasContext.tsx`

- [ ] **Step 1: Create the context file**

Create `app/src/components/canvas/CanvasContext.tsx`:

```typescript
import { createContext, useContext, useRef, useState, useCallback, type RefObject } from 'react';
import { ElementStore } from '../../lib/elementStore';
import type { Element } from '../../lib/elements';
import type { ToolType, ShapeType, StickyColor, ConnectorStyle, ArrowHead, EraserMode } from '../BottomToolbar';

export interface ToolOptions {
  stickyColor: StickyColor;
  stickyShape: 'square' | 'rounded' | 'circle';
  shapeType: ShapeType;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  fontSize: number;
  connectorStyle: ConnectorStyle;
  arrowStart: ArrowHead;
  arrowEnd: ArrowHead;
  eraserMode: EraserMode;
  eraserSize: number;
}

export interface CanvasContextValue {
  // Refs
  containerRef: RefObject<HTMLDivElement | null>;
  elementStoreRef: RefObject<ElementStore>;

  // Element state
  elements: Element[];
  setElements: React.Dispatch<React.SetStateAction<Element[]>>;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  editingId: string | null;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  clipboard: Element[];
  setClipboard: React.Dispatch<React.SetStateAction<Element[]>>;

  // View state
  offset: { x: number; y: number };
  setOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  scale: number;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  showGrid: boolean;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;

  // Tool state
  currentTool: ToolType;
  setCurrentTool: React.Dispatch<React.SetStateAction<ToolType>>;
  toolOptions: ToolOptions;
  setToolOptions: React.Dispatch<React.SetStateAction<ToolOptions>>;
  selectedColor: string;
  setSelectedColor: React.Dispatch<React.SetStateAction<string>>;

  // Derived helpers
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number };
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasContext(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error('useCanvasContext must be used within CanvasProvider');
  return ctx;
}

export interface CanvasProviderProps {
  userId: string;
  children: React.ReactNode;
}

export function CanvasProvider({ userId, children }: CanvasProviderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Lazy initialization to avoid creating a new ElementStore on every render
  const elementStoreRef = useRef<ElementStore>(null!);
  if (elementStoreRef.current === null) {
    elementStoreRef.current = new ElementStore(userId);
  }

  // Element state
  const [elements, setElements] = useState<Element[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Element[]>([]);

  // View state
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [showGrid, setShowGrid] = useState(true);

  // Tool state
  const [currentTool, setCurrentTool] = useState<ToolType>('select');
  const [toolOptions, setToolOptions] = useState<ToolOptions>({
    stickyColor: 'yellow',
    stickyShape: 'square',
    shapeType: 'rectangle',
    strokeColor: '#000000',
    strokeWidth: 2,
    fillColor: '#ffffff',
    fontSize: 16,
    connectorStyle: 'straight',
    arrowStart: 'none',
    arrowEnd: 'arrow',
    eraserMode: 'stroke',
    eraserSize: 20,
  });
  const [selectedColor, setSelectedColor] = useState('#000000');

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      return {
        x: (screenX - rect.left - offset.x) / scale,
        y: (screenY - rect.top - offset.y) / scale,
      };
    },
    [offset, scale]
  );

  const value: CanvasContextValue = {
    containerRef, elementStoreRef,
    elements, setElements, selectedIds, setSelectedIds, editingId, setEditingId, clipboard, setClipboard,
    offset, setOffset, scale, setScale, showGrid, setShowGrid,
    currentTool, setCurrentTool, toolOptions, setToolOptions, selectedColor, setSelectedColor,
    screenToCanvas,
  };

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd app && bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/canvas/CanvasContext.tsx
git commit -m "feat: create CanvasContext for shared canvas state management"
```

---

### Task 7: Extract useAutoSave hook

**Files:**
- Create: `app/src/components/canvas/hooks/useAutoSave.ts`
- Modify: `app/src/components/OpenJamCanvas.tsx` (remove auto-save code, import hook)

- [ ] **Step 1: Identify the auto-save code in OpenJamCanvas.tsx**

Read the auto-save related code:
- The `isDirty` ref
- The `saveToDatabase` / `handleSave` function
- The auto-save interval `useEffect`
- The `beforeunload` handler `useEffect`
- The `saveStatus` state

- [ ] **Step 2: Create the hook file**

Create `app/src/components/canvas/hooks/useAutoSave.ts` that extracts all auto-save logic. The hook takes `boardId`, `elementStoreRef`, and related state getters as parameters and returns `{ saveStatus, saveToDatabase }`.

The hook should contain:
- `isDirty` ref
- `saveStatus` state
- `saveToDatabase` callback (imports `saveBoard` from `../../lib/api`)
- Auto-save interval effect (30 seconds)
- Beforeunload handler effect

- [ ] **Step 3: Replace the code in OpenJamCanvas.tsx**

Import the hook and replace the extracted code with:
```typescript
const { saveStatus, saveToDatabase } = useAutoSave({
  boardId: _boardId,
  getElements: () => elementStoreRef.current.getElements(),
  getBoardName: () => boardName,
  getStamps: () => stamps,
  getPages: () => pages,
  getCurrentPageId: () => currentPageId,
});
```

- [ ] **Step 4: Verify TypeScript compiles and app works**

Run: `cd app && bun run typecheck`
Open the app, make a change, wait 30 seconds. Verify auto-save fires (check "Saved" toast or network tab).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/canvas/hooks/useAutoSave.ts app/src/components/OpenJamCanvas.tsx
git commit -m "refactor: extract useAutoSave hook from OpenJamCanvas"
```

---

### Task 8: Extract useKeyboardShortcuts hook

**Files:**
- Create: `app/src/components/canvas/hooks/useKeyboardShortcuts.ts`
- Modify: `app/src/components/OpenJamCanvas.tsx` (remove keyboard handler, import hook)

- [ ] **Step 1: Identify keyboard shortcut code**

Find the `useEffect` that sets up `keydown` listener on `window`. This handles:
- Ctrl+Z (undo), Ctrl+Shift+Z (redo)
- Ctrl+C/V/X (copy/paste/cut)
- Delete/Backspace (delete selected)
- Ctrl+A (select all)
- Ctrl+S (save)
- Escape (deselect)
- Ctrl+K (command palette)

- [ ] **Step 2: Create the hook**

Create `app/src/components/canvas/hooks/useKeyboardShortcuts.ts`. The hook takes callbacks as parameters:
```typescript
interface UseKeyboardShortcutsOptions {
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onCut: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onSave: () => void;
  onEscape: () => void;
  onCommandPalette: () => void;
}
```

- [ ] **Step 3: Replace in OpenJamCanvas.tsx**

Remove the keyboard `useEffect` and call `useKeyboardShortcuts({...callbacks})` instead.

- [ ] **Step 4: Verify TypeScript compiles and shortcuts work**

Run: `cd app && bun run typecheck`
Test: Ctrl+Z, Delete, Ctrl+K in the app.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/canvas/hooks/useKeyboardShortcuts.ts app/src/components/OpenJamCanvas.tsx
git commit -m "refactor: extract useKeyboardShortcuts hook from OpenJamCanvas"
```

---

### Task 9: Extract useClipboard hook

**Files:**
- Create: `app/src/components/canvas/hooks/useClipboard.ts`
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Identify clipboard code**

Find: `copySelected`, `pasteClipboard`, `cutSelected`, `duplicateSelected` functions and the `clipboard` state.

- [ ] **Step 2: Create the hook**

```typescript
interface UseClipboardOptions {
  elements: Element[];
  selectedIds: Set<string>;
  elementStoreRef: RefObject<ElementStore>;
  setSelectedIds: (ids: Set<string>) => void;
}

function useClipboard(options: UseClipboardOptions) {
  const [clipboard, setClipboard] = useState<Element[]>([]);
  // ... copySelected, pasteClipboard, cutSelected, duplicateSelected
  return { clipboard, copySelected, pasteClipboard, cutSelected, duplicateSelected };
}
```

- [ ] **Step 3: Replace in OpenJamCanvas.tsx**

Remove the `clipboard` state, `copySelected`, `pasteClipboard`, `cutSelected`, `duplicateSelected` functions from OpenJamCanvas.tsx. Import `useClipboard` and call it:
```typescript
const { clipboard, copySelected, pasteClipboard, cutSelected, duplicateSelected } = useClipboard({
  elements, selectedIds, elementStoreRef, setSelectedIds,
});
```
Wire the returned callbacks into existing keyboard shortcuts and context menu handlers.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd app && bun run typecheck`
Expected: No errors.

- [ ] **Step 5: Verify in browser**

Test: Ctrl+C to copy, Ctrl+V to paste, Ctrl+X to cut, Ctrl+D to duplicate. Elements should appear offset from originals.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/canvas/hooks/useClipboard.ts app/src/components/OpenJamCanvas.tsx
git commit -m "refactor: extract useClipboard hook from OpenJamCanvas"
```

---

### Task 10: Extract useSelection hook

**Files:**
- Create: `app/src/components/canvas/hooks/useSelection.ts`
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Identify selection code**

Find: `handleSelect`, `selectionBox` state, selection box mouse handling in handleMouseDown/Move/Up, the logic that computes which elements are inside the selection box.

- [ ] **Step 2: Create the hook**

The hook manages:
- `selectionBox` state (`start`/`end` coords)
- `handleSelect(id, addToSelection)` callback
- `startSelectionBox(point)`, `updateSelectionBox(point)`, `endSelectionBox()` callbacks
- `getSelectedFromBox(elements)` — returns Set of IDs inside the box

- [ ] **Step 3: Replace in OpenJamCanvas.tsx**

Remove `selectionBox` state and selection-related code from handleMouseDown/Move/Up. The hook reads `selectedIds`/`setSelectedIds` from CanvasContext (or receives them as params). In OpenJamCanvas, call:
```typescript
const { selectionBox, startSelectionBox, updateSelectionBox, endSelectionBox } = useSelection({
  elements, setSelectedIds, screenToCanvas,
});
```
Integrate `startSelectionBox`/`updateSelectionBox`/`endSelectionBox` into the mouse event handlers where selection box logic currently lives.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd app && bun run typecheck`

- [ ] **Step 5: Verify in browser**

Test: Click to select element, Shift+click for multi-select, drag on empty canvas for box selection. All should work.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/canvas/hooks/useSelection.ts app/src/components/OpenJamCanvas.tsx
git commit -m "refactor: extract useSelection hook from OpenJamCanvas"
```

---

### Task 11: Extract useDrawing hook

**Files:**
- Create: `app/src/components/canvas/hooks/useDrawing.ts`
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Identify drawing code**

Find: `isDrawing` state, `drawingPath` state, drawing-related code in handleMouseDown (pen/marker tool initiation), handleMouseMove (appending points), handleMouseUp (creating drawing element from path).

- [ ] **Step 2: Create the hook**

The hook manages:
- `isDrawing` state
- `drawingPath` state
- `startDrawing(point)` — initiates a stroke
- `continueDrawing(point)` — appends to path
- `endDrawing()` — creates the element via elementStore, returns the operation

- [ ] **Step 3: Replace in OpenJamCanvas.tsx**

Remove `isDrawing` state, `drawingPath` state, and drawing-related branches from handleMouseDown (lines that check `currentTool === 'pen' || currentTool === 'marker'`), handleMouseMove (appending to drawingPath), and handleMouseUp (creating drawing element). Replace with:
```typescript
const { isDrawing, drawingPath, startDrawing, continueDrawing, endDrawing } = useDrawing({
  elementStoreRef, currentTool, toolOptions,
});
```
Call `startDrawing(canvasPoint)` in handleMouseDown, `continueDrawing(canvasPoint)` in handleMouseMove, `endDrawing()` in handleMouseUp.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd app && bun run typecheck`

- [ ] **Step 5: Verify in browser**

Test: Select pen tool, draw a stroke. Select marker tool, draw a stroke. Verify strokes appear on canvas and persist.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/canvas/hooks/useDrawing.ts app/src/components/OpenJamCanvas.tsx
git commit -m "refactor: extract useDrawing hook from OpenJamCanvas"
```

---

### Task 12: Extract useEraser hook

**Files:**
- Create: `app/src/components/canvas/hooks/useEraser.ts`
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Identify eraser code**

Find: `isErasing` state, `eraserPosition` state, eraser handling in handleMouseDown/Move/Up (both stroke and pixel modes), `splitStrokeByKeptPoints` utility function.

- [ ] **Step 2: Create the hook**

The hook manages:
- `isErasing` state
- `eraserPosition` state (for cursor rendering)
- `startErasing(point, elements)`
- `continueErasing(point, elements)` — handles both stroke-delete and pixel-erase modes
- `endErasing()`
- Includes `splitStrokeByKeptPoints` as a private utility

- [ ] **Step 3: Replace in OpenJamCanvas.tsx**

Remove `isErasing` state, `eraserPosition` state, the `splitStrokeByKeptPoints` utility function, and eraser-related branches from handleMouseDown/Move/Up. Replace with:
```typescript
const { isErasing, eraserPosition, startErasing, continueErasing, endErasing } = useEraser({
  elementStoreRef, toolOptions, elements,
});
```
Call `startErasing`/`continueErasing`/`endErasing` in the respective mouse handlers where eraser tool logic currently lives.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd app && bun run typecheck`

- [ ] **Step 5: Verify in browser**

Test: Select eraser tool, use stroke mode to delete a drawing, use pixel mode to erase part of a stroke. Both modes should work.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/canvas/hooks/useEraser.ts app/src/components/OpenJamCanvas.tsx
git commit -m "refactor: extract useEraser hook from OpenJamCanvas"
```

---

### Task 13: Extract useDragCreate and useDragMove hooks

**Files:**
- Create: `app/src/components/canvas/hooks/useDragCreate.ts`
- Create: `app/src/components/canvas/hooks/useDragMove.ts`
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Identify drag-create code**

Find: `dragCreateStart`, `dragCreateEnd`, `dragCreateTool` states. Logic in handleMouseDown that initiates drag-to-create for text, shape, sticky, connector tools. Logic in handleMouseUp that creates the element from drag dimensions.

- [ ] **Step 2: Create useDragCreate hook**

Manages: `dragCreateStart`, `dragCreateEnd`, `dragCreateTool` states + `startDragCreate`, `updateDragCreate`, `endDragCreate` callbacks.

- [ ] **Step 3: Identify drag-move code**

Find: `dragMoveStart`, `dragMoveElementId`, `dragMoveInitialPos` states. Logic for moving elements after creation.

- [ ] **Step 4: Create useDragMove hook**

Manages: drag move states + `startDragMove`, `updateDragMove`, `endDragMove` callbacks.

- [ ] **Step 5: Replace in OpenJamCanvas.tsx**

Remove `dragCreateStart`, `dragCreateEnd`, `dragCreateTool` states and `dragMoveStart`, `dragMoveElementId`, `dragMoveInitialPos` states. Remove the corresponding branches in handleMouseDown/Move/Up. Replace with:
```typescript
const { dragCreateStart, dragCreateEnd, startDragCreate, updateDragCreate, endDragCreate } = useDragCreate({
  elementStoreRef, toolOptions, setSelectedIds,
});
const { startDragMove, updateDragMove, endDragMove } = useDragMove({
  elementStoreRef,
});
```
Wire into mouse handlers.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd app && bun run typecheck`

- [ ] **Step 7: Verify in browser**

Test: Select sticky tool, drag to create a sticky note. Select an element and drag to move it. Both should work. Test shape, text, and connector drag-create as well.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/canvas/hooks/useDragCreate.ts app/src/components/canvas/hooks/useDragMove.ts app/src/components/OpenJamCanvas.tsx
git commit -m "refactor: extract useDragCreate and useDragMove hooks from OpenJamCanvas"
```

---

### Task 14: Extract RemoteCursors and DrawingPreview components

**Files:**
- Create: `app/src/components/canvas/RemoteCursors.tsx`
- Create: `app/src/components/canvas/DrawingPreview.tsx`
- Create: `app/src/components/canvas/EraserCursor.tsx`
- Modify: `app/src/components/OpenJamCanvas.tsx`

- [ ] **Step 1: Extract RemoteCursors**

Find the remote cursors rendering block in OpenJamCanvas (the `{Array.from(remoteCursors.values()).map(...)}`  section). Move to its own component:

```typescript
// RemoteCursors.tsx
import type { RemoteCursor } from '../../lib/useCollaboration';

interface RemoteCursorsProps {
  cursors: Map<string, RemoteCursor>;
}

export default function RemoteCursors({ cursors }: RemoteCursorsProps) {
  return <>
    {Array.from(cursors.values()).map((cursor) => (
      // ... existing cursor rendering JSX
    ))}
  </>;
}
```

- [ ] **Step 2: Extract DrawingPreview**

Find the drawing preview block (`{isDrawing && drawingPath.length > 1 && ...}`). Move to its own component.

- [ ] **Step 3: Extract EraserCursor**

If there's a custom eraser cursor rendering (circle following mouse position), extract it.

- [ ] **Step 4: Replace inline JSX in OpenJamCanvas with component imports**

- [ ] **Step 5: Verify and commit**

```bash
git add app/src/components/canvas/RemoteCursors.tsx app/src/components/canvas/DrawingPreview.tsx app/src/components/canvas/EraserCursor.tsx app/src/components/OpenJamCanvas.tsx
git commit -m "refactor: extract RemoteCursors, DrawingPreview, EraserCursor components"
```

---

### Task 15: Create Canvas.tsx wrapper and wire everything together

**Files:**
- Create: `app/src/components/canvas/Canvas.tsx`
- Create: `app/src/components/canvas/index.ts`
- Modify: `app/src/components/OpenJamCanvas.tsx` (should be significantly smaller now)
- Modify: `app/src/App.tsx` (import from new location)

- [ ] **Step 1: Verify OpenJamCanvas is now manageable**

Count the lines in OpenJamCanvas.tsx. Target: under 600 lines (down from 2,200). The remaining code should be primarily:
- Composing hooks
- The unified handleMouseDown/Move/Up that delegates to hook handlers
- JSX layout (toolbar, canvas container, overlays)

If it's still too large, identify what else can be extracted.

- [ ] **Step 2: Create the barrel export**

Create `app/src/components/canvas/index.ts`:
```typescript
export { default as Canvas } from '../OpenJamCanvas';
export { CanvasProvider, useCanvasContext } from './CanvasContext';
```

Note: For Phase 1, `OpenJamCanvas.tsx` stays in its current location but is now much smaller. Full migration to `canvas/Canvas.tsx` can happen later. The hooks are already in `canvas/hooks/`.

- [ ] **Step 3: Final line count verification**

Run: `wc -l app/src/components/OpenJamCanvas.tsx`
Expected: Under 800 lines (ideally under 600).

Run: `wc -l app/src/components/canvas/hooks/*.ts app/src/components/canvas/*.tsx`
Expected: Each file under 300 lines.

- [ ] **Step 4: Full app verification**

Run: `cd app && bun run typecheck && bun run lint && bun run build`
Expected: All pass.

Start both servers. Test:
- Drawing (pen, marker)
- Eraser (stroke and pixel mode)
- Selection (click, box select, multi-select)
- Drag-to-create (sticky, shape, text)
- Element dragging
- Keyboard shortcuts (Ctrl+Z, Delete, Ctrl+K)
- Copy/paste
- Auto-save
- Remote collaboration (two tabs)
- Cursor sync

- [ ] **Step 5: Commit**

```bash
git add app/src/components/canvas/
git commit -m "refactor: complete canvas decomposition — hooks, components, context"
```

---

## Chunk 4: Cleanup

### Task 16: Remove Flowbite dependency

**Files:**
- Modify: `app/package.json` (remove flowbite, flowbite-react)

- [ ] **Step 1: Check for Flowbite imports**

Search for `flowbite` imports across the codebase:
```bash
grep -r "flowbite" app/src/ --include="*.tsx" --include="*.ts" -l
```

- [ ] **Step 2: Replace any Flowbite component usage**

If any files import from `flowbite` or `flowbite-react`, replace with plain HTML/Tailwind equivalents. Common replacements:
- `<Button>` → `<button className="...">`
- `<Modal>` → custom dialog with Tailwind
- `<TextInput>` → `<input className="...">`

- [ ] **Step 3: Remove from package.json**

```bash
cd app && bun remove flowbite flowbite-react
```

- [ ] **Step 4: Verify build still works**

Run: `cd app && bun run typecheck && bun run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/bun.lock
git commit -m "chore: remove Flowbite dependency (replaced by Liquid Glass in Phase 2)"
```

---

### Task 17: Final Phase 1 verification

- [ ] **Step 1: Full build test**

Run: `make clean && make build`
Expected: Produces `./openjam-server` binary.

- [ ] **Step 2: Test embedded binary**

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable ./openjam-server
```
Open http://localhost:8080. Verify:
- Frontend loads from embedded assets
- Auth works (register, login, logout)
- Canvas works (draw, select, create elements)
- Collaboration works (two tabs)
- Auto-save works

- [ ] **Step 3: Test Docker build**

Run: `make docker`
Expected: Docker compose builds and starts all services. Same verification as step 2.

- [ ] **Step 4: Run all checks**

```bash
cd app && bun run typecheck && bun run lint && bun run build
```
Expected: All pass with zero errors.

- [ ] **Step 5: Final commit if any remaining changes**

```bash
git add -A
git commit -m "chore: Phase 1 foundation complete — embed, auth fix, canvas decomposition"
```
