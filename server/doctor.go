package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/config"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/storage"
)

func runDoctor(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("openjam doctor", flag.ContinueOnError)
	flags.SetOutput(out)
	audit := flags.Bool("assets", false, "read and hash registered private images")
	timeout := flags.Duration("timeout", 30*time.Second, "time limit for all checks")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 || *timeout <= 0 {
		return errors.New("usage: openjam doctor [--assets] [--timeout 30s]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, *timeout)
	defer cancel()

	failed := false
	report := func(ok bool, check, detail string) {
		if ok {
			fmt.Fprintf(out, "PASS %s %s\n", check, detail)
		} else {
			fmt.Fprintf(out, "FAIL %s %s\n", check, detail)
			failed = true
		}
	}
	skip := func(check, detail string) { fmt.Fprintf(out, "SKIP %s %s\n", check, detail) }
	postgresCtx, stopPostgres := context.WithTimeout(ctx, 5*time.Second)
	err = db.InitContext(postgresCtx, cfg.DatabaseURL)
	stopPostgres()
	var schemaOK bool
	if err != nil {
		report(false, "postgres", "connection failed. Check the server address, credentials and network.")
		skip("schema", "requires PostgreSQL")
	} else {
		defer db.Close()
		report(true, "postgres", "connection ready")
		schemaCtx, stopSchema := context.WithTimeout(ctx, 5*time.Second)
		installed, required, err := db.SchemaVersions(schemaCtx)
		stopSchema()
		schemaOK = err == nil && installed == required
		if err != nil {
			report(false, "schema", "migration history unavailable or incomplete. See the upgrade guide.")
		} else {
			report(schemaOK, "schema", fmt.Sprintf("installed=%d required=%d", installed, required))
		}
	}

	switch {
	case cfg.RedisURL == "":
		skip("redis", "disabled in this configuration")
	case db.InitRedisContext(ctx, cfg.RedisURL) != nil:
		report(false, "redis", "PING failed. Check the server address, credentials and network.")
	default:
		_ = db.Redis().Close()
		report(true, "redis", "PING succeeded")
	}
	s3Ctx, stopS3 := context.WithTimeout(ctx, 8*time.Second)
	bucket, err := storage.OpenExistingBucket(s3Ctx, cfg.MinioEndpoint, cfg.MinioAccessKey,
		cfg.MinioSecretKey, cfg.MinioUseSSL, cfg.MinioBucket)
	stopS3()
	if err != nil {
		report(false, "storage", "bucket check failed. Check the endpoint, bucket, TLS and read access.")
	} else {
		report(true, "storage", "bucket is readable")
	}
	if *audit {
		if !schemaOK || bucket == nil {
			skip("private-images", "requires the matching schema and readable storage")
		} else if checked, err := assets.AuditStoredImages(ctx, bucket); err != nil {
			report(false, "private-images", fmt.Sprintf("checked=%d. %v", checked, err))
		} else {
			report(true, "private-images", fmt.Sprintf("verified=%d SHA-256", checked))
		}
	}
	if failed {
		return errors.New("OpenJam self-check failed")
	}
	return nil
}
