# Manual Setup

Deploy Shiori without Docker by building the frontend and backend manually.

## Prerequisites

- Go 1.22+
- Bun and Node.js for the frontend build. The Dockerfile records the versions used for Compose builds.
- PostgreSQL 16, as used by the Compose release
- Redis (optional)
- MinIO or S3-compatible storage (optional)

## Build the application

```bash
make build
```

This embeds the frontend in `./shiori-server`.

## Deploy

Configure the same [environment](/reference/configuration) for the migrator, API and worker. Take a consistent backup before migrating an existing instance.

```bash
./shiori-server migrate
SHIORI_AUTO_MIGRATE=false ./shiori-server api
```

Start `./shiori-server worker` under the process supervisor with the same database and object store configuration. Verify the HTTP endpoints and run `./shiori-server doctor`. See [Operations and Recovery](./operations.md) for checks and restore verification.

## Running with systemd

Create `/etc/systemd/system/shiori.service`:

```ini
[Unit]
Description=Shiori Workspace API
After=network.target postgresql.service

[Service]
Type=simple
User=shiori
WorkingDirectory=/opt/shiori
ExecStart=/opt/shiori/shiori-server api
EnvironmentFile=/opt/shiori/.env
Environment=SHIORI_AUTO_MIGRATE=false
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now shiori
```
