// Package jobs owns the durable work queue shared by Shiori API and worker processes.
package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Status string

const (
	StatusQueued        Status = "queued"
	StatusRunning       Status = "running"
	StatusPaused        Status = "paused"
	StatusAwaitingInput Status = "awaiting_input"
	StatusSucceeded     Status = "succeeded"
	StatusFailed        Status = "failed"
	StatusCancelled     Status = "cancelled"
	StatusExpired       Status = "expired"

	MaxPayloadBytes  = 16 << 20
	MaxInputBytes    = 32 << 20
	MaxArtifactBytes = 32 << 20
	MaxResultBytes   = 512 << 10
	MaxActorBytes    = 96 << 20
	MaxCacheBytes    = 512 << 20
	MaxActorActive   = 24
	MaxActive        = 256
	MaxManualRetries = 2
	InputTTL         = 24 * time.Hour
	DefaultOutputTTL = 24 * time.Hour
	MaxOutputTTL     = 7 * 24 * time.Hour
)

var (
	ErrNotFound            = errors.New("job not found")
	ErrConflict            = errors.New("job request or state conflicts")
	ErrInvalid             = errors.New("invalid job input")
	ErrCapacity            = errors.New("job queue storage capacity reached")
	ErrNoWork              = errors.New("no job is ready")
	ErrLeaseLost           = errors.New("job lease lost")
	ErrArtifactUnavailable = errors.New("job artifact unavailable")
)

type Job struct {
	ID                uuid.UUID       `json:"id"`
	ActorID           uuid.UUID       `json:"-"`
	BoardID           string          `json:"boardId,omitempty"`
	Kind              string          `json:"kind"`
	RequestID         uuid.UUID       `json:"requestId"`
	Status            Status          `json:"status"`
	Revision          int64           `json:"revision"`
	Attempt           int             `json:"attempt"`
	MaxAttempts       int             `json:"maxAttempts"`
	ManualRetries     int             `json:"manualRetries"`
	ErrorCode         string          `json:"errorCode,omitempty"`
	AvailableAt       time.Time       `json:"availableAt"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
	InputExpiresAt    time.Time       `json:"inputExpiresAt"`
	OutputExpiresAt   *time.Time      `json:"outputExpiresAt,omitempty"`
	ArtifactAvailable bool            `json:"artifactAvailable"`
	Result            json.RawMessage `json:"result,omitempty"`
	Payload           json.RawMessage `json:"-"`
}

type Spec struct {
	ActorID     uuid.UUID
	BoardID     string
	Kind        string
	RequestID   uuid.UUID
	Fingerprint [32]byte
	Payload     json.RawMessage
	Input       []byte
	MaxAttempts int
	// ExpiredLeaseCode overrides the failure code when the last attempt is abandoned.
	ExpiredLeaseCode string
}

type Lease struct {
	Job
	Token     uuid.UUID
	ExpiresAt time.Time
	Input     []byte
}

type Artifact struct {
	Data        []byte
	ContentType string
	Filename    string
	SHA256      string
	ExpiresAt   time.Time
}

type Outcome struct {
	Result     json.RawMessage
	Artifact   *Artifact
	AwaitInput bool
	OutputTTL  time.Duration
	// Commit performs short database-only writes inside the fenced completion transaction.
	Commit func(context.Context, pgx.Tx) (json.RawMessage, error)
}

type Handler func(context.Context, Lease) (Outcome, error)

var kindPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}$`)
var codePattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)

// Fingerprint hashes the caller's stable request parameters. A payload captured from
// changing state may differ on a retry while the request parameters stay the same.
func Fingerprint(value any) ([32]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return [32]byte{}, err
	}
	return sha256.Sum256(raw), nil
}

func validateKey(spec Spec) error {
	if spec.ActorID == uuid.Nil || spec.RequestID == uuid.Nil || len(spec.BoardID) > 36 ||
		!kindPattern.MatchString(spec.Kind) || spec.Fingerprint == [32]byte{} {
		return ErrInvalid
	}
	return nil
}

func validateJSON(raw json.RawMessage, max int) bool {
	return len(raw) == 0 || (len(raw) <= max && json.Valid(raw))
}

type fault struct {
	code      string
	retryable bool
}

func (f *fault) Error() string { return f.code }

func Fail(code string) error  { return makeFault(code, false) }
func Retry(code string) error { return makeFault(code, true) }

func makeFault(code string, retryable bool) error {
	if !codePattern.MatchString(code) {
		code = "JOB_FAILED"
	}
	return &fault{code: code, retryable: retryable}
}

func errorState(err error) (code string, retryable bool) {
	var known *fault
	switch {
	case errors.As(err, &known):
		return known.code, known.retryable
	case errors.Is(err, context.DeadlineExceeded):
		return "JOB_TIMEOUT", true
	case errors.Is(err, ErrInvalid):
		return "INVALID_RESULT", false
	case errors.Is(err, ErrCapacity):
		return "JOB_CAPACITY", true
	default:
		return "JOB_FAILED", true
	}
}
