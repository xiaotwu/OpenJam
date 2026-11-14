CREATE TABLE jobs (
    id UUID PRIMARY KEY,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id VARCHAR(36) REFERENCES rooms(id) ON DELETE CASCADE,
    kind VARCHAR(48) NOT NULL,
    request_id UUID NOT NULL,
    fingerprint BYTEA NOT NULL CHECK (octet_length(fingerprint) = 32),
    status VARCHAR(16) NOT NULL CHECK (status IN ('queued', 'running', 'awaiting_input', 'succeeded', 'failed', 'cancelled', 'expired')),
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 8),
    manual_retries INTEGER NOT NULL DEFAULT 0 CHECK (manual_retries BETWEEN 0 AND 2),
    available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    error_code VARCHAR(64),
    payload BYTEA,
    input BYTEA,
    input_expires_at TIMESTAMPTZ NOT NULL,
    result BYTEA,
    artifact BYTEA,
    artifact_content_type TEXT,
    artifact_filename TEXT,
    artifact_sha256 TEXT,
    output_expires_at TIMESTAMPTZ,
    cached_bytes INTEGER GENERATED ALWAYS AS (
        coalesce(octet_length(payload), 0) + coalesce(octet_length(input), 0) +
        coalesce(octet_length(result), 0) + coalesce(octet_length(artifact), 0)
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (actor_id, kind, request_id),
    CHECK ((status = 'running') = (lease_token IS NOT NULL)),
    CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
    CHECK ((artifact IS NULL) = (artifact_content_type IS NULL)),
    CHECK ((artifact IS NULL) = (artifact_filename IS NULL)),
    CHECK ((artifact IS NULL) = (artifact_sha256 IS NULL)),
    CHECK (artifact IS NULL OR (status = 'succeeded' AND output_expires_at IS NOT NULL)),
    CHECK (result IS NULL OR output_expires_at IS NOT NULL)
);

CREATE INDEX jobs_ready_idx ON jobs (kind, available_at, created_at, id) WHERE status = 'queued';
CREATE INDEX jobs_lease_idx ON jobs (kind, lease_until) WHERE status = 'running';
CREATE INDEX jobs_actor_scope_idx ON jobs (actor_id, board_id, created_at DESC, id DESC);
CREATE INDEX jobs_board_artifact_idx ON jobs (board_id, kind, request_id) WHERE artifact IS NOT NULL;
CREATE INDEX jobs_active_idx ON jobs (actor_id) WHERE status IN ('queued', 'running', 'awaiting_input');
CREATE INDEX jobs_cache_idx ON jobs (actor_id) WHERE cached_bytes > 0;
CREATE INDEX jobs_input_expiry_idx ON jobs (input_expires_at) WHERE payload IS NOT NULL OR input IS NOT NULL OR status IN ('queued', 'running', 'awaiting_input');
CREATE INDEX jobs_output_expiry_idx ON jobs (output_expires_at) WHERE result IS NOT NULL OR artifact IS NOT NULL;
