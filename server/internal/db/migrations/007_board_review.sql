CREATE TABLE board_comment_threads (
    board_id VARCHAR(36) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    created_by UUID NOT NULL,
    page_id TEXT NOT NULL,
    page_name TEXT NOT NULL,
    element_id TEXT,
    anchor_x DOUBLE PRECISION,
    anchor_y DOUBLE PRECISION,
    comment_count INTEGER NOT NULL DEFAULT 1 CHECK (comment_count >= 1),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (board_id, id),
    CHECK ((anchor_x IS NULL) = (anchor_y IS NULL)),
    CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);

CREATE INDEX board_review_threads_created ON board_comment_threads (board_id, created_at DESC, id DESC);

CREATE TABLE board_comments (
    board_id VARCHAR(36) NOT NULL,
    thread_id UUID NOT NULL,
    id UUID NOT NULL,
    author_id UUID NOT NULL,
    body TEXT NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 8000),
    mention_user_ids UUID[] NOT NULL DEFAULT '{}',
    request_digest BYTEA NOT NULL CHECK (octet_length(request_digest) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (board_id, id),
    FOREIGN KEY (board_id, thread_id) REFERENCES board_comment_threads(board_id, id) ON DELETE CASCADE
);

CREATE INDEX board_review_comments_thread ON board_comments (board_id, thread_id, created_at, id);

CREATE TABLE board_comment_notifications (
    board_id VARCHAR(36) NOT NULL,
    comment_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    read_at TIMESTAMPTZ,
    PRIMARY KEY (board_id, comment_id, user_id),
    FOREIGN KEY (board_id, comment_id) REFERENCES board_comments(board_id, id) ON DELETE CASCADE
);

CREATE INDEX board_review_notifications_user ON board_comment_notifications (board_id, user_id, created_at DESC, comment_id DESC);
CREATE INDEX board_review_notifications_unread ON board_comment_notifications (board_id, user_id) WHERE read_at IS NULL;
