CREATE TABLE workshop_threads (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    recipient_id UUID REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('team', 'direct')),
    subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 140),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX workshop_threads_team_updated ON workshop_threads (team_id, updated_at DESC, id);

CREATE TABLE workshop_messages (
    thread_id UUID NOT NULL REFERENCES workshop_threads(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 6000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (thread_id, id),
    UNIQUE (thread_id, sequence)
);

CREATE TABLE workshop_thread_state (
    thread_id UUID NOT NULL REFERENCES workshop_threads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_through BIGINT NOT NULL DEFAULT 0 CHECK (read_through >= 0),
    pinned_at TIMESTAMPTZ,
    PRIMARY KEY (thread_id, user_id)
);

CREATE FUNCTION openjam_workshop_thread_visible(thread workshop_threads, actor UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT openjam_team_role(thread.team_id, actor) IS NOT NULL
        AND (thread.kind = 'team' OR actor IN (thread.creator_id, thread.recipient_id))
$$;

CREATE TABLE workshop_recents (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id VARCHAR(36) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, board_id)
);

CREATE INDEX workshop_recents_user_time ON workshop_recents (user_id, opened_at DESC, board_id);

CREATE TABLE workshop_agenda (
    id UUID PRIMARY KEY,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    team_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('event', 'task')),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
    notes TEXT NOT NULL DEFAULT '' CHECK (octet_length(notes) <= 3600),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT false,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    CHECK (ends_at >= starts_at),
    CHECK (team_id IS NULL OR project_id IS NULL),
    CHECK (kind = 'task' OR NOT completed)
);

CREATE INDEX workshop_agenda_time ON workshop_agenda (starts_at, id);
CREATE INDEX workshop_agenda_creator ON workshop_agenda (creator_id, starts_at);
CREATE INDEX workshop_agenda_team ON workshop_agenda (team_id, starts_at);
CREATE INDEX workshop_agenda_project ON workshop_agenda (project_id, starts_at);

CREATE FUNCTION openjam_agenda_visible(item workshop_agenda, actor UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN item.project_id IS NOT NULL THEN openjam_project_role(item.project_id, actor) IS NOT NULL
        WHEN item.team_id IS NOT NULL THEN openjam_team_role(item.team_id, actor) IS NOT NULL
        ELSE coalesce(item.creator_id = actor, false)
    END
$$;

CREATE FUNCTION openjam_agenda_editable(item workshop_agenda, actor UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN item.project_id IS NOT NULL THEN coalesce(openjam_project_role(item.project_id, actor) = 'manager'
            OR (item.creator_id = actor AND openjam_project_role(item.project_id, actor) = 'edit'), false)
        WHEN item.team_id IS NOT NULL THEN coalesce(openjam_team_role(item.team_id, actor) IN ('owner', 'admin')
            OR (item.creator_id = actor AND openjam_team_role(item.team_id, actor) = 'member'), false)
        ELSE coalesce(item.creator_id = actor, false)
    END
$$;

CREATE INDEX workshop_board_mentions_user_time ON board_comment_notifications (user_id, created_at DESC);
