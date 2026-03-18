# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Install bun for faster builds
RUN npm install -g bun

# Copy package files first for better layer caching
COPY app/package.json app/bun.lock* app/package-lock.json* ./
RUN bun install --frozen-lockfile || bun install

COPY app/ ./

RUN bun run build

# Stage 2: Build Backend
FROM golang:1.22-alpine AS backend-builder

WORKDIR /app

RUN apk add --no-cache git

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# Stage 3: Production Runtime
FROM alpine:3.19

WORKDIR /app

RUN apk add --no-cache ca-certificates curl

COPY --from=backend-builder /app/server .
COPY --from=frontend-builder /app/dist ./static

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["./server"]
