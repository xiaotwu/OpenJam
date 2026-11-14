# Configuration

Configure Compose with the `.env.example` from the release bundle or source checkout. To run the API and worker outside Compose, start from `server/.env.example` and use the credentials and bucket from your stores.

## Environment Variables

### Server

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | HTTP server port | `8080` | No |
| `SHIORI_BIND_HOST` | Interface to bind the HTTP server to | All interfaces | No |
| `ENVIRONMENT` | `development` or `production` | `development` | No |
| `SHIORI_AUTO_MIGRATE` | Apply database migrations during API startup | `true` | No |

### Database

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Legacy fallback if unset | Set for manual deployments |
| `REDIS_URL` | Redis connection string | _(empty)_ | No |

### Security

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SHIORI_TRUSTED_PROXIES` | Comma-separated trusted proxy addresses or CIDRs for client IP forwarding | _(empty)_ | No |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:5173` | Yes (production) |

### S3-compatible object storage

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MINIO_ENDPOINT` | S3 server endpoint | `localhost:8333` or `seaweedfs:8333` in Compose | No |
| `MINIO_ACCESS_KEY` | MinIO access key | `minioadmin` | No |
| `MINIO_SECRET_KEY` | MinIO secret key | `minioadmin` | No |
| `MINIO_USE_SSL` | Use SSL for MinIO | `false` | No |
| `MINIO_BUCKET` | Storage bucket name | `shiori` in the fresh-install example | Set to match the store |

## Example `.env` File

```bash
PORT=8080
ENVIRONMENT=development

DATABASE_URL=postgres://shiori:replace-with-a-random-database-secret@localhost:5432/shiori?sslmode=disable
REDIS_URL=redis://localhost:6379

CORS_ORIGINS=http://localhost:5173

MINIO_ENDPOINT=localhost:8333
MINIO_ACCESS_KEY=shiori
MINIO_SECRET_KEY=replace-with-a-random-storage-secret
MINIO_USE_SSL=false
MINIO_BUCKET=shiori

SHIORI_AUTO_MIGRATE=true
```

When a deployment runs `shiori-server migrate` separately, start the API with `SHIORI_AUTO_MIGRATE=false`. The API checks the installed schema before opening its listener. Use `/startupz` and `/livez` for process probes and `/readyz` to check database connectivity and shutdown state.

## Compatibility with earlier deployments

Keep the original Compose project name, database, bucket, and credentials when upgrading. When those names are unset, the legacy database and bucket default is `openjam`.

`SHIORI_*` settings take precedence over the corresponding `OPENJAM_*` aliases. Runtime variables also take precedence when explicitly empty, after which each setting applies its default or validation. Compose image tags, published addresses and ports, and the required Meetings secret use the first nonempty value. Compose passes both names to the server so a previous image can read the same resolved settings during rollback.

### Worker and model settings

| Variable | Purpose |
|----------|---------|
| `SHIORI_JOB_LEASE_SECONDS` | Worker lease duration in seconds. Default 30 |
| `SHIORI_AGENT_URL` | Internal provider service origin, for example `http://agent:8091` |
| `SHIORI_AGENT_TOKEN` | Shared 32–512 character service secret |
| `SHIORI_OPENAI_MODEL` | Deployment-approved model that supports structured outputs |
| `OPENAI_API_KEY` | OpenAI credential supplied to the Python service |
| `SHIORI_OLLAMA_MODEL` | Model available on the configured local Ollama server |
| `SHIORI_OLLAMA_URL` | Local Ollama origin. The service resolves the origin to a private or loopback address |
| `SHIORI_EXTERNAL_AGENT_MODEL` | Deployment-approved identifier for one external HTTPS adapter |
| `SHIORI_EXTERNAL_AGENT_LABEL` | Optional user-facing connector name |
| `SHIORI_EXTERNAL_AGENT_URL` | Fixed HTTPS route that accepts the Shiori connector contract |
| `SHIORI_EXTERNAL_AGENT_TOKEN` | Adapter bearer secret supplied to the Python service |
| `SHIORI_AGENT_PROMPT_PACK` | Optional read-only mounted JSON workflow pack in the Python service |
| `SHIORI_AGENT_MOCK` | Enables `deterministic-v1` for synthetic runs. Default false |

Organization owners can enable the assistant and choose a configured provider from the board assistant panel. Cloud runs require the editor's confirmation. The setting for selected board text is separate from consent to send the typed prompt.

## Frontend Configuration

The frontend reads these settings at build time.

| Variable | Description | Default |
|----------|-------------|---------|
| `SHIORI_API_URL` | Backend API base URL | _(empty, uses same origin)_ |
| `SHIORI_WS_URL` | WebSocket URL | _(auto-detected from page URL)_ |
| `SHIORI_BUILD` | Optional version or source revision displayed in About. Pass `--build-arg SHIORI_BUILD=<revision>` for a Docker build. | _(empty)_ |

The API and WebSocket URL settings are only needed when running the frontend on a different origin than the backend. `VITE_API_URL` and `VITE_WS_URL` remain accepted when the corresponding Shiori setting is unset.
