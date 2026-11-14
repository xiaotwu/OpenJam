package storage

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
)

var ErrObjectNotFound = errors.New("storage object not found")

// OpenFile keeps bucket credentials and URLs inside the service. The caller
// supplies an already authorized object key and closes the returned stream.
func OpenFile(ctx context.Context, objectName string) (io.ReadSeekCloser, int64, error) {
	bucket := activeBucket.Load()
	if bucket == nil {
		return nil, 0, errors.New("storage not initialized")
	}
	return bucket.OpenFile(ctx, objectName)
}

func (bucket *Bucket) OpenFile(ctx context.Context, objectName string) (io.ReadSeekCloser, int64, error) {
	object, err := bucket.client.GetObject(ctx, bucket.name, objectName, minio.GetObjectOptions{})
	if err != nil {
		return nil, 0, fmt.Errorf("open storage object: %w", err)
	}
	info, err := object.Stat()
	if err != nil {
		_ = object.Close()
		if response := minio.ToErrorResponse(err); response.Code == "NoSuchKey" || response.Code == "NotFound" {
			return nil, 0, ErrObjectNotFound
		}
		return nil, 0, fmt.Errorf("stat storage object: %w", err)
	}
	return object, info.Size, nil
}
