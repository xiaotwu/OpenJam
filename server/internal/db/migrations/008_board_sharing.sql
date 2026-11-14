ALTER TABLE room_share_settings ADD COLUMN legacy_access_expires_at TIMESTAMPTZ;

-- Preserve the pre-upgrade link behavior for a bounded transition. New
-- links carry a separate credential and never grant edit access.
UPDATE room_share_settings
SET legacy_access_expires_at = statement_timestamp() + INTERVAL '30 days'
WHERE link_permission <> 'restricted';

CREATE TABLE board_share_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id VARCHAR(36) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(btrim(email))),
    permission VARCHAR(12) NOT NULL CHECK (permission IN ('view', 'comment', 'edit')),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
    accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX board_share_invitations_room_created_idx ON board_share_invitations (room_id, created_at DESC, id);
CREATE INDEX board_share_invitations_pending_email_idx ON board_share_invitations (room_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE board_share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id VARCHAR(36) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    permission VARCHAR(12) NOT NULL CHECK (permission IN ('view', 'comment')),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
    revoked_at TIMESTAMPTZ,
    UNIQUE (room_id, id)
);

CREATE INDEX board_share_links_room_created_idx ON board_share_links (room_id, created_at DESC, id);

CREATE TABLE board_share_link_grants (
    room_id VARCHAR(36) NOT NULL,
    link_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (link_id, user_id),
    FOREIGN KEY (room_id, link_id) REFERENCES board_share_links(room_id, id) ON DELETE CASCADE
);

CREATE INDEX board_share_link_grants_user_room_idx ON board_share_link_grants (user_id, room_id);

CREATE VIEW board_live_link_grants AS
SELECT g.room_id, g.user_id,
    CASE WHEN bool_or(l.permission = 'comment') THEN 'comment' ELSE 'view' END AS permission
FROM board_share_link_grants g
JOIN board_share_links l ON l.room_id = g.room_id AND l.id = g.link_id
WHERE l.revoked_at IS NULL AND l.expires_at > statement_timestamp()
GROUP BY g.room_id, g.user_id;
