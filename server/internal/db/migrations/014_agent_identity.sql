CREATE TABLE agent_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) <= 48),
    kind TEXT NOT NULL CHECK (kind IN ('ring', 'glyph', 'image', 'pet')),
    glyph TEXT NOT NULL CHECK (glyph IN ('', 'orbit', 'diamond', 'dot', 'sparkle')),
    image_png BYTEA CHECK (octet_length(image_png) <= 245760),
    CHECK ((kind = 'glyph') = (glyph <> '')),
    CHECK ((kind IN ('image', 'pet')) = (image_png IS NOT NULL))
);

CREATE TABLE board_agent_attributions (
    board_id VARCHAR(36) NOT NULL REFERENCES board_heads(board_id) ON DELETE CASCADE,
    element_id TEXT NOT NULL,
    run_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    actor_name VARCHAR(255) NOT NULL,
    agent_name TEXT NOT NULL CHECK (char_length(agent_name) <= 48),
    glyph TEXT NOT NULL CHECK (glyph IN ('', 'orbit', 'diamond', 'dot', 'sparkle')),
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY (board_id, element_id)
);

-- Reuse retained, authoritative changes for drafts applied before attribution.
INSERT INTO board_agent_attributions
    (board_id, element_id, run_id, actor_id, actor_name, agent_name, glyph, created_at_ms)
SELECT j.board_id, operation->>'id', j.id, j.actor_id, u.display_name, '', '',
    (operation->'value'->>'createdAt')::BIGINT
FROM agent_runs r
JOIN jobs j ON j.id = r.job_id
JOIN users u ON u.id = j.actor_id
JOIN board_changes c ON c.board_id = j.board_id AND c.epoch = r.applied_epoch AND c.seq = r.applied_seq
CROSS JOIN LATERAL jsonb_array_elements(c.payload->'operations') AS operation
WHERE c.payload->>'commandId' = j.id::TEXT
    AND operation->>'collection' = 'elements'
    AND operation->>'kind' = 'upsert'
    AND operation->'value'->>'createdAt' ~ '^[0-9]{1,16}$'
ON CONFLICT DO NOTHING;
