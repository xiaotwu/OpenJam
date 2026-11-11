package assets

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/storage"
)

const (
	stagingLock      int64 = 0x4f4a4153534554
	maxStagingBytes        = 128 * 1024 * 1024
	maxStagedObjects       = 1024
)

var ErrStagingFull = errors.New("unlinked image staging storage is full")

func objectKey(id string) string { return "assets/v1/" + id }

// Stage creates or reuses a private blob without granting board access.
// A crashed importer leaves a bounded reservation that Sweep can reclaim.
func Stage(ctx context.Context, meta Metadata, data []byte) error {
	if !storage.IsInitialized() {
		return ErrUnavailable
	}
	actual, err := Inspect(data, meta.MIMEType)
	if err != nil {
		return err
	}
	if actual != meta {
		return ErrInvalidImage
	}
	return stageVerified(ctx, meta, data)
}

func stageVerified(ctx context.Context, meta Metadata, data []byte) error {
	if err := reserve(ctx, meta); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		var ready bool
		if err := tx.QueryRow(ctx, `SELECT ready FROM asset_blobs WHERE id = $1 FOR UPDATE`, meta.ID).Scan(&ready); err != nil {
			return err
		}
		key := objectKey(meta.ID)
		if err := ensureObject(ctx, key, meta, data, !ready); err != nil {
			return fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		if ready {
			return nil
		}
		_, err := tx.Exec(ctx, `UPDATE asset_blobs SET ready = TRUE WHERE id = $1`, meta.ID)
		return err
	})
}

func reserve(ctx context.Context, meta Metadata) error {
	return pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, stagingLock); err != nil {
			return err
		}
		var existing Metadata
		err := tx.QueryRow(ctx, `
			SELECT id, mime_type, size_bytes, width, height FROM asset_blobs WHERE id = $1 FOR UPDATE
		`, meta.ID).Scan(&existing.ID, &existing.MIMEType, &existing.Size, &existing.Width, &existing.Height)
		switch {
		case err == nil:
			if existing != meta {
				return ErrInvalidImage
			}
			_, err := tx.Exec(ctx, `UPDATE asset_blobs SET staged_at = clock_timestamp() WHERE id = $1`, meta.ID)
			return err
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		var size int64
		var count int
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(sum(b.size_bytes), 0), count(*) FROM asset_blobs b
			WHERE NOT EXISTS (SELECT 1 FROM board_assets a WHERE a.asset_id = b.id)
		`).Scan(&size, &count); err != nil {
			return err
		}
		if size+meta.Size > maxStagingBytes || count >= maxStagedObjects {
			return ErrStagingFull
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO asset_blobs (id, mime_type, size_bytes, width, height) VALUES ($1, $2, $3, $4, $5)
		`, meta.ID, meta.MIMEType, meta.Size, meta.Width, meta.Height)
		return err
	})
}

func ensureObject(ctx context.Context, key string, meta Metadata, data []byte, verifyDigest bool) error {
	reader, size, err := storage.OpenFile(ctx, key)
	if errors.Is(err, storage.ErrObjectNotFound) {
		_, err := storage.UploadFile(ctx, key, bytes.NewReader(data), meta.Size, meta.MIMEType)
		return err
	}
	if err != nil {
		return err
	}
	defer reader.Close()
	if size != meta.Size {
		return errors.New("staged object size differs from its reservation")
	}
	if !verifyDigest {
		return nil
	}
	// An earlier attempt may have completed the PUT before losing its lease or
	// transaction. Verify the exact bytes rather than creating another object.
	hash := sha256.New()
	if n, err := io.Copy(hash, io.LimitReader(reader, meta.Size+1)); err != nil || n != meta.Size {
		return errors.New("could not verify the staged object bytes")
	}
	if hex.EncodeToString(hash.Sum(nil)) != meta.ID {
		return errors.New("staged object digest differs from its reservation")
	}
	return nil
}

// Sweep removes unreferenced blobs after their 24-hour staging window. The
// asset row stays locked while its deterministic object key is removed.
func Sweep(ctx context.Context, limit int) (int, error) {
	if !storage.IsInitialized() {
		return 0, ErrUnavailable
	}
	removed := 0
	for range min(max(limit, 0), 50) {
		deleted, more, err := sweepOne(ctx)
		if err != nil {
			return removed, err
		}
		if !more {
			break
		}
		if deleted {
			removed++
		}
	}
	return removed, nil
}

func sweepOne(ctx context.Context) (deleted, found bool, err error) {
	err = pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx, `
			SELECT b.id FROM asset_blobs b
			WHERE b.staged_at < clock_timestamp() - interval '24 hours'
			AND NOT EXISTS (SELECT 1 FROM board_assets a WHERE a.asset_id = b.id)
			ORDER BY b.staged_at, b.id LIMIT 1 FOR UPDATE SKIP LOCKED
		`).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		found = true
		// Recheck after locking, since a link may have committed while the
		// previous SELECT was finding this candidate.
		var linked bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM board_assets WHERE asset_id = $1)`, id).Scan(&linked); err != nil {
			return err
		}
		if linked {
			return nil
		}
		if err := storage.DeleteFile(ctx, objectKey(id)); err != nil {
			return fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM asset_blobs WHERE id = $1`, id); err != nil {
			return err
		}
		deleted = true
		return nil
	})
	return deleted, found, err
}
