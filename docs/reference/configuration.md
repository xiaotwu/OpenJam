# Configuration

Shiori is configured via environment variables. For local development, use a `.env` file in the `server/` directory.

Existing deployments can keep their `OPENJAM_*` settings. Runtime settings prefer `SHIORI_*` when set, including an explicit empty value. Each setting then applies its usual default or validation. Compose image tags, published addresses and ports, and the required secret in the Meetings overlay use the first nonempty value. Compose supplies both runtime names from the same resolved value so the prior image can run during rollback. Keep the existing Compose project, database, and bucket when upgrading.

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
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable` | Yes |
| `REDIS_URL` | Redis connection string | _(empty)_ | No |

### Security

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SHIORI_TRUSTED_PROXIES` | Comma-separated trusted proxy addresses or CIDRs for client IP forwarding | _(empty)_ | No |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:5173` | Yes (production) |

### Storage (MinIO / S3)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MINIO_ENDPOINT` | S3 server endpoint | `localhost:8333` or `seaweedfs:8333` in Compose | No |
| `MINIO_ACCESS_KEY` | MinIO access key | `minioadmin` | No |
| `MINIO_SECRET_KEY` | MinIO secret key | `minioadmin` | No |
| `MINIO_USE_SSL` | Use SSL for MinIO | `false` | No |
| `MINIO_BUCKET` | Storage bucket name | `openjam` | No |

## Example `.env` File

```bash
PORT=8080
ENVIRONMENT=development

DATABASE_URL=postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable
REDIS_URL=redis://localhost:6379

CORS_ORIGINS=http://localhost:5173

MINIO_ENDPOINT=localhost:8333
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

SHIORI_AUTO_MIGRATE=true
```

When a deployment runs `shiori-server migrate` separately, start the API with `SHIORI_AUTO_MIGRATE=false`. The API checks the installed schema before opening its listener. Use `/startupz` and `/livez` for process probes and `/readyz` to check database connectivity and shutdown state.

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
