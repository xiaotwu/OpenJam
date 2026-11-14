CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('personal', 'team'))
);

CREATE INDEX idx_organizations_owner_id ON organizations(owner_id);
CREATE UNIQUE INDEX idx_organizations_personal_owner ON organizations(owner_id) WHERE kind = 'personal';

CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_workspaces_organization_id ON workspaces(organization_id);
CREATE UNIQUE INDEX idx_workspaces_default ON workspaces(organization_id) WHERE is_default;

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_projects_workspace_id ON projects(workspace_id);
CREATE UNIQUE INDEX idx_projects_default ON projects(workspace_id) WHERE is_default;

CREATE TABLE board_directory (
    room_id VARCHAR(36) PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    archived_at TIMESTAMPTZ
);

CREATE INDEX idx_board_directory_project_id ON board_directory(project_id);

CREATE TABLE board_favorites (
    room_id VARCHAR(36) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX idx_board_favorites_user_id ON board_favorites(user_id);
