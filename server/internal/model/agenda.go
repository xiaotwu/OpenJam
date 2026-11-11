package model

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

type AgendaDraft struct {
	TeamID    *uuid.UUID `json:"teamId,omitempty"`
	ProjectID *uuid.UUID `json:"projectId,omitempty"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Notes     string     `json:"notes"`
	StartsAt  time.Time  `json:"startsAt"`
	EndsAt    time.Time  `json:"endsAt"`
	Completed bool       `json:"completed"`
	Revision  int64      `json:"revision,omitempty"`
}

type AgendaItem struct {
	AgendaDraft
	ID        uuid.UUID `json:"id"`
	Editable  bool      `json:"editable"`
	ScopeName string    `json:"scopeName,omitempty"`
}

type RecentResource struct {
	ResourceKind string    `json:"resourceKind"`
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Context      string    `json:"context,omitempty"`
	OpenedAt     time.Time `json:"openedAt"`
	URL          string    `json:"url"`
}

func ReadAgenda(ctx context.Context, actor uuid.UUID, from, to time.Time) ([]AgendaItem, error) {
	if !to.After(from) || to.Sub(from) > 100*24*time.Hour {
		return nil, ErrWorkshopInput
	}
	items := []AgendaItem{}
	err := db.Pool().QueryRow(ctx, `
		SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'teamId', a.team_id, 'projectId', a.project_id,
			'kind', a.kind, 'title', a.title, 'notes', a.notes, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
			'completed', a.completed, 'revision', a.revision, 'editable', a.editable,
			'scopeName', coalesce(p.name, o.name, '')) ORDER BY a.starts_at, a.id), '[]'::jsonb)
		FROM (
			SELECT item.*, openjam_agenda_editable(item, $1) AS editable FROM workshop_agenda item
			WHERE item.starts_at < $3 AND item.ends_at >= $2 AND openjam_agenda_visible(item, $1)
			ORDER BY item.starts_at, item.id LIMIT 500
		) a
		LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN organizations o ON o.id = a.team_id
	`, actor, from, to).Scan(&items)
	return items, err
}

func lockAgendaScope(ctx context.Context, tx pgx.Tx, actor uuid.UUID, input AgendaDraft) error {
	if input.TeamID != nil {
		return lockWorkshopTeam(ctx, tx, actor, *input.TeamID)
	}
	if input.ProjectID == nil {
		return nil
	}
	var organization uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT o.id FROM projects p JOIN workspaces w ON w.id = p.workspace_id
		JOIN organizations o ON o.id = w.organization_id WHERE p.id = $1 FOR SHARE OF o
	`, *input.ProjectID).Scan(&organization)
	if err != nil {
		return directoryLookupError(err)
	}
	var role *string
	if err := tx.QueryRow(ctx, "SELECT openjam_project_role($1, $2)", *input.ProjectID, actor).Scan(&role); err != nil {
		return err
	}
	if role == nil {
		return ErrDirectoryNotFound
	}
	if *role != "manager" && *role != "edit" {
		return ErrDirectoryForbidden
	}
	return nil
}

func SaveAgendaItem(ctx context.Context, actor, id uuid.UUID, input AgendaDraft) error {
	input.Title = strings.TrimSpace(input.Title)
	input.Notes = strings.TrimSpace(input.Notes)
	if id == uuid.Nil || (input.TeamID != nil && input.ProjectID != nil) ||
		(input.Kind != "task" && input.Kind != "event") || (input.Kind != "task" && input.Completed) ||
		!validWorkshopText(input.Title, 140, 560) || strings.ContainsRune(input.Notes, 0) || len(input.Notes) > 3600 ||
		input.StartsAt.IsZero() || input.EndsAt.Before(input.StartsAt) || input.EndsAt.Sub(input.StartsAt) > 366*24*time.Hour ||
		input.Revision < 0 {
		return ErrWorkshopInput
	}
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockAgendaScope(ctx, tx, actor, input); err != nil {
			return err
		}
		var revision int64
		var sameScope, canEdit, sameContents bool
		err := tx.QueryRow(ctx, `
			SELECT a.revision, a.team_id IS NOT DISTINCT FROM $3::uuid AND a.project_id IS NOT DISTINCT FROM $4::uuid,
				openjam_agenda_editable(a, $2),
				(a.kind, a.title, a.notes, a.starts_at, a.ends_at, a.completed) = ($5, $6, $7, $8, $9, $10)
			FROM workshop_agenda a WHERE a.id = $1 AND openjam_agenda_visible(a, $2) FOR UPDATE
		`, id, actor, input.TeamID, input.ProjectID, input.Kind, input.Title, input.Notes, input.StartsAt,
			input.EndsAt, input.Completed).Scan(&revision, &sameScope, &canEdit, &sameContents)
		if errors.Is(err, pgx.ErrNoRows) {
			if input.Revision != 0 {
				return ErrDirectoryNotFound
			}
			tag, err := tx.Exec(ctx, `
				INSERT INTO workshop_agenda (id, creator_id, team_id, project_id, kind, title, notes, starts_at, ends_at, completed)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING
			`, id, actor, input.TeamID, input.ProjectID, input.Kind, input.Title, input.Notes, input.StartsAt, input.EndsAt, input.Completed)
			if err == nil && tag.RowsAffected() == 0 {
				return ErrWorkshopConflict
			}
			return err
		}
		if err != nil {
			return err
		}
		if !canEdit {
			return ErrDirectoryForbidden
		}
		if !sameScope || (revision != input.Revision && !sameContents) {
			return ErrWorkshopConflict
		}
		if sameContents {
			return nil
		}
		_, err = tx.Exec(ctx, `
			UPDATE workshop_agenda SET kind = $2, title = $3, notes = $4, starts_at = $5,
				ends_at = $6, completed = $7, revision = revision + 1 WHERE id = $1
		`, id, input.Kind, input.Title, input.Notes, input.StartsAt, input.EndsAt, input.Completed)
		return err
	})
}

func DeleteAgendaItem(ctx context.Context, actor, id uuid.UUID, revision int64) error {
	if revision <= 0 {
		return ErrWorkshopInput
	}
	tag, err := db.Pool().Exec(ctx, `
		DELETE FROM workshop_agenda item WHERE item.id = $1 AND openjam_agenda_editable(item, $2) AND item.revision = $3
	`, id, actor, revision)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrDirectoryNotFound
	}
	return err
}

func RecordRecentResource(ctx context.Context, actor uuid.UUID, board string) error {
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if _, err := QueryRoomAccess(ctx, tx, board, actor); err != nil {
			return err
		}
		var id uuid.UUID
		if err := tx.QueryRow(ctx, "SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE", actor).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO workshop_recents (user_id, board_id) VALUES ($1, $2)
			ON CONFLICT (user_id, board_id) DO UPDATE SET opened_at = clock_timestamp()
		`, actor, board); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			DELETE FROM workshop_recents WHERE user_id = $1 AND (
				opened_at < now() - INTERVAL '90 days' OR board_id IN (
					SELECT board_id FROM workshop_recents WHERE user_id = $1 ORDER BY opened_at DESC, board_id OFFSET 120
				)
			)
		`, actor)
		return err
	})
}

func ReadRecentResources(ctx context.Context, actor uuid.UUID) ([]RecentResource, error) {
	items := []RecentResource{}
	err := db.Pool().QueryRow(ctx, `
		SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', name, 'context', context,
			'openedAt', opened_at, 'resourceKind', resource_kind) ORDER BY opened_at DESC, id), '[]'::jsonb)
		FROM (
			SELECT r.id, r.name, r.resource_kind, rec.opened_at, coalesce(p.name, '') AS context
			FROM workshop_recents rec JOIN rooms r ON r.id = rec.board_id
			CROSS JOIN LATERAL openjam_board_access(r.id, $1) access
			LEFT JOIN board_directory d ON d.room_id = r.id
			LEFT JOIN projects p ON p.id = d.project_id AND openjam_project_role(p.id, $1) IS NOT NULL
			WHERE rec.user_id = $1 AND rec.opened_at >= now() - INTERVAL '90 days'
				AND access.permission IS NOT NULL AND d.archived_at IS NULL
			ORDER BY rec.opened_at DESC, r.id LIMIT 40
		) visible
	`, actor).Scan(&items)
	if err == nil {
		for i := range items {
			items[i].URL = resourceSourceURL(items[i].ResourceKind, items[i].ID, "", "")
		}
	}
	return items, err
}
