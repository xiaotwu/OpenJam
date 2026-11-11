# Configuration

OpenJam is configured via environment variables. For local development, use a `.env` file in the `server/` directory.

## Environment Variables

### Server

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | HTTP server port | `8080` | No |
| `OPENJAM_BIND_HOST` | Interface to bind the HTTP server to | All interfaces | No |
| `ENVIRONMENT` | `development` or `production` | `development` | No |
| `OPENJAM_AUTO_MIGRATE` | Apply database migrations during API startup | `true` | No |

### Database

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable` | Yes |
| `REDIS_URL` | Redis connection string | _(empty)_ | No |

### Security

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `OPENJAM_TRUSTED_PROXIES` | Comma-separated trusted proxy addresses or CIDRs for client IP forwarding | _(empty)_ | No |
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

OPENJAM_AUTO_MIGRATE=true
```

When a deployment runs `openjam-server migrate` separately, start the API with `OPENJAM_AUTO_MIGRATE=false`. The API checks the installed schema before opening its listener. Use `/startupz` and `/livez` for process probes and `/readyz` to check database connectivity and shutdown state.

### Worker and model settings

| Variable | Purpose |
|----------|---------|
| `OPENJAM_JOB_LEASE_SECONDS` | Worker lease duration in seconds. Default 30 |
| `OPENJAM_AGENT_URL` | Internal provider service origin, for example `http://agent:8091` |
| `OPENJAM_AGENT_TOKEN` | Shared 32–512 character service secret |
| `OPENJAM_OPENAI_MODEL` | Deployment-approved model that supports structured outputs |
| `OPENAI_API_KEY` | OpenAI credential supplied to the Python service |
| `OPENJAM_OLLAMA_MODEL` | Model available on the configured local Ollama server |
| `OPENJAM_OLLAMA_URL` | Local Ollama origin. The service resolves the origin to a private or loopback address |
| `OPENJAM_EXTERNAL_AGENT_MODEL` | Deployment-approved identifier for one external HTTPS adapter |
| `OPENJAM_EXTERNAL_AGENT_LABEL` | Optional user-facing connector name |
| `OPENJAM_EXTERNAL_AGENT_URL` | Fixed HTTPS route that accepts the OpenJam connector contract |
| `OPENJAM_EXTERNAL_AGENT_TOKEN` | Adapter bearer secret supplied to the Python service |
| `OPENJAM_AGENT_PROMPT_PACK` | Optional read-only mounted JSON workflow pack in the Python service |
| `OPENJAM_AGENT_MOCK` | Enables `deterministic-v1` for synthetic runs. Default false |

Organization owners can enable the assistant and choose a configured provider from the board assistant panel. Cloud runs require the editor's confirmation. The setting for selected board text is separate from consent to send the typed prompt.

## Frontend Configuration

The frontend supports these Vite environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API base URL | _(empty, uses same origin)_ |
| `VITE_WS_URL` | WebSocket URL | _(auto-detected from page URL)_ |

These are only needed when running the frontend on a different origin than the backend.
