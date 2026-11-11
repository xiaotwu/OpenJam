ALTER TABLE rooms DROP CONSTRAINT rooms_resource_kind_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_resource_kind_check CHECK (resource_kind IN ('board', 'doc', 'sheet', 'slides'));

CREATE OR REPLACE FUNCTION openjam_board_references(body TEXT) RETURNS VARCHAR[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(ARRAY(
        SELECT DISTINCT m[1]::varchar
        FROM regexp_matches(body, $pattern$(?:^|[[:space:]("<'`])/(?:board|room|doc|sheet|slides)/([A-Za-z0-9_-]{1,36})(?=$|[[:space:]?#)>"',.!`])$pattern$, 'g') AS m
        ORDER BY 1 LIMIT 64
    ), '{}')
$$;

UPDATE workshop_board_index SET body = body WHERE strpos(body, '/slides/') > 0;
