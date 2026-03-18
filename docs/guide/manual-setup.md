# Manual Setup

Deploy OpenJam without Docker by building the frontend and backend manually.

## Prerequisites

- Go 1.22+
- Node.js 20+ or Bun
- PostgreSQL 14+
- Redis (optional)
- MinIO or S3-compatible storage (optional)

## Build the Frontend

::: code-group

```bash [Bun]
cd app
bun install
bun run build
```

```bash [npm]
cd app
npm install
npm run build
```

:::

This produces a `dist/` directory with static files.

## Build the Backend

```bash
cd server
CGO_ENABLED=0 go build -ldflags="-s -w" -o openjam-server .
```

## Deploy

1. Copy the frontend build output:
   ```bash
   cp -r app/dist server/static
   ```

2. Configure environment variables (see [Configuration](/reference/configuration))

3. Run the server:
   ```bash
   cd server
   ./openjam-server
   ```

The server serves both the API and frontend on the configured port (default 8080).

## Running with systemd

Create `/etc/systemd/system/openjam.service`:

```ini
[Unit]
Description=OpenJam Whiteboard Server
After=network.target postgresql.service

[Service]
Type=simple
User=openjam
WorkingDirectory=/opt/openjam
ExecStart=/opt/openjam/openjam-server
EnvironmentFile=/opt/openjam/.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now openjam
```
