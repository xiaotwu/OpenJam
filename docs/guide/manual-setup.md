# Manual Setup

Deploy OpenJam without Docker by building the frontend and backend manually.

## Prerequisites

- Go 1.22+
- Bun and Node.js for the frontend build. The Dockerfile records the versions used for Compose builds.
- PostgreSQL 14+
- Redis (optional)
- MinIO or S3-compatible storage (optional)

## Build the application

```bash
make build
```

This embeds the frontend in `./openjam-server`.

## Deploy

Configure the same [environment](/reference/configuration) for the migrator, API and worker. Take a consistent backup before migrating an existing instance.

```bash
./openjam-server migrate
OPENJAM_AUTO_MIGRATE=false ./openjam-server api
```

Start `./openjam-server worker` under the process supervisor with the same database and object store configuration. Verify the HTTP endpoints and run `./openjam-server doctor`. See [Operations and Recovery](./operations.md) for checks and restore verification.

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
ExecStart=/opt/openjam/openjam-server api
EnvironmentFile=/opt/openjam/.env
Environment=OPENJAM_AUTO_MIGRATE=false
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now openjam
```
