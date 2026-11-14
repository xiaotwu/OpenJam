ALTER TABLE board_versions
    ADD COLUMN imported_author TEXT NOT NULL DEFAULT '',
    ADD COLUMN imported_participants TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE project_versions ADD COLUMN imported_author TEXT NOT NULL DEFAULT '';

CREATE TABLE project_archive_restores (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
    PRIMARY KEY (workspace_id, actor_id, request_id)
);
