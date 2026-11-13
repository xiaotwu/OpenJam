FROM --platform=$BUILDPLATFORM oven/bun:1.3.3-alpine@sha256:d2bc1fbc3afcd3d70afc2bb2544235bf559caae2a3084e9abed126e233797511 AS bun

FROM --platform=$BUILDPLATFORM node:24.22.2-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS frontend
WORKDIR /src/app
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile
COPY app/ ./

FROM frontend AS frontend-test
RUN bun run test

FROM frontend AS frontend-build
ARG SHIORI_BUILD
ENV SHIORI_BUILD=$SHIORI_BUILD
RUN bun run build

FROM --platform=$BUILDPLATFORM golang:1.25.14-alpine@sha256:1ae0735f00daffa3aaf1363a5184c0d2dc55c78e3db4ec70241cdac97bf84b59 AS backend
ENV GOTOOLCHAIN=local
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=frontend-build /src/app/dist/ ./static/

FROM backend AS backend-test
RUN CGO_ENABLED=0 go test -mod=readonly ./...

FROM backend AS backend-build
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build \
    -mod=readonly -trimpath -buildvcs=false -ldflags="-s -w" -o /shiori-server .

FROM alpine:3.23.8@sha256:469c9ea410b9215eaee7976ba6c0639039b444be8e5d638f7abbada189971eb2
WORKDIR /app
RUN apk add --no-cache font-noto-cjk=0_git20220127-r1
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=backend-build /shiori-server /usr/local/bin/shiori
RUN ln -s /usr/local/bin/shiori /usr/local/bin/openjam
USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
    CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-8080}/readyz" || exit 1

ENTRYPOINT ["/usr/local/bin/shiori"]
CMD ["api"]
