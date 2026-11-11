package model

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

type Organization struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Kind string    `json:"kind"`
}

type Workspace struct {
	ID             uuid.UUID `json:"id"`
	OrganizationID uuid.UUID `json:"organizationId"`
	Name           string    `json:"name"`
}

type Project struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	Name        string    `json:"name"`
}

type DirectoryBoard struct {
	Room
	ProjectID  *uuid.UUID `json:"projectId"`
	ArchivedAt *time.Time `json:"archivedAt"`
	Favorite   bool       `json:"favorite"`
}

type Directory struct {
	Organizations []Organization   `json:"organizations"`
	Workspaces    []Workspace      `json:"workspaces"`
	Projects      []Project        `json:"projects"`
	Boards        []DirectoryBoard `json:"boards"`
}

var (
	ErrDirectoryNotFound = errors.New("directory resource not found")
	ErrCrossOrganization = errors.New("boards can only move within their organization")
)

type directoryQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func CreateOrganization(ctx context.Context, ownerID uuid.UUID, name string) (Organization, error) {
	org, _, err := createOrganization(ctx, db.Pool(), ownerID, name, "team", "General")
	return org, err
}

func createOrganization(ctx context.Context, query directoryQuerier, ownerID uuid.UUID, name, kind, workspaceName string) (Organization, uuid.UUID, error) {
	var organization Organization
	var draftsID uuid.UUID
	err := query.QueryRow(ctx, `
		WITH new_org AS (
			INSERT INTO organizations (owner_id, name, kind) VALUES ($1, $2, $3)
			RETURNING id, name, kind
		), new_workspace AS (
			INSERT INTO workspaces (organization_id, name, is_default)
			SELECT id, $4, TRUE FROM new_org
			RETURNING id
		), drafts AS (
			INSERT INTO projects (workspace_id, name, is_default)
			SELECT id, 'Drafts', TRUE FROM new_workspace
			RETURNING id
		)
		SELECT new_org.id, new_org.name, new_org.kind, drafts.id
		FROM new_org CROSS JOIN drafts
	`, ownerID, name, kind, workspaceName).Scan(&organization.ID, &organization.Name, &organization.Kind, &draftsID)
	return organization, draftsID, err
}

func findPersonalDrafts(ctx context.Context, query directoryQuerier, ownerID uuid.UUID) (uuid.UUID, error) {
	var projectID uuid.UUID
	err := query.QueryRow(ctx, `
		SELECT p.id
		FROM organizations o
		JOIN workspaces w ON w.organization_id = o.id AND w.is_default
		JOIN projects p ON p.workspace_id = w.id AND p.is_default
		WHERE o.owner_id = $1 AND o.kind = 'personal'
	`, ownerID).Scan(&projectID)
	return projectID, err
}

func ensurePersonalDrafts(ctx context.Context, tx pgx.Tx, ownerID uuid.UUID) (uuid.UUID, error) {
	projectID, err := findPersonalDrafts(ctx, tx, ownerID)
	if !errors.Is(err, pgx.ErrNoRows) {
		return projectID, err
	}

	// Serialize the first use of a user's directory across API replicas.
	var lockedOwner uuid.UUID
	if err := tx.QueryRow(ctx, "SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE", ownerID).Scan(&lockedOwner); err != nil {
		return uuid.Nil, err
	}
	projectID, err = findPersonalDrafts(ctx, tx, ownerID)
	if !errors.Is(err, pgx.ErrNoRows) {
		return projectID, err
	}

	_, projectID, err = createOrganization(ctx, tx, ownerID, "Personal", "personal", "My workspace")
	return projectID, err
}

func ListDirectory(ctx context.Context, userID uuid.UUID) (Directory, error) {
	draftsID, err := findPersonalDrafts(ctx, db.Pool(), userID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
			var err error
			draftsID, err = ensurePersonalDrafts(ctx, tx, userID)
			return err
		})
	}
	if err != nil {
		return Directory{}, err
	}

	// Legacy rooms without an explicit location belong to the owner's personal Drafts.
	// Invited collaborators and accounts with redeemed links see the board.
	var directory Directory
	err = db.Pool().QueryRow(ctx, `
		WITH own_orgs AS (
			SELECT id, name, kind FROM organizations WHERE owner_id = $1
		), own_workspaces AS (
			SELECT w.id, w.name, w.organization_id AS "organizationId"
			FROM workspaces w JOIN own_orgs o ON o.id = w.organization_id
		), own_projects AS (
			SELECT p.id, p.name, p.workspace_id AS "workspaceId"
			FROM projects p JOIN own_workspaces w ON w.id = p.workspace_id
		), visible_boards AS (
			SELECT r.id, r.name, r.owner_id AS "ownerId", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
				CASE WHEN r.owner_id = $1 THEN 'owner' ELSE COALESCE(rm.permission, g.permission) END AS permission,
				CASE WHEN r.owner_id = $1 THEN COALESCE(p.id, $2) END AS "projectId",
				d.archived_at AS "archivedAt",
				f.room_id IS NOT NULL AS favorite
			FROM rooms r
			LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $1
			LEFT JOIN board_live_link_grants g ON g.room_id = r.id AND g.user_id = $1
			LEFT JOIN board_directory d ON d.room_id = r.id
			LEFT JOIN own_projects p ON p.id = d.project_id
			LEFT JOIN board_favorites f ON f.room_id = r.id AND f.user_id = $1
			WHERE r.owner_id = $1 OR rm.user_id IS NOT NULL OR g.user_id IS NOT NULL
		)
		SELECT jsonb_build_object(
			'organizations', COALESCE((SELECT jsonb_agg(o ORDER BY (o.kind <> 'personal'), LOWER(o.name), o.id) FROM own_orgs o), '[]'::jsonb),
			'workspaces', COALESCE((SELECT jsonb_agg(w ORDER BY LOWER(w.name), w.id) FROM own_workspaces w), '[]'::jsonb),
			'projects', COALESCE((SELECT jsonb_agg(p ORDER BY LOWER(p.name), p.id) FROM own_projects p), '[]'::jsonb),
			'boards', COALESCE((SELECT jsonb_agg(b ORDER BY b."updatedAt" DESC, b.id) FROM visible_boards b), '[]'::jsonb)
		)
	`, userID, draftsID).Scan(&directory)
	return directory, err
}

func CreateWorkspace(ctx context.Context, userID, organizationID uuid.UUID, name string) (Workspace, error) {
	var workspace Workspace
	err := db.Pool().QueryRow(ctx, `
		INSERT INTO workspaces (organization_id, name)
		SELECT id, $3 FROM organizations WHERE id = $2 AND owner_id = $1
		RETURNING id, organization_id, name
	`, userID, organizationID, name).Scan(&workspace.ID, &workspace.OrganizationID, &workspace.Name)
	return workspace, directoryLookupError(err)
}

func CreateProject(ctx context.Context, userID, workspaceID uuid.UUID, name string) (Project, error) {
	var project Project
	err := db.Pool().QueryRow(ctx, `
		INSERT INTO projects (workspace_id, name)
		SELECT w.id, $3
		FROM workspaces w JOIN organizations o ON o.id = w.organization_id
		WHERE w.id = $2 AND o.owner_id = $1
		RETURNING id, workspace_id, name
	`, userID, workspaceID, name).Scan(&project.ID, &project.WorkspaceID, &project.Name)
	return project, directoryLookupError(err)
}

func CreateProjectBoard(ctx context.Context, userID, projectID uuid.UUID, name string) (DirectoryBoard, error) {
	board := DirectoryBoard{Room: Room{Permission: "owner"}, ProjectID: &projectID}
	err := db.Pool().QueryRow(ctx, `
		WITH new_board AS (
			INSERT INTO rooms (id, name, owner_id)
			SELECT $4, $3, o.owner_id
			FROM projects p
			JOIN workspaces w ON w.id = p.workspace_id
			JOIN organizations o ON o.id = w.organization_id
			WHERE p.id = $2 AND o.owner_id = $1
			RETURNING id, name, owner_id, created_at, updated_at
		), location AS (
			INSERT INTO board_directory (room_id, project_id)
			SELECT id, $2 FROM new_board
			RETURNING room_id
		)
		SELECT b.id, b.name, b.owner_id, b.created_at, b.updated_at
		FROM new_board b JOIN location l ON l.room_id = b.id
	`, userID, projectID, name, uuid.NewString()).Scan(&board.ID, &board.Name, &board.OwnerID, &board.CreatedAt, &board.UpdatedAt)
	return board, directoryLookupError(err)
}

func SetBoardFavorite(ctx context.Context, userID uuid.UUID, boardID string, favorite bool) error {
	var eligible bool
	err := db.Pool().QueryRow(ctx, `
		WITH eligible_board AS (
			SELECT r.id FROM rooms r
			LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $1
			LEFT JOIN board_live_link_grants g ON g.room_id = r.id AND g.user_id = $1
			WHERE r.id = $2 AND (r.owner_id = $1 OR rm.user_id IS NOT NULL OR g.user_id IS NOT NULL)
			FOR KEY SHARE OF r
		), favorited AS (
			INSERT INTO board_favorites (room_id, user_id)
			SELECT id, $1 FROM eligible_board WHERE $3::boolean
			ON CONFLICT DO NOTHING
		), unfavorited AS (
			DELETE FROM board_favorites f USING eligible_board b
			WHERE f.room_id = b.id AND f.user_id = $1 AND NOT $3::boolean
		)
		SELECT EXISTS(SELECT 1 FROM eligible_board)
	`, userID, boardID, favorite).Scan(&eligible)
	if err == nil && !eligible {
		return ErrDirectoryNotFound
	}
	return err
}

func SetBoardArchived(ctx context.Context, userID uuid.UUID, boardID string, archived bool) (*time.Time, error) {
	var archivedAt *time.Time
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if err := ensureOwnedBoardLocation(ctx, tx, userID, boardID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			UPDATE board_directory
			SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, NOW()) ELSE NULL END
			WHERE room_id = $1
			RETURNING archived_at
		`, boardID, archived).Scan(&archivedAt)
	})
	return archivedAt, err
}

func MoveBoard(ctx context.Context, userID uuid.UUID, boardID string, projectID uuid.UUID) error {
	return pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if err := ensureOwnedBoardLocation(ctx, tx, userID, boardID); err != nil {
			return err
		}
		var sourceOrgID, targetOrgID uuid.UUID
		err := tx.QueryRow(ctx, `
			SELECT source_workspace.organization_id, target_workspace.organization_id
			FROM board_directory d
			JOIN projects source_project ON source_project.id = d.project_id
			JOIN workspaces source_workspace ON source_workspace.id = source_project.workspace_id
			JOIN projects target_project ON target_project.id = $2
			JOIN workspaces target_workspace ON target_workspace.id = target_project.workspace_id
			JOIN organizations target_org ON target_org.id = target_workspace.organization_id AND target_org.owner_id = $3
			WHERE d.room_id = $1
		`, boardID, projectID, userID).Scan(&sourceOrgID, &targetOrgID)
		if err != nil {
			return directoryLookupError(err)
		}
		if sourceOrgID != targetOrgID {
			return ErrCrossOrganization
		}
		_, err = tx.Exec(ctx, "UPDATE board_directory SET project_id = $2 WHERE room_id = $1", boardID, projectID)
		return err
	})
}

func ensureOwnedBoardLocation(ctx context.Context, tx pgx.Tx, userID uuid.UUID, boardID string) error {
	var exists bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM board_directory d WHERE d.room_id = r.id)
		FROM rooms r WHERE r.id = $1 AND r.owner_id = $2
		FOR NO KEY UPDATE OF r
	`, boardID, userID).Scan(&exists)
	if err != nil || exists {
		return directoryLookupError(err)
	}
	draftsID, err := ensurePersonalDrafts(ctx, tx, userID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO board_directory (room_id, project_id) VALUES ($1, $2)
		ON CONFLICT (room_id) DO NOTHING
	`, boardID, draftsID)
	return err
}

func directoryLookupError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrDirectoryNotFound
	}
	return err
}
