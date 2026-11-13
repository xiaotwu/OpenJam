package document

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/assets"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/model"
)

type VersionBoardState struct {
	BoardID string `json:"boardId"`
	Epoch   int64  `json:"epoch"`
	Seq     int64  `json:"seq"`
	Hash    string `json:"hash"`
}

type VersionRestore struct {
	VersionBoardState
	BeforeVersionID uuid.UUID `json:"beforeVersionId"`
	VersionID       uuid.UUID `json:"versionId"`
	Replayed        bool      `json:"replayed"`
}

func versionBoardState(snapshot Snapshot) VersionBoardState {
	return VersionBoardState{BoardID: snapshot.BoardID, Epoch: snapshot.Epoch, Seq: snapshot.Seq, Hash: snapshot.Hash}
}

func RestoreVersion(ctx context.Context, boardID string, actor, sourceID, requestID uuid.UUID, position VersionPosition) (VersionRestore, error) {
	if requestID == uuid.Nil || !position.valid() {
		return VersionRestore{}, invalidCommand("Provide a request ID and a current board position.")
	}
	var result VersionRestore
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		room, err := lockRoom(ctx, tx, boardID)
		if err != nil {
			return err
		}
		head, err := versionAccess(ctx, tx, boardID, actor, true)
		if err != nil {
			return err
		}
		replay, found, err := readRestoreReceipt(ctx, tx, boardID, actor, sourceID, requestID, position)
		if err != nil {
			return err
		}
		if found {
			result = replay
			return nil
		}
		if !position.matches(head) {
			return cursorFault("STALE_VERSION_HEAD", "The board changed. Review the latest document before restoring.", head)
		}
		if head.Epoch >= maxSafeSequence || head.Seq >= maxSafeSequence {
			return invalidCommand("This board has reached the version limit.")
		}
		source, err := readVersionPreview(ctx, tx, boardID, sourceID)
		if err != nil {
			return err
		}
		before, err := snapshotLocked(ctx, tx, room, head, "")
		if err != nil {
			return err
		}
		checkpoint, err := storeVersion(ctx, tx, before, versionMarker{
			kind: versionBeforeRestore, name: "Before restore", actor: &actor, source: &sourceID,
		})
		if err != nil {
			return err
		}

		head.Epoch++
		head.Seq++
		head.FloorSeq = head.Seq
		head.DefaultPageID = source.Document.DefaultPageID
		snapshot, err := replaceDocument(ctx, tx, room, head, source.Document)
		if err != nil {
			return err
		}
		if snapshot.Hash != source.Version.Hash {
			return fmt.Errorf("restored version %s did not match its checksum", sourceID)
		}
		restored, err := storeVersion(ctx, tx, snapshot, versionMarker{
			kind: versionRestored, name: "Restored version", actor: &actor, source: &sourceID,
		})
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO board_version_restores
				(board_id, request_id, actor_id, source_version_id, expected_epoch, expected_seq, before_version_id, version_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, boardID, requestID, actor, sourceID, position.ExpectedEpoch, position.ExpectedSeq, checkpoint.ID, restored.ID); err != nil {
			return err
		}
		result = VersionRestore{VersionBoardState: versionBoardState(snapshot), BeforeVersionID: checkpoint.ID, VersionID: restored.ID}
		return nil
	})
	return result, err
}

func readRestoreReceipt(ctx context.Context, tx pgx.Tx, boardID string, actor, sourceID, requestID uuid.UUID, position VersionPosition) (VersionRestore, bool, error) {
	var receiptActor, receiptSource uuid.UUID
	var receiptPosition VersionPosition
	result := VersionRestore{VersionBoardState: VersionBoardState{BoardID: boardID}, Replayed: true}
	err := tx.QueryRow(ctx, `
		SELECT r.actor_id, r.source_version_id, r.expected_epoch, r.expected_seq, r.before_version_id, r.version_id,
			v.epoch, v.seq, s.digest
		FROM board_version_restores r
		JOIN board_versions v ON v.id = r.version_id AND v.board_id = r.board_id
		JOIN board_snapshots s ON (s.board_id, s.epoch, s.seq, s.reason) = (v.board_id, v.epoch, v.seq, v.snapshot_reason)
		WHERE r.board_id = $1 AND r.request_id = $2
	`, boardID, requestID).Scan(
		&receiptActor, &receiptSource, &receiptPosition.ExpectedEpoch, &receiptPosition.ExpectedSeq,
		&result.BeforeVersionID, &result.VersionID, &result.Epoch, &result.Seq, &result.Hash,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return VersionRestore{}, false, nil
	}
	if err != nil {
		return VersionRestore{}, false, err
	}
	if receiptActor != actor || receiptSource != sourceID || receiptPosition != position {
		return VersionRestore{}, false, &CommandFault{Code: "IDEMPOTENCY_CONFLICT", Message: "This request ID was already used for a different restore."}
	}
	return result, true, nil
}

func replaceDocument(ctx context.Context, tx pgx.Tx, room lockedRoom, head Head, content Document) (Snapshot, error) {
	// The document rows can be replaced while comments and sharing continue to
	// reference the room. New commands must use the new epoch and snapshot.
	if err := materializeDocument(ctx, tx, room.ID, head.Seq, content); err != nil {
		return Snapshot{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE board_heads SET epoch = $2, head_seq = $3, floor_seq = $4, default_page_id = $5 WHERE board_id = $1
	`, room.ID, head.Epoch, head.Seq, head.FloorSeq, head.DefaultPageID); err != nil {
		return Snapshot{}, err
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('openjam.document_v2_write', 'on', true)`); err != nil {
		return Snapshot{}, err
	}
	room.Name = content.Name
	if err := tx.QueryRow(ctx, `
		UPDATE rooms SET name = $2, updated_at = clock_timestamp() WHERE id = $1 RETURNING updated_at
	`, room.ID, room.Name).Scan(&room.UpdatedAt); err != nil {
		return Snapshot{}, err
	}
	return snapshotLocked(ctx, tx, room, head, "")
}

func CopyVersion(ctx context.Context, boardID string, actor, versionID uuid.UUID, name string) (VersionBoardState, error) {
	name = strings.TrimSpace(name)
	var result VersionBoardState
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		room, err := lockRoom(ctx, tx, boardID)
		if err != nil {
			return err
		}
		if _, err := versionAccess(ctx, tx, boardID, actor, false); err != nil {
			return err
		}
		preview, err := readVersionPreview(ctx, tx, boardID, versionID)
		if err != nil {
			return err
		}
		result, err = copyDocumentLocked(ctx, tx, room, actor, name, preview.Document)
		return err
	})
	return result, err
}

func CopyCurrent(ctx context.Context, boardID string, actor uuid.UUID, name string) (VersionBoardState, error) {
	name = strings.TrimSpace(name)
	var result VersionBoardState
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		room, err := lockRoom(ctx, tx, boardID)
		if err != nil {
			return err
		}
		if _, err := model.QueryRoomAccess(ctx, tx, boardID, actor); err != nil {
			return err
		}
		head, err := activeHead(ctx, tx, boardID)
		if err != nil {
			return err
		}
		snapshot, err := snapshotLocked(ctx, tx, room, head, "")
		if err != nil {
			return err
		}
		result, err = copyDocumentLocked(ctx, tx, room, actor, name, snapshot.Document)
		return err
	})
	if err != nil {
		return VersionBoardState{}, err
	}
	return result, nil
}

func copyDocumentLocked(ctx context.Context, tx pgx.Tx, source lockedRoom, actor uuid.UUID, name string, content Document) (VersionBoardState, error) {
	if name == "" || utf8.RuneCountInString(name) > 255 || strings.ContainsRune(name, 0) {
		return VersionBoardState{}, invalidCommand("Provide a board name of up to 255 characters.")
	}
	room := lockedRoom{ID: uuid.NewString(), Name: name, Kind: source.Kind}
	if err := tx.QueryRow(ctx, `
		INSERT INTO rooms (id, name, owner_id, resource_kind) VALUES ($1, $2, $3, $4) RETURNING updated_at
	`, room.ID, name, actor, room.Kind).Scan(&room.UpdatedAt); err != nil {
		return VersionBoardState{}, err
	}
	head := Head{Mode: modeActive, Epoch: 1, DefaultPageID: content.DefaultPageID, Extra: json.RawMessage("{}")}
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_heads (board_id, mode, epoch, default_page_id, extra) VALUES ($1, $2, $3, $4, $5)
	`, room.ID, head.Mode, head.Epoch, head.DefaultPageID, head.Extra); err != nil {
		return VersionBoardState{}, err
	}
	ids, err := assets.References(content.Elements)
	if err != nil {
		return VersionBoardState{}, err
	}
	if err := assets.CopyLinks(ctx, tx, source.ID, room.ID, ids); err != nil {
		return VersionBoardState{}, err
	}
	if err := materializeDocument(ctx, tx, room.ID, head.Seq, content); err != nil {
		return VersionBoardState{}, err
	}
	snapshot, err := snapshotLocked(ctx, tx, room, head, "")
	if err != nil {
		return VersionBoardState{}, err
	}
	if _, err := storeVersion(ctx, tx, snapshot, versionMarker{kind: versionCheckpoint, name: "Copied version", actor: &actor}); err != nil {
		return VersionBoardState{}, err
	}
	return versionBoardState(snapshot), nil
}
