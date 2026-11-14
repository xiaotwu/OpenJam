# API Reference

Shiori exposes HTTP APIs for accounts, Workshop, and the four editors. The current editor APIs use `/api/v2`.

## Authentication

### POST `/api/auth/register`
Create a new account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "Jane Doe"
}
```

**Response (200):**
```json
{
  "token": "abc123...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "displayName": "Jane Doe",
    "avatarColor": "#3b82f6"
  }
}
```

### POST `/api/auth/login`
Sign in with existing account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### POST `/api/auth/logout`
End the current session.

## User

### GET `/api/me`
Get current user profile. Requires authentication.

### PUT `/api/me`
Update display name and avatar color.

**Request:**
```json
{
  "displayName": "New Name",
  "avatarColor": "#ef4444"
}
```

## Document sync

Boards, Docs, Sheets, and Slides use the same sync endpoints. The file ID comes from the Workshop directory.

| Method and path | Behavior |
| --- | --- |
| `GET /api/v2/directory` | Lists the caller’s accessible organizations, workspaces, projects, boards, docs, sheets, and slides. |
| `GET /api/v2/boards/:id/snapshot` | Returns the current document, access level, epoch, sequence, and hash. |
| `GET /api/v2/boards/:id/changes?epoch=…&afterSeq=…` | Returns committed changes after the given sequence. |
| `POST /api/v2/boards/:id/commands` | Submits a command and returns its commit receipt. Retry with the same client ID, command ID, and payload. |

The WebSocket at `/ws/v2` handles subscriptions, presence, cursors, and change notifications. See [Real-Time Collaboration](../guide/collaboration.md) and the [command contract](https://github.com/xiaotwu/Shiori/blob/main/contracts/board-sync.md).

## Rooms

The room endpoints are used by older board clients and require authentication.

### POST `/api/rooms`
Create a new room.

**Request:**
```json
{ "name": "Sprint Planning" }
```

### GET `/api/rooms`
List rooms owned by the current user plus boards shared with them as a member.

### GET `/api/rooms/:id`
Get room details.

### PUT `/api/rooms/:id`
Rename a room (owner only).

**Request:**
```json
{ "name": "Updated Board Name" }
```

### DELETE `/api/rooms/:id`
Delete a room (owner only).

### GET `/api/rooms/:id/share`
Get link permission and invited members for a room.

### PUT `/api/rooms/:id/share`
Update room link permission (owner only).

**Request:**
```json
{ "linkPermission": "restricted" }
```

Valid values: `restricted`, `anyone-view`, `anyone-comment`, `anyone-edit`.

### POST `/api/rooms/:id/invites`
Invite an existing Shiori user to a room by email (owner only).

**Request:**
```json
{
  "email": "teammate@example.com",
  "permission": "edit"
}
```

Valid permissions: `view`, `comment`, `edit`.

### DELETE `/api/rooms/:id/members/:userId`
Remove an invited member from a room (owner only).

## Board Data

These full-board endpoints apply to boards in legacy sync mode. Use [Document sync](#document-sync) for current files.

### POST `/api/rooms/:id/save`
Save board state.

**Request:**
```json
{
  "name": "My Board",
  "elements": [...],
  "stamps": [...],
  "pages": [...]
}
```

### GET `/api/rooms/:id/load`
Load saved board state.

## Export

The routes below serve older board clients. For current Board PNG, JSON, or ZIP exports, queue a job with `POST /api/v2/boards/:id/files/export`. Read the job with `GET /api/v2/jobs/:jobId` and download its completed artifact from `GET /api/v2/jobs/:jobId/artifact`.

### POST `/api/rooms/:id/export/png`
Export board as PNG image.

### POST `/api/rooms/:id/export/json`
Export board as JSON.

### GET `/exports/:key`
Download an exported file.

## Docs

Docs use the project’s existing Team or personal permissions. The directory returns documents in its `docs` collection. Open the browser route `/doc/:id` with an optional `block` query parameter for a specific block.

| Method and path | Behavior |
|:---|:---|
| `POST /api/v2/projects/:projectId/docs` | Creates an empty document from a JSON body with `name`. |
| `POST /api/v2/projects/:projectId/docs/import?name=…&format=…` | Creates a document from a raw Markdown (`md`) or `docx` body of up to 4 MiB. |
| `GET /api/v2/docs/:id/export?format=…` | Downloads the current saved document as `md` or `docx`. |

The existing V2 snapshot, changes, commands, review, and versions routes also serve Docs. A Doc snapshot carries `resourceKind: "doc"`. Its `pages` collection stores ordered text blocks. Block patches compare the previous field value, just as other synchronized edits do.

## Sheets

The directory returns workbooks in `sheets`. The browser route is `/sheet/:id`. Search results include `sheet` and `cell` query parameters for a worksheet ID and cell address.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/v2/projects/:projectId/sheets` | Creates a workbook with one worksheet from a JSON body with `name`. |
| `POST /api/v2/projects/:projectId/sheets/import?name=…&format=…` | Creates a workbook from a raw `csv` or `xlsx` body up to 4 MiB. |
| `GET /api/v2/sheets/:id/export?format=…` | Downloads the saved workbook as `xlsx` or a single worksheet as `csv`. For CSV, `sheet` selects a worksheet ID and defaults to the first worksheet. |

V2 snapshot, changes, commands, review, and versions share the existing file permissions. Sheet snapshots use `resourceKind: "sheet"`. `pages` stores ordered worksheet metadata and `elements` stores filled cells. A `setCell` command uses `collection: "elements"` and an ID made from the worksheet UUID, a colon, and the uppercase address. Its `value` includes `pageId`, `address`, `input`, and `valueType`. The `expected` field includes the previous `input` and `valueType`. Empty strings for both represent a blank cell. The server calculates formula results and updates the search index in the commit transaction.

## Slides

The directory returns presentations in `slides`. The browser route is `/slides/:id`. A `slide` query parameter selects a slide UUID that stays stable when slides are reordered.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/v2/projects/:projectId/slides` | Creates a presentation with one blank slide from a JSON body with `name`. |
| `POST /api/v2/projects/:projectId/slides/import?name=…` | Imports a raw PPTX body of up to 32 MiB. The response may include `warnings` for skipped objects or pictures. |
| `GET /api/v2/slides/:id/export` | Downloads the saved presentation and its authorized images as PPTX. |

Snapshots use `resourceKind: "slides"`. The ordered `pages` contain slide metadata and dimensions. `elements` contains editable text and image objects with a `pageId`. Images use existing private asset routes and are linked to the presentation. Object edits compare the previous values of changed fields. Reordering compares the previous slide order. The existing V2 access, review, and history endpoints apply to Slides.

## Project Branches and Versions

These endpoints use `/api/v2/projects/:projectId`. Write requests use a client-generated UUID `requestId` so a retry on another API replica can return the same result.

| Method and path | Behavior |
|:---|:---|
| `POST /import` | Copies a personal Project into a Team `workspaceId` with a `name` and a `mode` of `linked` or `independent`. |
| `GET /sync` | Lists linked projects the caller can manage on both sides. |
| `GET /sync/:peerId` | Returns a preview `token` and changes marked `incoming`, `outgoing`, or `conflict`. |
| `POST /sync/:peerId` | Applies the requested `direction` of `pull` or `push` using the preview `token`. Optional `resolve` lists conflicting file keys to apply in that direction. Optional `name` labels a push. |
| `GET /versions?before=…` | Lists snapshots, with a `next` cursor for older versions. |
| `POST /versions` | Saves a snapshot with a `name`. |
| `GET /versions/:versionId/restore` | Previews the files a restore would change and returns a `token`. |
| `POST /versions/:versionId/restore` | Restores the selected snapshot with its preview `token`. |

An outdated preview returns HTTP 409 with `STALE_PROJECT`.

## Project Archives

These authenticated endpoints return private, non-cacheable responses. Both instances must support project archive format version 1.

| Method and path | Behavior |
|:---|:---|
| `GET /api/v2/projects/:projectId/archive?origin=…` | Downloads the ZIP for a Project Manager. Send the public HTTP(S) origin of the source instance for link resolution. |
| `POST /api/v2/project-archives/inspect` | Accepts the raw ZIP as `application/zip` and validates its manifest, documents, and private images. Returns counts and source member labels without writing a project. |
| `POST /api/v2/workspaces/:workspaceId/project-archives` | Creates a new project. Send multipart form data with the ZIP in `archive` and a JSON object in `options`. |

Restore options include a required UUID `requestId`, an optional `name`, and optional `mappings` with `sourceUserId`, `targetUserId`, and `role` (`manager`, `edit`, `comment`, or `view`). A retry with the same request, bytes, and options returns the same new project. Only existing members of the destination Team may be mapped. See [Project Archives](../guide/project-archive.md) for scope and limits.

## Workshop

Workshop endpoints use `/api/v2/workshop` and require authentication. Reads apply the account’s current Team, Project, and board access.

| Method and path | Behavior |
|:---|:---|
| `GET /search?q=…&team=…` | Finds projects, members, files, and content. The Team filter is optional. Each result has a source `url`. |
| `GET /teams/:teamId/graph` | Returns visible members, projects, boards, and edges. `truncated` indicates that the graph reached a size limit. |
| `GET /inbox` | Returns recent threads, visible board mentions and meeting notices, and the total unread count. |
| `POST /threads` | Starts a conversation with a client-generated UUID `id`, `teamId`, `subject`, and `body`. Provide `recipientId` for a direct conversation. |
| `GET /threads/:id?before=…` | Returns messages in sequence order. Pass the response’s `nextBefore` value for earlier messages. |
| `POST /threads/:id/replies` | Appends a reply with a client-generated UUID `id` and a `body`. |
| `PUT /threads/:id/state` | Updates the caller’s `pinned` flag, `readThrough` sequence, or both. |
| `GET /agenda?from=…&to=…` | Returns visible events, tasks, and meetings in the RFC 3339 time range. |
| `PUT /agenda/:id` | Creates or edits an event or task. Include the current `revision` when editing. Optional `teamId` or `projectId` selects a shared scope. |
| `DELETE /agenda/:id?revision=…` | Deletes the matching editable revision. |
| `PUT /meetings/:id` | Creates a meeting using a client-generated UUID, a title, and one `teamId` or `projectId`. Supply both `startsAt` and `endsAt` in RFC 3339 for a scheduled meeting. Omit both for an immediate meeting. |
| `GET /meetings/:id` | Returns visible meeting details, its current status, and whether media is configured. |
| `PUT /meetings/:id/read` | Marks the meeting notice as read for the current account. |
| `PUT /meetings/:id/end` | Ends or cancels the meeting if the caller can manage it. |
| `GET /recents` | Returns the caller’s recently opened accessible boards. |
| `PUT /recents/:id` | Records a board open for the caller. |

## Health

| Endpoint | Purpose |
| --- | --- |
| `GET /livez` | Reports that the API process is responding. |
| `GET /startupz` | Reports that the API has opened its listener. |
| `GET /readyz` | Reports PostgreSQL readiness and returns `503` if the database is unavailable or the API is draining. |
| `GET /health` | Reports basic health and the `exportsEnabled` flag for storage initialization. |

## WebSocket

Use `/ws/v2` for current editors. See [Real-Time Collaboration](../guide/collaboration.md) for subscriptions and change notifications. The `/ws` endpoint serves legacy board clients.
