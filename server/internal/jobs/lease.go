package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/rand/v2"
	"mime"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

func validLeaseDuration(d time.Duration) bool {
	return d >= 500*time.Millisecond && d <= 5*time.Minute
}

// Claim assigns a new token and increments the attempt for queued jobs and
// interrupted attempts whose leases have expired. Running attempts never block
// other workers selecting ready jobs.
func Claim(ctx context.Context, kinds []string, duration time.Duration) (Lease, error) {
	if len(kinds) == 0 || !validKinds(kinds) || !validLeaseDuration(duration) {
		return Lease{}, ErrInvalid
	}
	var lease Lease
	var payload []byte
	row := db.Pool().QueryRow(ctx, `WITH next_job AS (
		SELECT id FROM jobs WHERE kind = ANY($1::text[]) AND input_expires_at > statement_timestamp()
		AND attempt < max_attempts AND ((status = 'queued' AND available_at <= statement_timestamp())
			OR (status = 'running' AND lease_until <= statement_timestamp()))
		ORDER BY CASE WHEN status = 'running' THEN lease_until ELSE available_at END, created_at, id
		FOR UPDATE SKIP LOCKED LIMIT 1
	)
	UPDATE jobs j SET status = 'running', attempt = attempt + 1,
		revision = revision + 1, updated_at = clock_timestamp(), error_code = NULL,
		lease_token = $2, lease_until = clock_timestamp() + $3::bigint * interval '1 millisecond'
	FROM next_job WHERE j.id = next_job.id RETURNING `+jobSummaryColumns+`,
		j.lease_token, j.lease_until, j.payload, j.input`, kinds, uuid.New(), duration.Milliseconds())
	job, err := scanJob(row, false, &lease.Token, &lease.ExpiresAt, &payload, &lease.Input)
	if errors.Is(err, pgx.ErrNoRows) {
		return Lease{}, ErrNoWork
	}
	if err != nil {
		return Lease{}, err
	}
	job.Payload = payload
	lease.Job = job
	return lease, nil
}

func Renew(ctx context.Context, id, token uuid.UUID, duration time.Duration) error {
	if !validLeaseDuration(duration) {
		return ErrInvalid
	}
	result, err := db.Pool().Exec(ctx, `UPDATE jobs SET
		lease_until = clock_timestamp() + $3::bigint * interval '1 millisecond'
		WHERE id = $1 AND lease_token = $2 AND status = 'running'
		AND lease_until > clock_timestamp() AND input_expires_at > clock_timestamp()`, id, token, duration.Milliseconds())
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func Complete(ctx context.Context, lease Lease, outcome Outcome) (Job, error) {
	if !validateJSON(outcome.Result, MaxResultBytes) ||
		(outcome.Commit != nil && len(outcome.Result) > 0) ||
		(outcome.AwaitInput && (outcome.Artifact != nil || outcome.Commit != nil)) ||
		(outcome.OutputTTL != 0 && (outcome.OutputTTL < time.Millisecond || outcome.OutputTTL > MaxOutputTTL)) {
		return Job{}, ErrInvalid
	}
	var artifact []byte
	var contentType, filename, digest *string
	if outcome.Artifact != nil {
		if !validArtifact(*outcome.Artifact) {
			return Job{}, ErrInvalid
		}
		artifact = outcome.Artifact.Data
		contentType = &outcome.Artifact.ContentType
		filename = &outcome.Artifact.Filename
		sum := sha256.Sum256(artifact)
		value := hex.EncodeToString(sum[:])
		digest = &value
	}
	return change(ctx, func(tx pgx.Tx) (Job, error) {
		var actor uuid.UUID
		var beforeBytes, inputBytes int
		err := tx.QueryRow(ctx, `SELECT actor_id, cached_bytes,
			coalesce(octet_length(payload), 0) + coalesce(octet_length(input), 0)
			FROM jobs WHERE id = $1 AND lease_token = $2 AND status = 'running'
			AND lease_until > clock_timestamp() AND input_expires_at > clock_timestamp() FOR UPDATE`,
			lease.ID, lease.Token).Scan(&actor, &beforeBytes, &inputBytes)
		if errors.Is(err, pgx.ErrNoRows) {
			return Job{}, ErrLeaseLost
		}
		if err != nil {
			return Job{}, err
		}

		result := outcome.Result
		if outcome.Commit != nil {
			result, err = outcome.Commit(ctx, tx)
			if err != nil {
				return Job{}, err
			}
			if !validateJSON(result, MaxResultBytes) {
				return Job{}, ErrInvalid
			}
		}
		if len(result) == 0 {
			result = nil
		}

		status := StatusSucceeded
		endBytes := len(result) + len(artifact)
		if outcome.AwaitInput {
			status = StatusAwaitingInput
			endBytes += inputBytes
		}
		if extra := endBytes - beforeBytes; extra > 0 {
			if err := lockCapacity(ctx, tx); err != nil {
				return Job{}, err
			}
			if err := checkCapacity(ctx, tx, actor, extra, false); err != nil {
				return Job{}, err
			}
		}
		ttl := outcome.OutputTTL
		if ttl == 0 {
			ttl = DefaultOutputTTL
		}
		if len(result) == 0 && len(artifact) == 0 {
			ttl = 0
		}
		j, err := scanJob(tx.QueryRow(ctx, `UPDATE jobs j SET status = $3::text,
			revision = revision + 1, updated_at = clock_timestamp(), error_code = NULL,
			lease_token = NULL, lease_until = NULL,
			payload = CASE WHEN $3::text = 'awaiting_input' THEN payload END,
			input = CASE WHEN $3::text = 'awaiting_input' THEN input END,
			result = $4, artifact = $5, artifact_content_type = $6, artifact_filename = $7, artifact_sha256 = $8,
			output_expires_at = CASE WHEN $9::bigint = 0 THEN NULL
				WHEN $3::text = 'awaiting_input' THEN input_expires_at
				ELSE clock_timestamp() + $9::bigint * interval '1 millisecond' END
			WHERE j.id = $1 AND j.lease_token = $2 AND j.status = 'running'
			AND j.lease_until > clock_timestamp() AND j.input_expires_at > clock_timestamp()
			RETURNING `+jobColumns,
			lease.ID, lease.Token, status, []byte(result), artifact, contentType, filename, digest, ttl.Milliseconds()), true)
		if errors.Is(err, pgx.ErrNoRows) {
			return Job{}, ErrLeaseLost
		}
		return j, err
	})
}

func validArtifact(artifact Artifact) bool {
	if len(artifact.Data) == 0 || len(artifact.Data) > MaxArtifactBytes || len(artifact.ContentType) > 128 ||
		len(artifact.Filename) == 0 || len(artifact.Filename) > 180 || !utf8.ValidString(artifact.Filename) ||
		strings.TrimSpace(artifact.Filename) != artifact.Filename || artifact.Filename == "." || artifact.Filename == ".." ||
		strings.ContainsAny(artifact.Filename, `/\`) || strings.ContainsFunc(artifact.Filename, unicode.IsControl) {
		return false
	}
	_, _, err := mime.ParseMediaType(artifact.ContentType)
	return err == nil
}

func Reject(ctx context.Context, lease Lease, cause error) (Job, error) {
	code, retryable := errorState(cause)
	j, err := scanJob(db.Pool().QueryRow(ctx, `UPDATE jobs j SET
		status = CASE WHEN $3 AND attempt < max_attempts THEN 'queued' ELSE 'failed' END,
		available_at = clock_timestamp() + CASE WHEN $3 AND attempt < max_attempts
			THEN $4::bigint * interval '1 millisecond' ELSE interval '0 seconds' END,
		revision = revision + 1, updated_at = clock_timestamp(), error_code = $5,
		lease_token = NULL, lease_until = NULL
		WHERE j.id = $1 AND j.lease_token = $2 AND j.status = 'running'
		AND j.lease_until > clock_timestamp() AND j.input_expires_at > clock_timestamp()
		RETURNING `+jobColumns, lease.ID, lease.Token, retryable, retryDelay(lease.Attempt).Milliseconds(), code), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, ErrLeaseLost
	}
	return j, err
}

func retryDelay(attempt int) time.Duration {
	exponent := max(0, min(attempt-1, 7))
	delay := time.Second << exponent
	jitter := delay/2 + time.Duration(rand.Int64N(int64(delay/2)))
	return min(2*time.Minute, jitter)
}

// Sweep frees retained input and output bytes in bounded batches and resolves
// an interrupted last attempt even when no eligible work remains to claim.
func Sweep(ctx context.Context) error {
	_, err := db.Pool().Exec(ctx, `WITH elapsed AS (
		SELECT id FROM jobs WHERE input_expires_at <= statement_timestamp()
	AND (payload IS NOT NULL OR input IS NOT NULL OR status IN ('queued', 'running', 'paused', 'awaiting_input'))
		ORDER BY input_expires_at FOR UPDATE SKIP LOCKED LIMIT 64
	)
	UPDATE jobs j SET payload = NULL, input = NULL, lease_token = NULL, lease_until = NULL,
	status = CASE WHEN j.status IN ('queued', 'running', 'paused', 'awaiting_input') THEN 'expired' ELSE j.status END,
	error_code = CASE WHEN j.status IN ('queued', 'running', 'paused', 'awaiting_input') THEN 'JOB_EXPIRED' ELSE j.error_code END,
		revision = revision + 1, updated_at = clock_timestamp()
	FROM elapsed WHERE j.id = elapsed.id`)
	if err != nil {
		return err
	}
	_, err = db.Pool().Exec(ctx, `WITH elapsed AS (
		SELECT id FROM jobs WHERE output_expires_at <= statement_timestamp()
		AND (result IS NOT NULL OR artifact IS NOT NULL)
		ORDER BY output_expires_at FOR UPDATE SKIP LOCKED LIMIT 64
	)
	UPDATE jobs j SET result = NULL, artifact = NULL, artifact_content_type = NULL,
		artifact_filename = NULL, artifact_sha256 = NULL, revision = revision + 1, updated_at = clock_timestamp()
	FROM elapsed WHERE j.id = elapsed.id`)
	if err != nil {
		return err
	}
	_, err = db.Pool().Exec(ctx, `WITH abandoned AS (
		SELECT id FROM jobs WHERE status = 'running' AND lease_until <= statement_timestamp()
		AND attempt >= max_attempts ORDER BY lease_until FOR UPDATE SKIP LOCKED LIMIT 64
	)
	UPDATE jobs j SET status = 'failed', error_code = j.expired_lease_code, lease_token = NULL, lease_until = NULL,
		revision = revision + 1, updated_at = clock_timestamp() FROM abandoned WHERE j.id = abandoned.id`)
	return err
}
