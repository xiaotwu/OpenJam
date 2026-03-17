<div align="center">
  <img src="app/public/icons/openjam.png" alt="OpenJam" width="128" height="128">
  <h1>OpenJam</h1>
  <p><strong>A collaborative whiteboard for teams</strong></p>

  <p>
    <a href="#features">Features</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#development">Development</a> •
    <a href="#deployment">Deployment</a> •
    <a href="#contributing">Contributing</a>
  </p>

  <!-- Add badges here when available -->
  <!-- ![License](https://img.shields.io/github/license/your-username/openjam) -->
  <!-- ![Stars](https://img.shields.io/github/stars/your-username/openjam) -->
</div>

---

## Features

- 🎨 **Real-time Collaboration** - Work together on the same canvas with your team
- 🖼️ **Rich Drawing Tools** - Shapes, freehand drawing, text, and more
- 💾 **Auto-save** - Never lose your work
- 🔒 **Secure** - Session-based authentication
- 📤 **Export** - Save your boards as images
- 🐳 **Docker Ready** - One-command deployment

## Quick Start

The fastest way to run OpenJam:

```bash
git clone https://github.com/xiaotwu/openjam.git
cd openjam
docker compose up --build -d
```

Open `http://localhost:8080` in your browser.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (for containerized deployment)
- [Go](https://golang.org/dl/) 1.22+ (for backend development)
- [Bun](https://bun.sh/) or [Node.js](https://nodejs.org/) 20+ (for frontend development)

## Development

### 1. Start Services

```bash
# Start PostgreSQL, Redis, and MinIO
docker compose -f docker-compose.dev.yml up -d
```

### 2. Run Backend

```bash
cd server
cp .env.example .env   # Linux/macOS
# copy .env.example .env  # Windows
go run main.go
```

### 3. Run Frontend

```bash
cd app
bun install
bun run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8080 |
| MinIO Console | http://localhost:9001 |

## Deployment

### Docker (Recommended)

```bash
# Build and start all services
docker compose up --build -d
```

### Single Binary (Recommended for production)

```bash
make build
```

This builds the frontend, embeds it into the Go binary via `go:embed`, and produces a single `./openjam-server` file (~17MB). Deploy it anywhere — no Node.js runtime needed.

```bash
DATABASE_URL=postgres://... ./openjam-server
```

### Manual Build

<details>
<summary>Click to expand</summary>

**Frontend:**
```bash
cd app
bun install
bun run build
```

**Backend:**
```bash
rm -rf server/static && cp -r app/dist server/static
cd server && CGO_ENABLED=0 go build -ldflags="-s -w" -o ../openjam-server .
```

</details>

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `ENVIRONMENT` | `development` / `production` | `development` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `REDIS_URL` | Redis connection string | - |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | `http://localhost:5173` |
| `SESSION_SECRET` | Session encryption key | ⚠️ **Change in production** |
| `MINIO_ENDPOINT` | MinIO/S3 endpoint | - |
| `MINIO_ACCESS_KEY` | MinIO access key | - |
| `MINIO_SECRET_KEY` | MinIO secret key | - |

See [`.env.example`](server/.env.example) for all available options.

## Project Structure

```
openjam/
├── app/                      # Frontend (React + TypeScript + Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── canvas/       # Canvas decomposed modules
│   │   │   │   ├── hooks/    # useDrawing, useEraser, useSelection, etc.
│   │   │   │   └── ...       # DrawingPreview, EraserCursor, CanvasContext
│   │   │   └── ...           # OpenJamCanvas, BottomToolbar, MenuBar, etc.
│   │   └── lib/              # ElementStore, WebSocket, API client
│   └── ...
├── server/                   # Backend (Go + Gin)
│   ├── internal/
│   │   ├── config/           # Configuration
│   │   ├── db/               # Database layer
│   │   ├── handler/          # API handlers
│   │   ├── middleware/       # Middleware
│   │   ├── model/            # Data models
│   │   ├── storage/          # File storage
│   │   └── ws/               # WebSocket hub + client
│   ├── static.go             # Embedded frontend assets (go:embed)
│   └── main.go
├── Makefile                  # Build: make build → single binary
├── docker-compose.yml        # Production deployment
├── docker-compose.dev.yml    # Development services
└── Dockerfile                # Multi-stage build
```

## Tech Stack

| Layer | Technologies |
|:------|:-------------|
| **Frontend** | ![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white) ![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) |
| **Backend** | ![Go](https://img.shields.io/badge/Go-00ADD8?style=flat-square&logo=go&logoColor=white) ![Gin](https://img.shields.io/badge/Gin-00ADD8?style=flat-square&logo=gin&logoColor=white) |
| **Database** | ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white) ![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white) |
| **Storage** | ![MinIO](https://img.shields.io/badge/MinIO-C72E49?style=flat-square&logo=minio&logoColor=white) |
| **DevOps** | ![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white) |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <sub>Built with ❤️ by OpenJam</sub>
</div>
