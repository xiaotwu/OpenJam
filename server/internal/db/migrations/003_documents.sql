CREATE TABLE board_heads (
    board_id VARCHAR(36) PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('active', 'legacy')),
    epoch BIGINT NOT NULL CHECK (epoch > 0),
    head_seq BIGINT NOT NULL DEFAULT 0,
    floor_seq BIGINT NOT NULL DEFAULT 0 CHECK (floor_seq >= 0 AND floor_seq <= head_seq),
    default_page_id TEXT NOT NULL,
    extra JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(extra) = 'object')
);

CREATE TABLE board_pages (
    board_id VARCHAR(36) NOT NULL REFERENCES board_heads(board_id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    position BIGINT NOT NULL DEFAULT 0,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (board_id, id)
);

CREATE TABLE board_elements (
    board_id VARCHAR(36) NOT NULL,
    id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    position BIGINT NOT NULL DEFAULT 0,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (board_id, id),
    FOREIGN KEY (board_id, page_id) REFERENCES board_pages(board_id, id) ON DELETE CASCADE
);

CREATE TABLE board_stamps (
    board_id VARCHAR(36) NOT NULL,
    id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    position BIGINT NOT NULL DEFAULT 0,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (board_id, id),
    FOREIGN KEY (board_id, page_id) REFERENCES board_pages(board_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_board_elements_page ON board_elements (board_id, page_id);
CREATE INDEX idx_board_stamps_page ON board_stamps (board_id, page_id);

CREATE TABLE board_snapshots (
    board_id VARCHAR(36) NOT NULL REFERENCES board_heads(board_id) ON DELETE CASCADE,
    epoch BIGINT NOT NULL,
    seq BIGINT NOT NULL,
    reason TEXT NOT NULL,
    document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    digest TEXT NOT NULL CHECK (length(digest) = 64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (board_id, epoch, seq, reason)
);

CREATE TABLE board_legacy_archives (
    board_id VARCHAR(36) NOT NULL REFERENCES board_heads(board_id) ON DELETE CASCADE,
    epoch BIGINT NOT NULL,
    source_name TEXT NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    source_board_data JSONB,
    operation_count BIGINT NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (board_id, epoch)
);

CREATE TABLE board_legacy_operations (
    board_id VARCHAR(36) NOT NULL,
    epoch BIGINT NOT NULL,
    legacy_id BIGINT NOT NULL,
    data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    PRIMARY KEY (board_id, epoch, legacy_id),
    FOREIGN KEY (board_id, epoch) REFERENCES board_legacy_archives(board_id, epoch) ON DELETE CASCADE
);

-- An UPDATE on rooms already locks the affected row before running its trigger.
CREATE FUNCTION openjam_fence_legacy_room_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_ARGV[0] = 'name' AND current_setting('openjam.document_v2_write', true) = 'on' THEN
        RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM board_heads WHERE board_id = OLD.id AND mode = 'active') THEN
        RAISE EXCEPTION USING ERRCODE = 'PJV01', MESSAGE = 'board requires the V2 document protocol';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER openjam_fence_room_snapshot
BEFORE UPDATE OF board_data ON rooms
FOR EACH ROW EXECUTE FUNCTION openjam_fence_legacy_room_write('snapshot');

CREATE TRIGGER openjam_fence_room_name
BEFORE UPDATE OF name ON rooms
FOR EACH ROW EXECUTE FUNCTION openjam_fence_legacy_room_write('name');

-- Old API processes use the same rooms lock as the cutover before they can
-- append an operation. The subsequent mode lookup sees the committed cutover.
CREATE FUNCTION openjam_fence_legacy_operation_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    prior_room VARCHAR(36);
BEGIN
    IF TG_OP = 'UPDATE' THEN
        prior_room := OLD.room_id;
    END IF;
    PERFORM id FROM rooms WHERE id IN (prior_room, NEW.room_id) ORDER BY id FOR UPDATE;
    IF EXISTS (
        SELECT 1 FROM board_heads WHERE board_id IN (prior_room, NEW.room_id) AND mode = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PJV01', MESSAGE = 'board requires the V2 document protocol';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER openjam_fence_legacy_operation
BEFORE INSERT OR UPDATE ON operations
FOR EACH ROW EXECUTE FUNCTION openjam_fence_legacy_operation_write();

-- A board transaction acquires this lock before resolving effective access.
CREATE FUNCTION openjam_lock_room_acl() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    prior_room VARCHAR(36);
    next_room VARCHAR(36);
BEGIN
    IF TG_OP <> 'INSERT' THEN
        prior_room := OLD.room_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        next_room := NEW.room_id;
    END IF;
    PERFORM id FROM rooms WHERE id IN (prior_room, next_room) ORDER BY id FOR UPDATE;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER openjam_lock_room_member
BEFORE INSERT OR UPDATE OR DELETE ON room_members
FOR EACH ROW EXECUTE FUNCTION openjam_lock_room_acl();

CREATE TRIGGER openjam_lock_room_share
BEFORE INSERT OR UPDATE OR DELETE ON room_share_settings
FOR EACH ROW EXECUTE FUNCTION openjam_lock_room_acl();
