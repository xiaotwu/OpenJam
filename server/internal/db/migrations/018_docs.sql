ALTER TABLE rooms ADD COLUMN resource_kind TEXT NOT NULL DEFAULT 'board'
    CHECK (resource_kind IN ('board', 'doc'));

CREATE OR REPLACE FUNCTION openjam_searchable_text(content JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT left(CASE WHEN content->'docBlock' = 'true'::jsonb THEN coalesce(content->>'text', '')
        ELSE concat_ws(' ', content->>'text', content->>'name', content->>'title',
            content->>'label', content->>'caption', content->>'body', content->>'content',
            (SELECT string_agg(value #>> '{}', ' ')
             FROM jsonb_path_query(content->'widgetData', '$.** ? (@.type() == "string")') AS value))
        END, 16000)
$$;

CREATE OR REPLACE FUNCTION openjam_board_references(body TEXT) RETURNS VARCHAR[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(ARRAY(
        SELECT DISTINCT m[1]::varchar
        FROM regexp_matches(body, $pattern$(?:^|[[:space:]("<'`])/(?:board|room|doc)/([A-Za-z0-9_-]{1,36})(?=$|[[:space:]?#)>"',.!`])$pattern$, 'g') AS m
        ORDER BY 1 LIMIT 64
    ), '{}')
$$;
