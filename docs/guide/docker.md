# Docker Deployment

OpenJam provides a multi-stage Dockerfile and Docker Compose configuration for production deployment.

## Production Deployment

```bash
# Clone and configure
git clone https://github.com/xiaotwu/openjam.git
cd openjam
cp .env.example .env

# Edit .env - set at minimum:
# - SESSION_SECRET (generate with: openssl rand -hex 32)
# - CORS_ORIGINS (your domain)

# Build and start
docker compose up --build -d
```

The application will be available at `http://localhost:8080`.

## Services

The Docker Compose setup includes:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `server` | Built from Dockerfile | 8080 | Go backend + frontend static files |
| `postgres` | postgres:16-alpine | 5432 | Primary database |
| `redis` | redis:7-alpine | 6379 | Session cache, pub/sub |
| `minio` | minio/minio | 9000, 9001 | File/image storage |

## Health Checks

All services include health checks:
- **PostgreSQL**: `pg_isready`
- **Redis**: `redis-cli ping`
- **Server**: `curl http://localhost:8080/health`

## Data Persistence

Data is stored in Docker volumes:
- `postgres_data` - Database files
- `redis_data` - Redis persistence
- `minio_data` - Uploaded files

To back up:
```bash
docker compose exec postgres pg_dump -U postgres openjam > backup.sql
```

## Development Services Only

For local development, use the dev compose file which only starts dependency services:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Then run the backend and frontend locally (see [Getting Started](/guide/getting-started)).
