package document

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/model"
)

const maxChangePageBytes = 4 * 1024 * 1024

type ChangePage struct {
	BoardID    string   `json:"boardId"`
	Epoch      int64    `json:"epoch"`
	HeadSeq    int64    `json:"headSeq"`
	FloorSeq   int64    `json:"floorSeq"`
	Permission string   `json:"permission"`
	Changes    []Change `json:"changes"`
	HasMore    bool     `json:"hasMore"`
}

type SubscriptionState struct {
	BoardID    string `json:"boardId"`
	Epoch      int64  `json:"epoch"`
	HeadSeq    int64  `json:"headSeq"`
	Permission string `json:"permission"`
}

func activeHead(ctx context.Context, tx pgx.Tx, boardID string) (Head, error) {
	head, err := readHead(ctx, tx, boardID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Head{}, ErrLegacyMode
	}
	if err != nil {
		return Head{}, err
	}
	if head.Mode != modeActive {
		return Head{}, ErrLegacyMode
	}
	return head, nil
}

func permissionLabel(access *model.RoomAccess) string {
	if access.IsOwner {
		return "owner"
	}
	return string(access.Permission)
}

func Subscription(ctx context.Context, boardID string, actor uuid.UUID) (SubscriptionState, error) {
	var state SubscriptionState
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		access, err := model.QueryRoomAccess(ctx, tx, boardID, actor)
		if err != nil {
			return err
		}
		head, err := activeHead(ctx, tx, boardID)
		if err != nil {
			return err
		}
		state = SubscriptionState{BoardID: boardID, Epoch: head.Epoch, HeadSeq: head.Seq, Permission: permissionLabel(access)}
		return nil
	})
	if err != nil {
		return SubscriptionState{}, err
	}
	return state, nil
}

func Changes(ctx context.Context, boardID string, actor uuid.UUID, epoch, afterSeq int64, limit int) (ChangePage, error) {
	if epoch <= 0 || epoch > maxSafeSequence || afterSeq < 0 || afterSeq > maxSafeSequence || limit < 0 {
		return ChangePage{}, invalidCommand("Invalid document cursor.")
	}
	if limit == 0 {
		limit = 50
	}
	limit = min(limit, 100)
	var page ChangePage
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		access, err := model.QueryRoomAccess(ctx, tx, boardID, actor)
		if err != nil {
			return err
		}
		head, err := activeHead(ctx, tx, boardID)
		if err != nil {
			return err
		}
		if epoch != head.Epoch || afterSeq < head.FloorSeq || afterSeq > head.Seq {
			return cursorFault("RESYNC_REQUIRED", "The document cursor requires a new snapshot.", head)
		}
		changes, err := readChangePage(ctx, tx, boardID, head, afterSeq, limit)
		if err != nil {
			return err
		}
		page = ChangePage{
			BoardID: boardID, Epoch: head.Epoch, HeadSeq: head.Seq, FloorSeq: head.FloorSeq,
			Permission: permissionLabel(access), Changes: changes,
			HasMore: afterSeq+int64(len(changes)) < head.Seq,
		}
		return nil
	})
	if err != nil {
		return ChangePage{}, err
	}
	return page, nil
}

func readChangePage(ctx context.Context, tx pgx.Tx, boardID string, head Head, afterSeq int64, limit int) ([]Change, error) {
	changes := make([]Change, 0, limit)
	if afterSeq == head.Seq {
		return changes, nil
	}
	rows, err := tx.Query(ctx, `
		WITH candidates AS (
			SELECT seq, payload_bytes FROM board_changes
			WHERE board_id = $1 AND epoch = $2 AND seq > $3
			ORDER BY seq LIMIT $4
		), selected AS (
			SELECT seq, sum(payload_bytes) OVER (ORDER BY seq) AS bytes
			FROM candidates
		)
		SELECT c.payload FROM selected s
		JOIN board_changes c ON c.board_id = $1 AND c.seq = s.seq
		WHERE s.bytes <= $5 OR s.seq = $3 + 1
		ORDER BY s.seq
	`, boardID, head.Epoch, afterSeq, limit, maxChangePageBytes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		var change Change
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &change); err != nil {
			return nil, err
		}
		if change.Seq != afterSeq+int64(len(changes))+1 || change.Epoch != head.Epoch {
			return nil, cursorFault("RESYNC_REQUIRED", "The change feed has a gap.", head)
		}
		changes = append(changes, change)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(changes) == 0 {
		return nil, cursorFault("RESYNC_REQUIRED", "The change feed has a gap.", head)
	}
	return changes, nil
}
