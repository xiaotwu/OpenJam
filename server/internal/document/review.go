package document

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/model"
)

type ReviewAnchor struct {
	PageID    string   `json:"pageId"`
	ElementID string   `json:"elementId,omitempty"`
	X         *float64 `json:"x,omitempty"`
	Y         *float64 `json:"y,omitempty"`
}

type ReviewAnchorStatus struct {
	ReviewAnchor
	PageName      string `json:"pageName"`
	CurrentPageID string `json:"currentPageId,omitempty"`
	Status        string `json:"status"`
}

type ReviewThread struct {
	ID           uuid.UUID          `json:"id"`
	Anchor       ReviewAnchorStatus `json:"anchor"`
	AuthorID     uuid.UUID          `json:"authorId"`
	AuthorName   string             `json:"authorName"`
	Body         string             `json:"body"`
	CommentCount int                `json:"commentCount"`
	ResolvedAt   *time.Time         `json:"resolvedAt,omitempty"`
	ResolvedBy   *uuid.UUID         `json:"resolvedBy,omitempty"`
	CreatedAt    time.Time          `json:"createdAt"`
	UpdatedAt    time.Time          `json:"updatedAt"`
	CanResolve   bool               `json:"canResolve"`
}

type ReviewComment struct {
	ID             uuid.UUID   `json:"id"`
	ThreadID       uuid.UUID   `json:"threadId"`
	AuthorID       uuid.UUID   `json:"authorId"`
	AuthorName     string      `json:"authorName"`
	Body           string      `json:"body"`
	MentionUserIDs []uuid.UUID `json:"mentionUserIds"`
	CreatedAt      time.Time   `json:"createdAt"`
	UpdatedAt      time.Time   `json:"updatedAt"`
}

type ReviewThreads struct {
	Threads     []ReviewThread `json:"threads"`
	NextCursor  *uuid.UUID     `json:"nextCursor,omitempty"`
	CanComment  bool           `json:"canComment"`
	UnreadCount int            `json:"unreadCount"`
}

type ReviewThreadDetail struct {
	Thread     ReviewThread    `json:"thread"`
	Comments   []ReviewComment `json:"comments"`
	NextCursor *uuid.UUID      `json:"nextCursor,omitempty"`
	CanComment bool            `json:"canComment"`
}

type ReviewPerson struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"displayName"`
	AvatarColor string    `json:"avatarColor"`
}

type ReviewNotification struct {
	CommentID  uuid.UUID  `json:"commentId"`
	ThreadID   uuid.UUID  `json:"threadId"`
	AuthorName string     `json:"authorName"`
	Preview    string     `json:"preview"`
	CreatedAt  time.Time  `json:"createdAt"`
	ReadAt     *time.Time `json:"readAt,omitempty"`
}

var ErrReviewNotFound = errors.New("comment or review thread not found")

func reviewTransaction(ctx context.Context, boardID string, actor uuid.UUID, write bool, work func(pgx.Tx, *model.RoomAccess) error) error {
	options := pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	if write {
		options = pgx.TxOptions{IsoLevel: pgx.ReadCommitted}
	}
	return pgx.BeginTxFunc(ctx, db.Pool(), options, func(tx pgx.Tx) error {
		if write {
			if _, err := lockRoom(ctx, tx, boardID); err != nil {
				return err
			}
		}
		access, err := model.QueryRoomAccess(ctx, tx, boardID, actor)
		if err != nil {
			return err
		}
		if _, err = activeHead(ctx, tx, boardID); err != nil {
			return err
		}
		return work(tx, access)
	})
}

func canReview(access *model.RoomAccess) bool {
	return access.IsOwner || access.Permission == model.RoomPermissionEdit || access.Permission == model.RoomPermissionComment
}

func canResolveReview(access *model.RoomAccess, actor, author uuid.UUID) bool {
	return canReview(access) && (access.IsOwner || access.Permission == model.RoomPermissionEdit || actor == author)
}

const reviewThreadFields = `
	SELECT t.id, t.created_by, COALESCE(u.display_name, 'Former member'), root.body, t.comment_count,
		t.resolved_at, t.resolved_by, t.created_at, t.updated_at,
		t.page_id, t.page_name, COALESCE(t.element_id, ''), t.anchor_x, t.anchor_y,
		COALESCE(p.id, ''), CASE
			WHEN p.id IS NULL THEN 'missing-page'
			WHEN t.element_id IS NOT NULL AND e.id IS NULL THEN 'missing-object'
			WHEN p.id <> t.page_id THEN 'moved'
			ELSE 'live' END
	FROM board_comment_threads t
	JOIN board_comments root ON root.board_id = t.board_id AND root.id = t.id
	LEFT JOIN users u ON u.id = t.created_by
	LEFT JOIN board_elements e ON e.board_id = t.board_id AND e.id = t.element_id AND NOT e.deleted
	LEFT JOIN board_pages p ON p.board_id = t.board_id AND p.id = COALESCE(e.page_id, t.page_id) AND NOT p.deleted
`

type reviewRow interface {
	Scan(...any) error
}

func scanReviewThread(row reviewRow, access *model.RoomAccess, actor uuid.UUID) (ReviewThread, error) {
	var thread ReviewThread
	err := row.Scan(&thread.ID, &thread.AuthorID, &thread.AuthorName, &thread.Body, &thread.CommentCount,
		&thread.ResolvedAt, &thread.ResolvedBy, &thread.CreatedAt, &thread.UpdatedAt,
		&thread.Anchor.PageID, &thread.Anchor.PageName, &thread.Anchor.ElementID, &thread.Anchor.X, &thread.Anchor.Y,
		&thread.Anchor.CurrentPageID, &thread.Anchor.Status)
	thread.CanResolve = canResolveReview(access, actor, thread.AuthorID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrReviewNotFound
	}
	return thread, err
}

func findReviewThread(ctx context.Context, tx pgx.Tx, boardID string, actor uuid.UUID, access *model.RoomAccess, threadID uuid.UUID) (ReviewThread, error) {
	return scanReviewThread(tx.QueryRow(ctx, reviewThreadFields+`WHERE t.board_id = $1 AND t.id = $2`, boardID, threadID), access, actor)
}

func ListReviewThreads(ctx context.Context, boardID string, actor uuid.UUID, filter string, cursor *uuid.UUID, limit int) (ReviewThreads, error) {
	result := ReviewThreads{Threads: []ReviewThread{}}
	err := reviewTransaction(ctx, boardID, actor, false, func(tx pgx.Tx, access *model.RoomAccess) error {
		result.CanComment = canReview(access)
		if err := tx.QueryRow(ctx, `
			SELECT count(*) FROM board_comment_notifications WHERE board_id = $1 AND user_id = $2 AND read_at IS NULL
		`, boardID, actor).Scan(&result.UnreadCount); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, reviewThreadFields+`
			WHERE t.board_id = $1
			AND ($2 = 'all' OR ($2 = 'open' AND t.resolved_at IS NULL)
				OR ($2 = 'resolved' AND t.resolved_at IS NOT NULL)
				OR ($2 = 'mentioned' AND EXISTS (
					SELECT 1 FROM board_comment_notifications n
					JOIN board_comments c ON c.board_id = n.board_id AND c.id = n.comment_id
					WHERE c.board_id = t.board_id AND c.thread_id = t.id AND n.user_id = $3
				)))
			AND ($4::uuid IS NULL OR (t.created_at, t.id) < (
				SELECT cursor.created_at, cursor.id FROM board_comment_threads cursor
				WHERE cursor.board_id = $1 AND cursor.id = $4
			))
			ORDER BY t.created_at DESC, t.id DESC LIMIT $5
		`, boardID, filter, actor, cursor, limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if len(result.Threads) == limit {
				result.NextCursor = &result.Threads[limit-1].ID
				break
			}
			thread, err := scanReviewThread(rows, access, actor)
			if err != nil {
				return err
			}
			result.Threads = append(result.Threads, thread)
		}
		return rows.Err()
	})
	return result, err
}

const reviewCommentFields = `
	SELECT c.id, c.thread_id, c.author_id, COALESCE(u.display_name, 'Former member'),
		c.body, c.mention_user_ids, c.created_at, c.updated_at
	FROM board_comments c
	LEFT JOIN users u ON u.id = c.author_id
`

func scanReviewComment(row reviewRow) (ReviewComment, error) {
	var comment ReviewComment
	err := row.Scan(&comment.ID, &comment.ThreadID, &comment.AuthorID, &comment.AuthorName,
		&comment.Body, &comment.MentionUserIDs, &comment.CreatedAt, &comment.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrReviewNotFound
	}
	return comment, err
}

func findReviewComment(ctx context.Context, tx pgx.Tx, boardID string, threadID, commentID uuid.UUID) (ReviewComment, error) {
	return scanReviewComment(tx.QueryRow(ctx, reviewCommentFields+`
		WHERE c.board_id = $1 AND c.thread_id = $2 AND c.id = $3
	`, boardID, threadID, commentID))
}

func GetReviewThread(ctx context.Context, boardID string, actor, threadID uuid.UUID, cursor *uuid.UUID, limit int) (ReviewThreadDetail, error) {
	result := ReviewThreadDetail{Comments: []ReviewComment{}}
	err := reviewTransaction(ctx, boardID, actor, false, func(tx pgx.Tx, access *model.RoomAccess) error {
		thread, err := findReviewThread(ctx, tx, boardID, actor, access, threadID)
		if err != nil {
			return err
		}
		result.Thread, result.CanComment = thread, canReview(access)
		rows, err := tx.Query(ctx, reviewCommentFields+`
			WHERE c.board_id = $1 AND c.thread_id = $2
			AND ($3::uuid IS NULL OR (c.created_at, c.id) > (
				SELECT cursor.created_at, cursor.id FROM board_comments cursor
				WHERE cursor.board_id = $1 AND cursor.thread_id = $2 AND cursor.id = $3
			))
			ORDER BY c.created_at, c.id LIMIT $4
		`, boardID, threadID, cursor, limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if len(result.Comments) == limit {
				result.NextCursor = &result.Comments[limit-1].ID
				break
			}
			comment, err := scanReviewComment(rows)
			if err != nil {
				return err
			}
			result.Comments = append(result.Comments, comment)
		}
		return rows.Err()
	})
	return result, err
}

func ListReviewPeople(ctx context.Context, boardID string, actor uuid.UUID) ([]ReviewPerson, error) {
	people := []ReviewPerson{}
	err := reviewTransaction(ctx, boardID, actor, false, func(tx pgx.Tx, access *model.RoomAccess) error {
		if !canReview(access) {
			return model.ErrRoomAccessDenied
		}
		rows, err := tx.Query(ctx, `
			SELECT u.id, u.display_name, u.avatar_color
			FROM users u JOIN (
				SELECT owner_id AS user_id FROM rooms WHERE id = $1
				UNION SELECT user_id FROM room_members WHERE room_id = $1
			) members ON members.user_id = u.id
			WHERE u.id <> $2 ORDER BY lower(u.display_name), u.id LIMIT 100
		`, boardID, actor)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var person ReviewPerson
			if err := rows.Scan(&person.ID, &person.DisplayName, &person.AvatarColor); err != nil {
				return err
			}
			people = append(people, person)
		}
		return rows.Err()
	})
	return people, err
}

func ListReviewNotifications(ctx context.Context, boardID string, actor uuid.UUID, limit int) ([]ReviewNotification, error) {
	notifications := []ReviewNotification{}
	err := reviewTransaction(ctx, boardID, actor, false, func(tx pgx.Tx, _ *model.RoomAccess) error {
		rows, err := tx.Query(ctx, `
			SELECT n.comment_id, c.thread_id, COALESCE(u.display_name, 'Former member'), left(c.body, 160), n.created_at, n.read_at
			FROM board_comment_notifications n
			JOIN board_comments c ON c.board_id = n.board_id AND c.id = n.comment_id
			LEFT JOIN users u ON u.id = c.author_id
			WHERE n.board_id = $1 AND n.user_id = $2
			ORDER BY (n.read_at IS NULL) DESC, n.created_at DESC, n.comment_id DESC LIMIT $3
		`, boardID, actor, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var notification ReviewNotification
			if err := rows.Scan(&notification.CommentID, &notification.ThreadID, &notification.AuthorName,
				&notification.Preview, &notification.CreatedAt, &notification.ReadAt); err != nil {
				return err
			}
			notifications = append(notifications, notification)
		}
		return rows.Err()
	})
	return notifications, err
}
