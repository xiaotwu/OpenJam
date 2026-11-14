package agent

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/model"
)

type Fault struct {
	Status  int
	Code    string
	Message string
}

func (f *Fault) Error() string { return f.Message }

func invalid(message string) error {
	return &Fault{http.StatusBadRequest, "INVALID_AGENT_REQUEST", message}
}

func conflict(code, message string) error {
	return &Fault{http.StatusConflict, code, message}
}

var errDisabled = &Fault{http.StatusForbidden, "AI_DISABLED", "AI is disabled for this board."}
var errConsent = &Fault{http.StatusForbidden, "CLOUD_CONSENT_REQUIRED", "Confirm sending this run to the configured cloud model."}
var errContextPolicy = &Fault{http.StatusForbidden, "CLOUD_CONTEXT_DISABLED", "This organization has not enabled sending selected board text to the cloud model."}

type SettingsInput struct {
	Enabled           bool   `json:"enabled"`
	Provider          string `json:"provider"`
	Model             string `json:"model"`
	AllowBoardContext bool   `json:"allowBoardContext"`
}

type Settings struct {
	SettingsInput
	Choices        []Choice   `json:"choices"`
	OrganizationID *uuid.UUID `json:"organizationId,omitempty"`
	CanConfigure   bool       `json:"canConfigure"`
}

type policy struct {
	SettingsInput
	ID       uuid.UUID
	Revision int64
}

type policyScope struct {
	organizationID *uuid.UUID
	adminID        uuid.UUID
	team           bool
}

type queryRow interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func requireEditor(ctx context.Context, query queryRow, boardID string, actor uuid.UUID) error {
	access, err := model.QueryRoomAccess(ctx, query, boardID, actor)
	if err != nil {
		return err
	}
	if !access.IsOwner && !model.RoomPermissionAllowsEdit(access.Permission) {
		return model.ErrRoomAccessDenied
	}
	return nil
}

func boardPolicyScope(ctx context.Context, query queryRow, boardID string) (policyScope, error) {
	var scope policyScope
	err := query.QueryRow(ctx, `
		SELECT coalesce(o.id, personal.id), coalesce(o.owner_id, r.owner_id), coalesce(o.kind = 'team', false)
		FROM rooms r
		LEFT JOIN board_directory d ON d.room_id = r.id
		LEFT JOIN projects p ON p.id = d.project_id
		LEFT JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN organizations o ON o.id = w.organization_id
		LEFT JOIN organizations personal ON personal.owner_id = r.owner_id AND personal.kind = 'personal'
		WHERE r.id = $1
	`, boardID).Scan(&scope.organizationID, &scope.adminID, &scope.team)
	if errors.Is(err, pgx.ErrNoRows) {
		return policyScope{}, model.ErrRoomNotFound
	}
	return scope, err
}

func (scope policyScope) keys() (organization, owner *uuid.UUID) {
	if scope.team {
		return scope.organizationID, nil
	}
	return nil, &scope.adminID
}

func readPolicy(ctx context.Context, query queryRow, scope policyScope, lock bool) (policy, error) {
	organization, owner := scope.keys()
	sql := `SELECT id, revision, enabled, provider, model, allow_board_context FROM agent_policies
		WHERE organization_id = $1 OR personal_owner_id = $2`
	if lock {
		sql += " FOR SHARE"
	}
	var result policy
	err := query.QueryRow(ctx, sql, organization, owner).Scan(
		&result.ID, &result.Revision, &result.Enabled, &result.Provider, &result.Model, &result.AllowBoardContext)
	if errors.Is(err, pgx.ErrNoRows) {
		return policy{}, nil
	}
	return result, err
}

func effectiveSettings(config Config, scope policyScope, policy policy, actor uuid.UUID) Settings {
	value := policy.SettingsInput
	if _, available := config.choice(value.Provider, value.Model); !available {
		value.Enabled = false
	}
	return Settings{
		SettingsInput: value, Choices: append([]Choice{}, config.choices...),
		OrganizationID: scope.organizationID, CanConfigure: scope.adminID == actor,
	}
}

func ReadSettings(ctx context.Context, config Config, boardID string, actor uuid.UUID) (Settings, error) {
	var result Settings
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if err := requireEditor(ctx, tx, boardID, actor); err != nil {
			return err
		}
		scope, err := boardPolicyScope(ctx, tx, boardID)
		if err != nil {
			return err
		}
		value, err := readPolicy(ctx, tx, scope, false)
		result = effectiveSettings(config, scope, value, actor)
		return err
	})
	return result, err
}

func SetBoardSettings(ctx context.Context, config Config, boardID string, actor uuid.UUID, input SettingsInput) (Settings, error) {
	var result Settings
	err := writeTx(ctx, func(tx pgx.Tx) error {
		var locked string
		err := tx.QueryRow(ctx, `SELECT id FROM rooms WHERE id = $1 FOR UPDATE`, boardID).Scan(&locked)
		if errors.Is(err, pgx.ErrNoRows) {
			return model.ErrRoomNotFound
		}
		if err != nil {
			return err
		}
		if err := requireEditor(ctx, tx, boardID, actor); err != nil {
			return err
		}
		scope, err := boardPolicyScope(ctx, tx, boardID)
		if err != nil {
			return err
		}
		result, err = setSettings(ctx, tx, config, scope, actor, input)
		return err
	})
	return result, err
}

func SetOrganizationSettings(ctx context.Context, config Config, id, actor uuid.UUID, input SettingsInput) (Settings, error) {
	var result Settings
	err := writeTx(ctx, func(tx pgx.Tx) error {
		scope := policyScope{organizationID: &id}
		err := tx.QueryRow(ctx, `SELECT owner_id, kind = 'team' FROM organizations WHERE id = $1 FOR SHARE`, id).
			Scan(&scope.adminID, &scope.team)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && scope.adminID != actor) {
			return model.ErrDirectoryNotFound
		}
		if err != nil {
			return err
		}
		result, err = setSettings(ctx, tx, config, scope, actor, input)
		return err
	})
	return result, err
}

func setSettings(ctx context.Context, tx pgx.Tx, config Config, scope policyScope, actor uuid.UUID, input SettingsInput) (Settings, error) {
	if scope.adminID != actor {
		return Settings{}, model.ErrRoomAccessDenied
	}
	if _, configured := config.choice(input.Provider, input.Model); !configured {
		if input.Enabled {
			return Settings{}, invalid("Choose a model configured on this deployment.")
		}
		input.Provider, input.Model = "", ""
	}
	organization, owner := scope.keys()
	key := "personal_owner_id"
	if scope.team {
		key = "organization_id"
	}
	_, err := tx.Exec(ctx, `INSERT INTO agent_policies
		(organization_id, personal_owner_id, enabled, provider, model, allow_board_context, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (`+key+`) DO UPDATE SET
			enabled = excluded.enabled, provider = excluded.provider, model = excluded.model,
			allow_board_context = excluded.allow_board_context, updated_by = excluded.updated_by,
			updated_at = clock_timestamp(), revision = agent_policies.revision + CASE WHEN
				(agent_policies.enabled, agent_policies.provider, agent_policies.model, agent_policies.allow_board_context)
				IS DISTINCT FROM (excluded.enabled, excluded.provider, excluded.model, excluded.allow_board_context)
				THEN 1 ELSE 0 END`,
		organization, owner, input.Enabled, input.Provider, input.Model, input.AllowBoardContext, actor)
	if err != nil {
		return Settings{}, err
	}
	return effectiveSettings(config, scope, policy{SettingsInput: input}, actor), nil
}

func writeTx(ctx context.Context, apply func(pgx.Tx) error) error {
	return pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, apply)
}
