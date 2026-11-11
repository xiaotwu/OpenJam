package model

import (
	"context"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

type SearchResult struct {
	Kind           string     `json:"kind"`
	ResourceKind   string     `json:"resourceKind,omitempty"`
	ID             string     `json:"id"`
	Title          string     `json:"title"`
	Snippet        string     `json:"snippet,omitempty"`
	OrganizationID *uuid.UUID `json:"organizationId,omitempty"`
	ProjectID      *uuid.UUID `json:"projectId,omitempty"`
	PageID         string     `json:"pageId,omitempty"`
	ElementID      string     `json:"elementId,omitempty"`
	Context        string     `json:"context,omitempty"`
	URL            string     `json:"url"`
}

type TeamGraphNode struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	ResourceKind string `json:"resourceKind,omitempty"`
	Title        string `json:"title"`
	Color        string `json:"color,omitempty"`
	URL          string `json:"url"`
}

type TeamGraphEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
}

type TeamGraph struct {
	Nodes     []TeamGraphNode `json:"nodes"`
	Edges     []TeamGraphEdge `json:"edges"`
	Truncated bool            `json:"truncated"`
}

const discoveryScope = `
WITH visible_projects AS (
	SELECT p.id, p.name, w.organization_id, o.kind AS organization_kind
	FROM projects p JOIN workspaces w ON w.id = p.workspace_id JOIN organizations o ON o.id = w.organization_id
	WHERE ($2::uuid IS NULL OR w.organization_id = $2)
		AND (o.owner_id = $1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = $1 AND pm.project_id = p.id))
		AND openjam_project_role(p.id, $1) IS NOT NULL
), visible_boards AS (
	SELECT r.id, r.name, r.resource_kind, p.id AS project_id, d.archived_at,
		concat_ws(' · ', p.name, CASE WHEN d.archived_at IS NOT NULL THEN 'Archive' END) AS project_name, h.mode
	FROM openjam_visible_boards($1) a JOIN rooms r ON r.id = a.board_id
	LEFT JOIN board_directory d ON d.room_id = r.id
	LEFT JOIN projects location ON location.id = d.project_id
	LEFT JOIN workspaces w ON w.id = location.workspace_id
	LEFT JOIN visible_projects p ON p.id = d.project_id
	LEFT JOIN board_heads h ON h.board_id = r.id
	WHERE ($2::uuid IS NULL OR w.organization_id = $2)
), visible_teams AS (
	SELECT o.id, o.name, o.owner_id FROM organizations o
	WHERE ($2::uuid IS NULL OR o.id = $2) AND o.kind = 'team'
		AND (o.owner_id = $1 OR EXISTS (
			SELECT 1 FROM team_members m WHERE m.organization_id = o.id AND m.user_id = $1 AND m.revoked_at IS NULL
		))
), visible_members AS (
	SELECT t.id AS team_id, t.name AS team_name, t.owner_id AS user_id FROM visible_teams t
	UNION ALL
	SELECT t.id, t.name, m.user_id FROM visible_teams t JOIN team_members m ON m.organization_id = t.id
	WHERE m.revoked_at IS NULL AND m.user_id <> t.owner_id
)`

const currentIndexedSource = `
	(i.source = 'legacy') = (b.mode IS DISTINCT FROM 'active')
	AND (i.source = 'legacy' OR EXISTS (
		SELECT 1 FROM board_pages page WHERE page.board_id = b.id AND page.id = i.page_id AND NOT page.deleted
	))`

func SearchWorkshop(ctx context.Context, actor uuid.UUID, team *uuid.UUID, query string) ([]SearchResult, error) {
	results := []SearchResult{}
	err := readDiscovery(ctx, actor, team, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, discoveryScope+`,
	query AS (SELECT lower($3::text) AS needle, plainto_tsquery('simple', $3) AS terms),
	matches AS (
		SELECT 'project' AS kind, p.id::text AS id, p.name AS title, '' AS snippet, p.organization_id,
			p.id AS project_id, '' AS page_id, '' AS element_id, '' AS context, '' AS resource_kind,
			CASE WHEN lower(p.name) = q.needle THEN 6 ELSE 3 END AS score
		FROM visible_projects p CROSS JOIN query q WHERE strpos(lower(p.name), q.needle) > 0
		UNION ALL
		SELECT 'member', u.id::text, u.display_name, '', m.team_id, NULL, '', '', m.team_name, '',
			CASE WHEN lower(u.display_name) = q.needle THEN 6 ELSE 3 END
		FROM visible_members m JOIN users u ON u.id = m.user_id CROSS JOIN query q
		WHERE strpos(lower(u.display_name), q.needle) > 0
		UNION ALL
		SELECT 'file', b.id, b.name, '', NULL, b.project_id, '', '', b.project_name, b.resource_kind,
			CASE WHEN lower(b.name) = q.needle THEN 7 ELSE 4 END
		FROM visible_boards b CROSS JOIN query q WHERE strpos(lower(b.name), q.needle) > 0
		UNION ALL
		SELECT 'content', b.id, b.name,
			btrim(substring(i.body from greatest(strpos(lower(i.body), q.needle) - 40, 1) for 230)),
			NULL, b.project_id, coalesce(i.page_id, ''), coalesce(i.element_id, ''),
			concat_ws(' · ', nullif(b.project_name, ''), CASE b.resource_kind
				WHEN 'sheet' THEN source_page.data->>'name' || '!' || split_part(i.element_id, ':', 2)
				WHEN 'slides' THEN 'Slide ' || (1 + (SELECT count(*) FROM board_pages earlier
					WHERE earlier.board_id = b.id AND NOT earlier.deleted AND (earlier.position, earlier.id) < (source_page.position, source_page.id)))
				END), b.resource_kind,
			1 + ts_rank(i.terms, q.terms)
		FROM visible_boards b JOIN workshop_board_index i ON i.board_id = b.id
		LEFT JOIN board_pages source_page ON b.resource_kind IN ('sheet', 'slides') AND source_page.board_id = b.id
			AND source_page.id = i.page_id AND NOT source_page.deleted
		CROSS JOIN query q
		WHERE (`+currentIndexedSource+`) AND (i.terms @@ q.terms OR strpos(lower(i.body), q.needle) > 0)
	), ranked AS (
		SELECT *, row_number() OVER (PARTITION BY kind, id, organization_id ORDER BY score DESC, page_id, element_id) AS source_rank
		FROM matches
	), by_kind AS (
		SELECT *, row_number() OVER (PARTITION BY kind ORDER BY score DESC, lower(title), id, page_id, element_id) AS kind_rank
		FROM ranked WHERE source_rank <= 6
	)
	SELECT coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'title', title, 'snippet', snippet,
		'organizationId', organization_id, 'projectId', project_id, 'pageId', page_id, 'elementId', element_id,
		'context', context, 'resourceKind', resource_kind) ORDER BY score DESC, lower(title), kind, id, page_id, element_id), '[]'::jsonb)
	FROM by_kind WHERE kind_rank <= 20`, actor, team, query).Scan(&results)
	})
	if err != nil {
		return nil, err
	}
	for i := range results {
		item := &results[i]
		switch item.Kind {
		case "project":
			item.URL = directoryURL("project", item.ID, *item.OrganizationID)
		case "member":
			item.URL = directoryURL("member", item.ID, *item.OrganizationID)
		default:
			item.URL = resourceSourceURL(item.ResourceKind, item.ID, item.PageID, item.ElementID)
		}
	}
	return results, nil
}

func ReadTeamGraph(ctx context.Context, actor, team uuid.UUID) (TeamGraph, error) {
	var graph TeamGraph
	err := readDiscovery(ctx, actor, &team, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, discoveryScope+`,
	members AS (
		SELECT u.id, u.display_name, u.avatar_color FROM visible_members m JOIN users u ON u.id = m.user_id
		ORDER BY lower(u.display_name), u.id LIMIT 80
	), projects AS (
		SELECT id, name FROM visible_projects ORDER BY lower(name), id LIMIT 60
	), boards AS (
		SELECT b.* FROM visible_boards b JOIN projects p ON p.id = b.project_id
		WHERE b.archived_at IS NULL
		ORDER BY lower(b.name), b.id LIMIT 120
	), nodes AS (
		SELECT id::text AS id, 'member' AS kind, display_name AS title, avatar_color AS color, '' AS resource_kind FROM members
		UNION ALL SELECT id::text, 'project', name, '', '' FROM projects
		UNION ALL SELECT id, 'resource', name, '', resource_kind FROM boards
	), edges AS (
		SELECT 'member:' || m.id AS origin, 'project:' || p.id AS target,
			CASE WHEN person.is_owner THEN 'owns' ELSE 'participates' END AS kind
		FROM projects p CROSS JOIN LATERAL openjam_project_people(p.id, $1) person
		JOIN members m ON m.id = person.user_id
		UNION ALL
		SELECT 'project:' || b.project_id, 'resource:' || b.id, 'contains' FROM boards b
		UNION ALL
		SELECT DISTINCT 'resource:' || b.id, 'resource:' || target.id, 'references'
		FROM boards b JOIN workshop_board_index i ON i.board_id = b.id
		JOIN boards target ON target.id = ANY(i.references_to) AND target.id <> b.id
		WHERE `+currentIndexedSource+`
	), limited_edges AS (SELECT * FROM edges ORDER BY kind, origin, target LIMIT 600)
	SELECT jsonb_build_object(
		'nodes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'color', color, 'resourceKind', resource_kind)
			ORDER BY lower(title), id) FROM nodes), '[]'::jsonb),
		'edges', coalesce((SELECT jsonb_agg(jsonb_build_object('from', origin, 'to', target, 'kind', kind)
			ORDER BY kind, origin, target) FROM limited_edges), '[]'::jsonb),
		'truncated', (SELECT count(*) > 80 FROM visible_members) OR (SELECT count(*) > 60 FROM visible_projects)
			OR (SELECT count(*) > 120 FROM visible_boards WHERE project_id IS NOT NULL AND archived_at IS NULL)
			OR (SELECT count(*) > 600 FROM edges))`, actor, team).Scan(&graph)
	})
	if err != nil {
		return TeamGraph{}, err
	}
	for i := range graph.Nodes {
		node := &graph.Nodes[i]
		if node.Kind == "resource" {
			node.URL = resourceSourceURL(node.ResourceKind, node.ID, "", "")
		} else {
			node.URL = directoryURL(node.Kind, node.ID, team)
		}
		node.ID = node.Kind + ":" + node.ID
	}
	return graph, nil
}

func readDiscovery(ctx context.Context, actor uuid.UUID, team *uuid.UUID, read func(pgx.Tx) error) error {
	return pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if team != nil {
			role, err := teamRole(ctx, tx, *team, actor)
			if err != nil {
				return err
			}
			if role == "" {
				return ErrDirectoryNotFound
			}
		}
		return read(tx)
	})
}

func directoryURL(kind, id string, organization uuid.UUID) string {
	values := url.Values{"organization": {organization.String()}, kind: {id}}
	if kind == "member" {
		values.Set("section", "teams")
	}
	return "/workplace?" + values.Encode()
}

func resourceSourceURL(kind, resource, page, element string) string {
	if kind == ResourceSlides {
		path := "/slides/" + url.PathEscape(resource)
		if page != "" {
			path += "?" + (url.Values{"slide": {page}}).Encode()
		}
		return path
	}
	if kind == ResourceSheet {
		path := "/sheet/" + url.PathEscape(resource)
		if address, ok := strings.CutPrefix(element, page+":"); ok && page != "" {
			path += "?" + (url.Values{"sheet": {page}, "cell": {address}}).Encode()
		}
		return path
	}
	if kind == ResourceDoc {
		path := "/doc/" + url.PathEscape(resource)
		if page != "" {
			path += "?" + (url.Values{"block": {page}}).Encode()
		}
		return path
	}
	path := "/board/" + url.PathEscape(resource)
	values := url.Values{}
	if page != "" {
		values.Set("page", page)
	}
	if element != "" {
		values.Set("element", element)
	}
	if query := values.Encode(); query != "" {
		path += "?" + query
	}
	return path
}
