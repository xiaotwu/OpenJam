# Docker Deployment

The Shiori image embeds the frontend in a non-root Go runtime. Docker Compose runs database migrations before starting the application. The default stack runs PostgreSQL, Redis, SeaweedFS and a background worker. The AI service is optional.

## Local Deployment

```bash
docker compose up --build --wait
```

Open [localhost:8080](http://localhost:8080). Set `SHIORI_PUBLISH_PORT` to run on a different local port. Compose uses the current project name for its network, containers, volumes and default image tag. To run a prebuilt local image, set `SHIORI_IMAGE` to its tag and use `docker compose up --no-build --wait`.

Use the [Meetings overlay](./meetings.md#enable-media) to add the private audio, video, and screen-sharing service.

For a pilot deployment, copy `.env.example` to a protected environment file and replace the sample credentials. Use a fixed Compose project name and record the exact application image. For an HTTPS deployment, put a reverse proxy in front of Shiori, configure it to forward WebSocket traffic, set `ENVIRONMENT=production`, and set `CORS_ORIGINS` to the HTTPS origin. Set PostgreSQL credentials with `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`. When credentials contain URI delimiters or PostgreSQL is external, provide a `DATABASE_URL` with properly encoded credentials.

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

For an existing Compose MinIO installation, select the `storage` profile and use the same Compose project name. The profile uses a local image so it can start with a previously cached MinIO image. Set `MINIO_IMAGE` to the tag of an approved image already available locally. The default tag for older installations is `minio/minio:latest`.

```bash
MINIO_ENDPOINT=minio:9000 docker compose --profile storage up --build --wait
```

The profile publishes the object API and console on loopback ports 9000 and 9001. Set `MINIO_API_PORT` or `MINIO_CONSOLE_PORT` to change them.

## Board assistant

Set `SHIORI_AGENT_URL=http://agent:8091`, provide a shared `SHIORI_AGENT_TOKEN`, and configure the allowed provider and model in the environment. Start Compose with `--profile ai`. The provider service is reachable within the Compose network. The assistant starts disabled for each organization.

```bash
docker compose --profile ai up --build --wait
```

For local validation set `SHIORI_AGENT_MOCK=true` and select the test model in the board assistant settings. For Ollama, start a local server with the configured model available. Docker Desktop can reach it using `SHIORI_OLLAMA_URL=http://host.docker.internal:11434`.

The worker persists claims, leases, retry deadlines, and results in PostgreSQL. File tasks and the assistant use separate polling loops. Job payloads and artifacts expire after 24 hours by default, with stored-byte limits of 512 MiB per deployment and 96 MiB per actor. Private board images are accessed through the application with current board permissions. Board ZIPs carry authorized private images, and PNG exports and workbench thumbnails use the selected light or dark theme.

The assistant uses an independently deployed Python service. Add a fixed HTTPS adapter for an external Agent or mount a versioned workflow pack to update guidance. [Board assistant](/guide/board-assistant) · [External Agent and workflow guides](/guide/agent-connector)

## Data Persistence

Use the same Compose project name on upgrades to keep using these volumes:
- `postgres_data` - Database files
- `redis_data` - Redis persistence
- `seaweed_data` - Private S3 objects
- `minio_data` - Uploaded files

For a consistent instance backup, capture PostgreSQL and SeaweedFS during the same maintenance window. Follow [Create an instance backup](./operations.md#create-an-instance-backup).

## Development Services Only

For local development, use the dev Compose file to start PostgreSQL, Redis and SeaweedFS on loopback ports 5432, 6379 and 8333. Use a distinct Compose project name to run the dev and full stacks independently.

```bash
docker compose -f docker-compose.dev.yml up -d
```

Then run the backend and frontend locally (see [Getting Started](/guide/getting-started)).
Run `go run . worker` from `server/` in a second process to enable file and assistant jobs.
