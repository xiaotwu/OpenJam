package model

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

var (
	ErrDirectoryForbidden = errors.New("insufficient directory permission")
	ErrInvalidTeamRole    = errors.New("invalid team role")
	ErrInvalidProjectRole = errors.New("invalid project role")
	ErrInvalidTeamInvite  = errors.New("team invitation is unavailable")
	ErrAlreadyTeamMember  = errors.New("account is already a team member")
	ErrTooManyTeamInvites = errors.New("this team has reached its active invitation limit")
)

type TeamMember struct {
	UserID      uuid.UUID `json:"userId"`
	DisplayName string    `json:"displayName"`
	AvatarColor string    `json:"avatarColor"`
	Email       string    `json:"email,omitempty"`
	Role        string    `json:"role"`
}

type TeamInvitation struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type ProjectMember struct {
	UserID      uuid.UUID `json:"userId"`
	DisplayName string    `json:"displayName"`
	Role        string    `json:"role"`
	Inherited   bool      `json:"inherited"`
}

func teamRole(ctx context.Context, q directoryQuerier, teamID, userID uuid.UUID) (string, error) {
	var role string
	err := q.QueryRow(ctx, "SELECT coalesce(openjam_team_role($1, $2), '')", teamID, userID).Scan(&role)
	return role, err
}

func lockTeam(ctx context.Context, tx pgx.Tx, teamID uuid.UUID) error {
	var id uuid.UUID
	err := tx.QueryRow(ctx, "SELECT id FROM organizations WHERE id = $1 AND kind = 'team' FOR NO KEY UPDATE", teamID).Scan(&id)
	return directoryLookupError(err)
}

func canManageTeamMember(actorRole, targetRole string) bool {
	return actorRole == "owner" && targetRole != "owner" ||
		actorRole == "admin" && targetRole == "member"
}

func ListTeamMembers(ctx context.Context, teamID, actor uuid.UUID) ([]TeamMember, error) {
	var members []TeamMember
	err := db.Pool().QueryRow(ctx, `
		WITH access AS (SELECT openjam_team_role($1, $2) AS role),
		roster AS (
			SELECT o.owner_id AS user_id, 'owner' AS role FROM organizations o WHERE o.id = $1
			UNION ALL
			SELECT tm.user_id, tm.role FROM team_members tm JOIN organizations o ON o.id = tm.organization_id
			WHERE tm.organization_id = $1 AND tm.revoked_at IS NULL AND tm.user_id <> o.owner_id
		)
		SELECT coalesce((
			SELECT jsonb_agg(jsonb_build_object('userId', u.id, 'displayName', u.display_name,
				'avatarColor', u.avatar_color, 'role', r.role, 'email',
				CASE WHEN access.role IN ('owner', 'admin') OR u.id = $2 THEN u.email ELSE '' END)
				ORDER BY (r.role <> 'owner'), lower(u.display_name), u.id)
			FROM roster r JOIN users u ON u.id = r.user_id
		), '[]'::jsonb)
		FROM access WHERE access.role IS NOT NULL
	`, teamID, actor).Scan(&members)
	return members, directoryLookupError(err)
}

func CreateTeamInvitation(ctx context.Context, teamID, actor uuid.UUID, email, role string) (TeamInvitation, error) {
	if role != "admin" && role != "member" {
		return TeamInvitation{}, ErrInvalidTeamRole
	}
	email = strings.ToLower(strings.TrimSpace(email))
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || len(email) > 254 {
		return TeamInvitation{}, ErrInvalidInviteEmail
	}
	token, digest, err := shareToken()
	if err != nil {
		return TeamInvitation{}, err
	}
	var invite TeamInvitation
	err = pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockTeam(ctx, tx, teamID); err != nil {
			return err
		}
		actorRole, err := teamRole(ctx, tx, teamID, actor)
		if err != nil {
			return err
		}
		if actorRole == "" {
			return ErrDirectoryNotFound
		}
		if !canManageTeamMember(actorRole, role) {
			return ErrDirectoryForbidden
		}
		var already bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM users WHERE email = $2 AND openjam_team_role($1, id) IS NOT NULL
		)`, teamID, email).Scan(&already); err != nil {
			return err
		}
		if already {
			return ErrAlreadyTeamMember
		}
		if _, err := tx.Exec(ctx, `UPDATE team_invitations SET revoked_at = statement_timestamp()
			WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, teamID, email); err != nil {
			return err
		}
		if err := checkShareLimit(tx.QueryRow(ctx, `SELECT count(*) >= $2 FROM team_invitations
			WHERE organization_id = $1 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > statement_timestamp()`,
			teamID, maxActiveBoardShares)); errors.Is(err, ErrTooManyActiveShares) {
			return ErrTooManyTeamInvites
		} else if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			INSERT INTO team_invitations (organization_id, email, role, token_hash, created_by, expires_at)
			VALUES ($1, $2, $3, $4, $5, statement_timestamp() + INTERVAL '7 days')
			RETURNING expires_at
		`, teamID, email, role, digest[:], actor).Scan(&invite.ExpiresAt)
	})
	if err != nil {
		return TeamInvitation{}, err
	}
	invite.Token = token
	return invite, nil
}

func AcceptTeamInvitation(ctx context.Context, teamID, actor uuid.UUID, token string) error {
	digest, err := shareTokenHash(token)
	if err != nil {
		return ErrInvalidTeamInvite
	}
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockTeam(ctx, tx, teamID); errors.Is(err, ErrDirectoryNotFound) {
			return ErrInvalidTeamInvite
		} else if err != nil {
			return err
		}
		var id uuid.UUID
		var role, inviterRole string
		var acceptedBy *uuid.UUID
		err := tx.QueryRow(ctx, `
			SELECT i.id, i.role, coalesce(openjam_team_role(i.organization_id, i.created_by), ''), i.accepted_by
			FROM team_invitations i JOIN users u ON u.id = $3 AND u.email = i.email
			WHERE i.organization_id = $1 AND i.token_hash = $2 AND i.revoked_at IS NULL
				AND ((i.accepted_at IS NULL AND i.expires_at > statement_timestamp()) OR i.accepted_by = $3)
		`, teamID, digest[:], actor).Scan(&id, &role, &inviterRole, &acceptedBy)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidTeamInvite
		}
		if err != nil {
			return err
		}
		if acceptedBy != nil {
			current, err := teamRole(ctx, tx, teamID, actor)
			if err != nil {
				return err
			}
			if *acceptedBy == actor && current != "" {
				return nil
			}
			return ErrInvalidTeamInvite
		}
		if !canManageTeamMember(inviterRole, role) {
			return ErrInvalidTeamInvite
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO team_members (organization_id, user_id, role) VALUES ($1, $2, $3)
			ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL
			WHERE team_members.revoked_at IS NOT NULL
		`, teamID, actor, role); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, "UPDATE team_invitations SET accepted_by = $2, accepted_at = statement_timestamp() WHERE id = $1", id, actor)
		return err
	})
}

func ChangeTeamMember(ctx context.Context, teamID, actor, member uuid.UUID, role string) ([]string, error) {
	if role != "" && role != "member" && role != "admin" {
		return nil, ErrInvalidTeamRole
	}
	var affected []string
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockTeam(ctx, tx, teamID); err != nil {
			return err
		}
		actorRole, err := teamRole(ctx, tx, teamID, actor)
		if err != nil {
			return err
		}
		if actorRole == "" {
			return ErrDirectoryNotFound
		}
		memberRole, err := teamRole(ctx, tx, teamID, member)
		if err != nil {
			return err
		}
		if memberRole == "" {
			return ErrDirectoryNotFound
		}
		canLeave := actor == member && role == "" && memberRole != "owner"
		if !canLeave && (!canManageTeamMember(actorRole, memberRole) || (role != "" && !canManageTeamMember(actorRole, role))) {
			return ErrDirectoryForbidden
		}
		if role != "" {
			if _, err := tx.Exec(ctx, "UPDATE team_members SET role = $3 WHERE organization_id = $1 AND user_id = $2", teamID, member, role); err != nil {
				return err
			}
			if role == "member" && memberRole == "admin" {
				_, err := tx.Exec(ctx, `UPDATE team_invitations SET revoked_at = statement_timestamp()
					WHERE organization_id = $1 AND created_by = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, teamID, member)
				return err
			}
			return nil
		}
		affected, err = revokeTeamMembership(ctx, tx, teamID, member)
		return err
	})
	return affected, err
}

func revokeTeamMembership(ctx context.Context, tx pgx.Tx, teamID, member uuid.UUID) ([]string, error) {
	// Serialize revocation with existing document and sharing writes. New
	// requests still check membership directly if an invalidation is delayed.
	rows, err := tx.Query(ctx, `
		SELECT r.id FROM rooms r JOIN board_directory d ON d.room_id = r.id
		JOIN projects p ON p.id = d.project_id JOIN workspaces w ON w.id = p.workspace_id
		WHERE w.organization_id = $1 ORDER BY r.id FOR UPDATE OF r
	`, teamID)
	if err != nil {
		return nil, err
	}
	boards, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `
		WITH revoked AS (
			UPDATE team_members SET revoked_at = statement_timestamp() WHERE organization_id = $1 AND user_id = $2
		), project_access AS (
			DELETE FROM project_members pm USING projects p, workspaces w
			WHERE pm.project_id = p.id AND p.workspace_id = w.id AND w.organization_id = $1 AND pm.user_id = $2
		), pending AS (
			UPDATE team_invitations SET revoked_at = statement_timestamp()
			WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
				AND (created_by = $2 OR email = (SELECT email FROM users WHERE id = $2))
		), board_access AS (
			DELETE FROM room_members WHERE room_id = ANY($3::varchar[]) AND user_id = $2
		), link_access AS (
			DELETE FROM board_share_link_grants WHERE room_id = ANY($3::varchar[]) AND user_id = $2
		)
		UPDATE board_share_invitations SET revoked_at = statement_timestamp()
		WHERE room_id = ANY($3::varchar[]) AND accepted_at IS NULL AND revoked_at IS NULL
			AND (created_by = $2 OR email = (SELECT email FROM users WHERE id = $2))
	`, teamID, member, boards)
	return boards, err
}

func ListProjectMembers(ctx context.Context, projectID, actor uuid.UUID) ([]ProjectMember, error) {
	var members []ProjectMember
	err := db.Pool().QueryRow(ctx, `
		WITH scoped AS (
			SELECT o.id, o.owner_id FROM projects p JOIN workspaces w ON w.id = p.workspace_id
			JOIN organizations o ON o.id = w.organization_id AND o.kind = 'team'
			WHERE p.id = $1 AND openjam_project_role(p.id, $2) = 'manager'
		), roster AS (
			SELECT owner_id AS user_id, 'manager' AS role, true AS inherited FROM scoped
			UNION ALL
			SELECT pm.user_id, pm.role, false FROM project_members pm CROSS JOIN scoped
			WHERE pm.project_id = $1 AND pm.user_id <> scoped.owner_id
				AND openjam_team_role(scoped.id, pm.user_id) IS NOT NULL
		)
		SELECT coalesce((
			SELECT jsonb_agg(jsonb_build_object('userId', u.id, 'displayName', u.display_name,
				'role', r.role, 'inherited', r.inherited) ORDER BY r.inherited DESC, lower(u.display_name), u.id)
			FROM roster r JOIN users u ON u.id = r.user_id
		), '[]'::jsonb) FROM scoped
	`, projectID, actor).Scan(&members)
	return members, directoryLookupError(err)
}

func ChangeProjectMember(ctx context.Context, projectID, actor, member uuid.UUID, role string) ([]string, error) {
	switch role {
	case "", "manager", "edit", "comment", "view":
	default:
		return nil, ErrInvalidProjectRole
	}
	var affected []string
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		var teamID uuid.UUID
		err := tx.QueryRow(ctx, `
			SELECT o.id FROM projects p JOIN workspaces w ON w.id = p.workspace_id
			JOIN organizations o ON o.id = w.organization_id AND o.kind = 'team'
			WHERE p.id = $1 FOR NO KEY UPDATE OF o
		`, projectID).Scan(&teamID)
		if err != nil {
			return directoryLookupError(err)
		}
		var actorRole string
		if err := tx.QueryRow(ctx, "SELECT coalesce(openjam_project_role($1, $2), '')", projectID, actor).Scan(&actorRole); err != nil {
			return err
		}
		if actorRole == "" {
			return ErrDirectoryNotFound
		}
		if actorRole != "manager" {
			return ErrDirectoryForbidden
		}
		memberRole, err := teamRole(ctx, tx, teamID, member)
		if err != nil {
			return err
		}
		if memberRole == "" {
			return ErrDirectoryNotFound
		}
		if memberRole == "owner" {
			return ErrDirectoryForbidden
		}
		rows, err := tx.Query(ctx, `
			SELECT r.id FROM rooms r JOIN board_directory d ON d.room_id = r.id
			WHERE d.project_id = $1 ORDER BY r.id FOR UPDATE OF r
		`, projectID)
		if err != nil {
			return err
		}
		affected, err = pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		if role == "" {
			_, err = tx.Exec(ctx, "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", projectID, member)
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
			ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
		`, projectID, member, role)
		return err
	})
	return affected, err
}
