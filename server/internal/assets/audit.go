package assets

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"

	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/storage"
)

// AuditStoredImages reads each registered image linked from a file or a
// project snapshot. Unlinked staging objects are eligible for normal expiry.
func AuditStoredImages(ctx context.Context, bucket *storage.Bucket) (checked int, err error) {
	rows, err := db.Pool().Query(ctx, `
		SELECT b.id, b.size_bytes, b.ready
		FROM asset_blobs b WHERE EXISTS (SELECT FROM board_assets a WHERE a.asset_id = b.id)
			OR EXISTS (SELECT FROM project_version_assets a WHERE a.asset_id = b.id)
		ORDER BY b.id
	`)
	if err != nil {
		return 0, errors.New("could not read the private image inventory")
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var size int64
		var ready bool
		if err := rows.Scan(&id, &size, &ready); err != nil {
			return checked, errors.New("could not read a private image record")
		}
		if !ready || !ValidID(id) || size < 1 || size > MaxImageBytes {
			return checked, errors.New("a linked image record is invalid or not ready")
		}
		reader, storedSize, err := bucket.OpenFile(ctx, objectKey(id))
		if err != nil {
			if ctx.Err() != nil {
				return checked, errors.New("image audit reached its time limit or was interrupted")
			}
			return checked, fmt.Errorf("could not read image %s", id)
		}
		hash := sha256.New()
		n, readErr := io.Copy(hash, io.LimitReader(reader, size+1))
		_ = reader.Close()
		if ctx.Err() != nil {
			return checked, errors.New("image audit reached its time limit or was interrupted")
		}
		if readErr != nil || storedSize != size || n != size || hex.EncodeToString(hash.Sum(nil)) != id {
			return checked, fmt.Errorf("size or SHA-256 mismatch for image %s", id)
		}
		checked++
	}
	if rows.Err() != nil {
		return checked, errors.New("private image inventory was interrupted")
	}
	return checked, nil
}
