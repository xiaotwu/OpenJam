.PHONY: dev build clean docker frontend backend

FRONTEND_OUTPUT_DIR ?= $(CURDIR)/app/dist
OUTPUT ?= $(CURDIR)/shiori-server

build:
	@set -eu; \
		build_dir=$$(mktemp -d "$${TMPDIR:-/tmp}/shiori-build.XXXXXXXX"); \
		trap 'rm -rf "$$build_dir"' EXIT; \
		trap 'exit 130' INT; \
		trap 'exit 143' TERM; \
		$(MAKE) frontend FRONTEND_OUTPUT_DIR="$$build_dir/dist"; \
		$(MAKE) backend FRONTEND_OUTPUT_DIR="$$build_dir/dist"

frontend:
	cd app && bun install --frozen-lockfile && bun run build --outDir "$(FRONTEND_OUTPUT_DIR)"

backend:
	@set -eu; \
		if [ ! -f "$(FRONTEND_OUTPUT_DIR)/index.html" ]; then \
			printf '%s\n' "Frontend build missing. Run make frontend or make build." >&2; \
			exit 1; \
		fi; \
		build_dir=$$(mktemp -d "$${TMPDIR:-/tmp}/shiori-backend.XXXXXXXX"); \
		trap 'rm -rf "$$build_dir"' EXIT; \
		trap 'exit 130' INT; \
		trap 'exit 143' TERM; \
		cp -R server/*.go server/go.mod server/go.sum server/internal "$$build_dir/"; \
		mkdir "$$build_dir/static"; \
		cp -R "$(FRONTEND_OUTPUT_DIR)/." "$$build_dir/static/"; \
		(cd "$$build_dir" && CGO_ENABLED=0 go build -mod=readonly -trimpath -buildvcs=false -ldflags="-s -w" -o shiori-server .); \
		mv "$$build_dir/shiori-server" "$(OUTPUT)"; \
		printf '%s\n' "Build complete: $(OUTPUT)"

dev:
	@printf '%s\n' 'Run docker compose -f docker-compose.dev.yml up -d for local dependencies.' \
		'Run cd server && go run . and cd app && bun run dev in separate terminals.'

docker:
	docker compose up --build -d

clean:
	rm -f "$(OUTPUT)"
