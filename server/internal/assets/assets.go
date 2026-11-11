package assets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/storage"
)

const (
	maxBoardAssetBytes = 128 * 1024 * 1024
	maxBoardAssets     = 1024
)

var (
	ErrNotFound    = errors.New("image asset not found on this board")
	ErrQuota       = errors.New("board image storage limit reached")
	ErrUnavailable = errors.New("private image storage is temporarily unavailable")
)

// Reference validates a typed asset reference without resolving a storage key.
// Legacy images are represented by an absent assetId.
func Reference(fields map[string]json.RawMessage) (string, error) {
	value, hasAsset := fields["assetId"]
	if !hasAsset {
		return "", nil
	}
	var kind, id, source string
	if json.Unmarshal(fields["type"], &kind) != nil || kind != "image" ||
		json.Unmarshal(value, &id) != nil || !ValidID(id) {
		return "", ErrInvalidReference
	}
	if sourceField, exists := fields["src"]; exists && (json.Unmarshal(sourceField, &source) != nil || source != "") {
		return "", ErrInvalidReference
	}
	return id, nil
}

func References(elements []json.RawMessage) ([]string, error) {
	seen := make(map[string]bool)
	var ids []string
	for _, element := range elements {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(element, &fields); err != nil {
			return nil, ErrInvalidReference
		}
		id, err := Reference(fields)
		if err != nil {
			return nil, err
		}
		if id != "" && !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	slices.Sort(ids)
	return ids, nil
}

func RequireLinked(ctx context.Context, tx pgx.Tx, boardID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	var found int
	err := tx.QueryRow(ctx, `
		SELECT count(*) FROM board_assets a JOIN asset_blobs b ON a.asset_id = b.id
		WHERE a.board_id = $1 AND a.asset_id = ANY($2::text[]) AND b.ready
	`, boardID, ids).Scan(&found)
	if err != nil {
		return err
	}
	if found != len(ids) {
		return ErrNotFound
	}
	return nil
}

// Get checks effective access for the specific board and matches the image to
// a committed board association before opening private object storage.
func Get(ctx context.Context, boardID string, actor uuid.UUID, id string) (Metadata, io.ReadSeekCloser, error) {
	if !ValidID(id) {
		return Metadata{}, nil, ErrInvalidReference
	}
	var meta Metadata
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if _, err := model.QueryRoomAccess(ctx, tx, boardID, actor); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			SELECT b.id, b.mime_type, b.size_bytes, b.width, b.height
			FROM board_assets a JOIN asset_blobs b ON a.asset_id = b.id
			WHERE a.board_id = $1 AND a.asset_id = $2 AND b.ready
		`, boardID, id).Scan(&meta.ID, &meta.MIMEType, &meta.Size, &meta.Width, &meta.Height)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	if err != nil {
		return Metadata{}, nil, err
	}
	reader, size, err := storage.OpenFile(ctx, objectKey(meta.ID))
	if err != nil {
		return Metadata{}, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if size != meta.Size {
		_ = reader.Close()
		return Metadata{}, nil, fmt.Errorf("%w: registered size differs from object size", ErrUnavailable)
	}
	return meta, reader, nil
}

func Upload(ctx context.Context, boardID string, actor uuid.UUID, data []byte, contentType string) (Metadata, error) {
	if err := model.UserCanEditRoom(ctx, boardID, actor); err != nil {
		return Metadata{}, err
	}
	if !storage.IsInitialized() {
		return Metadata{}, ErrUnavailable
	}
	meta, err := Inspect(data, contentType)
	if err != nil {
		return Metadata{}, err
	}
	if err := stageVerified(ctx, meta, data); err != nil {
		return Metadata{}, err
	}
	err = pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockBoard(ctx, tx, boardID); err != nil {
			return err
		}
		access, err := model.QueryRoomAccess(ctx, tx, boardID, actor)
		if err != nil {
			return err
		}
		if !access.IsOwner && !model.RoomPermissionAllowsEdit(access.Permission) {
			return model.ErrRoomAccessDenied
		}
		return grantLocked(ctx, tx, boardID, []Metadata{meta})
	})
	if err != nil {
		return Metadata{}, err
	}
	return meta, nil
}

func lockBoard(ctx context.Context, tx pgx.Tx, boardID string) error {
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM rooms WHERE id = $1 FOR UPDATE`, boardID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ErrRoomNotFound
	}
	return err
}

// Grant links already validated and staged bytes to the destination board.
// Callers authorize the destination and import source before invoking Grant.
func Grant(ctx context.Context, tx pgx.Tx, boardID string, metas []Metadata) error {
	if len(metas) == 0 {
		return nil
	}
	if err := lockBoard(ctx, tx, boardID); err != nil {
		return err
	}
	return grantLocked(ctx, tx, boardID, metas)
}

func grantLocked(ctx context.Context, tx pgx.Tx, boardID string, metas []Metadata) error {
	expected := make(map[string]Metadata, len(metas))
	var ids []string
	for _, meta := range metas {
		prior, seen := expected[meta.ID]
		if !ValidID(meta.ID) || (seen && meta != prior) {
			return ErrInvalidImage
		}
		if !seen {
			ids = append(ids, meta.ID)
			expected[meta.ID] = meta
		}
	}
	if len(ids) > maxBoardAssets {
		return ErrQuota
	}
	// Hold row locks through the link insertion so a sweep cannot remove an
	// unlinked blob between its verification and the board association.
	rows, err := tx.Query(ctx, `
		SELECT id, mime_type, size_bytes, width, height FROM asset_blobs
		WHERE id = ANY($1::text[]) AND ready ORDER BY id FOR KEY SHARE
	`, ids)
	if err != nil {
		return err
	}
	registered, err := readMetadata(rows)
	if err != nil {
		return err
	}
	if len(registered) != len(ids) {
		return ErrNotFound
	}
	for _, meta := range registered {
		if meta != expected[meta.ID] {
			return ErrInvalidImage
		}
	}
	var size int64
	var count int
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(sum(b.size_bytes), 0), count(*) FROM asset_blobs b JOIN (
			SELECT asset_id AS id FROM board_assets WHERE board_id = $1
			UNION SELECT unnest($2::text[])
		) linked USING (id)
	`, boardID, ids).Scan(&size, &count)
	if err != nil {
		return err
	}
	if size > maxBoardAssetBytes || count > maxBoardAssets {
		return ErrQuota
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO board_assets (board_id, asset_id)
		SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING
	`, boardID, ids)
	return err
}

// CopyLinks carries only the referenced, registered images from a previously
// authorized source board to a new private board in the copying transaction.
func CopyLinks(ctx context.Context, tx pgx.Tx, sourceID, targetID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	rows, err := tx.Query(ctx, `
		SELECT b.id, b.mime_type, b.size_bytes, b.width, b.height
		FROM board_assets a JOIN asset_blobs b ON a.asset_id = b.id
		WHERE a.board_id = $1 AND a.asset_id = ANY($2::text[]) AND b.ready
	`, sourceID, ids)
	if err != nil {
		return err
	}
	metas, err := readMetadata(rows)
	if err != nil {
		return err
	}
	if len(metas) != len(ids) {
		return ErrNotFound
	}
	return Grant(ctx, tx, targetID, metas)
}

func readMetadata(rows pgx.Rows) ([]Metadata, error) {
	defer rows.Close()
	var metas []Metadata
	for rows.Next() {
		var meta Metadata
		if err := rows.Scan(&meta.ID, &meta.MIMEType, &meta.Size, &meta.Width, &meta.Height); err != nil {
			return nil, err
		}
		metas = append(metas, meta)
	}
	return metas, rows.Err()
}
