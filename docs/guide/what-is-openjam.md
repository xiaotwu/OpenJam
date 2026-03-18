# What is OpenJam?

OpenJam is an open-source, self-hosted collaborative whiteboard application. It enables teams to work together in real time on a shared canvas with rich drawing tools, interactive widgets, and seamless synchronization.

## Key Capabilities

- **Multi-user real-time collaboration** via WebSocket with CRDT conflict resolution
- **Rich canvas** with sticky notes, shapes, text, connectors, freehand drawing, and images
- **11 interactive widgets** including timers, polls, kanban boards, retro boards, and more
- **Session-based authentication** with bcrypt password hashing
- **Auto-save** with periodic persistence to PostgreSQL
- **Export** boards as PNG images or JSON
- **Self-hosted** - deploy with Docker Compose in one command

## Tech Stack

| Layer | Technology |
|:------|:-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Backend | Go 1.22, Gin |
| Database | PostgreSQL 16 |
| Cache | Redis 7 (optional) |
| Storage | MinIO / S3 (optional) |
| Real-time | WebSocket with CRDT vector clocks |

## Who is it for?

- Teams that need a self-hosted alternative to Miro, FigJam, or Excalidraw
- Organizations with data sovereignty requirements
- Developers who want a customizable whiteboard platform
- Anyone who wants to brainstorm, plan, or collaborate visually
