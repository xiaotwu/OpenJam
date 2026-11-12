package storage

import (
	"context"
	"fmt"
	"io"
	"sync/atomic"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

const defaultBucket = "openjam"

type Bucket struct {
	client *minio.Client
	name   string
}

var activeBucket atomic.Pointer[Bucket]

func Init(endpoint, accessKey, secretKey string, useSSL bool) error {
	return InitWithBucket(endpoint, accessKey, secretKey, useSSL, defaultBucket)
}

func newBucket(endpoint, accessKey, secretKey string, useSSL bool, bucket string) (*Bucket, error) {
	if bucket == "" {
		bucket = defaultBucket
	}

	candidate, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create MinIO client: %w", err)
	}
	return &Bucket{client: candidate, name: bucket}, nil
}

func InitWithBucket(endpoint, accessKey, secretKey string, useSSL bool, bucket string) error {
	target, err := newBucket(endpoint, accessKey, secretKey, useSSL, bucket)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	exists, err := target.client.BucketExists(ctx, target.name)
	if err != nil {
		return fmt.Errorf("failed to check bucket: %w", err)
	}

	if !exists {
		if err := target.client.MakeBucket(ctx, target.name, minio.MakeBucketOptions{}); err != nil {
			switch minio.ToErrorResponse(err).Code {
			case "BucketAlreadyOwnedByYou", "BucketAlreadyExists":
				exists, checkErr := target.client.BucketExists(ctx, target.name)
				if checkErr != nil || !exists {
					return fmt.Errorf("failed to confirm existing bucket after create: %w", err)
				}
			default:
				return fmt.Errorf("failed to create bucket: %w", err)
			}
		}
	}

	activeBucket.Store(target)
	return nil
}

// OpenExistingBucket checks read access without creating a bucket or objects.
func OpenExistingBucket(ctx context.Context, endpoint, accessKey, secretKey string, useSSL bool, bucket string) (*Bucket, error) {
	target, err := newBucket(endpoint, accessKey, secretKey, useSSL, bucket)
	if err != nil {
		return nil, err
	}
	exists, err := target.client.BucketExists(ctx, target.name)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("configured object bucket is missing")
	}
	listCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	for item := range target.client.ListObjects(listCtx, target.name, minio.ListObjectsOptions{MaxKeys: 1}) {
		if item.Err != nil {
			return nil, item.Err
		}
		break
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return target, nil
}

func IsInitialized() bool {
	return activeBucket.Load() != nil
}

func UploadFile(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) (string, error) {
	bucket := activeBucket.Load()
	if bucket == nil {
		return "", fmt.Errorf("storage not initialized")
	}

	_, err := bucket.client.PutObject(ctx, bucket.name, objectName, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload file: %w", err)
	}

	return objectName, nil
}

func GetPresignedURL(ctx context.Context, objectName string, expiry time.Duration) (string, error) {
	bucket := activeBucket.Load()
	if bucket == nil {
		return "", fmt.Errorf("storage not initialized")
	}

	url, err := bucket.client.PresignedGetObject(ctx, bucket.name, objectName, expiry, nil)
	if err != nil {
		return "", fmt.Errorf("failed to get presigned URL: %w", err)
	}

	return url.String(), nil
}

func DeleteFile(ctx context.Context, objectName string) error {
	bucket := activeBucket.Load()
	if bucket == nil {
		return fmt.Errorf("storage not initialized")
	}

	return bucket.client.RemoveObject(ctx, bucket.name, objectName, minio.RemoveObjectOptions{})
}

func ListFiles(ctx context.Context, prefix string) ([]string, error) {
	bucket := activeBucket.Load()
	if bucket == nil {
		return nil, fmt.Errorf("storage not initialized")
	}

	var files []string
	objectCh := bucket.client.ListObjects(ctx, bucket.name, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})

	for object := range objectCh {
		if object.Err != nil {
			return nil, object.Err
		}
		files = append(files, object.Key)
	}

	return files, nil
}
