CREATE TABLE team_members (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX team_members_active_user ON team_members (user_id, organization_id) WHERE revoked_at IS NULL;

CREATE TABLE team_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(btrim(email))),
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX team_invitations_pending_email ON team_invitations (organization_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('manager', 'edit', 'comment', 'view')),
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_members_user ON project_members (user_id, project_id);

CREATE FUNCTION openjam_team_role(target UUID, actor UUID) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN o.owner_id = actor THEN 'owner' ELSE m.role END
    FROM organizations o
    LEFT JOIN team_members m ON m.organization_id = o.id AND m.user_id = actor AND m.revoked_at IS NULL
    WHERE o.id = target AND o.kind = 'team'
$$;

CREATE FUNCTION openjam_project_role(target UUID, actor UUID) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN o.owner_id = actor THEN 'manager' ELSE pm.role END
    FROM projects p
    JOIN workspaces w ON w.id = p.workspace_id
    JOIN organizations o ON o.id = w.organization_id
    LEFT JOIN team_members tm ON o.kind = 'team' AND tm.organization_id = o.id
        AND tm.user_id = actor AND tm.revoked_at IS NULL
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = tm.user_id
    WHERE p.id = target
$$;

-- The board's original owner remains its owner outside a Team. Inside a Team,
-- Project Managers manage the board and the original owner is retained as metadata.
CREATE FUNCTION openjam_board_access(target VARCHAR, actor UUID)
RETURNS TABLE(permission TEXT, source TEXT)
LANGUAGE sql STABLE AS $$
    SELECT effective.permission, effective.source
    FROM rooms r
    LEFT JOIN board_directory d ON d.room_id = r.id
    LEFT JOIN projects p ON p.id = d.project_id
    LEFT JOIN workspaces w ON w.id = p.workspace_id
    LEFT JOIN organizations o ON o.id = w.organization_id AND o.kind = 'team'
    LEFT JOIN team_members tm ON tm.organization_id = o.id AND tm.user_id = actor
    LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = actor
    LEFT JOIN board_live_link_grants g ON g.room_id = r.id AND g.user_id = actor AND rm.user_id IS NULL
    LEFT JOIN room_share_settings rss ON rss.room_id = r.id AND rss.legacy_access_expires_at > statement_timestamp()
    LEFT JOIN LATERAL (
        SELECT CASE WHEN o.id IS NOT NULL THEN openjam_project_role(p.id, actor) END AS role
    ) project ON true
    LEFT JOIN LATERAL (
        SELECT candidate.permission, candidate.source
        FROM (VALUES
            (CASE WHEN (o.id IS NULL AND r.owner_id = actor) OR project.role = 'manager' THEN 'owner' END,
                CASE WHEN o.id IS NULL THEN 'owner' ELSE 'project' END, 1),
            (rm.permission, 'member', 2),
            (project.role, 'project', 3),
            (g.permission, 'link', 4),
            (CASE rss.link_permission
                WHEN 'anyone-view' THEN 'view'
                WHEN 'anyone-comment' THEN 'comment'
                WHEN 'anyone-edit' THEN 'edit' END, 'legacy-link', 5)
        ) AS candidate(permission, source, preference)
        WHERE candidate.permission IS NOT NULL AND candidate.permission <> 'manager'
        ORDER BY CASE WHEN candidate.source = 'legacy-link' THEN 0 ELSE
            CASE candidate.permission WHEN 'owner' THEN 4 WHEN 'edit' THEN 3 WHEN 'comment' THEN 2 ELSE 1 END
        END DESC, candidate.preference
        LIMIT 1
    ) effective ON tm.revoked_at IS NULL OR o.owner_id = actor
    WHERE r.id = target
$$;

-- A legacy open link authorizes a direct visit. It does not advertise the
-- board in the directory to every signed-in account.
CREATE FUNCTION openjam_visible_boards(actor UUID)
RETURNS TABLE(board_id VARCHAR, permission TEXT)
LANGUAGE sql STABLE AS $$
    WITH candidates AS (
        SELECT id AS room_id FROM rooms WHERE owner_id = actor
        UNION
        SELECT room_id FROM room_members WHERE user_id = actor
        UNION
        SELECT room_id FROM board_live_link_grants WHERE user_id = actor
        UNION
        SELECT d.room_id FROM organizations o
        JOIN workspaces w ON w.organization_id = o.id
        JOIN projects p ON p.workspace_id = w.id
        JOIN board_directory d ON d.project_id = p.id
        WHERE o.kind = 'team' AND o.owner_id = actor
        UNION
        SELECT d.room_id FROM project_members pm
        JOIN board_directory d ON d.project_id = pm.project_id
        WHERE pm.user_id = actor
    )
    SELECT c.room_id, a.permission
    FROM candidates c
    CROSS JOIN LATERAL openjam_board_access(c.room_id, actor) a
    WHERE a.permission IS NOT NULL AND a.source <> 'legacy-link'
$$;
