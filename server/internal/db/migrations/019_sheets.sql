ALTER TABLE rooms DROP CONSTRAINT rooms_resource_kind_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_resource_kind_check CHECK (resource_kind IN ('board', 'doc', 'sheet'));

CREATE OR REPLACE FUNCTION openjam_searchable_text(content JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT left(CASE WHEN content->>'type' = 'sheetCell' THEN
            concat_ws(' ', content->>'input', nullif(content->>'display', content->>'input'))
        WHEN content->'sheetTab' = 'true'::jsonb THEN ''
        WHEN content->'docBlock' = 'true'::jsonb THEN coalesce(content->>'text', '')
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
        FROM regexp_matches(body, $pattern$(?:^|[[:space:]("<'`])/(?:board|room|doc|sheet)/([A-Za-z0-9_-]{1,36})(?=$|[[:space:]?#)>"',.!`])$pattern$, 'g') AS m
        ORDER BY 1 LIMIT 64
    ), '{}')
$$;

UPDATE workshop_board_index SET body = body WHERE strpos(body, '/sheet/') > 0;
