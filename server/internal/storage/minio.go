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

type storageBucket struct {
	client *minio.Client
	name   string
}

var activeBucket atomic.Pointer[storageBucket]

func Init(endpoint, accessKey, secretKey string, useSSL bool) error {
	return InitWithBucket(endpoint, accessKey, secretKey, useSSL, defaultBucket)
}

func InitWithBucket(endpoint, accessKey, secretKey string, useSSL bool, bucket string) error {
	if bucket == "" {
		bucket = defaultBucket
	}

	candidate, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return fmt.Errorf("failed to create MinIO client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	exists, err := candidate.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Errorf("failed to check bucket: %w", err)
	}

	if !exists {
		if err := candidate.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			switch minio.ToErrorResponse(err).Code {
			case "BucketAlreadyOwnedByYou", "BucketAlreadyExists":
				exists, checkErr := candidate.BucketExists(ctx, bucket)
				if checkErr != nil || !exists {
					return fmt.Errorf("failed to confirm existing bucket after create: %w", err)
				}
			default:
				return fmt.Errorf("failed to create bucket: %w", err)
			}
		}
	}

	activeBucket.Store(&storageBucket{client: candidate, name: bucket})
	return nil
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
