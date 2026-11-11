# Real-Time Collaboration

OpenJam uses WebSocket connections with an operation-log and last-writer-wins conflict resolution for real-time multi-user collaboration.

## How It Works

### Connection Lifecycle

1. User authenticates via REST API and receives a `wb_session` cookie (httpOnly) plus a bearer token
2. Frontend opens a WebSocket connection authenticated via the cookie (same-origin) or query token (cross-origin dev)
3. Client sends a `join` message with the room ID
4. Server sends back a `sync` message with current state and online users
5. Subsequent operations are broadcast in real time

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `join` | Client → Server | Join a room |
| `leave` | Client → Server | Leave a room |
| `op` | Bidirectional | Canvas operation (add, update, delete, move, etc.) |
| `cursor` | Bidirectional | Cursor position update |
| `sync` | Server → Client | Initial state sync on join |
| `presence` | Server → Client | User join/leave notifications |

### Operations

Each operation includes:
- **opId** - Unique operation identifier
- **opType** - Operation type (add, update, delete, move, resize, reorder, lock, clear)
- **elementId** - Target element ID
- **vectorClock** - Causal ordering metadata
- **userId** - Originating user
- **timestamp** - Wall clock time

### Vector Clocks

Vector clocks ensure correct ordering of concurrent operations:

- Each user maintains a counter in the vector clock
- On each operation, the user increments their counter
- When receiving remote operations, clocks are merged (max of each entry)
- Concurrent operations (neither happens-before the other) are resolved by timestamp

### Conflict Resolution

For concurrent edits to the same element:

1. Operations are ordered by vector clock, then timestamp as a tiebreaker
2. Last-writer-wins for property updates (the later operation overwrites)
3. Each operation is deduplicated by opId, so the same operation is never applied twice
4. Board state is persisted as a full snapshot via auto-save; on save, an optimistic-lock check (based on `updated_at`) rejects stale overwrites and the client reloads the server's authoritative version to merge

## Board Persistence

The authoritative board state is the `board_data` JSONB column in the `rooms` table. The `operations` table logs incremental edits for real-time sync but is not the source of truth for persistence. On join, the client loads the snapshot via HTTP and receives the operation history via WebSocket `sync` to fill any gap since the last save.

## Live Cursors

Cursor positions are broadcast at up to 20fps (throttled) to show where collaborators are pointing. Stale cursors (no update for 10 seconds) are automatically removed.

## Presence

When users join or leave a room, presence messages are broadcast to all other clients. The status bar shows how many users are currently online.

## Reconnection

The WebSocket client automatically reconnects with exponential backoff:
- Initial delay: 1 second
- Backoff multiplier: 1.5x
- Maximum attempts: 10
- On reconnect, the client re-joins the room and receives a fresh sync
