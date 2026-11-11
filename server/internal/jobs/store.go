package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

type queryRow interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type queryRows interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

const jobSummaryColumns = `j.id, j.actor_id, coalesce(j.board_id, ''), j.kind, j.request_id, j.status,
	j.revision, j.attempt, j.max_attempts, j.manual_retries, coalesce(j.error_code, ''), j.available_at,
	j.created_at, j.updated_at, j.input_expires_at, j.output_expires_at,
	(j.artifact IS NOT NULL AND j.output_expires_at > statement_timestamp())`

const jobColumns = jobSummaryColumns + `,
	CASE WHEN j.output_expires_at > statement_timestamp() THEN j.result END`

func scanJob(row pgx.Row, includeResult bool, extra ...any) (Job, error) {
	var j Job
	fields := []any{
		&j.ID, &j.ActorID, &j.BoardID, &j.Kind, &j.RequestID, &j.Status,
		&j.Revision, &j.Attempt, &j.MaxAttempts, &j.ManualRetries, &j.ErrorCode, &j.AvailableAt,
		&j.CreatedAt, &j.UpdatedAt, &j.InputExpiresAt, &j.OutputExpiresAt, &j.ArtifactAvailable,
	}
	if includeResult {
		fields = append(fields, &j.Result)
	}
	if err := row.Scan(append(fields, extra...)...); err != nil {
		return Job{}, err
	}
	return j, nil
}

func Find(ctx context.Context, tx pgx.Tx, spec Spec) (Job, bool, error) {
	if err := validateKey(spec); err != nil {
		return Job{}, false, err
	}
	var fingerprint []byte
	j, err := scanJob(tx.QueryRow(ctx, `SELECT `+jobColumns+`, j.fingerprint FROM jobs j
		WHERE j.actor_id = $1 AND j.kind = $2 AND j.request_id = $3`,
		spec.ActorID, spec.Kind, spec.RequestID), true, &fingerprint)
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, false, nil
	}
	if err != nil {
		return Job{}, false, err
	}
	if j.BoardID != spec.BoardID || !bytes.Equal(fingerprint, spec.Fingerprint[:]) {
		return Job{}, false, ErrConflict
	}
	return j, true, nil
}

// Enqueue binds one stable caller request to a durable job. The supplied READ
// COMMITTED transaction can also capture source data or save related state.
func Enqueue(ctx context.Context, tx pgx.Tx, spec Spec) (Job, error) {
	if err := validateKey(spec); err != nil {
		return Job{}, err
	}
	if existing, found, err := Find(ctx, tx, spec); err != nil || found {
		return existing, err
	}
	if spec.MaxAttempts == 0 {
		spec.MaxAttempts = 4
	}
	if spec.ExpiredLeaseCode == "" {
		spec.ExpiredLeaseCode = "ATTEMPTS_EXHAUSTED"
	}
	if spec.MaxAttempts < 1 || spec.MaxAttempts > 8 ||
		!validateJSON(spec.Payload, MaxPayloadBytes) || len(spec.Input) > MaxInputBytes ||
		!codePattern.MatchString(spec.ExpiredLeaseCode) {
		return Job{}, ErrInvalid
	}
	// Serialize capacity reservations and recheck the idempotency key after waiting.
	if err := lockCapacity(ctx, tx); err != nil {
		return Job{}, err
	}
	if existing, found, err := Find(ctx, tx, spec); err != nil || found {
		return existing, err
	}
	if err := checkCapacity(ctx, tx, spec.ActorID, len(spec.Payload)+len(spec.Input), true); err != nil {
		return Job{}, err
	}
	return scanJob(tx.QueryRow(ctx, `INSERT INTO jobs AS j
		(id, actor_id, board_id, kind, request_id, fingerprint, status, max_attempts, payload, input, input_expires_at, expired_lease_code)
		VALUES ($1, $2, nullif($3, ''), $4, $5, $6, 'queued', $7, $8, $9,
			clock_timestamp() + $10::bigint * interval '1 millisecond', $11) RETURNING `+jobColumns,
		uuid.New(), spec.ActorID, spec.BoardID, spec.Kind, spec.RequestID, spec.Fingerprint[:], spec.MaxAttempts,
		[]byte(spec.Payload), spec.Input, InputTTL.Milliseconds(), spec.ExpiredLeaseCode), true)
}

// Both limits count raw application bytes, regardless of PostgreSQL's compression.
// Operations that only free bytes need no reservation.
const capacityLock int64 = 0x4f4a4a4f42434150

func lockCapacity(ctx context.Context, tx pgx.Tx) error {
	var isolation string
	if err := tx.QueryRow(ctx, `SHOW transaction_isolation`).Scan(&isolation); err != nil {
		return err
	}
	// A repeatable-read snapshot taken before the lock could miss another
	// worker's reservation. A fresh statement snapshot is required here.
	if isolation != "read committed" && isolation != "read uncommitted" {
		return ErrInvalid
	}
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, capacityLock)
	return err
}

func checkCapacity(ctx context.Context, tx pgx.Tx, actor uuid.UUID, extraBytes int, addsActive bool) error {
	var globalBytes, actorBytes, globalActive, actorActive int64
	err := tx.QueryRow(ctx, `SELECT coalesce(sum(cached_bytes), 0),
		coalesce(sum(cached_bytes) FILTER (WHERE actor_id = $1), 0),
		count(*) FILTER (WHERE status IN ('queued', 'running', 'paused', 'awaiting_input')),
		count(*) FILTER (WHERE actor_id = $1 AND status IN ('queued', 'running', 'paused', 'awaiting_input'))
		FROM jobs WHERE cached_bytes > 0 OR status IN ('queued', 'running', 'paused', 'awaiting_input')`, actor).
		Scan(&globalBytes, &actorBytes, &globalActive, &actorActive)
	if err != nil {
		return err
	}
	if extraBytes > 0 && (globalBytes+int64(extraBytes) > MaxCacheBytes || actorBytes+int64(extraBytes) > MaxActorBytes) {
		return ErrCapacity
	}
	if addsActive && (globalActive >= MaxActive || actorActive >= MaxActorActive) {
		return ErrCapacity
	}
	return nil
}

func Get(ctx context.Context, id, actor uuid.UUID) (Job, error) {
	return get(ctx, db.Pool(), id, actor, false)
}

func GetTx(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID) (Job, error) {
	return get(ctx, tx, id, actor, false)
}

func Lock(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID) (Job, error) {
	return get(ctx, tx, id, actor, true)
}

// GetInputTx reads retained parameters for clarification or resuming paused work.
// Call it after authorizing the board and locking the job in the same transaction.
func GetInputTx(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID) (json.RawMessage, error) {
	var payload []byte
	err := tx.QueryRow(ctx, `SELECT payload FROM jobs WHERE id = $1 AND actor_id = $2
		AND status IN ('awaiting_input', 'paused') AND input_expires_at > clock_timestamp()`, id, actor).Scan(&payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConflict
	}
	return payload, err
}

func get(ctx context.Context, q queryRow, id, actor uuid.UUID, lock bool) (Job, error) {
	sql := `SELECT ` + jobColumns + ` FROM jobs j WHERE j.id = $1 AND j.actor_id = $2`
	if lock {
		sql += ` FOR UPDATE`
	}
	j, err := scanJob(q.QueryRow(ctx, sql, id, actor), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, ErrNotFound
	}
	return j, err
}

func GetRevision(ctx context.Context, id, actor uuid.UUID) (int64, error) {
	var revision int64
	err := db.Pool().QueryRow(ctx, `SELECT revision FROM jobs WHERE id = $1 AND actor_id = $2`, id, actor).Scan(&revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return revision, err
}

// BumpRevisionTx publishes a related run change stored in the same transaction.
// The job's own execution state stays unchanged.
func BumpRevisionTx(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID) error {
	result, err := tx.Exec(ctx, `UPDATE jobs SET revision = revision + 1, updated_at = clock_timestamp()
		WHERE id = $1 AND actor_id = $2`, id, actor)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrConflict
	}
	return nil
}

// List returns lightweight summaries for exactly one scope. An empty board ID
// selects work owned by the actor outside a board, such as dashboard imports.
func List(ctx context.Context, actor uuid.UUID, boardID string, kinds []string, limit int) ([]Job, error) {
	return list(ctx, db.Pool(), actor, boardID, kinds, limit)
}

func ListTx(ctx context.Context, tx pgx.Tx, actor uuid.UUID, boardID string, kinds []string, limit int) ([]Job, error) {
	return list(ctx, tx, actor, boardID, kinds, limit)
}

func list(ctx context.Context, query queryRows, actor uuid.UUID, boardID string, kinds []string, limit int) ([]Job, error) {
	if actor == uuid.Nil || len(boardID) > 36 || limit < 1 || limit > 100 || !validKinds(kinds) {
		return nil, ErrInvalid
	}
	rows, err := query.Query(ctx, `SELECT `+jobSummaryColumns+` FROM jobs j
		WHERE j.actor_id = $1 AND j.board_id IS NOT DISTINCT FROM nullif($2, '')
		AND (coalesce(cardinality($3::text[]), 0) = 0 OR j.kind = ANY($3::text[]))
		ORDER BY j.created_at DESC, j.id DESC LIMIT $4`, actor, boardID, kinds, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Job, 0, limit)
	for rows.Next() {
		j, err := scanJob(rows, false)
		if err != nil {
			return nil, err
		}
		result = append(result, j)
	}
	return result, rows.Err()
}

func validKinds(kinds []string) bool {
	if len(kinds) > 16 {
		return false
	}
	for _, kind := range kinds {
		if !kindPattern.MatchString(kind) {
			return false
		}
	}
	return true
}

func Cancel(ctx context.Context, id, actor uuid.UUID) (Job, error) {
	return change(ctx, func(tx pgx.Tx) (Job, error) { return CancelTx(ctx, tx, id, actor) })
}

func CancelTx(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID) (Job, error) {
	job, err := scanJob(tx.QueryRow(ctx, `UPDATE jobs j SET status = 'cancelled',
		revision = revision + 1, updated_at = clock_timestamp(), error_code = NULL,
		lease_token = NULL, lease_until = NULL, payload = NULL, input = NULL,
		result = NULL, output_expires_at = NULL
		WHERE j.id = $1 AND j.actor_id = $2 AND j.status IN ('queued', 'running', 'paused', 'awaiting_input')
		RETURNING `+jobColumns, id, actor), true)
	if !errors.Is(err, pgx.ErrNoRows) {
		return job, err
	}
	job, err = GetTx(ctx, tx, id, actor)
	if err == nil && job.Status != StatusCancelled {
		return Job{}, ErrConflict
	}
	return job, err
}

func RetryJob(ctx context.Context, id, actor uuid.UUID) (Job, error) {
	return change(ctx, func(tx pgx.Tx) (Job, error) { return RetryJobTx(ctx, tx, id, actor) })
}

func RetryJobTx(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID) (Job, error) {
	job, err := Lock(ctx, tx, id, actor)
	if err != nil {
		return Job{}, err
	}
	if job.Status != StatusFailed || job.ManualRetries >= MaxManualRetries {
		return Job{}, ErrConflict
	}
	if err := lockCapacity(ctx, tx); err != nil {
		return Job{}, err
	}
	if err := checkCapacity(ctx, tx, actor, 0, true); err != nil {
		return Job{}, err
	}
	job, err = scanJob(tx.QueryRow(ctx, `UPDATE jobs j SET status = 'queued', attempt = 0,
		manual_retries = manual_retries + 1, revision = revision + 1, error_code = NULL,
		available_at = clock_timestamp(), updated_at = clock_timestamp()
		WHERE j.id = $1 AND j.input_expires_at > clock_timestamp() RETURNING `+jobColumns, id), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, ErrConflict
	}
	return job, err
}

func Resume(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID, revision int64, payload json.RawMessage) (Job, error) {
	if revision < 1 || !validateJSON(payload, MaxPayloadBytes) {
		return Job{}, ErrInvalid
	}
	job, err := Lock(ctx, tx, id, actor)
	if err != nil {
		return Job{}, err
	}
	if job.Status != StatusAwaitingInput || job.Revision != revision {
		return Job{}, ErrConflict
	}
	var replacedBytes int
	if err := tx.QueryRow(ctx, `SELECT coalesce(octet_length(payload), 0) + coalesce(octet_length(result), 0)
		FROM jobs WHERE id = $1`, id).Scan(&replacedBytes); err != nil {
		return Job{}, err
	}
	if extra := len(payload) - replacedBytes; extra > 0 {
		if err := lockCapacity(ctx, tx); err != nil {
			return Job{}, err
		}
		if err := checkCapacity(ctx, tx, actor, extra, false); err != nil {
			return Job{}, err
		}
	}
	job, err = scanJob(tx.QueryRow(ctx, `UPDATE jobs j SET status = 'queued', attempt = 0,
		revision = revision + 1, error_code = NULL, payload = $2, result = NULL, output_expires_at = NULL,
		available_at = clock_timestamp(), updated_at = clock_timestamp()
		WHERE j.id = $1 AND j.input_expires_at > clock_timestamp() RETURNING `+jobColumns, id, []byte(payload)), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, ErrConflict
	}
	return job, err
}

func change(ctx context.Context, fn func(pgx.Tx) (Job, error)) (Job, error) {
	var result Job
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		var err error
		result, err = fn(tx)
		return err
	})
	if err != nil {
		return Job{}, err
	}
	return result, nil
}

func GetArtifact(ctx context.Context, id, actor uuid.UUID) (Artifact, error) {
	return getArtifact(ctx, db.Pool(), id, actor)
}

func GetArtifactTx(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID) (Artifact, error) {
	return getArtifact(ctx, tx, id, actor)
}

func getArtifact(ctx context.Context, q queryRow, id, actor uuid.UUID) (Artifact, error) {
	row := q.QueryRow(ctx, `SELECT CASE WHEN j.status = 'succeeded' AND j.output_expires_at > statement_timestamp()
		THEN j.artifact END, coalesce(j.artifact_content_type, ''), coalesce(j.artifact_filename, ''),
		coalesce(j.artifact_sha256, ''), j.output_expires_at FROM jobs j WHERE j.id = $1 AND j.actor_id = $2`, id, actor)
	return scanArtifact(row, ErrNotFound)
}

// GetBoardArtifact is for artifacts explicitly shared with board readers, such
// as thumbnails. The calling handler must authorize current board access.
func GetBoardArtifact(ctx context.Context, boardID, kind string, requestID uuid.UUID) (Artifact, error) {
	return getBoardArtifact(ctx, db.Pool(), boardID, kind, requestID)
}

func GetBoardArtifactTx(ctx context.Context, tx pgx.Tx, boardID, kind string, requestID uuid.UUID) (Artifact, error) {
	return getBoardArtifact(ctx, tx, boardID, kind, requestID)
}

func getBoardArtifact(ctx context.Context, q queryRow, boardID, kind string, requestID uuid.UUID) (Artifact, error) {
	if strings.TrimSpace(boardID) == "" || !kindPattern.MatchString(kind) || requestID == uuid.Nil {
		return Artifact{}, ErrInvalid
	}
	row := q.QueryRow(ctx, `SELECT j.artifact, j.artifact_content_type, j.artifact_filename, j.artifact_sha256,
		j.output_expires_at FROM jobs j WHERE j.board_id = $1 AND j.kind = $2 AND j.request_id = $3
		AND j.status = 'succeeded' AND j.artifact IS NOT NULL AND j.output_expires_at > statement_timestamp()
		ORDER BY j.created_at DESC, j.id DESC LIMIT 1`, boardID, kind, requestID)
	return scanArtifact(row, ErrArtifactUnavailable)
}

func scanArtifact(row pgx.Row, missing error) (Artifact, error) {
	var result Artifact
	var expiresAt *time.Time
	err := row.Scan(&result.Data, &result.ContentType, &result.Filename, &result.SHA256, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Artifact{}, missing
	}
	if err != nil {
		return Artifact{}, err
	}
	if len(result.Data) == 0 || expiresAt == nil {
		return Artifact{}, ErrArtifactUnavailable
	}
	result.ExpiresAt = *expiresAt
	return result, nil
}
