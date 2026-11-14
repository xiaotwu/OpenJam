# What is Shiori?

Shiori is a self-hosted workspace for teams. Keep boards, documents, spreadsheets, and presentations together in a Project, with shared access and version history.

## Key Capabilities

- **Multi-user real-time collaboration** via WebSocket with operation-log sync and vector-clock dedup
- **Rich canvas** with sticky notes, shapes, text, connectors, freehand drawing, and images
- **Collaborative documents, spreadsheets, and presentations** alongside the canvas
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
| Storage | SeaweedFS or S3-compatible storage |
| Real-time | WebSocket with vector clocks (last-writer-wins) |

## Who is it for?

- Teams that need a self-hosted alternative to Miro, FigJam, or Excalidraw
- Organizations with data sovereignty requirements
- Developers who want a customizable whiteboard platform
- Anyone who wants to brainstorm, plan, or collaborate visually
