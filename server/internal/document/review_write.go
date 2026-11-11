package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/model"
)

type ReviewDraft struct {
	Body           string      `json:"body"`
	MentionUserIDs []uuid.UUID `json:"mentionUserIds,omitempty"`
}

type CreateReviewComment struct {
	ReviewDraft
	RequestID uuid.UUID `json:"requestId"`
}

type CreateReviewThread struct {
	CreateReviewComment
	Anchor ReviewAnchor `json:"anchor"`
}

type EditReviewComment struct {
	ReviewDraft
	ExpectedUpdatedAt time.Time `json:"expectedUpdatedAt"`
}

func normalizeReviewDraft(draft ReviewDraft, actor uuid.UUID) (ReviewDraft, error) {
	draft.Body = strings.TrimSpace(draft.Body)
	if draft.Body == "" || len(draft.Body) > 8000 || strings.ContainsRune(draft.Body, 0) {
		return ReviewDraft{}, invalidCommand("Write a comment up to 8,000 bytes.")
	}
	if len(draft.MentionUserIDs) > 10 {
		return ReviewDraft{}, invalidCommand("Mention at most ten people in one comment.")
	}
	draft.MentionUserIDs = append([]uuid.UUID{}, draft.MentionUserIDs...)
	for _, id := range draft.MentionUserIDs {
		if id == uuid.Nil || id == actor {
			return ReviewDraft{}, invalidCommand("Invalid comment mention.")
		}
	}
	slices.SortFunc(draft.MentionUserIDs, func(a, b uuid.UUID) int { return bytes.Compare(a[:], b[:]) })
	draft.MentionUserIDs = slices.Compact(draft.MentionUserIDs)
	return draft, nil
}

func reviewRequestDigest(value any) ([32]byte, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return [32]byte{}, invalidCommand("Invalid review content.")
	}
	return sha256.Sum256(body), nil
}

func getReviewReplay(ctx context.Context, tx pgx.Tx, boardID string, threadID, commentID, actor uuid.UUID, digest [32]byte) (bool, error) {
	var gotThread, gotActor uuid.UUID
	var gotDigest []byte
	err := tx.QueryRow(ctx, `
		SELECT thread_id, author_id, request_digest FROM board_comments WHERE board_id = $1 AND id = $2
	`, boardID, commentID).Scan(&gotThread, &gotActor, &gotDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if threadID != gotThread || actor != gotActor || !bytes.Equal(gotDigest, digest[:]) {
		return false, &CommandFault{Code: "IDEMPOTENCY_CONFLICT", Message: "This review request already has different contents."}
	}
	return true, nil
}

func verifyReviewMentions(ctx context.Context, tx pgx.Tx, boardID string, mentions []uuid.UUID) error {
	for _, userID := range mentions {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, userID).Scan(&exists); err != nil {
			return err
		}
		_, err := model.QueryRoomAccess(ctx, tx, boardID, userID)
		if err != nil && !errors.Is(err, model.ErrRoomAccessDenied) {
			return err
		}
		if !exists || err != nil {
			return invalidCommand("A mentioned person no longer has access to this board.")
		}
	}
	return nil
}

func updateReviewNotifications(ctx context.Context, tx pgx.Tx, boardID string, commentID uuid.UUID, mentions []uuid.UUID) error {
	if _, err := tx.Exec(ctx, `
		DELETE FROM board_comment_notifications
		WHERE board_id = $1 AND comment_id = $2 AND NOT (user_id = ANY($3::uuid[]))
	`, boardID, commentID, mentions); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO board_comment_notifications (board_id, comment_id, user_id)
		SELECT $1::varchar, $2::uuid, users.id FROM unnest($3::uuid[]) AS users(id)
		ON CONFLICT DO NOTHING
	`, boardID, commentID, mentions)
	return err
}

func insertReviewComment(ctx context.Context, tx pgx.Tx, boardID string, threadID, actor uuid.UUID, comment CreateReviewComment, digest [32]byte) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO board_comments (board_id, thread_id, id, author_id, body, mention_user_ids, request_digest)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, boardID, threadID, comment.RequestID, actor, comment.Body, comment.MentionUserIDs, digest[:])
	if err != nil {
		return err
	}
	return updateReviewNotifications(ctx, tx, boardID, comment.RequestID, comment.MentionUserIDs)
}

func reviewAnchorPage(ctx context.Context, tx pgx.Tx, boardID string, anchor *ReviewAnchor) (string, error) {
	validCoordinate := func(value *float64) bool {
		return value == nil || (!math.IsNaN(*value) && !math.IsInf(*value, 0) && math.Abs(*value) <= 1e8)
	}
	if !validEntityID(anchor.PageID) || (anchor.ElementID != "" && !validEntityID(anchor.ElementID)) ||
		(anchor.X == nil) != (anchor.Y == nil) || !validCoordinate(anchor.X) || !validCoordinate(anchor.Y) {
		return "", invalidCommand("Choose a valid review location.")
	}
	var name string
	var element json.RawMessage
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(p.data->>'name', 'Untitled page'), e.data
		FROM board_pages p
		LEFT JOIN board_elements e ON e.board_id = p.board_id AND e.page_id = p.id AND e.id = $3 AND NOT e.deleted
		WHERE p.board_id = $1 AND p.id = $2 AND NOT p.deleted
		AND ($3 = '' OR e.id IS NOT NULL)
	`, boardID, anchor.PageID, anchor.ElementID).Scan(&name, &element)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &CommandFault{Code: "REVIEW_ANCHOR_CHANGED", Message: "This review location is no longer on the selected page."}
	}
	if err == nil && anchor.X == nil && len(element) > 0 {
		var position struct {
			X *float64 `json:"x"`
			Y *float64 `json:"y"`
		}
		if json.Unmarshal(element, &position) == nil && position.X != nil && position.Y != nil &&
			validCoordinate(position.X) && validCoordinate(position.Y) {
			anchor.X, anchor.Y = position.X, position.Y
		}
	}
	return name, err
}

func AddReviewThread(ctx context.Context, boardID string, actor uuid.UUID, input CreateReviewThread) (ReviewThread, error) {
	draft, err := normalizeReviewDraft(input.ReviewDraft, actor)
	if err != nil {
		return ReviewThread{}, err
	}
	if input.RequestID == uuid.Nil {
		return ReviewThread{}, invalidCommand("A review request ID is required.")
	}
	input.ReviewDraft = draft
	digest, err := reviewRequestDigest(input)
	if err != nil {
		return ReviewThread{}, err
	}
	var result ReviewThread
	err = reviewTransaction(ctx, boardID, actor, true, func(tx pgx.Tx, access *model.RoomAccess) error {
		if !canReview(access) {
			return model.ErrRoomAccessDenied
		}
		replayed, err := getReviewReplay(ctx, tx, boardID, input.RequestID, input.RequestID, actor, digest)
		if err != nil {
			return err
		}
		if !replayed {
			name, err := reviewAnchorPage(ctx, tx, boardID, &input.Anchor)
			if err != nil {
				return err
			}
			if err = verifyReviewMentions(ctx, tx, boardID, input.MentionUserIDs); err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `
				INSERT INTO board_comment_threads (board_id, id, created_by, page_id, page_name, element_id, anchor_x, anchor_y)
				VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8)
			`, boardID, input.RequestID, actor, input.Anchor.PageID, name, input.Anchor.ElementID, input.Anchor.X, input.Anchor.Y)
			if err != nil {
				return err
			}
			if err = insertReviewComment(ctx, tx, boardID, input.RequestID, actor, input.CreateReviewComment, digest); err != nil {
				return err
			}
		}
		result, err = findReviewThread(ctx, tx, boardID, actor, access, input.RequestID)
		return err
	})
	return result, err
}

func AddReviewReply(ctx context.Context, boardID string, actor, threadID uuid.UUID, input CreateReviewComment) (ReviewComment, error) {
	draft, err := normalizeReviewDraft(input.ReviewDraft, actor)
	if err != nil {
		return ReviewComment{}, err
	}
	if input.RequestID == uuid.Nil {
		return ReviewComment{}, invalidCommand("A review request ID is required.")
	}
	input.ReviewDraft = draft
	digest, err := reviewRequestDigest(input)
	if err != nil {
		return ReviewComment{}, err
	}
	var result ReviewComment
	err = reviewTransaction(ctx, boardID, actor, true, func(tx pgx.Tx, access *model.RoomAccess) error {
		if !canReview(access) {
			return model.ErrRoomAccessDenied
		}
		replayed, err := getReviewReplay(ctx, tx, boardID, threadID, input.RequestID, actor, digest)
		if err != nil {
			return err
		}
		if !replayed {
			thread, err := findReviewThread(ctx, tx, boardID, actor, access, threadID)
			if err != nil {
				return err
			}
			if thread.ResolvedAt != nil {
				return &CommandFault{Code: "REVIEW_THREAD_RESOLVED", Message: "Reopen the thread before replying."}
			}
			if err = verifyReviewMentions(ctx, tx, boardID, input.MentionUserIDs); err != nil {
				return err
			}
			if err = insertReviewComment(ctx, tx, boardID, threadID, actor, input, digest); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `
				UPDATE board_comment_threads SET comment_count = comment_count + 1, updated_at = clock_timestamp()
				WHERE board_id = $1 AND id = $2
			`, boardID, threadID); err != nil {
				return err
			}
		}
		result, err = findReviewComment(ctx, tx, boardID, threadID, input.RequestID)
		return err
	})
	return result, err
}

func SetReviewResolved(ctx context.Context, boardID string, actor, threadID uuid.UUID, resolved bool) (ReviewThread, error) {
	var result ReviewThread
	err := reviewTransaction(ctx, boardID, actor, true, func(tx pgx.Tx, access *model.RoomAccess) error {
		thread, err := findReviewThread(ctx, tx, boardID, actor, access, threadID)
		if err != nil {
			return err
		}
		if !thread.CanResolve {
			return model.ErrRoomAccessDenied
		}
		if (thread.ResolvedAt != nil) == resolved {
			result = thread
			return nil
		}
		if _, err = tx.Exec(ctx, `
			UPDATE board_comment_threads SET resolved_at = CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,
				resolved_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END, updated_at = clock_timestamp()
			WHERE board_id = $1 AND id = $2
		`, boardID, threadID, resolved, actor); err != nil {
			return err
		}
		result, err = findReviewThread(ctx, tx, boardID, actor, access, threadID)
		return err
	})
	return result, err
}

func ChangeReviewComment(ctx context.Context, boardID string, actor, threadID, commentID uuid.UUID, input EditReviewComment) (ReviewComment, error) {
	draft, err := normalizeReviewDraft(input.ReviewDraft, actor)
	if err != nil {
		return ReviewComment{}, err
	}
	if input.ExpectedUpdatedAt.IsZero() {
		return ReviewComment{}, invalidCommand("The original comment timestamp is required.")
	}
	var result ReviewComment
	err = reviewTransaction(ctx, boardID, actor, true, func(tx pgx.Tx, access *model.RoomAccess) error {
		if !canReview(access) {
			return model.ErrRoomAccessDenied
		}
		comment, err := findReviewComment(ctx, tx, boardID, threadID, commentID)
		if err != nil {
			return err
		}
		if comment.AuthorID != actor {
			return model.ErrRoomAccessDenied
		}
		if !comment.UpdatedAt.Equal(input.ExpectedUpdatedAt) {
			return &CommandFault{Code: "REVIEW_COMMENT_CHANGED", Message: "This comment changed. Read its latest version before editing."}
		}
		if err = verifyReviewMentions(ctx, tx, boardID, draft.MentionUserIDs); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `
			UPDATE board_comments SET body = $3, mention_user_ids = $4, updated_at = clock_timestamp()
			WHERE board_id = $1 AND id = $2
		`, boardID, commentID, draft.Body, draft.MentionUserIDs); err != nil {
			return err
		}
		if err = updateReviewNotifications(ctx, tx, boardID, commentID, draft.MentionUserIDs); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `
			UPDATE board_comment_threads SET updated_at = clock_timestamp() WHERE board_id = $1 AND id = $2
		`, boardID, threadID); err != nil {
			return err
		}
		result, err = findReviewComment(ctx, tx, boardID, threadID, commentID)
		return err
	})
	return result, err
}

func MarkReviewNotificationRead(ctx context.Context, boardID string, actor, commentID uuid.UUID) error {
	return reviewTransaction(ctx, boardID, actor, true, func(tx pgx.Tx, _ *model.RoomAccess) error {
		result, err := tx.Exec(ctx, `
			UPDATE board_comment_notifications SET read_at = COALESCE(read_at, clock_timestamp())
			WHERE board_id = $1 AND user_id = $2 AND comment_id = $3
		`, boardID, actor, commentID)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return ErrReviewNotFound
		}
		return nil
	})
}
