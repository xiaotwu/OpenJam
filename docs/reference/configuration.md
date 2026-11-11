# Configuration

OpenJam is configured via environment variables. For local development, use a `.env` file in the `server/` directory.

## Environment Variables

### Server

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | HTTP server port | `8080` | No |
| `ENVIRONMENT` | `development` or `production` | `development` | No |

### Database

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable` | Yes |
| `REDIS_URL` | Redis connection string | _(empty)_ | No |

### Security

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SESSION_SECRET` | Secret key for session management | _(insecure default)_ | Yes (production) |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:5173` | Yes (production) |

### Storage (MinIO / S3)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MINIO_ENDPOINT` | MinIO server endpoint | `localhost:9000` | No |
| `MINIO_ACCESS_KEY` | MinIO access key | `minioadmin` | No |
| `MINIO_SECRET_KEY` | MinIO secret key | `minioadmin` | No |
| `MINIO_USE_SSL` | Use SSL for MinIO | `false` | No |
| `MINIO_BUCKET` | Storage bucket name | `openjam-exports` | No |

## Example `.env` File

```bash
PORT=8080
ENVIRONMENT=development

DATABASE_URL=postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable
REDIS_URL=redis://localhost:6379

CORS_ORIGINS=http://localhost:5173

MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

SESSION_SECRET=your-secret-key-change-in-production
```

## Frontend Configuration

The frontend supports these Vite environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API base URL | _(empty, uses same origin)_ |
| `VITE_WS_URL` | WebSocket URL | _(auto-detected from page URL)_ |

These are only needed when running the frontend on a different origin than the backend.
