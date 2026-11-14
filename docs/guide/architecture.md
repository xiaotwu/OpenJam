# Architecture

The Shiori image serves the React frontend and Go API from one origin. Workshop and its editors use HTTP for data and commands and WebSocket for collaboration. The default Compose stack runs PostgreSQL, Redis, SeaweedFS, and a separate Go worker.

## Services

| Component | Responsibility |
| --- | --- |
| Web client | Opens Workshop and the Board, Doc, Sheet, and Slides editors. Sends authenticated commands and updates the editor from confirmed changes. |
| API server | Checks Team, Project, and file access. Serves search, file endpoints, and board collaboration. |
| PostgreSQL | Stores accounts, permissions, projects, file revisions, sync receipts, search data, and durable jobs. |
| Redis | Caches sessions and relays collaboration notifications across API replicas. Clients can catch up from PostgreSQL if a notification is missed. |
| SeaweedFS | Provides the default S3-compatible object store for private images and storage-backed files. Shiori checks access when serving them. |
| Worker | Claims queued file jobs and Board Assistant runs. The optional Python Agent handles requests to configured model providers. |
| Migrator | Updates the PostgreSQL schema before the API and worker start. |

## Follow an edit

1. The editor reads an authenticated snapshot. The browser stores pending commands for an open editor in IndexedDB.
2. The API checks current edit permission and commits the document update, its change entry, and its command receipt in one PostgreSQL transaction.
3. The WebSocket channel tells subscribed clients that a new sequence is available. A client reads missed committed changes over HTTP and applies them in order.
4. The editor shows **Saved** after the write is confirmed. Retrying the same command reuses its receipt.

API replicas share PostgreSQL and Redis. A missed notification or reconnect uses the same committed change feed. See [Real-Time Collaboration](./collaboration.md) for the browser behavior and [Docker Deployment](./docker.md) for services and health checks.

## Source layout

- `app/src/components/workshop` contains Workshop navigation, project actions, and team views. `app/src/components` also contains the four editors.
- `app/src/lib/boardSync*` contains the shared command protocol, client queue, and synchronization code.
- `server/internal/document` implements document commands, revisions, project sync, and archives. `server/internal/handler` exposes the HTTP and WebSocket endpoints.
- `server/internal/boardfiles` and `server/internal/jobs` handle file work and the persistent queue. `agent` contains the optional model service.
