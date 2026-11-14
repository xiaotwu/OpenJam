package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

var pool *pgxpool.Pool

func Init(databaseURL string) error {
	return InitContext(context.Background(), databaseURL)
}

func InitContext(ctx context.Context, databaseURL string) error {
	newPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("unable to connect to database: %w", err)
	}

	if err := newPool.Ping(ctx); err != nil {
		newPool.Close()
		return fmt.Errorf("unable to ping database: %w", err)
	}

	pool = newPool
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
