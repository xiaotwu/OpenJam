package document

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/model"
)

type MigrationReport struct {
	BoardID            string `json:"boardId"`
	Mode               string `json:"mode"`
	Epoch              int64  `json:"epoch"`
	Seq                int64  `json:"seq"`
	FloorSeq           int64  `json:"floorSeq"`
	Hash               string `json:"hash,omitempty"`
	MigrationIssue     string `json:"migrationIssue,omitempty"`
	ArchivedOperations int64  `json:"archivedOperations"`
	LegacyArchiveEpoch int64  `json:"legacyArchiveEpoch,omitempty"`
	LiveLegacyOps      int64  `json:"liveLegacyOperations"`
	PageCount          int    `json:"pageCount"`
	ElementCount       int    `json:"elementCount"`
	StampCount         int    `json:"stampCount"`
}

func Activate(ctx context.Context, boardID string) (MigrationReport, error) {
	var report MigrationReport
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		room, err := lockRoom(ctx, tx, boardID)
		if err != nil {
			return err
		}
		head, err := readHead(ctx, tx, boardID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if head.Mode == modeActive {
			report, err = inspectLocked(ctx, tx, room, head)
			return err
		}
		_, report, err = activateLocked(ctx, tx, room, head, "")
		return err
	})
	if err != nil {
		return MigrationReport{}, err
	}
	return report, nil
}

func activateLocked(ctx context.Context, tx pgx.Tx, room lockedRoom, previous Head, permission string) (Snapshot, MigrationReport, error) {
	normalized, err := readLegacyDocument(ctx, tx, room)
	if err != nil {
		return Snapshot{}, MigrationReport{}, err
	}
	head := Head{
		Mode: modeActive, Epoch: previous.Epoch + 1, Seq: previous.Seq, FloorSeq: previous.Seq,
		DefaultPageID: normalized.Document.DefaultPageID, Extra: normalized.Extra,
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_heads (board_id, mode, epoch, head_seq, floor_seq, default_page_id, extra)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (board_id) DO UPDATE SET
			mode = EXCLUDED.mode, epoch = EXCLUDED.epoch, head_seq = EXCLUDED.head_seq,
			floor_seq = EXCLUDED.floor_seq, default_page_id = EXCLUDED.default_page_id, extra = EXCLUDED.extra
	`, room.ID, head.Mode, head.Epoch, head.Seq, head.FloorSeq, head.DefaultPageID, head.Extra); err != nil {
		return Snapshot{}, MigrationReport{}, err
	}
	count, err := archiveLegacy(ctx, tx, room.ID, head.Epoch)
	if err != nil {
		return Snapshot{}, MigrationReport{}, err
	}
	if err := materializeDocument(ctx, tx, room.ID, head.Seq, normalized.Document); err != nil {
		return Snapshot{}, MigrationReport{}, err
	}
	snapshot, err := snapshotLocked(ctx, tx, room, head, permission)
	if err != nil {
		return Snapshot{}, MigrationReport{}, err
	}
	if err := saveCheckpoint(ctx, tx, snapshot, "migration"); err != nil {
		return Snapshot{}, MigrationReport{}, err
	}
	if err := markInitialVersion(ctx, tx, snapshot); err != nil {
		return Snapshot{}, MigrationReport{}, err
	}
	report := reportSnapshot(snapshot, head)
	report.ArchivedOperations = count
	report.LegacyArchiveEpoch = head.Epoch
	return snapshot, report, nil
}

func readLegacyDocument(ctx context.Context, tx pgx.Tx, room lockedRoom) (normalizedLegacy, error) {
	var raw json.RawMessage
	if err := tx.QueryRow(ctx, `SELECT board_data FROM rooms WHERE id = $1`, room.ID).Scan(&raw); err != nil {
		return normalizedLegacy{}, err
	}
	normalized, err := normalizeLegacy(room.Name, raw)
	if err != nil {
		return normalizedLegacy{}, err
	}
	if err := requireDocumentAssets(ctx, tx, room.ID, normalized.Document); err != nil {
		if errors.Is(err, assets.ErrNotFound) || errors.Is(err, assets.ErrInvalidReference) {
			return normalizedLegacy{}, fmt.Errorf("%w: a private image reference is invalid or missing", ErrMigrationBlocked)
		}
		return normalizedLegacy{}, err
	}
	return normalized, nil
}

func archiveLegacy(ctx context.Context, tx pgx.Tx, boardID string, epoch int64) (int64, error) {
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_legacy_archives (board_id, epoch, source_name, source_updated_at, source_board_data)
		SELECT id, $2, name, updated_at, board_data FROM rooms WHERE id = $1
	`, boardID, epoch); err != nil {
		return 0, err
	}
	// Archive the exact persisted rows. Neither timestamps nor operation IDs
	// identify what the last whole-board save already incorporated.
	result, err := tx.Exec(ctx, `
		WITH moved AS (DELETE FROM operations WHERE room_id = $1 RETURNING *)
		INSERT INTO board_legacy_operations (board_id, epoch, legacy_id, data)
		SELECT $1, $2, moved.id, to_jsonb(moved) FROM moved
	`, boardID, epoch)
	if err != nil {
		return 0, err
	}
	count := result.RowsAffected()
	_, err = tx.Exec(ctx, `
		UPDATE board_legacy_archives SET operation_count = $3 WHERE board_id = $1 AND epoch = $2
	`, boardID, epoch, count)
	return count, err
}

func materializeDocument(ctx context.Context, tx pgx.Tx, boardID string, seq int64, document Document) error {
	if err := requireDocumentAssets(ctx, tx, boardID, document); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM board_pages WHERE board_id = $1`, boardID); err != nil {
		return err
	}
	for _, collection := range []struct {
		records []json.RawMessage
		insert  string
	}{
		{document.Pages, `
			INSERT INTO board_pages (board_id, id, data, position, revision)
			SELECT $1, value->>'id', value, ordinality - 1, $3
			FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY
		`},
		{document.Elements, `
			INSERT INTO board_elements (board_id, id, page_id, data, position, revision)
			SELECT $1, value->>'id', value->>'pageId', value, ordinality - 1, $3
			FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY
		`},
		{document.Stamps, `
			INSERT INTO board_stamps (board_id, id, page_id, data, position, revision)
			SELECT $1, value->>'id', value->>'pageId', value, ordinality - 1, $3
			FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY
		`},
	} {
		data, err := json.Marshal(collection.records)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, collection.insert, boardID, data, seq); err != nil {
			return err
		}
	}
	return nil
}

func Rollback(ctx context.Context, boardID string, expectedEpoch, expectedSeq int64) (MigrationReport, error) {
	var report MigrationReport
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		room, err := lockRoom(ctx, tx, boardID)
		if err != nil {
			return err
		}
		head, err := readHead(ctx, tx, boardID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLegacyMode
		}
		if err != nil {
			return err
		}
		if room.Kind == model.ResourceDoc {
			return invalidCommand("Docs use the current sync protocol.")
		}
		if head.Epoch != expectedEpoch || head.Seq != expectedSeq {
			return ErrStaleRollback
		}
		if head.Mode == modeLegacy {
			report, err = inspectLocked(ctx, tx, room, head)
			return err
		}
		snapshot, err := snapshotLocked(ctx, tx, room, head, "")
		if err != nil {
			return err
		}
		projection, err := legacyProjection(snapshot.Document, head.Extra)
		if err != nil {
			return err
		}
		if err := saveCheckpoint(ctx, tx, snapshot, "rollback"); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE board_heads SET mode = 'legacy' WHERE board_id = $1`, boardID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE rooms SET board_data = $2, updated_at = clock_timestamp() WHERE id = $1
		`, boardID, projection); err != nil {
			return err
		}
		head.Mode = modeLegacy
		report = reportSnapshot(snapshot, head)
		return loadArchiveCount(ctx, tx, &report)
	})
	if err != nil {
		return MigrationReport{}, err
	}
	return report, nil
}

func Inspect(ctx context.Context, boardID string) (MigrationReport, error) {
	var report MigrationReport
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		room, err := lockRoom(ctx, tx, boardID)
		if err != nil {
			return err
		}
		head, err := readHead(ctx, tx, boardID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		report, err = inspectLocked(ctx, tx, room, head)
		return err
	})
	if err != nil {
		return MigrationReport{}, err
	}
	return report, nil
}

func inspectLocked(ctx context.Context, tx pgx.Tx, room lockedRoom, head Head) (MigrationReport, error) {
	report := MigrationReport{
		BoardID: room.ID, Mode: head.Mode, Epoch: head.Epoch, Seq: head.Seq, FloorSeq: head.FloorSeq,
	}
	if head.Mode == modeActive {
		snapshot, err := snapshotLocked(ctx, tx, room, head, "")
		if err != nil {
			return MigrationReport{}, err
		}
		report = reportSnapshot(snapshot, head)
	} else {
		if report.Mode == "" {
			report.Mode = "unmigrated"
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM operations WHERE room_id = $1`, room.ID).Scan(&report.LiveLegacyOps); err != nil {
			return MigrationReport{}, err
		}
		preview, err := readLegacyDocument(ctx, tx, room)
		if errors.Is(err, ErrMigrationBlocked) {
			report.MigrationIssue = err.Error()
		} else if err != nil {
			return MigrationReport{}, err
		} else {
			report.PageCount = len(preview.Document.Pages)
			report.ElementCount = len(preview.Document.Elements)
			report.StampCount = len(preview.Document.Stamps)
		}
	}
	if err := loadArchiveCount(ctx, tx, &report); err != nil {
		return MigrationReport{}, err
	}
	return report, nil
}

func reportSnapshot(snapshot Snapshot, head Head) MigrationReport {
	return MigrationReport{
		BoardID: snapshot.BoardID, Mode: head.Mode, Epoch: head.Epoch, Seq: head.Seq, FloorSeq: head.FloorSeq,
		Hash: snapshot.Hash, PageCount: len(snapshot.Document.Pages),
		ElementCount: len(snapshot.Document.Elements), StampCount: len(snapshot.Document.Stamps),
	}
}

func loadArchiveCount(ctx context.Context, tx pgx.Tx, report *MigrationReport) error {
	if report.Epoch == 0 {
		return nil
	}
	err := tx.QueryRow(ctx, `
		SELECT epoch, operation_count FROM board_legacy_archives WHERE board_id = $1 AND epoch <= $2
		ORDER BY epoch DESC LIMIT 1
	`, report.BoardID, report.Epoch).Scan(&report.LegacyArchiveEpoch, &report.ArchivedOperations)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

// WriteLegacyArchive streams the original operation rows in persisted order.
// Epoch zero selects the latest available migration archive.
func WriteLegacyArchive(ctx context.Context, boardID string, epoch int64, writer io.Writer) error {
	return pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		var header struct {
			BoardID            string          `json:"boardId"`
			Epoch              int64           `json:"epoch"`
			Name               string          `json:"name"`
			UpdatedAt          time.Time       `json:"updatedAt"`
			BoardData          json.RawMessage `json:"boardData"`
			BoardDataIsSQLNull bool            `json:"boardDataIsSqlNull"`
			OperationCount     int64           `json:"operationCount"`
		}
		header.BoardID = boardID
		err := tx.QueryRow(ctx, `
			SELECT epoch, source_name, source_updated_at, source_board_data, source_board_data IS NULL, operation_count
			FROM board_legacy_archives WHERE board_id = $1 AND ($2::bigint = 0 OR epoch = $2)
			ORDER BY epoch DESC LIMIT 1
		`, boardID, epoch).Scan(&header.Epoch, &header.Name, &header.UpdatedAt, &header.BoardData, &header.BoardDataIsSQLNull, &header.OperationCount)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrArchiveNotFound
		}
		if err != nil {
			return err
		}
		start, err := json.Marshal(header)
		if err != nil {
			return err
		}
		if _, err := writer.Write(start[:len(start)-1]); err != nil {
			return err
		}
		if _, err := io.WriteString(writer, `,"operations":[`); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT data FROM board_legacy_operations WHERE board_id = $1 AND epoch = $2 ORDER BY legacy_id
		`, boardID, header.Epoch)
		if err != nil {
			return err
		}
		defer rows.Close()
		for index := 0; rows.Next(); index++ {
			var operation []byte
			if err := rows.Scan(&operation); err != nil {
				return err
			}
			if index > 0 {
				if _, err := io.WriteString(writer, ","); err != nil {
					return err
				}
			}
			if _, err := writer.Write(operation); err != nil {
				return err
			}
		}
		if err := rows.Err(); err != nil {
			return err
		}
		_, err = io.WriteString(writer, "]}\n")
		return err
	})
}
