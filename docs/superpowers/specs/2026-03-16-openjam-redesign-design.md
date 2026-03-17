# OpenJam Redesign — Design Specification

**Date:** 2026-03-16
**Status:** Draft
**Scope:** Auth overhaul, UI redesign (Liquid Glass), drawing engine upgrade, app shell, deployment simplification, code decomposition

---

## 1. Overview

OpenJam is a real-time collaborative whiteboard. This redesign addresses six areas: broken authentication, UI modernization, drawing quality, app navigation, deployment consistency, and code structure. The Go backend is retained; the frontend gets a major overhaul.

### Success Criteria

- All three auth methods work end-to-end (email/password, OAuth, magic link)
- UI renders with Full Liquid Glass treatment on all surfaces, in both light and dark mode
- Freehand drawing produces smooth, tapered strokes via perfect-freehand
- Users see a dashboard before entering a board; can manage boards and settings
- `make build` produces a single self-contained binary (no Docker required)
- OpenJamCanvas.tsx is decomposed from 2,200 lines into focused modules under 400 lines each

---

## 2. Architecture

### 2.1 Backend (Go — retained)

The Go backend stays as-is structurally. Changes:

- **Go `embed` package**: The `app/dist/` directory is embedded into the Go binary at compile time. The server serves embedded assets instead of reading from disk. This eliminates the fragile path-search fallback chain in `main.go` (lines 104-120) and makes Docker and non-Docker deployments identical.

- **New auth handlers**: OAuth callback endpoints (`GET /api/auth/callback/google`, `GET /api/auth/callback/github`) and magic link endpoints (`POST /api/auth/magic-link`, `GET /api/auth/verify-magic-link`).

- **New user model fields**: `auth_provider` (enum: local, google, github, magic_link), `provider_id` (external OAuth ID), `email_verified` (boolean). Migration adds columns to existing `users` table.

- **Email sending**: For magic links. Use a simple SMTP integration (configurable via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` env vars). No third-party email service dependency.

### 2.2 Frontend (React — major changes)

- **Client-side routing**: Add `react-router-dom`. Routes: `/` (dashboard), `/board/:id` (canvas), `/settings` (user settings), `/auth` (login/register).
- **Design system**: New Liquid Glass component library (see Section 4).
- **Drawing engine**: Replace raw SVG path rendering with `perfect-freehand` (see Section 5).
- **Canvas decomposition**: Break OpenJamCanvas.tsx into focused modules (see Section 7).

### 2.3 Build & Deployment

```
Makefile
├── make dev          # Start dev services + Go backend + Vite dev server
├── make build        # Build frontend (bun) → Build Go with embed → single binary
├── make docker       # Docker compose build + up
└── make clean        # Remove build artifacts
```

The `make build` target:
1. `cd app && bun install && bun run build` → produces `app/dist/`
2. `cd server && go build -ldflags="-s -w" -o ../openjam-server .` → binary with embedded `app/dist/`
3. Output: `./openjam-server` (single file, ~30-40MB)

---

## 3. Authentication

### 3.1 Fix Current Auth Bug

The current email/password auth is reported as non-functional. Investigation required during implementation. Likely causes to check:
- Session token format/storage mismatch between frontend (`wb_token` in localStorage) and backend (cookie `wb_session` + Bearer header)
- CORS blocking credentials on cross-origin requests
- Database migration not creating sessions table
- Token extraction priority (header vs cookie vs query param)

### 3.2 OAuth (Google + GitHub)

**Flow:**
1. Frontend renders "Sign in with Google" / "Sign in with GitHub" buttons on auth page
2. Click redirects to `GET /api/auth/oauth/:provider` which redirects to provider's OAuth consent screen
3. Provider redirects back to `GET /api/auth/callback/:provider` with authorization code
4. Backend exchanges code for access token, fetches user profile
5. Backend creates or links user account (match by email), creates session
6. Backend redirects to frontend with session token as query param (e.g., `/auth/callback?token=xyz`)
7. Frontend extracts token, stores it, immediately strips token from URL via `window.history.replaceState()` to prevent leaking via referrer/history, then redirects to dashboard

**Backend changes:**
- New config: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- New handler file: `server/internal/handler/oauth.go`
- User model: add `auth_provider`, `provider_id` fields
- Account linking: if a user with the same email exists (from email/password signup), link the OAuth provider to that account rather than creating a duplicate

**Frontend changes:**
- OAuth buttons on AuthPage.tsx
- Handle token-in-URL on redirect back from OAuth

### 3.3 Magic Link (Passwordless Email)

**Flow:**
1. User enters email on auth page, clicks "Send Magic Link"
2. Frontend calls `POST /api/auth/magic-link` with email
3. Backend generates a one-time token (32 bytes, 15-minute expiry), stores in database
4. Backend sends email with link: `https://app.example.com/auth/verify?token=xyz`
5. User clicks link, frontend calls `GET /api/auth/verify-magic-link?token=xyz`
6. Backend validates token, creates/finds user, creates session, returns auth response
7. Frontend stores session, redirects to dashboard

**Backend changes:**
- New model: `magic_link_tokens` table (token, email, expires_at, used)
- SMTP config and email sending utility
- Rate limiting: max 3 magic link requests per email per hour

**Frontend changes:**
- Magic link input/button on auth page
- Verification page component that handles the `?token=` query param

### 3.4 Auth Page Layout

Three sections on the auth page:
1. **OAuth buttons** (top) — "Continue with Google", "Continue with GitHub"
2. **Divider** — "or"
3. **Email form** (bottom) — tabs for "Password" and "Magic Link"
   - Password tab: email + password fields + sign in/register toggle
   - Magic Link tab: email field + "Send Link" button

---

## 4. UI Design — Full Liquid Glass

### 4.1 Design Principles

- **Every surface is glass**: Toolbar, panels, menus, dialogs, widgets, status bar — all use translucent backgrounds with backdrop-blur
- **Canvas shows through**: The whiteboard content is visible behind all UI chrome
- **Depth through layering**: Multiple glass layers create visual hierarchy (toolbar glass > menu glass > tooltip glass)
- **Amber/Orange brand**: Primary accent color remains amber (#F59E0B) / orange (#F97316) gradient
- **Light + Dark mode**: Toggle in toolbar. Glass adapts — lighter blur on light, darker blur on dark

### 4.2 Glass Token System

CSS custom properties for the design system:

```css
/* Light mode */
--glass-bg: rgba(255, 255, 255, 0.65);
--glass-bg-elevated: rgba(255, 255, 255, 0.78);
--glass-bg-subtle: rgba(255, 255, 255, 0.45);
--glass-border: rgba(255, 255, 255, 0.35);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
--glass-blur: blur(24px);
--glass-blur-heavy: blur(40px);
--text-primary: rgba(0, 0, 0, 0.87);
--text-secondary: rgba(0, 0, 0, 0.6);
--accent: #F59E0B;
--accent-gradient: linear-gradient(135deg, #F59E0B, #F97316);

/* Dark mode */
--glass-bg: rgba(30, 30, 40, 0.7);
--glass-bg-elevated: rgba(40, 40, 55, 0.8);
--glass-bg-subtle: rgba(20, 20, 30, 0.5);
--glass-border: rgba(255, 255, 255, 0.1);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
--text-primary: rgba(255, 255, 255, 0.92);
--text-secondary: rgba(255, 255, 255, 0.6);
--accent: #FBBF24;
--accent-gradient: linear-gradient(135deg, #FBBF24, #F59E0B);
```

### 4.3 Component Treatment

| Component | Glass Level | Notes |
|-----------|-------------|-------|
| **MenuBar** | `--glass-bg-elevated` | Top bar, heaviest blur. Logo + board name + share button |
| **BottomToolbar** | `--glass-bg-elevated` | Floating pill shape, centered |
| **ZoomControls** | `--glass-bg` | Bottom-right floating |
| **StatusBar** | `--glass-bg-subtle` | Bottom-left, lighter treatment |
| **Context Menus** | `--glass-bg-elevated` | Dropdown menus, right-click |
| **Dialogs/Modals** | `--glass-bg-elevated` | Share, settings, image upload |
| **Widget containers** | `--glass-bg` | Timer, poll, kanban cards on canvas |
| **Tooltips** | `--glass-bg-subtle` | Small, minimal blur |
| **Auth page** | Full glass card on gradient background | |
| **Dashboard** | Glass sidebar + glass board cards | |

### 4.4 Animations & Micro-interactions

- **Toolbar hover**: Subtle scale(1.05) + brightness increase on tool icons
- **Panel open/close**: Slide + fade with 200ms ease-out
- **Element selection**: Soft glow ring (amber tint) instead of hard border
- **Mode transitions**: Light/dark crossfade 300ms
- **Button press**: Scale(0.97) spring animation
- **Glass shimmer**: Subtle gradient shift on hover for glass surfaces

### 4.5 21st-dev Magic MCP

Use the 21st-dev Magic MCP tools for generating polished React components where beneficial:
- `21st_magic_component_builder` for complex glass components
- `21st_magic_component_inspiration` for design reference
- `21st_magic_component_refiner` for iterating on generated components

These are assistive — we maintain full control over the design system and component architecture.

---

## 5. Drawing Engine — perfect-freehand

### 5.1 Integration

Install `perfect-freehand` package. Replace the current drawing pipeline:

**Current flow:**
1. Mouse move → push `{x, y}` to `drawingPath[]`
2. Mouse up → create SVG `<polyline>` or `<path>` from raw points
3. Store as `DrawingElement.points`

**New flow:**
1. Mouse move → push `{x, y, pressure?}` to input points array
2. Each frame: run `getStroke(points, options)` → returns outline polygon
3. Render outline as filled SVG `<path>` using `getSvgPathFromStroke()`
4. Mouse up → store final stroke data in `DrawingElement`

### 5.2 Stroke Options by Tool

```typescript
const PEN_OPTIONS = {
  size: strokeWidth,
  thinning: 0.5,        // Pressure-based width variation
  smoothing: 0.5,        // Path smoothing
  streamline: 0.5,       // Input smoothing
  simulatePressure: true, // Simulate if no tablet
  start: { taper: true },
  end: { taper: true },
};

const MARKER_OPTIONS = {
  size: strokeWidth * 3,
  thinning: 0.1,         // Less variation — markers are flat
  smoothing: 0.7,
  streamline: 0.6,
  simulatePressure: false,
  start: { taper: false },
  end: { taper: false },
};
```

### 5.3 Storage Format

Drawing elements continue to store raw input points (for CRDT sync and undo). The `getStroke()` rendering is applied at render time, not storage time. This means:
- Existing drawings still render (raw points → getStroke at render)
- No migration needed for existing board data
- CRDT operations sync input points, not rendered outlines

### 5.4 Drawing Preview

The in-progress stroke (while mouse is down) also renders through `getStroke()` on every frame. This gives real-time visual feedback with smoothing applied as the user draws.

---

## 6. App Shell — Dashboard & Settings

### 6.1 Routing

```
/              → Dashboard (board list)
/auth          → Auth page (login/register/OAuth/magic link)
/auth/verify   → Magic link verification
/board/:id     → Canvas (OpenJamCanvas)
/settings      → User settings
```

Use `react-router-dom` with a root layout component that handles auth guards.

**URL migration:** The current app uses `/room/:id` (parsed manually in `App.tsx` via `window.location.pathname.split('/room/')`). The new routing uses `/board/:id`. Add a redirect route: `/room/:id` → `/board/:id` to maintain backward compatibility with shared links. The `?room=` query param is also supported currently and should redirect similarly.

### 6.2 Dashboard Page

**Layout:** Full-page with glass sidebar (collapsible) + main content area.

**Sidebar:**
- User avatar + name (links to /settings)
- "New Board" button (primary action)
- Navigation: All Boards, Recent, Shared with Me (future), Trash (future)
- Dark mode toggle at bottom

**Main content:**
- **Board grid**: Cards showing board name, thumbnail preview (future), last edited time, collaborator avatars
- **Board actions**: Rename (inline edit), duplicate, delete (with confirmation)
- **Empty state**: Friendly illustration + "Create your first board" CTA
- **Search/filter bar**: Filter boards by name

### 6.3 Settings Page

**Sections:**
- **Profile**: Display name, avatar color picker, email (read-only)
- **Authentication**: Change password (if email/password user), connected OAuth accounts (connect/disconnect Google/GitHub)
- **Sessions**: List of active sessions with device info, "Sign out everywhere" button
- **Appearance**: Light/Dark mode preference (persisted)
- **Danger Zone**: Delete account

### 6.4 Backend API Additions

```
GET    /api/rooms              → List boards (already exists, enhance with thumbnails/metadata)
PUT    /api/rooms/:id          → Rename board (new)
POST   /api/rooms/:id/duplicate → Duplicate board (new)
PUT    /api/me/password        → Change password (new)
GET    /api/me/sessions        → List active sessions (new)
DELETE /api/me/sessions/:token → Revoke specific session (new)
DELETE /api/me/sessions        → Revoke all sessions except current (new)
DELETE /api/me                 → Delete account (new)
```

---

## 7. Code Decomposition

### 7.1 OpenJamCanvas.tsx Breakdown

The current 2,200-line monolith splits into:

```
components/canvas/
├── Canvas.tsx              # Root component — layout, state coordination (~200 lines)
├── CanvasContext.tsx        # React context providing shared canvas state (~80 lines)
├── CanvasRenderer.tsx      # SVG/DOM rendering of elements + grid (~150 lines)
├── hooks/
│   ├── useCanvasInteraction.ts  # Pan, zoom, mouse/touch handlers (~250 lines)
│   ├── useDrawing.ts            # Drawing state + perfect-freehand (~200 lines)
│   ├── useEraser.ts             # Eraser logic (stroke + pixel modes) (~150 lines)
│   ├── useSelection.ts          # Selection box, multi-select, click-select (~200 lines)
│   ├── useDragCreate.ts         # Drag-to-create shapes/text/sticky/connector (~150 lines)
│   ├── useDragMove.ts           # Element dragging (~100 lines)
│   ├── useKeyboardShortcuts.ts  # All keyboard handlers (~100 lines)
│   ├── useClipboard.ts          # Copy/paste/duplicate (~80 lines)
│   └── useAutoSave.ts           # Auto-save timer + beforeunload (~50 lines)
├── DrawingPreview.tsx      # In-progress stroke rendering (~60 lines)
├── RemoteCursors.tsx       # Collaborator cursor rendering (~40 lines)
├── SelectionOverlay.tsx    # Selection box + handles (~60 lines)
└── EraserCursor.tsx        # Custom eraser cursor (~30 lines)
```

**State management:** `Canvas.tsx` creates a `CanvasContext` that holds the shared state (~20 useState calls from the current monolith). Child hooks and components consume this context via `useCanvasContext()`. This avoids prop-drilling while keeping state colocated in one place. The context provides:

- Element state: `elements`, `selectedIds`, `editingId`, `clipboard` (backed by ElementStore)
- Tool state: `currentTool`, `toolOptions`, `selectedColor`
- View state: `offset`, `scale`, `showGrid`
- Interaction state: `isPanning`, `isDrawing`, `selectionBox`
- Refs: `containerRef`, `elementStoreRef`
- Callbacks: `handleSelect`, `handleUpdate`, `handleMove`, `handleResize`, `screenToCanvas`

Each hook reads from context and returns its own local state + handlers. `Canvas.tsx` composes the hooks and passes their handlers to the unified mouse/keyboard event system.

### 7.2 useCollaboration Fix

Replace method monkey-patching with a typed event emitter on ElementStore:

```typescript
// Add to ElementStore class:
type StoreEvents = {
  operation: (op: ElementOperation) => void;
};

class ElementStore {
  private listeners = new Map<string, Set<Function>>();

  on<K extends keyof StoreEvents>(event: K, fn: StoreEvents[K]) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn); // returns unsubscribe
  }

  private emit<K extends keyof StoreEvents>(event: K, ...args: Parameters<StoreEvents[K]>) {
    this.listeners.get(event)?.forEach(fn => fn(...args));
  }

  // In each mutation method (addElement, updateElement, etc.):
  // After applying the operation locally:
  // this.emit('operation', op);
}
```

The `useCollaboration` hook simplifies to:
```typescript
useEffect(() => {
  const unsub = elementStore.on('operation', (op) => {
    wsClient.broadcastOperation(op);
  });
  return unsub;
}, [elementStore]);
```

This is cleaner, type-safe, and doesn't break if ElementStore is recreated. No external library needed — the emitter is ~15 lines built into ElementStore.

---

## 8. Implementation Phases

### Phase 1: Foundation
- Go `embed` for frontend assets
- `Makefile` with build/dev/docker targets
- Investigate and fix auth bug
- Decompose OpenJamCanvas.tsx into modules
- Fix useCollaboration monkey-patching → event emitter
- Remove Flowbite dependency (replaced by Liquid Glass components)

### Phase 2: Design System + Drawing Engine
- Liquid Glass design system (CSS tokens + base glass components: GlassPanel, GlassButton, GlassCard, GlassDialog, GlassInput)
- Dark mode toggle + theme persistence (localStorage)
- Restyle existing canvas chrome (toolbar, zoom, status bar, context menus) to glass
- Animations and micro-interactions
- Install and integrate `perfect-freehand`
- Replace pen/marker tool rendering with smooth strokes
- Update drawing preview (in-progress strokes)
- 21st-dev Magic MCP for component generation where helpful

### Phase 3: Auth + Routing
- `react-router-dom` setup with route guards
- Auth page with glass treatment (all three auth methods)
- OAuth integration (Google + GitHub)
- Magic link implementation (SMTP + token flow)
- Dashboard page using glass components (board list + create/rename/delete)
- Settings page using glass components (profile + password + sessions)
- URL migration redirects (`/room/:id` → `/board/:id`)

### Phase 4: Polish + Integration
- Restyle remaining components (widgets, share dialog, help panel, version history)
- End-to-end testing of all auth flows
- Verify CRDT sync with new stroke format
- Verify undo/redo across all operations
- Final dark mode audit (all components render correctly in both modes)
- Update documentation and README

**Phase ordering rationale:** Phase 2 builds the design system and drawing engine first, so Phase 3 (new pages) can use glass components from the start — no throwaway styling.

---

## 9. Configuration Changes

New environment variables:

```bash
# OAuth (optional — features disabled if not set)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Magic Link Email (optional — feature disabled if not set)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@example.com

# App URL (for OAuth redirects and magic link URLs)
APP_URL=http://localhost:8080
```

---

## 10. Database Migrations

New columns on `users` table:
- `auth_provider VARCHAR(20) NOT NULL DEFAULT 'local'` — enum: local, google, github, magic_link
- `provider_id VARCHAR(255)` — external OAuth user ID (nullable)
- `email_verified BOOLEAN NOT NULL DEFAULT false` — existing users default to false

New table `magic_link_tokens`:
- `token VARCHAR(64) PRIMARY KEY`
- `email VARCHAR(255) NOT NULL`
- `expires_at TIMESTAMP NOT NULL`
- `used BOOLEAN NOT NULL DEFAULT false`
- `created_at TIMESTAMP NOT NULL DEFAULT NOW()`

Migrations run automatically on server startup (same pattern as existing migrations in `db/` package).

## 11. Build Notes

- **Go embed path:** The Go module lives in `server/` while the frontend builds to `app/dist/`. The `go:embed` directive will reference `../app/dist` via a symlink or by copying `dist/` into `server/static/` as a build step in the Makefile. The Makefile handles this — no manual copying.
- **Flowbite removal:** The current `package.json` includes `flowbite` and `flowbite-react`. These are replaced by the Liquid Glass component library and should be removed in Phase 1 to avoid bundle bloat.
- **Existing touch support:** The current canvas has basic touch handlers. These are maintained as-is during decomposition — not improved, not regressed.
- **Redis/MinIO remain optional:** The single-binary deployment requires only PostgreSQL. Redis (caching/pub-sub) and MinIO (exports) remain optional and degrade gracefully when absent.

## 12. Out of Scope

- Mobile/touch responsiveness
- Server admin dashboard
- End-to-end encryption
- Board templates
- Offline mode
- SAML/OIDC enterprise SSO
- Board thumbnail generation
- "Shared with Me" view (requires sharing/permissions system)
