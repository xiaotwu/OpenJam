package document

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/model"
)

const ProtocolVersion = 2

const (
	modeActive = "active"
	modeLegacy = "legacy"
)

var (
	ErrLegacyMode       = errors.New("board is in legacy mode")
	ErrMigrationBlocked = errors.New("legacy board needs migration review")
	ErrStaleRollback    = errors.New("board changed since the rollback was prepared")
	ErrArchiveNotFound  = errors.New("legacy archive not found")
)

type Document struct {
	Name          string            `json:"name"`
	DefaultPageID string            `json:"defaultPageId"`
	Pages         []json.RawMessage `json:"pages"`
	Elements      []json.RawMessage `json:"elements"`
	Stamps        []json.RawMessage `json:"stamps"`
}

type Snapshot struct {
	ProtocolVersion int       `json:"protocolVersion"`
	BoardID         string    `json:"boardId"`
	ResourceKind    string    `json:"resourceKind,omitempty"`
	Epoch           int64     `json:"epoch"`
	Seq             int64     `json:"seq"`
	Hash            string    `json:"hash"`
	Permission      string    `json:"permission"`
	UpdatedAt       time.Time `json:"updatedAt"`
	Document        Document  `json:"document"`
}

type Head struct {
	Mode          string
	Epoch         int64
	Seq           int64
	FloorSeq      int64
	DefaultPageID string
	Extra         json.RawMessage
}

type lockedRoom struct {
	ID        string
	Name      string
	Kind      string
	UpdatedAt time.Time
}

func LegacyWriteFenced(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "PJV01"
}

func IsActive(ctx context.Context, boardID string) (bool, error) {
	var active bool
	err := db.Pool().QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM board_heads WHERE board_id = $1 AND mode = 'active')
	`, boardID).Scan(&active)
	return active, err
}

// Open reads one consistent version after checking effective room access. The
// first open can activate a board that has never been migrated. An explicit
// rollback requires an explicit activation to switch the board back to V2.
func Open(ctx context.Context, boardID string, userID uuid.UUID, autoActivate bool) (Snapshot, error) {
	var result Snapshot
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		room, err := lockRoom(ctx, tx, boardID)
		if err != nil {
			return err
		}
		access, err := model.QueryRoomAccess(ctx, tx, boardID, userID)
		if err != nil {
			return err
		}
		permission := string(access.Permission)
		if access.IsOwner {
			permission = "owner"
		}

		head, err := readHead(ctx, tx, boardID)
		if errors.Is(err, pgx.ErrNoRows) {
			if !autoActivate {
				return ErrLegacyMode
			}
			result, _, err = activateLocked(ctx, tx, room, Head{}, permission)
			return err
		}
		if err != nil {
			return err
		}
		if head.Mode != modeActive {
			return ErrLegacyMode
		}
		result, err = snapshotLocked(ctx, tx, room, head, permission)
		return err
	})
	if err != nil {
		return Snapshot{}, err
	}
	return result, nil
}

func lockRoom(ctx context.Context, tx pgx.Tx, boardID string) (lockedRoom, error) {
	var room lockedRoom
	err := tx.QueryRow(ctx, `
		SELECT id, name, resource_kind, updated_at FROM rooms WHERE id = $1 FOR UPDATE
	`, boardID).Scan(&room.ID, &room.Name, &room.Kind, &room.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return lockedRoom{}, model.ErrRoomNotFound
	}
	return room, err
}

func readHead(ctx context.Context, tx pgx.Tx, boardID string) (Head, error) {
	var head Head
	err := tx.QueryRow(ctx, `
		SELECT mode, epoch, head_seq, floor_seq, default_page_id, extra
		FROM board_heads WHERE board_id = $1
	`, boardID).Scan(&head.Mode, &head.Epoch, &head.Seq, &head.FloorSeq, &head.DefaultPageID, &head.Extra)
	return head, err
}

func snapshotLocked(ctx context.Context, tx pgx.Tx, room lockedRoom, head Head, permission string) (Snapshot, error) {
	pages, err := readRecords(ctx, tx, `
		SELECT data FROM board_pages WHERE board_id = $1 AND NOT deleted ORDER BY position, id
	`, room.ID)
	if err != nil {
		return Snapshot{}, err
	}
	elements, err := readRecords(ctx, tx, `
		SELECT data FROM board_elements WHERE board_id = $1 AND NOT deleted ORDER BY position, id
	`, room.ID)
	if err != nil {
		return Snapshot{}, err
	}
	stamps, err := readRecords(ctx, tx, `
		SELECT data FROM board_stamps WHERE board_id = $1 AND NOT deleted ORDER BY position, id
	`, room.ID)
	if err != nil {
		return Snapshot{}, err
	}
	result := Snapshot{
		ProtocolVersion: ProtocolVersion,
		BoardID:         room.ID,
		ResourceKind:    room.Kind,
		Epoch:           head.Epoch,
		Seq:             head.Seq,
		Permission:      permission,
		UpdatedAt:       room.UpdatedAt,
		Document: Document{
			Name: room.Name, DefaultPageID: head.DefaultPageID,
			Pages: pages, Elements: elements, Stamps: stamps,
		},
	}
	_, result.Hash, err = encodeDocument(result.Document)
	return result, err
}

func readRecords(ctx context.Context, tx pgx.Tx, query string, args ...any) ([]json.RawMessage, error) {
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []json.RawMessage{}
	for rows.Next() {
		var record json.RawMessage
		if err := rows.Scan(&record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func encodeDocument(document Document) ([]byte, string, error) {
	data, err := json.Marshal(document)
	if err != nil {
		return nil, "", err
	}
	digest := sha256.Sum256(data)
	return data, hex.EncodeToString(digest[:]), nil
}

func saveCheckpoint(ctx context.Context, tx pgx.Tx, snapshot Snapshot, reason string) error {
	data, digest, err := encodeDocument(snapshot.Document)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO board_snapshots (board_id, epoch, seq, reason, document, digest)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, snapshot.BoardID, snapshot.Epoch, snapshot.Seq, reason, data, digest)
	return err
}
