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
	Role string    `json:"role"`
}

type Workspace struct {
	ID             uuid.UUID `json:"id"`
	OrganizationID uuid.UUID `json:"organizationId"`
	Name           string    `json:"name"`
	IsDefault      bool      `json:"isDefault"`
}

type ProjectPerson struct {
	UserID      uuid.UUID `json:"userId"`
	DisplayName string    `json:"displayName"`
	AvatarColor string    `json:"avatarColor"`
	IsOwner     bool      `json:"isOwner"`
}

type Project struct {
	ID          uuid.UUID       `json:"id"`
	WorkspaceID uuid.UUID       `json:"workspaceId"`
	Name        string          `json:"name"`
	Role        string          `json:"role"`
	IsDefault   bool            `json:"isDefault"`
	People      []ProjectPerson `json:"people,omitempty"`
	PeopleCount int             `json:"peopleCount,omitempty"`
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
	organization := Organization{Role: "owner"}
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
		WITH visible_orgs AS (
			SELECT id, name, kind, 'owner' AS role FROM organizations WHERE owner_id = $1
			UNION ALL
			SELECT o.id, o.name, o.kind, tm.role FROM team_members tm
			JOIN organizations o ON o.id = tm.organization_id AND o.kind = 'team'
			WHERE tm.user_id = $1 AND tm.revoked_at IS NULL AND o.owner_id <> $1
		), visible_workspaces AS (
			SELECT w.id, w.name, w.organization_id AS "organizationId", w.is_default AS "isDefault"
			FROM workspaces w JOIN visible_orgs o ON o.id = w.organization_id
		), visible_projects AS (
			SELECT p.id, p.name, p.workspace_id AS "workspaceId", p.is_default AS "isDefault",
				CASE WHEN o.role = 'owner' THEN 'manager' ELSE pm.role END AS role,
				people.items AS people, people.total AS "peopleCount"
			FROM projects p JOIN visible_workspaces w ON w.id = p.workspace_id
			JOIN visible_orgs o ON o.id = w."organizationId"
			LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
			CROSS JOIN LATERAL (
				SELECT coalesce(jsonb_agg(jsonb_build_object('userId', person.user_id, 'displayName', person.display_name,
					'avatarColor', person.avatar_color, 'isOwner', person.is_owner)
					ORDER BY person.is_owner DESC, lower(person.display_name), person.user_id), '[]'::jsonb) AS items,
					coalesce(max(person.total), 0) AS total
				FROM (SELECT *, count(*) OVER () AS total FROM openjam_project_people(p.id, $1)
					ORDER BY is_owner DESC, lower(display_name), user_id LIMIT 5) person
			) people
			WHERE o.role = 'owner' OR pm.role IS NOT NULL
		), visible_boards AS (
			SELECT r.id, r.name, r.owner_id AS "ownerId", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
				a.permission,
				CASE WHEN p.id IS NOT NULL THEN p.id
					WHEN d.room_id IS NULL AND r.owner_id = $1 THEN $2 END AS "projectId",
				d.archived_at AS "archivedAt",
				f.room_id IS NOT NULL AS favorite
			FROM openjam_visible_boards($1) a
			JOIN rooms r ON r.id = a.board_id
			LEFT JOIN board_directory d ON d.room_id = r.id
			LEFT JOIN visible_projects p ON p.id = d.project_id
			LEFT JOIN board_favorites f ON f.room_id = r.id AND f.user_id = $1
		)
		SELECT jsonb_build_object(
			'organizations', COALESCE((SELECT jsonb_agg(o ORDER BY (o.kind <> 'personal'), LOWER(o.name), o.id) FROM visible_orgs o), '[]'::jsonb),
			'workspaces', COALESCE((SELECT jsonb_agg(w ORDER BY NOT w."isDefault", LOWER(w.name), w.id) FROM visible_workspaces w), '[]'::jsonb),
			'projects', COALESCE((SELECT jsonb_agg(p ORDER BY LOWER(p.name), p.id) FROM visible_projects p), '[]'::jsonb),
			'boards', COALESCE((SELECT jsonb_agg(b ORDER BY b."updatedAt" DESC, b.id) FROM visible_boards b), '[]'::jsonb)
		)
	`, userID, draftsID).Scan(&directory)
	return directory, err
}

func CreateWorkspace(ctx context.Context, userID, organizationID uuid.UUID, name string) (Workspace, error) {
	var workspace Workspace
	err := db.Pool().QueryRow(ctx, `
		INSERT INTO workspaces (organization_id, name)
		SELECT id, $3 FROM organizations
		WHERE id = $2 AND (owner_id = $1 OR openjam_team_role(id, $1) = 'admin')
		RETURNING id, organization_id, name, is_default
	`, userID, organizationID, name).Scan(&workspace.ID, &workspace.OrganizationID, &workspace.Name, &workspace.IsDefault)
	return workspace, directoryLookupError(err)
}

func CreateProject(ctx context.Context, userID, workspaceID uuid.UUID, name string) (Project, error) {
	project := Project{Role: "manager"}
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		// Use the same organization lock as membership changes, so an offboarded
		// member cannot leave a new grant behind while losing Team access.
		var orgID uuid.UUID
		if err := tx.QueryRow(ctx, `
			SELECT o.id FROM organizations o JOIN workspaces w ON w.organization_id = o.id
			WHERE w.id = $1 FOR NO KEY UPDATE OF o
		`, workspaceID).Scan(&orgID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			WITH authorized AS (
				SELECT owner_id FROM organizations WHERE id = $4
					AND (owner_id = $1 OR openjam_team_role(id, $1) IS NOT NULL)
			), created AS (
				INSERT INTO projects (workspace_id, name)
				SELECT $2, $3 FROM authorized
				RETURNING id, workspace_id, name, is_default
			), creator AS (
				INSERT INTO project_members (project_id, user_id, role)
				SELECT c.id, $1, 'manager' FROM created c CROSS JOIN authorized a
				WHERE a.owner_id <> $1
			)
			SELECT id, workspace_id, name, is_default FROM created
		`, userID, workspaceID, name, orgID).Scan(&project.ID, &project.WorkspaceID, &project.Name, &project.IsDefault)
	})
	return project, directoryLookupError(err)
}

func CreateProjectBoard(ctx context.Context, userID, projectID uuid.UUID, name string) (DirectoryBoard, error) {
	board := DirectoryBoard{ProjectID: &projectID}
	err := db.Pool().QueryRow(ctx, `
		WITH authorized AS (
			SELECT id, openjam_project_role(id, $1) AS role FROM projects WHERE id = $2
		), new_board AS (
			INSERT INTO rooms (id, name, owner_id)
			SELECT $4, $3, $1 FROM authorized WHERE role IN ('manager', 'edit')
			RETURNING id, name, owner_id, created_at, updated_at
		), location AS (
			INSERT INTO board_directory (room_id, project_id)
			SELECT id, $2 FROM new_board
			RETURNING room_id
		)
		SELECT b.id, b.name, b.owner_id, b.created_at, b.updated_at,
			CASE WHEN a.role = 'manager' THEN 'owner' ELSE 'edit' END
		FROM new_board b JOIN location l ON l.room_id = b.id CROSS JOIN authorized a
	`, userID, projectID, name, uuid.NewString()).Scan(&board.ID, &board.Name, &board.OwnerID, &board.CreatedAt, &board.UpdatedAt, &board.Permission)
	return board, directoryLookupError(err)
}

func SetBoardFavorite(ctx context.Context, userID uuid.UUID, boardID string, favorite bool) error {
	var eligible bool
	err := db.Pool().QueryRow(ctx, `
		WITH eligible_board AS (
			SELECT r.id FROM rooms r
			CROSS JOIN LATERAL openjam_board_access(r.id, $1) a
			WHERE r.id = $2 AND a.permission IS NOT NULL AND a.source <> 'legacy-link'
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
			WHERE d.room_id = $1 AND openjam_project_role(target_project.id, $3) = 'manager'
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
		FROM rooms r WHERE r.id = $1
		FOR NO KEY UPDATE OF r
	`, boardID).Scan(&exists)
	if err != nil {
		return directoryLookupError(err)
	}
	access, err := QueryRoomAccess(ctx, tx, boardID, userID)
	if errors.Is(err, ErrRoomAccessDenied) || (err == nil && !access.IsOwner) {
		return ErrDirectoryNotFound
	}
	if err != nil || exists {
		return err
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
