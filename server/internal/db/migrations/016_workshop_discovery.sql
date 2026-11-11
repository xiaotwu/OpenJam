CREATE FUNCTION openjam_searchable_text(content JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT left(concat_ws(' ', content->>'text', content->>'name', content->>'title',
        content->>'label', content->>'caption', content->>'body', content->>'content',
        (SELECT string_agg(value #>> '{}', ' ')
         FROM jsonb_path_query(content->'widgetData', '$.** ? (@.type() == "string")') AS value)), 16000)
$$;

CREATE FUNCTION openjam_board_references(body TEXT) RETURNS VARCHAR[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(ARRAY(
        SELECT DISTINCT m[1]::varchar
        FROM regexp_matches(body, $pattern$(?:^|[[:space:]("'])/(?:board|room)/([A-Za-z0-9_-]{1,36})(?=$|[[:space:]?#)"',.!])$pattern$, 'g') AS m
        ORDER BY 1 LIMIT 64
    ), '{}')
$$;

CREATE TABLE workshop_board_index (
    board_id VARCHAR(36) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('page', 'element', 'legacy')),
    source_id TEXT NOT NULL,
    page_id TEXT,
    element_id TEXT,
    body TEXT NOT NULL,
    terms TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, body)) STORED,
    references_to VARCHAR[] GENERATED ALWAYS AS (openjam_board_references(body)) STORED,
    PRIMARY KEY (board_id, source, source_id)
);

CREATE INDEX workshop_board_index_terms ON workshop_board_index USING GIN (terms);

CREATE FUNCTION openjam_index_board_record() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    entry_body TEXT;
    entry_page TEXT;
    entry_element TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM workshop_board_index WHERE board_id = OLD.board_id AND source = TG_ARGV[0] AND source_id = OLD.id;
        RETURN OLD;
    END IF;
    IF TG_ARGV[0] = 'page' THEN
        entry_page := NEW.id;
    ELSE
        entry_page := NEW.page_id;
        entry_element := NEW.id;
    END IF;
    entry_body := openjam_searchable_text(NEW.data);
    IF TG_OP = 'UPDATE' AND NEW.deleted = OLD.deleted
        AND (TG_ARGV[0] = 'page' OR (to_jsonb(NEW)->>'page_id') IS NOT DISTINCT FROM (to_jsonb(OLD)->>'page_id'))
        AND entry_body = openjam_searchable_text(OLD.data) THEN
        RETURN NEW;
    END IF;
    IF NEW.deleted OR btrim(entry_body) = '' THEN
        DELETE FROM workshop_board_index WHERE board_id = NEW.board_id AND source = TG_ARGV[0] AND source_id = NEW.id;
    ELSE
        INSERT INTO workshop_board_index (board_id, source, source_id, page_id, element_id, body)
        VALUES (NEW.board_id, TG_ARGV[0], NEW.id, entry_page, entry_element, entry_body)
        ON CONFLICT (board_id, source, source_id) DO UPDATE SET
            page_id = EXCLUDED.page_id, body = EXCLUDED.body;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER workshop_index_elements AFTER INSERT OR UPDATE OF data, deleted, page_id OR DELETE ON board_elements
FOR EACH ROW EXECUTE FUNCTION openjam_index_board_record('element');

CREATE TRIGGER workshop_index_pages AFTER INSERT OR UPDATE OF data, deleted OR DELETE ON board_pages
FOR EACH ROW EXECUTE FUNCTION openjam_index_board_record('page');

CREATE FUNCTION openjam_refresh_legacy_index(target VARCHAR, snapshot JSONB) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM workshop_board_index WHERE board_id = target AND source = 'legacy';
    IF NOT EXISTS (SELECT 1 FROM board_heads WHERE board_id = target AND mode = 'active') THEN
        INSERT INTO workshop_board_index (board_id, source, source_id, page_id, element_id, body)
        SELECT target, 'legacy', ord::text, value->>'pageId', value->>'id', indexed.body
        FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(snapshot->'elements') = 'array' THEN snapshot->'elements' ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS item(value, ord)
        CROSS JOIN LATERAL (SELECT openjam_searchable_text(item.value) AS body) indexed
        WHERE btrim(indexed.body) <> '';
    END IF;
END;
$$;

CREATE FUNCTION openjam_index_legacy_board() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'rooms' THEN
        PERFORM openjam_refresh_legacy_index(NEW.id, NEW.board_data);
    ELSIF TG_OP = 'INSERT' OR NEW.mode IS DISTINCT FROM OLD.mode THEN
        PERFORM openjam_refresh_legacy_index(NEW.board_id, (SELECT board_data FROM rooms WHERE id = NEW.board_id));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER workshop_index_legacy AFTER INSERT OR UPDATE OF board_data ON rooms
FOR EACH ROW EXECUTE FUNCTION openjam_index_legacy_board();

CREATE TRIGGER workshop_index_mode AFTER INSERT OR UPDATE OF mode ON board_heads
FOR EACH ROW EXECUTE FUNCTION openjam_index_legacy_board();

INSERT INTO workshop_board_index (board_id, source, source_id, page_id, body)
SELECT p.board_id, 'page', p.id, p.id, openjam_searchable_text(p.data)
FROM board_pages p WHERE NOT p.deleted AND btrim(openjam_searchable_text(p.data)) <> '';

INSERT INTO workshop_board_index (board_id, source, source_id, page_id, element_id, body)
SELECT e.board_id, 'element', e.id, e.page_id, e.id, openjam_searchable_text(e.data)
FROM board_elements e WHERE NOT e.deleted AND btrim(openjam_searchable_text(e.data)) <> '';

DO $$
DECLARE board RECORD;
BEGIN
    FOR board IN SELECT id, board_data FROM rooms r WHERE NOT EXISTS (
        SELECT 1 FROM board_heads WHERE board_id = r.id AND mode = 'active'
    ) LOOP
        PERFORM openjam_refresh_legacy_index(board.id, board.board_data);
    END LOOP;
END;
$$;

CREATE FUNCTION openjam_project_people(target UUID, actor UUID)
RETURNS TABLE(user_id UUID, display_name TEXT, avatar_color TEXT, is_owner BOOLEAN)
LANGUAGE sql STABLE AS $$
    WITH project AS (
        SELECT p.id, o.id AS organization_id, o.owner_id
        FROM projects p JOIN workspaces w ON w.id = p.workspace_id
        JOIN organizations o ON o.id = w.organization_id
        WHERE p.id = target AND openjam_project_role(p.id, actor) IS NOT NULL
    ), people AS (
        SELECT owner_id AS user_id, true AS is_owner FROM project
        UNION ALL
        SELECT pm.user_id, false FROM project p
        JOIN project_members pm ON pm.project_id = p.id AND pm.user_id <> p.owner_id
        WHERE openjam_team_role(p.organization_id, pm.user_id) IS NOT NULL
    )
    SELECT u.id, u.display_name::text, u.avatar_color::text, p.is_owner
    FROM people p JOIN users u ON u.id = p.user_id
    ORDER BY p.is_owner DESC, lower(u.display_name), u.id
$$;
