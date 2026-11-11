package db

import (
	"context"
	"embed"
	"fmt"

	"github.com/jackc/pgx/v5"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

var migrations = [...]string{
	"migrations/001_legacy.sql",
	"migrations/002_directory.sql",
	"migrations/003_documents.sql",
	"migrations/004_document_sync.sql",
	"migrations/005_editor_commands.sql",
	"migrations/006_board_versions.sql",
	"migrations/007_board_review.sql",
	"migrations/008_board_sharing.sql",
	"migrations/009_jobs.sql",
	"migrations/010_assets.sql",
	"migrations/011_agent.sql",
	"migrations/012_job_abandonment.sql",
	"migrations/013_agent_conversations.sql",
	"migrations/014_agent_identity.sql",
	"migrations/015_team_access.sql",
	"migrations/016_workshop_discovery.sql",
	"migrations/017_workshop.sql",
}

// Every OpenJam migrator for the same database uses this transaction lock.
const migrationLock int64 = 0x4f70656e4a616d

func Migrate() error {
	return MigrateContext(context.Background())
}

func MigrateContext(ctx context.Context) error {
	return pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", migrationLock); err != nil {
			return fmt.Errorf("acquire OpenJam migration lock: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			CREATE TABLE IF NOT EXISTS openjam_schema_migrations (
				version INTEGER PRIMARY KEY CHECK (version > 0),
				applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`); err != nil {
			return fmt.Errorf("initialize OpenJam migration history: %w", err)
		}
		current, err := schemaVersion(ctx, tx)
		if err != nil {
			return err
		}
		if current > len(migrations) {
			return fmt.Errorf("OpenJam database schema is at version %d, binary supports %d", current, len(migrations))
		}
		for index, path := range migrations[current:] {
			version := current + index + 1
			sql, err := migrationFiles.ReadFile(path)
			if err != nil {
				return fmt.Errorf("read OpenJam migration %d: %w", version, err)
			}
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return fmt.Errorf("apply OpenJam migration %d: %w", version, err)
			}
			if _, err := tx.Exec(ctx, "INSERT INTO openjam_schema_migrations (version) VALUES ($1)", version); err != nil {
				return fmt.Errorf("record OpenJam migration %d: %w", version, err)
			}
		}
		return nil
	})
}

// CheckSchema confirms that all migrations required by this binary have committed.
func CheckSchema(ctx context.Context) error {
	current, err := schemaVersion(ctx, pool)
	if err != nil {
		return err
	}
	if current != len(migrations) {
		return fmt.Errorf("OpenJam database schema is at version %d, binary requires %d", current, len(migrations))
	}
	return nil
}

type schemaQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func schemaVersion(ctx context.Context, query schemaQuerier) (int, error) {
	var current, applied int
	err := query.QueryRow(ctx, "SELECT COALESCE(MAX(version), 0), COUNT(*) FROM openjam_schema_migrations").Scan(&current, &applied)
	if err != nil {
		return 0, fmt.Errorf("read OpenJam migration history: %w", err)
	}
	if current != applied {
		return 0, fmt.Errorf("OpenJam migration history has gaps up to version %d", current)
	}
	return current, nil
}
