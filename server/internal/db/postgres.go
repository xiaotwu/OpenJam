package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

var pool *pgxpool.Pool

func Init(databaseURL string) error {
	var err error
	pool, err = pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return fmt.Errorf("unable to connect to database: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return fmt.Errorf("unable to ping database: %w", err)
	}

	return nil
}

func Close() {
	if pool != nil {
		pool.Close()
	}
}

func Pool() *pgxpool.Pool {
	return pool
}

func Migrate() error {
	ctx := context.Background()

	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			display_name VARCHAR(255) NOT NULL,
			avatar_color VARCHAR(7) NOT NULL DEFAULT '#3b82f6',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS sessions (
			token VARCHAR(64) PRIMARY KEY,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create sessions table: %w", err)
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS rooms (
			id VARCHAR(36) PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			board_data JSONB DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create rooms table: %w", err)
	}

	_, _ = pool.Exec(ctx, `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS board_data JSONB DEFAULT '{}'`)

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS room_members (
			room_id VARCHAR(36) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			permission VARCHAR(12) NOT NULL CHECK (permission IN ('view', 'comment', 'edit')),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (room_id, user_id)
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create room_members table: %w", err)
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS room_share_settings (
			room_id VARCHAR(36) PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
			link_permission VARCHAR(24) NOT NULL DEFAULT 'restricted'
				CHECK (link_permission IN ('restricted', 'anyone-view', 'anyone-comment', 'anyone-edit')),
			updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create room_share_settings table: %w", err)
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS operations (
			id BIGSERIAL PRIMARY KEY,
			room_id VARCHAR(36) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			op_id VARCHAR(64) NOT NULL,
			op_type VARCHAR(20) NOT NULL,
			payload JSONB NOT NULL,
			vector_clock JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(room_id, op_id)
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create operations table: %w", err)
	}

	_, err = pool.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS idx_operations_room_id ON operations(room_id);
		CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
		CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
		CREATE INDEX IF NOT EXISTS idx_rooms_owner_id ON rooms(owner_id);
		CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
	`)
	if err != nil {
		return fmt.Errorf("failed to create indexes: %w", err)
	}

	return nil
}
