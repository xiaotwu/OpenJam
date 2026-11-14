# Docker Deployment

The Shiori image embeds the frontend in a non-root Go runtime. Docker Compose runs database migrations before starting the application. The default stack runs PostgreSQL, Redis, SeaweedFS and a background worker. The AI service is optional.

## Install the published release

1. Install Docker with the Compose plugin. The published image supports Linux ARM64 and AMD64.
2. Download the Compose bundle, the image lock, and `SHA256SUMS` from the [latest Shiori release](https://github.com/xiaotwu/Shiori/releases/latest). Follow `INSTALL.md` in the bundle to verify the checksums and configure a fresh `.env` with unique database and object storage credentials. Use the `SHIORI_IMAGE` digest listed in that bundle.
3. From the extracted directory, start the pinned image.

```bash
docker compose --env-file .env up --no-build --wait
```

Open [localhost:8080](http://localhost:8080). Set `SHIORI_PUBLISH_PORT` and update `CORS_ORIGINS` if you use a different port. Set a fixed `COMPOSE_PROJECT_NAME` for a shared deployment so Compose uses the same volumes if you move the directory. Follow [Upgrade a deployment](./operations.md#upgrade-a-deployment) for an existing instance.

Use the [Meetings overlay](./meetings.md#enable-media) to add the private audio, video, and screen-sharing service.

<a id="local-deployment"></a>

For a pilot deployment, copy `.env.example` to a protected environment file and replace the sample credentials. Use a fixed Compose project name and record the exact application image. For an HTTPS deployment, put a reverse proxy in front of Shiori, configure it to forward WebSocket traffic, set `ENVIRONMENT=production`, and set `CORS_ORIGINS` to the HTTPS origin. Set PostgreSQL credentials with `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`. When credentials contain URI delimiters or PostgreSQL is external, provide a `DATABASE_URL` with properly encoded credentials.

## Build from source

Use a full [Shiori source checkout](https://github.com/xiaotwu/Shiori). For a new local instance, copy its `.env.example` to `.env` and set fresh credentials before starting the stack.

```bash
docker compose up --build --wait
```

## Services

| Service | Published port by default | Purpose |
|---------|---------------------------|---------|
| `server` | 8080 on loopback | Go API, WebSocket endpoint, and embedded frontend |
| `migrate` | — | One-time schema migration using the same image as `server` |
| `postgres` | — | Primary database |
| `redis` | — | Session cache and collaboration pub/sub |
| `seaweedfs` | — | S3-compatible storage for private board images |
| `worker` | — | Claims export, import, thumbnail and assistant jobs from PostgreSQL |
| `agent` | — | Optional `ai` profile with the internal Python model service |
| `minio` | — | Optional legacy object storage profile |

The application exposes `/livez` for liveness, `/startupz` for startup and `/readyz` for readiness. Compose checks `/readyz` before reporting the server as healthy. The legacy `/health` endpoint also reports export availability.

Use the [operations guide](./operations.md) for quick checks, upgrades, backups, recovery and troubleshooting.

Use the [pilot acceptance checklist](./pilot-acceptance.md) to validate the actual ingress, replica and rollback path before opening a pilot.

## Object Storage

The default stack uses SeaweedFS for private images. The application authenticates asset reads through the current board's permissions. Set `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, and `MINIO_USE_SSL` for an external S3 endpoint.

For an existing Compose MinIO installation, select the `storage` profile and use the same Compose project name and deployment environment. Set `SHIORI_IMAGE` to the approved application image and `MINIO_IMAGE` to the approved MinIO image already available locally. The fallback tag for older installations is `minio/minio:latest`.

```bash
MINIO_ENDPOINT=minio:9000 docker compose --env-file .env --profile storage up --no-build --wait
```

The profile publishes the object API and console on loopback ports 9000 and 9001. Set `MINIO_API_PORT` or `MINIO_CONSOLE_PORT` to change them.

## Board assistant

Use a full source checkout to build the optional Agent image. Set `SHIORI_AGENT_URL=http://agent:8091`, provide a shared `SHIORI_AGENT_TOKEN`, and configure the allowed provider and model in the environment. Start Compose with `--profile ai`. The provider service is reachable within the Compose network. The assistant starts disabled for each organization.

```bash
docker compose --profile ai up --build --wait
```

For local validation set `SHIORI_AGENT_MOCK=true` and select the test model in the board assistant settings. For Ollama, start a local server with the configured model available. Docker Desktop can reach it using `SHIORI_OLLAMA_URL=http://host.docker.internal:11434`.

The worker persists claims, leases, retry deadlines, and results in PostgreSQL. File tasks and the assistant use separate polling loops. Job payloads and artifacts expire after 24 hours by default, with stored-byte limits of 512 MiB per deployment and 96 MiB per actor. Private board images are accessed through the application with current board permissions. Board ZIPs carry authorized private images, and PNG exports and Workshop thumbnails use the selected light or dark theme.

The assistant uses an independently deployed Python service. Add a fixed HTTPS adapter for an external Agent or mount a versioned workflow pack to update guidance. [Board assistant](/guide/board-assistant) · [External Agent and workflow guides](/guide/agent-connector)

## Data Persistence

Use the original Compose project name on upgrades, even after moving the checkout. Pass `--project-name` or keep the existing `COMPOSE_PROJECT_NAME` to reuse these volumes:
- `postgres_data` - Database files
- `redis_data` - Redis persistence
- `seaweed_data` - Private S3 objects
- `minio_data` - Uploaded files

The fresh-install environment example sets both `POSTGRES_DB` and `MINIO_BUCKET` to `shiori`. When upgrading, keep the original database, bucket and credentials, including the legacy defaults if the deployment relied on them. See [Configuration](../reference/configuration.md#compatibility-with-earlier-deployments).

For a consistent instance backup, capture PostgreSQL and SeaweedFS during the same maintenance window. Follow [Create an instance backup](./operations.md#create-an-instance-backup).

## Development Services Only

For local development, use the dev Compose file to start PostgreSQL, Redis and SeaweedFS on loopback ports 5432, 6379 and 8333. Use a distinct Compose project name to run the dev and full stacks independently.

```bash
docker compose -f docker-compose.dev.yml up -d
```

Use the same database and bucket settings in the dev stack and the backend. Follow the [development setup](./getting-started.md#development-setup) to run the frontend, API and worker.
