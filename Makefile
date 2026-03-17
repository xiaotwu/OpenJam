.PHONY: dev build clean docker frontend backend

# Build the complete application (single binary)
build: frontend backend
	@echo "\u2705 Build complete: ./openjam-server"

# Build frontend assets
frontend:
	cd app && bun install && bun run build

# Copy dist into server and build Go binary with embed
backend:
	rm -rf server/static && cp -r app/dist server/static
	cd server && CGO_ENABLED=0 go build -ldflags="-s -w" -o ../openjam-server .
	rm -rf server/static

# Start dev environment (requires docker-compose.dev.yml services running)
dev:
	@echo "Starting dev servers..."
	@echo "Run: docker compose -f docker-compose.dev.yml up -d"
	@echo "Then in separate terminals:"
	@echo "  cd server && go run main.go"
	@echo "  cd app && bun run dev"

# Docker compose build and up
docker:
	docker compose up --build -d

# Clean build artifacts
clean:
	rm -f openjam-server
	rm -rf server/static
	rm -rf app/dist
	rm -rf app/node_modules
