# Real-Time Collaboration

OpenJam uses WebSocket connections with CRDT-based conflict resolution for real-time multi-user collaboration.

## How It Works

### Connection Lifecycle

1. User authenticates via REST API and receives a session token
2. Frontend opens a WebSocket connection with the token
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

### CRDT Operations

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

1. Both operations are applied in vector clock order
2. If clocks are concurrent, timestamp is used as tiebreaker
3. Last-write-wins for property updates
4. Deletes are permanent (tombstoned)

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
