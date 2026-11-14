ALTER TABLE board_directory ADD COLUMN file_key UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE board_directory ADD UNIQUE (project_id, file_key);

CREATE TABLE project_sync_links (
    team_project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    personal_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    CHECK (team_project_id <> personal_project_id)
);

CREATE INDEX project_sync_links_personal ON project_sync_links (personal_project_id);

CREATE TABLE project_sync_base (
    team_project_id UUID NOT NULL REFERENCES project_sync_links(team_project_id) ON DELETE CASCADE,
    file_key UUID NOT NULL,
    personal_state TEXT NOT NULL CHECK (length(personal_state) <= 65),
    team_state TEXT NOT NULL CHECK (length(team_state) <= 65),
    PRIMARY KEY (team_project_id, file_key)
);

CREATE TABLE project_versions (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    kind TEXT NOT NULL CHECK (kind IN ('named', 'imported', 'before_sync', 'pulled', 'pushed', 'before_restore', 'restored')),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (id, project_id)
);

CREATE INDEX project_versions_history ON project_versions (project_id, created_at DESC, id DESC);

-- Keep the document independent of its live room, so a deleted file can be
-- restored. Successive project versions share unchanged document payloads.
CREATE TABLE project_version_documents (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    digest TEXT NOT NULL CHECK (length(digest) = 64),
    document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    PRIMARY KEY (project_id, digest)
);

CREATE TABLE project_version_assets (
    project_id UUID NOT NULL,
    digest TEXT NOT NULL,
    asset_id TEXT NOT NULL REFERENCES asset_blobs(id),
    PRIMARY KEY (project_id, digest, asset_id),
    FOREIGN KEY (project_id, digest) REFERENCES project_version_documents(project_id, digest) ON DELETE CASCADE
);

CREATE INDEX project_version_assets_blob ON project_version_assets (asset_id);

CREATE TABLE project_version_files (
    version_id UUID NOT NULL,
    project_id UUID NOT NULL,
    file_key UUID NOT NULL,
    resource_kind TEXT NOT NULL CHECK (resource_kind IN ('board', 'doc', 'sheet', 'slides')),
    digest TEXT NOT NULL,
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (version_id, file_key),
    FOREIGN KEY (version_id, project_id) REFERENCES project_versions(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, digest) REFERENCES project_version_documents(project_id, digest) ON DELETE CASCADE
);

CREATE TABLE project_operation_receipts (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
    result JSONB NOT NULL,
    PRIMARY KEY (project_id, request_id)
);
