package assets

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"

	"github.com/xiaotwu/shiori/server/internal/storage"
)

// ReadRegistered opens bytes whose ready metadata and source association were
// verified in the caller's authorized export snapshot. It is not a public lookup.
func ReadRegistered(ctx context.Context, meta Metadata) ([]byte, error) {
	if !ValidID(meta.ID) || meta.Size <= 0 || meta.Size > MaxImageBytes {
		return nil, ErrInvalidImage
	}
	reader, size, err := storage.OpenFile(ctx, objectKey(meta.ID))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer reader.Close()
	if size != meta.Size {
		return nil, ErrUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(reader, meta.Size+1))
	if err != nil || int64(len(data)) != meta.Size {
		return nil, ErrUnavailable
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != meta.ID {
		return nil, ErrUnavailable
	}
	return data, nil
}
