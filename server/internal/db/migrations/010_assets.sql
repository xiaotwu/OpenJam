CREATE TABLE asset_blobs (
    id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
    size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
    ready BOOLEAN NOT NULL DEFAULT FALSE,
    staged_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (width::bigint * height <= 16777216)
);

CREATE TABLE board_assets (
    board_id VARCHAR(36) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES asset_blobs(id),
    PRIMARY KEY (board_id, asset_id)
);

CREATE INDEX board_assets_blob_idx ON board_assets (asset_id);
CREATE INDEX asset_blobs_staged_idx ON asset_blobs (staged_at, id);
