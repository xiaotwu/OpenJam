package jobs

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PauseTx fences a claimed attempt in the same transaction as its state change.
// Only callers that can safely repeat a local handler may pause a running job.
func PauseTx(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID, allowRunning bool) (Job, error) {
	job, err := scanJob(tx.QueryRow(ctx, `UPDATE jobs j SET status = 'paused',
		attempt = CASE WHEN status = 'running' THEN greatest(0, attempt - 1) ELSE attempt END,
		revision = revision + 1, updated_at = clock_timestamp(), lease_token = NULL, lease_until = NULL
		WHERE j.id = $1 AND j.actor_id = $2 AND j.input_expires_at > clock_timestamp()
		AND (j.status = 'queued' OR ($3 AND j.status = 'running'))
		RETURNING `+jobColumns, id, actor, allowRunning), true)
	if !errors.Is(err, pgx.ErrNoRows) {
		return job, err
	}
	job, err = GetTx(ctx, tx, id, actor)
	if err == nil && job.Status != StatusPaused {
		return Job{}, ErrConflict
	}
	return job, err
}

// ResumePausedTx keeps the original request, input deadline and any remaining
// retry backoff. A replay after a worker has reclaimed the job is read-only.
func ResumePausedTx(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID) (Job, error) {
	job, err := scanJob(tx.QueryRow(ctx, `UPDATE jobs j SET status = 'queued', resumed_from_pause = TRUE,
		revision = revision + 1, available_at = greatest(available_at, clock_timestamp()),
		updated_at = clock_timestamp()
		WHERE j.id = $1 AND j.actor_id = $2 AND j.status = 'paused' AND j.input_expires_at > clock_timestamp()
		RETURNING `+jobColumns, id, actor), true)
	if !errors.Is(err, pgx.ErrNoRows) {
		return job, err
	}
	job, err = GetTx(ctx, tx, id, actor)
	if err != nil {
		return Job{}, err
	}
	var resumed bool
	if err := tx.QueryRow(ctx, `SELECT resumed_from_pause FROM jobs WHERE id = $1`, id).Scan(&resumed); err != nil {
		return Job{}, err
	}
	if !resumed || job.Status == StatusPaused || job.Status == StatusCancelled || job.Status == StatusExpired {
		return Job{}, ErrConflict
	}
	return job, nil
}
