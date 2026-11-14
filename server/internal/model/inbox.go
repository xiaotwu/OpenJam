package model

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/db"
)

var (
	ErrWorkshopInput    = errors.New("invalid workshop input")
	ErrWorkshopConflict = errors.New("this request ID already belongs to a different change")
)

type ThreadSummary struct {
	ID          uuid.UUID `json:"id"`
	TeamID      uuid.UUID `json:"teamId"`
	TeamName    string    `json:"teamName"`
	Kind        string    `json:"kind"`
	Subject     string    `json:"subject"`
	Contact     string    `json:"contact,omitempty"`
	Preview     string    `json:"preview"`
	UpdatedAt   time.Time `json:"updatedAt"`
	Unread      int       `json:"unread"`
	Pinned      bool      `json:"pinned"`
	StartedByMe bool      `json:"startedByMe"`
}

type BoardMention struct {
	ResourceKind string    `json:"resourceKind,omitempty"`
	BoardID      string    `json:"boardId"`
	BoardName    string    `json:"boardName"`
	CommentID    uuid.UUID `json:"commentId"`
	ThreadID     uuid.UUID `json:"threadId"`
	Author       string    `json:"author"`
	Preview      string    `json:"preview"`
	CreatedAt    time.Time `json:"createdAt"`
	Unread       bool      `json:"unread"`
	URL          string    `json:"url"`
}

type WorkshopInbox struct {
	Threads        []ThreadSummary `json:"threads"`
	Mentions       []BoardMention  `json:"mentions"`
	Meetings       []MeetingNotice `json:"meetings"`
	UnreadMeetings int             `json:"unreadMeetings"`
	Unread         int             `json:"unread"`
}

type WorkshopMessage struct {
	ID          uuid.UUID  `json:"id"`
	Sequence    int64      `json:"sequence"`
	Author      string     `json:"author"`
	AuthorID    *uuid.UUID `json:"authorId,omitempty"`
	AvatarColor string     `json:"avatarColor,omitempty"`
	Body        string     `json:"body"`
	Mine        bool       `json:"mine"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type WorkshopThread struct {
	Messages   []WorkshopMessage `json:"messages"`
	NextBefore *int64            `json:"nextBefore,omitempty"`
}

type NewWorkshopThread struct {
	ID          uuid.UUID  `json:"id"`
	TeamID      uuid.UUID  `json:"teamId"`
	RecipientID *uuid.UUID `json:"recipientId"`
	Subject     string     `json:"subject"`
	Body        string     `json:"body"`
}

type WorkshopThreadUpdate struct {
	Pinned      *bool  `json:"pinned,omitempty"`
	ReadThrough *int64 `json:"readThrough,omitempty"`
}

func validWorkshopText(value string, maxChars, maxBytes int) bool {
	return value != "" && !strings.ContainsRune(value, 0) &&
		utf8.RuneCountInString(value) <= maxChars && len(value) <= maxBytes
}

func ReadWorkshopInbox(ctx context.Context, actor uuid.UUID) (WorkshopInbox, error) {
	var inbox WorkshopInbox
	err := db.Pool().QueryRow(ctx, `
		WITH visible AS (
			SELECT t.*, o.name AS team_name, s.pinned_at, coalesce(s.read_through, 0) AS read_through
			FROM workshop_threads t JOIN organizations o ON o.id = t.team_id
			LEFT JOIN workshop_thread_state s ON s.thread_id = t.id AND s.user_id = $1
			WHERE openjam_workshop_thread_visible(t, $1)
		), cards AS (
			SELECT t.*, left(last.body, 160) AS preview, coalesce(u.display_name, '') AS contact,
				(SELECT count(*) FROM workshop_messages msg WHERE msg.thread_id = t.id
					AND msg.sequence > t.read_through AND msg.author_id IS DISTINCT FROM $1) AS unread
			FROM visible t
			JOIN LATERAL (SELECT body FROM workshop_messages msg WHERE msg.thread_id = t.id ORDER BY sequence DESC LIMIT 1) last ON true
			LEFT JOIN users u ON u.id = CASE WHEN t.creator_id = $1 THEN t.recipient_id ELSE t.creator_id END
		), notices AS (
			SELECT n.board_id, r.name, r.resource_kind, n.comment_id, c.thread_id, coalesce(u.display_name, '') AS author,
				left(c.body, 160) AS preview, n.created_at, n.read_at IS NULL AS unread
			FROM board_comment_notifications n JOIN board_comments c ON (c.board_id, c.id) = (n.board_id, n.comment_id)
			JOIN rooms r ON r.id = n.board_id
			CROSS JOIN LATERAL openjam_board_access(n.board_id, $1) access
			LEFT JOIN users u ON u.id = c.author_id
			WHERE n.user_id = $1 AND access.permission IS NOT NULL
		), meetings AS (
			SELECT a.id, a.title, a.starts_at, a.ends_at, a.meeting_created_at,
				coalesce(p.name, o.name, '') AS scope_name, openjam_meeting_status(a) AS status,
				(a.creator_id IS DISTINCT FROM $1 AND r.user_id IS NULL) AS unread
			FROM workshop_agenda a LEFT JOIN projects p ON p.id = a.project_id
			LEFT JOIN organizations o ON o.id = a.team_id
			LEFT JOIN workshop_meeting_reads r ON r.meeting_id = a.id AND r.user_id = $1
			WHERE a.kind = 'meeting' AND a.meeting_ended_at IS NULL AND a.ends_at > now() - INTERVAL '2 hours'
				AND openjam_agenda_visible(a, $1)
		)
		SELECT jsonb_build_object(
			'threads', coalesce((SELECT jsonb_agg(jsonb_build_object(
				'id', t.id, 'teamId', t.team_id, 'teamName', t.team_name, 'kind', t.kind, 'subject', t.subject,
				'contact', t.contact, 'preview', t.preview, 'updatedAt', t.updated_at, 'unread', t.unread,
				'pinned', t.pinned_at IS NOT NULL, 'startedByMe', coalesce(t.creator_id = $1, false))
				ORDER BY t.pinned_at DESC NULLS LAST, t.updated_at DESC, t.id)
				FROM (SELECT * FROM cards ORDER BY pinned_at DESC NULLS LAST, updated_at DESC, id LIMIT 100) t), '[]'::jsonb),
			'mentions', coalesce((SELECT jsonb_agg(jsonb_build_object(
				'boardId', board_id, 'boardName', name, 'resourceKind', resource_kind, 'commentId', comment_id, 'threadId', thread_id,
				'author', author, 'preview', preview, 'createdAt', created_at, 'unread', unread) ORDER BY created_at DESC, comment_id)
				FROM (SELECT * FROM notices ORDER BY created_at DESC, comment_id LIMIT 60) n), '[]'::jsonb),
			'meetings', coalesce((SELECT jsonb_agg(jsonb_build_object(
				'id', id, 'title', title, 'startsAt', starts_at, 'endsAt', ends_at,
				'scopeName', scope_name, 'status', status, 'unread', unread) ORDER BY meeting_created_at DESC, id)
				FROM (SELECT * FROM meetings ORDER BY meeting_created_at DESC, id LIMIT 60) recent), '[]'::jsonb),
			'unreadMeetings', (SELECT count(*) FROM meetings WHERE unread),
			'unread', coalesce((SELECT sum(unread) FROM cards), 0)
				+ (SELECT count(*) FROM notices WHERE unread) + (SELECT count(*) FROM meetings WHERE unread)
		)`, actor).Scan(&inbox)
	if err == nil {
		for i := range inbox.Mentions {
			item := &inbox.Mentions[i]
			item.URL = resourceSourceURL(item.ResourceKind, item.BoardID, "", "") + "?" + (url.Values{"thread": {item.ThreadID.String()}}).Encode()
		}
	}
	return inbox, err
}

func ReadWorkshopThread(ctx context.Context, actor, thread uuid.UUID, before int64) (WorkshopThread, error) {
	result := WorkshopThread{Messages: []WorkshopMessage{}}
	err := db.Pool().QueryRow(ctx, `
		SELECT coalesce((
			SELECT jsonb_agg(jsonb_build_object('id', id, 'sequence', sequence, 'body', body, 'author', author,
				'mine', mine, 'createdAt', created_at, 'authorId', author_id, 'avatarColor', avatar_color) ORDER BY sequence)
			FROM (
				SELECT m.id, m.sequence, m.body, m.created_at, m.author_id, coalesce(u.display_name, '') AS author,
					coalesce(u.avatar_color, '') AS avatar_color, coalesce(m.author_id = $1, false) AS mine
				FROM workshop_messages m LEFT JOIN users u ON u.id = m.author_id
				WHERE m.thread_id = t.id AND ($3::bigint = 0 OR m.sequence < $3)
				ORDER BY m.sequence DESC LIMIT 61
			) messages
		), '[]'::jsonb)
		FROM workshop_threads t WHERE t.id = $2 AND openjam_workshop_thread_visible(t, $1)
	`, actor, thread, before).Scan(&result.Messages)
	if len(result.Messages) == 61 {
		result.Messages = result.Messages[1:]
		result.NextBefore = &result.Messages[0].Sequence
	}
	return result, directoryLookupError(err)
}

func lockWorkshopTeam(ctx context.Context, tx pgx.Tx, actor, team uuid.UUID) error {
	var id uuid.UUID
	err := tx.QueryRow(ctx, "SELECT id FROM organizations WHERE id = $1 AND kind = 'team' FOR SHARE", team).Scan(&id)
	if err != nil {
		return directoryLookupError(err)
	}
	role, err := teamRole(ctx, tx, team, actor)
	if err == nil && role == "" {
		return ErrDirectoryNotFound
	}
	return err
}

func StartWorkshopThread(ctx context.Context, actor uuid.UUID, input NewWorkshopThread) error {
	input.Subject = strings.TrimSpace(input.Subject)
	input.Body = strings.TrimSpace(input.Body)
	if input.ID == uuid.Nil || input.TeamID == uuid.Nil ||
		!validWorkshopText(input.Subject, 140, 560) || !validWorkshopText(input.Body, 6000, 6000) ||
		(input.RecipientID != nil && (*input.RecipientID == uuid.Nil || *input.RecipientID == actor)) {
		return ErrWorkshopInput
	}
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockWorkshopTeam(ctx, tx, actor, input.TeamID); err != nil {
			return err
		}
		kind := "team"
		if input.RecipientID != nil {
			role, err := teamRole(ctx, tx, input.TeamID, *input.RecipientID)
			if err != nil {
				return err
			}
			if role == "" {
				return ErrDirectoryNotFound
			}
			kind = "direct"
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO workshop_threads (id, team_id, creator_id, recipient_id, kind, subject)
			VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING
		`, input.ID, input.TeamID, actor, input.RecipientID, kind, input.Subject); err != nil {
			return err
		}
		var matches bool
		if err := tx.QueryRow(ctx, `
			SELECT team_id = $2 AND creator_id = $3 AND recipient_id IS NOT DISTINCT FROM $4::uuid
				AND kind = $5 AND subject = $6
			FROM workshop_threads WHERE id = $1 FOR UPDATE
		`, input.ID, input.TeamID, actor, input.RecipientID, kind, input.Subject).Scan(&matches); err != nil {
			return err
		}
		if !matches {
			return ErrWorkshopConflict
		}
		return insertWorkshopMessage(ctx, tx, actor, input.ID, input.ID, input.Body)
	})
}

func lockWorkshopThread(ctx context.Context, tx pgx.Tx, actor, thread uuid.UUID) error {
	var team uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT team_id FROM workshop_threads t WHERE t.id = $1 AND openjam_workshop_thread_visible(t, $2)
	`, thread, actor).Scan(&team)
	if err != nil {
		return directoryLookupError(err)
	}
	if err := lockWorkshopTeam(ctx, tx, actor, team); err != nil {
		return err
	}
	return directoryLookupError(tx.QueryRow(ctx, `
		SELECT id FROM workshop_threads t WHERE t.id = $1 AND openjam_workshop_thread_visible(t, $2) FOR UPDATE
	`, thread, actor).Scan(&team))
}

func ReplyWorkshopThread(ctx context.Context, actor, thread, id uuid.UUID, body string) error {
	body = strings.TrimSpace(body)
	if id == uuid.Nil || !validWorkshopText(body, 6000, 6000) {
		return ErrWorkshopInput
	}
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockWorkshopThread(ctx, tx, actor, thread); err != nil {
			return err
		}
		var canReply bool
		err := tx.QueryRow(ctx, `
			SELECT kind = 'team' OR (openjam_team_role(team_id, creator_id) IS NOT NULL
				AND openjam_team_role(team_id, recipient_id) IS NOT NULL)
			FROM workshop_threads WHERE id = $1
		`, thread).Scan(&canReply)
		if err != nil {
			return err
		}
		if !canReply {
			return ErrDirectoryForbidden
		}
		return insertWorkshopMessage(ctx, tx, actor, thread, id, body)
	})
}

func insertWorkshopMessage(ctx context.Context, tx pgx.Tx, actor, thread, id uuid.UUID, body string) error {
	tag, err := tx.Exec(ctx, `
		INSERT INTO workshop_messages (thread_id, id, author_id, body)
		VALUES ($1, $2, $3, $4) ON CONFLICT (thread_id, id) DO NOTHING
	`, thread, id, actor, body)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var matches bool
		err = tx.QueryRow(ctx, "SELECT coalesce(author_id = $3, false) AND body = $4 FROM workshop_messages WHERE thread_id = $1 AND id = $2",
			thread, id, actor, body).Scan(&matches)
		if err == nil && !matches {
			return ErrWorkshopConflict
		}
		return err
	}
	_, err = tx.Exec(ctx, "UPDATE workshop_threads SET updated_at = clock_timestamp() WHERE id = $1", thread)
	return err
}

func UpdateWorkshopThread(ctx context.Context, actor, thread uuid.UUID, update WorkshopThreadUpdate) error {
	if (update.Pinned == nil && update.ReadThrough == nil) || (update.ReadThrough != nil && *update.ReadThrough < 0) {
		return ErrWorkshopInput
	}
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockWorkshopThread(ctx, tx, actor, thread); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO workshop_thread_state (thread_id, user_id, read_through, pinned_at)
			VALUES ($1, $2, least(coalesce($3::bigint, 0), coalesce((SELECT max(sequence) FROM workshop_messages WHERE thread_id = $1), 0)),
				CASE WHEN $4::boolean THEN clock_timestamp() END)
			ON CONFLICT (thread_id, user_id) DO UPDATE SET
				read_through = greatest(workshop_thread_state.read_through, EXCLUDED.read_through),
				pinned_at = CASE WHEN $4 IS NULL THEN workshop_thread_state.pinned_at
					WHEN $4 THEN coalesce(workshop_thread_state.pinned_at, EXCLUDED.pinned_at) END
		`, thread, actor, update.ReadThrough, update.Pinned)
		return err
	})
}
