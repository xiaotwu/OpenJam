ALTER TABLE board_elements ADD COLUMN deleted_by UUID;
ALTER TABLE board_elements ADD COLUMN deleted_client_id UUID;

CREATE INDEX idx_board_pages_live_order ON board_pages (board_id, position, id) WHERE NOT deleted;
CREATE INDEX idx_board_elements_live_order ON board_elements (board_id, position, id) WHERE NOT deleted;
CREATE INDEX idx_board_stamps_live_order ON board_stamps (board_id, position, id) WHERE NOT deleted;

CREATE TABLE board_changes (
    board_id VARCHAR(36) NOT NULL REFERENCES board_heads(board_id) ON DELETE CASCADE,
    seq BIGINT NOT NULL CHECK (seq > 0),
    epoch BIGINT NOT NULL CHECK (epoch > 0),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_bytes BIGINT NOT NULL CHECK (payload_bytes > 0),
    committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (board_id, seq)
);

CREATE INDEX idx_board_changes_epoch_seq ON board_changes (board_id, epoch, seq);

CREATE TABLE board_command_receipts (
    board_id VARCHAR(36) NOT NULL REFERENCES board_heads(board_id) ON DELETE CASCADE,
    actor_id UUID NOT NULL,
    client_id UUID NOT NULL,
    command_id UUID NOT NULL,
    epoch BIGINT NOT NULL CHECK (epoch > 0),
    seq BIGINT NOT NULL CHECK (seq > 0),
    digest BYTEA NOT NULL CHECK (octet_length(digest) = 32),
    committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (board_id, client_id, command_id)
);
