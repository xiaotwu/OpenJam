CREATE TABLE board_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id VARCHAR(36) NOT NULL,
    epoch BIGINT NOT NULL CHECK (epoch > 0),
    seq BIGINT NOT NULL CHECK (seq >= 0),
    snapshot_reason TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('checkpoint', 'named', 'before_restore', 'restored')),
    name VARCHAR(120) NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    participant_ids UUID[] NOT NULL DEFAULT '{}',
    source_version_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (board_id, epoch, seq, snapshot_reason)
        REFERENCES board_snapshots(board_id, epoch, seq, reason) ON DELETE CASCADE
);

CREATE INDEX idx_board_versions_history ON board_versions (board_id, created_at DESC, id DESC);
CREATE INDEX idx_board_versions_checkpoint ON board_versions (board_id, seq DESC)
    WHERE kind = 'checkpoint' AND snapshot_reason = 'version';
CREATE INDEX idx_board_versions_snapshot ON board_versions (board_id, epoch, seq, snapshot_reason);

INSERT INTO board_versions (board_id, epoch, seq, snapshot_reason, kind, name, created_at)
SELECT board_id, epoch, seq, reason, 'checkpoint', 'Initial checkpoint', created_at
FROM board_snapshots WHERE reason = 'migration';

CREATE TABLE board_version_restores (
    board_id VARCHAR(36) NOT NULL REFERENCES board_heads(board_id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    source_version_id UUID NOT NULL,
    expected_epoch BIGINT NOT NULL CHECK (expected_epoch > 0),
    expected_seq BIGINT NOT NULL CHECK (expected_seq >= 0),
    before_version_id UUID NOT NULL REFERENCES board_versions(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES board_versions(id) ON DELETE CASCADE,
    PRIMARY KEY (board_id, request_id)
);
