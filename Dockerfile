FROM node:20-alpine AS frontend-builder

WORKDIR /app

RUN npm install -g bun

COPY app/package.json app/bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY app/ ./

RUN bun run build

FROM golang:1.22-alpine AS backend-builder

WORKDIR /app

RUN apk add --no-cache git

COPY server/go.mod server/go.sum* ./
RUN go mod download

COPY server/ ./

RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine:3.19

WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY --from=backend-builder /app/server .

COPY --from=frontend-builder /app/dist ./static

EXPOSE 8080

CMD ["./server"]
