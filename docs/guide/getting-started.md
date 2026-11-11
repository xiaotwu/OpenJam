# Getting Started

The fastest way to run OpenJam is with Docker Compose.

## Quick Start (Docker)

```bash
git clone https://github.com/xiaotwu/openjam.git
cd openjam
docker compose up --build -d
```

Open [http://localhost:8080](http://localhost:8080) and create an account.

## Development Setup

For local development, you'll run the backend and frontend separately.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for database services)
- [Go](https://golang.org/dl/) 1.22+
- [Bun](https://bun.sh/) or [Node.js](https://nodejs.org/) 20+

### 1. Start dependency services

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts PostgreSQL, Redis, and MinIO.

### 2. Start the backend

```bash
cd server
cp .env.example .env
go run main.go
```

### 3. Start the frontend

::: code-group

```bash [Bun]
cd app
bun install
bun run dev
```

```bash [npm]
cd app
npm install
npm run dev
```

:::

### 4. Open the app

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend API: [http://localhost:8080](http://localhost:8080)
- MinIO Console: [http://localhost:9001](http://localhost:9001)

## Creating a Board

1. Register a new account or sign in
2. You'll be placed on the default board
3. Use `?room=my-board` in the URL to create named boards
4. Share the URL with collaborators to work together
