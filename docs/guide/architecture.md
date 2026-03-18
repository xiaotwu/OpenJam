# Architecture

OpenJam follows a client-server architecture with WebSocket for real-time communication.

## System Overview

```
┌──────────────────┐     HTTP + WS     ┌──────────────────┐
│                  │ ◄───────────────► │                  │
│  React Frontend  │                   │   Go Backend     │
│  (SPA)           │                   │   (Gin)          │
│                  │                   │                  │
└──────────────────┘                   └────────┬─────────┘
                                                │
                            ┌───────────────────┼───────────────────┐
                            │                   │                   │
                     ┌──────┴──────┐    ┌───────┴───────┐  ┌───────┴───────┐
                     │ PostgreSQL  │    │    Redis      │  │    MinIO      │
                     │ (Primary)   │    │  (Optional)   │  │  (Optional)   │
                     └─────────────┘    └───────────────┘  └───────────────┘
```

## Frontend Architecture

The frontend is a single-page React application built with Vite.

### Key Components

- **OpenJamCanvas** - Main canvas component handling rendering, interaction, and tool management
- **ElementStore** - CRDT-based state management for canvas elements with vector clocks
- **useCollaboration** - React hook bridging ElementStore with WebSocket for real-time sync
- **WebSocketClient** - WebSocket connection with auto-reconnect and message queuing

### Data Flow

1. User action (e.g., add sticky note)
2. ElementStore creates operation with vector clock
3. useCollaboration intercepts and broadcasts via WebSocket
4. Remote clients receive operation and apply to their ElementStore
5. React re-renders affected components

## Backend Architecture

The backend is structured following Go conventions with `internal/` packages.

### Package Structure

- **config** - Environment variable loading and validation
- **db** - PostgreSQL connection pool and Redis client
- **handler** - HTTP route handlers and WebSocket upgrade
- **middleware** - Authentication middleware
- **model** - Data models with database operations
- **storage** - MinIO/S3 file storage
- **ws** - WebSocket hub (room management) and client (message handling)

### WebSocket Hub

The hub manages connected clients and rooms:

- Clients register/unregister on connect/disconnect
- Room-based message broadcasting (only clients in the same room)
- Redis pub/sub for multi-server broadcasting
- Automatic cleanup of disconnected clients

## Database Schema

```sql
-- Users with bcrypt password hashing
users (id UUID, email, password_hash, display_name, avatar_color, ...)

-- Session tokens with expiration
sessions (token VARCHAR(64), user_id, expires_at, ...)

-- Rooms (boards) with JSONB board data
rooms (id VARCHAR(36), name, owner_id, board_data JSONB, ...)

-- Operations for CRDT sync
operations (id BIGSERIAL, room_id, user_id, op_id, op_type, payload JSONB, vector_clock JSONB, ...)
```

## Multi-Server Scaling

With Redis enabled, OpenJam supports horizontal scaling:

1. Each server instance connects to the shared Redis pub/sub channel
2. When a client sends an operation, the server broadcasts locally AND publishes to Redis
3. Other server instances receive the pub/sub message and broadcast to their local clients
4. All server instances share the same PostgreSQL database
