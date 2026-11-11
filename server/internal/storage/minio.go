package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var client *minio.Client
var bucketName = "openjam"

func Init(endpoint, accessKey, secretKey string, useSSL bool) error {
	var err error
	client, err = minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return fmt.Errorf("failed to create MinIO client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	exists, err := client.BucketExists(ctx, bucketName)
	if err != nil {
		return fmt.Errorf("failed to check bucket: %w", err)
	}

	if !exists {
		if err := client.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("failed to create bucket: %w", err)
		}
	}

	return nil
}

func IsInitialized() bool {
	return client != nil
}

func UploadFile(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) (string, error) {
	if client == nil {
		return "", fmt.Errorf("storage not initialized")
	}

	_, err := client.PutObject(ctx, bucketName, objectName, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload file: %w", err)
	}

	return objectName, nil
}

func GetPresignedURL(ctx context.Context, objectName string, expiry time.Duration) (string, error) {
	if client == nil {
		return "", fmt.Errorf("storage not initialized")
	}

	url, err := client.PresignedGetObject(ctx, bucketName, objectName, expiry, nil)
	if err != nil {
		return "", fmt.Errorf("failed to get presigned URL: %w", err)
	}

	return url.String(), nil
}

func DeleteFile(ctx context.Context, objectName string) error {
	if client == nil {
		return fmt.Errorf("storage not initialized")
	}

	return client.RemoveObject(ctx, bucketName, objectName, minio.RemoveObjectOptions{})
}

func ListFiles(ctx context.Context, prefix string) ([]string, error) {
	if client == nil {
		return nil, fmt.Errorf("storage not initialized")
	}

	var files []string
	objectCh := client.ListObjects(ctx, bucketName, minio.ListObjectsOptions{
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
