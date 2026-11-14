package model

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/db"
)

type MeetingDraft struct {
	TeamID    *uuid.UUID `json:"teamId,omitempty"`
	ProjectID *uuid.UUID `json:"projectId,omitempty"`
	Title     string     `json:"title"`
	StartsAt  *time.Time `json:"startsAt,omitempty"`
	EndsAt    *time.Time `json:"endsAt,omitempty"`
}

type MeetingSummary struct {
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	ScopeName string    `json:"scopeName"`
	StartsAt  time.Time `json:"startsAt"`
	EndsAt    time.Time `json:"endsAt"`
	Status    string    `json:"status"`
}

type Meeting struct {
	MeetingSummary
	Organizer string `json:"organizer"`
	CanEnd    bool   `json:"canEnd"`
}

type MeetingNotice struct {
	MeetingSummary
	Unread bool `json:"unread"`
}

func CreateMeeting(ctx context.Context, actor, id uuid.UUID, input MeetingDraft) error {
	input.Title = strings.TrimSpace(input.Title)
	instant := input.StartsAt == nil && input.EndsAt == nil
	if id == uuid.Nil || (input.TeamID == nil) == (input.ProjectID == nil) ||
		!validWorkshopText(input.Title, 140, 560) {
		return ErrWorkshopInput
	}
	if !instant {
		if input.StartsAt == nil || input.EndsAt == nil || input.StartsAt.IsZero() ||
			!input.EndsAt.After(*input.StartsAt) || input.EndsAt.Sub(*input.StartsAt) > 24*time.Hour {
			return ErrWorkshopInput
		}
	}
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockAgendaScope(ctx, tx, actor, AgendaDraft{TeamID: input.TeamID, ProjectID: input.ProjectID}); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO workshop_agenda (id, creator_id, team_id, project_id, kind, title, starts_at, ends_at, meeting_created_at)
			SELECT $1, $2, $3, $4, 'meeting', $5, coalesce($6, now()), coalesce($7, now() + INTERVAL '1 hour'), now()
			WHERE coalesce($7::timestamptz, now() + INTERVAL '1 hour') > now()
			ON CONFLICT (id) DO NOTHING
		`, id, actor, input.TeamID, input.ProjectID, input.Title, input.StartsAt, input.EndsAt)
		if err != nil || tag.RowsAffected() == 1 {
			return err
		}
		var same bool
		err = tx.QueryRow(ctx, `
			SELECT kind = 'meeting' AND creator_id IS NOT DISTINCT FROM $2::uuid AND team_id IS NOT DISTINCT FROM $3::uuid
				AND project_id IS NOT DISTINCT FROM $4::uuid AND title = $5
				AND CASE WHEN $8 THEN starts_at = meeting_created_at ELSE starts_at = $6 AND ends_at = $7 END
			FROM workshop_agenda WHERE id = $1
		`, id, actor, input.TeamID, input.ProjectID, input.Title, input.StartsAt, input.EndsAt, instant).Scan(&same)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrWorkshopInput
		}
		if err != nil {
			return err
		}
		if !same {
			return ErrWorkshopConflict
		}
		return nil
	})
}

func ReadMeeting(ctx context.Context, actor, id uuid.UUID) (Meeting, error) {
	var meeting Meeting
	err := db.Pool().QueryRow(ctx, `
		SELECT a.id, a.title, coalesce(p.name, o.name, ''), a.starts_at, a.ends_at,
			openjam_meeting_status(a), coalesce(u.display_name, ''), openjam_agenda_editable(a, $2)
		FROM workshop_agenda a LEFT JOIN projects p ON p.id = a.project_id
		LEFT JOIN organizations o ON o.id = a.team_id LEFT JOIN users u ON u.id = a.creator_id
		WHERE a.id = $1 AND a.kind = 'meeting' AND openjam_agenda_visible(a, $2)
	`, id, actor).Scan(&meeting.ID, &meeting.Title, &meeting.ScopeName, &meeting.StartsAt,
		&meeting.EndsAt, &meeting.Status, &meeting.Organizer, &meeting.CanEnd)
	return meeting, directoryLookupError(err)
}

func EndMeeting(ctx context.Context, actor, id uuid.UUID) error {
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		var scope AgendaDraft
		err := tx.QueryRow(ctx, `
			SELECT a.team_id, a.project_id FROM workshop_agenda a
			WHERE a.id = $1 AND a.kind = 'meeting' AND openjam_agenda_visible(a, $2)
		`, id, actor).Scan(&scope.TeamID, &scope.ProjectID)
		if err != nil {
			return directoryLookupError(err)
		}
		if err := lockAgendaScope(ctx, tx, actor, scope); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE workshop_agenda a SET meeting_ended_at = coalesce(meeting_ended_at, clock_timestamp())
			WHERE id = $1 AND kind = 'meeting' AND openjam_agenda_editable(a, $2)
		`, id, actor)
		if err == nil && tag.RowsAffected() == 0 {
			return ErrDirectoryForbidden
		}
		return err
	})
}

func MarkMeetingRead(ctx context.Context, actor, id uuid.UUID) error {
	var visible bool
	err := db.Pool().QueryRow(ctx, `
		WITH item AS (
			SELECT id FROM workshop_agenda a
			WHERE a.id = $1 AND a.kind = 'meeting' AND openjam_agenda_visible(a, $2)
		), marked AS (
			INSERT INTO workshop_meeting_reads (meeting_id, user_id)
			SELECT id, $2 FROM item ON CONFLICT DO NOTHING
		)
		SELECT EXISTS(SELECT 1 FROM item)
	`, id, actor).Scan(&visible)
	if err == nil && !visible {
		return ErrDirectoryNotFound
	}
	return err
}

// MeetingParticipants reads the room's live status and the allowed media identities
// in one statement. Each media identity belongs to one unexpired Shiori session.
func MeetingParticipants(ctx context.Context, id uuid.UUID, identities []uuid.UUID) (bool, []uuid.UUID, error) {
	var allowed []uuid.UUID
	var open bool
	err := db.Pool().QueryRow(ctx, `
		SELECT coalesce((SELECT openjam_meeting_status(a) = 'open' FROM workshop_agenda a
			WHERE a.id = $1 AND a.kind = 'meeting'), false),
			ARRAY(SELECT s.meeting_identity FROM workshop_agenda a CROSS JOIN sessions s
				WHERE a.id = $1 AND a.kind = 'meeting' AND s.meeting_identity = ANY($2::uuid[])
				AND s.expires_at > now() AND openjam_agenda_visible(a, s.user_id))
	`, id, identities).Scan(&open, &allowed)
	return open, allowed, err
}
