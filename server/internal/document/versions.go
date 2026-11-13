package document

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/model"
)

const (
	versionSnapshotReason = "version"
	versionCheckpoint     = "checkpoint"
	versionNamed          = "named"
	versionBeforeRestore  = "before_restore"
	versionRestored       = "restored"
	checkpointInterval    = 50
	checkpointRetention   = 12
	maxCheckpointBytes    = 8 * 1024 * 1024
	maxVersionName        = 120
)

var ErrVersionNotFound = errors.New("board version not found")

type VersionSummary struct {
	ID              uuid.UUID  `json:"id"`
	Name            string     `json:"name"`
	Kind            string     `json:"kind"`
	Epoch           int64      `json:"epoch"`
	Seq             int64      `json:"seq"`
	Hash            string     `json:"hash"`
	CreatedAt       time.Time  `json:"createdAt"`
	Author          string     `json:"author,omitempty"`
	Participants    []string   `json:"participants,omitempty"`
	SourceVersionID *uuid.UUID `json:"sourceVersionId,omitempty"`
}

type VersionList struct {
	BoardID    string           `json:"boardId"`
	Epoch      int64            `json:"epoch"`
	Seq        int64            `json:"seq"`
	Versions   []VersionSummary `json:"versions"`
	NextCursor *uuid.UUID       `json:"nextCursor,omitempty"`
}

type VersionPreview struct {
	Version  VersionSummary `json:"version"`
	Document Document       `json:"document"`
}

type VersionPosition struct {
	ExpectedEpoch int64 `json:"expectedEpoch"`
	ExpectedSeq   int64 `json:"expectedSeq"`
}

func (position VersionPosition) valid() bool {
	return position.ExpectedEpoch > 0 && position.ExpectedEpoch <= maxSafeSequence &&
		position.ExpectedSeq >= 0 && position.ExpectedSeq <= maxSafeSequence
}

func (position VersionPosition) matches(head Head) bool {
	return position.ExpectedEpoch == head.Epoch && position.ExpectedSeq == head.Seq
}

type versionMarker struct {
	kind         string
	name         string
	actor        *uuid.UUID
	participants []uuid.UUID
	source       *uuid.UUID
}

func versionAccess(ctx context.Context, tx pgx.Tx, boardID string, actor uuid.UUID, ownerOnly bool) (Head, error) {
	access, err := model.QueryRoomAccess(ctx, tx, boardID, actor)
	if err != nil {
		return Head{}, err
	}
	if ownerOnly && !access.IsOwner {
		return Head{}, model.ErrNotRoomOwner
	}
	if !access.IsOwner && !model.RoomPermissionAllowsEdit(access.Permission) {
		return Head{}, model.ErrRoomAccessDenied
	}
	return activeHead(ctx, tx, boardID)
}

const versionFields = `v.id, v.name, v.kind, v.epoch, v.seq, s.digest, v.created_at,
	COALESCE(author.display_name, v.imported_author),
	CASE WHEN cardinality(v.imported_participants) > 0 THEN v.imported_participants
	     ELSE ARRAY(SELECT member.display_name FROM users member WHERE member.id = ANY(v.participant_ids)
	                ORDER BY member.display_name, member.id) END,
	v.source_version_id`

const versionJoins = `
	FROM board_versions v
	JOIN board_snapshots s ON (s.board_id, s.epoch, s.seq, s.reason)
		= (v.board_id, v.epoch, v.seq, v.snapshot_reason)
	LEFT JOIN users author ON author.id = v.actor_id
`

type versionScanner interface {
	Scan(...any) error
}

func scanVersion(row versionScanner, content *Document) (VersionSummary, error) {
	var version VersionSummary
	values := []any{
		&version.ID, &version.Name, &version.Kind, &version.Epoch, &version.Seq, &version.Hash,
		&version.CreatedAt, &version.Author, &version.Participants, &version.SourceVersionID,
	}
	if content != nil {
		values = append(values, content)
	}
	err := row.Scan(values...)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrVersionNotFound
	}
	return version, err
}

func versionByID(ctx context.Context, tx pgx.Tx, boardID string, id uuid.UUID, content *Document) (VersionSummary, error) {
	fields := versionFields
	if content != nil {
		fields += ", s.document"
	}
	return scanVersion(tx.QueryRow(ctx, "SELECT "+fields+versionJoins+"WHERE v.board_id = $1 AND v.id = $2", boardID, id), content)
}

func ListVersions(ctx context.Context, boardID string, actor uuid.UUID, before *uuid.UUID, limit int) (VersionList, error) {
	if limit < 1 || limit > 100 {
		return VersionList{}, invalidCommand("Invalid version list limit.")
	}
	var list VersionList
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		head, err := versionAccess(ctx, tx, boardID, actor, false)
		if err != nil {
			return err
		}
		var cursorTime *time.Time
		if before != nil {
			version, err := versionByID(ctx, tx, boardID, *before, nil)
			if err != nil {
				return err
			}
			cursorTime = &version.CreatedAt
		}
		rows, err := tx.Query(ctx, "SELECT "+versionFields+versionJoins+`
			WHERE v.board_id = $1 AND ($2::timestamptz IS NULL OR (v.created_at, v.id) < ($2, $3::uuid))
			ORDER BY v.created_at DESC, v.id DESC LIMIT $4
		`, boardID, cursorTime, before, limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		list = VersionList{BoardID: boardID, Epoch: head.Epoch, Seq: head.Seq, Versions: make([]VersionSummary, 0, limit)}
		for rows.Next() {
			version, err := scanVersion(rows, nil)
			if err != nil {
				return err
			}
			if len(list.Versions) == limit {
				cursor := list.Versions[len(list.Versions)-1].ID
				list.NextCursor = &cursor
				break
			}
			list.Versions = append(list.Versions, version)
		}
		return rows.Err()
	})
	return list, err
}

func PreviewVersion(ctx context.Context, boardID string, actor, versionID uuid.UUID) (VersionPreview, error) {
	var preview VersionPreview
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if _, err := versionAccess(ctx, tx, boardID, actor, false); err != nil {
			return err
		}
		var err error
		preview, err = readVersionPreview(ctx, tx, boardID, versionID)
		return err
	})
	return preview, err
}

func readVersionPreview(ctx context.Context, tx pgx.Tx, boardID string, versionID uuid.UUID) (VersionPreview, error) {
	var preview VersionPreview
	version, err := versionByID(ctx, tx, boardID, versionID, &preview.Document)
	if err != nil {
		return VersionPreview{}, err
	}
	_, digest, err := encodeDocument(preview.Document)
	if err != nil {
		return VersionPreview{}, err
	}
	if digest != version.Hash {
		return VersionPreview{}, fmt.Errorf("checksum mismatch for board version %s", version.ID)
	}
	preview.Version = version
	return preview, nil
}

func NameVersion(ctx context.Context, boardID string, actor uuid.UUID, name string, position VersionPosition) (VersionSummary, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxVersionName || strings.ContainsRune(name, 0) || !position.valid() {
		return VersionSummary{}, invalidCommand("Provide a version name of up to 120 characters and a current board position.")
	}
	var version VersionSummary
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		room, err := lockRoom(ctx, tx, boardID)
		if err != nil {
			return err
		}
		head, err := versionAccess(ctx, tx, boardID, actor, false)
		if err != nil {
			return err
		}
		if !position.matches(head) {
			return cursorFault("STALE_VERSION_HEAD", "The board changed. Sync the latest edits before naming this version.", head)
		}
		snapshot, err := snapshotLocked(ctx, tx, room, head, "")
		if err != nil {
			return err
		}
		version, err = storeVersion(ctx, tx, snapshot, versionMarker{kind: versionNamed, name: name, actor: &actor})
		return err
	})
	return version, err
}

func storeVersion(ctx context.Context, tx pgx.Tx, snapshot Snapshot, marker versionMarker) (VersionSummary, error) {
	payload, digest, err := encodeDocument(snapshot.Document)
	if err != nil {
		return VersionSummary{}, err
	}
	id, err := storeVersionPayload(ctx, tx, snapshot, marker, payload, digest)
	if err != nil {
		return VersionSummary{}, err
	}
	return versionByID(ctx, tx, snapshot.BoardID, id, nil)
}

func storeVersionPayload(ctx context.Context, tx pgx.Tx, snapshot Snapshot, marker versionMarker, payload []byte, digest string) (uuid.UUID, error) {
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_snapshots (board_id, epoch, seq, reason, document, digest)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (board_id, epoch, seq, reason) DO NOTHING
	`, snapshot.BoardID, snapshot.Epoch, snapshot.Seq, versionSnapshotReason, payload, digest); err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
		INSERT INTO board_versions (board_id, epoch, seq, snapshot_reason, kind, name, actor_id, participant_ids, source_version_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::uuid[], '{}'), $9)
		RETURNING id
	`, snapshot.BoardID, snapshot.Epoch, snapshot.Seq, versionSnapshotReason, marker.kind, marker.name,
		marker.actor, marker.participants, marker.source).Scan(&id)
	return id, err
}

func markInitialVersion(ctx context.Context, tx pgx.Tx, snapshot Snapshot) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO board_versions (board_id, epoch, seq, snapshot_reason, kind, name)
		VALUES ($1, $2, $3, 'migration', 'checkpoint', 'Initial checkpoint')
	`, snapshot.BoardID, snapshot.Epoch, snapshot.Seq)
	return err
}

func maybeCheckpointVersion(ctx context.Context, tx pgx.Tx, state *commitState) error {
	if state.seq%checkpointInterval != 0 {
		return nil
	}
	head := state.head
	head.Seq = state.seq
	snapshot, err := snapshotLocked(ctx, tx, state.room, head, "")
	if err != nil {
		return err
	}
	payload, digest, err := encodeDocument(snapshot.Document)
	if err != nil || len(payload) > maxCheckpointBytes {
		return err
	}
	var participants []uuid.UUID
	if err := tx.QueryRow(ctx, `
		SELECT ARRAY(SELECT DISTINCT actor_id FROM board_command_receipts
			WHERE board_id = $1 AND epoch = $2 AND seq > $3 AND seq <= $4 ORDER BY actor_id LIMIT 30)
	`, state.room.ID, head.Epoch, head.Seq-checkpointInterval, head.Seq).Scan(&participants); err != nil {
		return err
	}
	if _, err := storeVersionPayload(ctx, tx, snapshot, versionMarker{
		kind: versionCheckpoint, name: "Automatic checkpoint", participants: participants,
	}, payload, digest); err != nil {
		return err
	}
	pruned, err := tx.Exec(ctx, `
		DELETE FROM board_versions WHERE id IN (
			SELECT id FROM board_versions
			WHERE board_id = $1 AND kind = 'checkpoint' AND snapshot_reason = $2
			ORDER BY seq DESC OFFSET $3
		)
	`, state.room.ID, versionSnapshotReason, checkpointRetention)
	if err != nil || pruned.RowsAffected() == 0 {
		return err
	}
	_, err = tx.Exec(ctx, `
		DELETE FROM board_snapshots s WHERE s.board_id = $1 AND s.reason = $2 AND NOT EXISTS (
			SELECT 1 FROM board_versions v WHERE (v.board_id, v.epoch, v.seq, v.snapshot_reason)
				= (s.board_id, s.epoch, s.seq, s.reason)
		)
	`, state.room.ID, versionSnapshotReason)
	return err
}
