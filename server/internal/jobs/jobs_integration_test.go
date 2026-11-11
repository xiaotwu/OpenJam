package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

func TestJobIdempotencyAndLeaseFencing(t *testing.T) {
	ctx := jobTestDatabase(t)
	actor, board := jobFixture(t, ctx)
	spec := jobSpec(t, actor, board, "export")
	spec.Payload = json.RawMessage(`{"revision":10}`)
	spec.Input = []byte("fixture bytes")
	job, err := enqueueForTest(ctx, spec)
	if err != nil || job.Status != StatusQueued {
		t.Fatalf("enqueue: %+v, %v", job, err)
	}

	spec.Payload = json.RawMessage(`{"revision":11}`)
	replayed, err := enqueueForTest(ctx, spec)
	if err != nil || replayed.ID != job.ID || replayed.Revision != job.Revision {
		t.Fatalf("fixed-source replay: %+v, %v", replayed, err)
	}
	concurrent := jobSpec(t, actor, "", "import")
	concurrentResults := make(chan uuid.UUID, 2)
	for range 2 {
		go func() {
			j, err := enqueueForTest(ctx, concurrent)
			if err != nil {
				t.Errorf("concurrent enqueue: %v", err)
			}
			concurrentResults <- j.ID
		}()
	}
	if first, second := <-concurrentResults, <-concurrentResults; first == uuid.Nil || first != second {
		t.Fatalf("duplicate requests created different jobs: %s / %s", first, second)
	}
	different := spec
	different.Fingerprint = sha256.Sum256([]byte("different request"))
	if _, err := enqueueForTest(ctx, different); !errors.Is(err, ErrConflict) {
		t.Fatalf("mismatched request: %v", err)
	}
	if _, err := Get(ctx, job.ID, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another actor read a job: %v", err)
	}
	listed, err := List(ctx, actor, board, nil, 10)
	if err != nil || len(listed) != 1 || listed[0].ID != job.ID {
		t.Fatalf("scope list: %+v, %v", listed, err)
	}

	locked, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = locked.Rollback(ctx) }()
	if _, err := Lock(ctx, locked, job.ID, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := Claim(ctx, []string{"export"}, time.Second); !errors.Is(err, ErrNoWork) {
		t.Fatalf("claim skipped a locked row: %v", err)
	}
	if err := locked.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	first := claimForTest(t, ctx, "export")
	if first.ID != job.ID || first.Attempt != 1 || string(first.Payload) != `{"revision":10}` || string(first.Input) != "fixture bytes" {
		t.Fatalf("initial lease: %+v", first)
	}
	if err := Renew(ctx, first.ID, first.Token, time.Second); err != nil {
		t.Fatalf("renew first lease: %v", err)
	}
	expireLease(t, ctx, job.ID)
	second := claimForTest(t, ctx, "export")
	if second.ID != job.ID || second.Token == first.Token || second.Attempt != 2 {
		t.Fatalf("reclaimed lease: %+v", second)
	}
	if err := Renew(ctx, first.ID, first.Token, time.Second); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("renew stale lease: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `CREATE TABLE job_effects (job_id uuid PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	artifact := Artifact{Data: []byte("artifact bytes"), ContentType: "application/zip", Filename: "workshop.zip"}
	finish := Outcome{Artifact: &artifact, Commit: func(ctx context.Context, tx pgx.Tx) (json.RawMessage, error) {
		_, err := tx.Exec(ctx, `INSERT INTO job_effects (job_id) VALUES ($1)`, job.ID)
		return json.RawMessage(`{"seq":10}`), err
	}}
	if _, err := Complete(ctx, first, finish); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("stale worker was not fenced: %v", err)
	}
	interrupted := finish
	interrupted.Commit = func(ctx context.Context, tx pgx.Tx) (json.RawMessage, error) {
		if _, err := finish.Commit(ctx, tx); err != nil {
			return nil, err
		}
		_, err := tx.Exec(ctx, `UPDATE jobs SET lease_until = clock_timestamp() WHERE id=$1`, job.ID)
		return nil, err
	}
	if _, err := Complete(ctx, second, interrupted); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("completion crossed its lease deadline: %v", err)
	}
	result, err := Complete(ctx, second, finish)
	if err != nil || result.Status != StatusSucceeded || !result.ArtifactAvailable || string(result.Result) != `{"seq":10}` {
		t.Fatalf("worker completion: %+v, %v", result, err)
	}
	if _, err := Complete(ctx, second, finish); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("duplicate worker completion: %v", err)
	}
	var effects, retainedInput int
	if err := db.Pool().QueryRow(ctx, `SELECT (SELECT count(*) FROM job_effects),
		coalesce(octet_length(payload), 0) + coalesce(octet_length(input), 0) FROM jobs WHERE id=$1`, job.ID).
		Scan(&effects, &retainedInput); err != nil || effects != 1 || retainedInput != 0 {
		t.Fatalf("fenced side effect count %d, retained input %d, %v", effects, retainedInput, err)
	}
	file, err := GetArtifact(ctx, job.ID, actor)
	sum := sha256.Sum256(artifact.Data)
	if err != nil || string(file.Data) != string(artifact.Data) || file.SHA256 != hex.EncodeToString(sum[:]) || file.Filename != artifact.Filename {
		t.Fatalf("artifact read: %+v, %v", file, err)
	}
	if shared, err := GetBoardArtifact(ctx, board, spec.Kind, spec.RequestID); err != nil || shared.SHA256 != file.SHA256 {
		t.Fatalf("board artifact read: %+v, %v", shared, err)
	}
	if _, err := GetArtifact(ctx, job.ID, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another actor read an artifact: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE jobs SET output_expires_at = clock_timestamp() WHERE id=$1`, job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := GetArtifact(ctx, job.ID, actor); !errors.Is(err, ErrArtifactUnavailable) {
		t.Fatalf("expired artifact: %v", err)
	}
	if err := Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	replayed, err = enqueueForTest(ctx, spec)
	if err != nil || replayed.ID != job.ID || replayed.Status != StatusSucceeded || replayed.ArtifactAvailable || len(replayed.Result) != 0 {
		t.Fatalf("expiry discarded the idempotency receipt or retained output: %+v, %v", replayed, err)
	}
}

func TestJobRetryCancellationAndClarification(t *testing.T) {
	ctx := jobTestDatabase(t)
	actor, _ := jobFixture(t, ctx)
	spec := jobSpec(t, actor, "", "agent")
	spec.MaxAttempts = 2
	spec.Payload = json.RawMessage(`{"input":"first"}`)
	job, err := enqueueForTest(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	lease := claimForTest(t, ctx, "agent")
	backoff, err := Reject(ctx, lease, Retry("TRANSIENT"))
	if err != nil || backoff.Status != StatusQueued || backoff.ErrorCode != "TRANSIENT" || !backoff.AvailableAt.After(backoff.UpdatedAt) {
		t.Fatalf("automatic backoff: %+v, %v", backoff, err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE jobs SET available_at = clock_timestamp() WHERE id=$1`, job.ID); err != nil {
		t.Fatal(err)
	}
	lease = claimForTest(t, ctx, "agent")
	if lease.Attempt != 2 {
		t.Fatalf("retry attempt: %+v", lease)
	}
	expireLease(t, ctx, job.ID)
	if err := Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	failed, err := Get(ctx, job.ID, actor)
	if err != nil || failed.Status != StatusFailed || failed.ErrorCode != "ATTEMPTS_EXHAUSTED" {
		t.Fatalf("abandoned final attempt: %+v, %v", failed, err)
	}
	retried, err := RetryJob(ctx, job.ID, actor)
	if err != nil || retried.ID != job.ID || retried.Attempt != 0 || retried.ManualRetries != 1 || retried.Status != StatusQueued {
		t.Fatalf("manual retry: %+v, %v", retried, err)
	}
	lease = claimForTest(t, ctx, "agent")
	if string(lease.Payload) != string(spec.Payload) {
		t.Fatalf("manual retry lost original input: %s", lease.Payload)
	}
	waiting, err := Complete(ctx, lease, Outcome{AwaitInput: true, Result: json.RawMessage(`{"question":"Which page?"}`)})
	if err != nil || waiting.Status != StatusAwaitingInput || len(waiting.Result) == 0 {
		t.Fatalf("waiting for clarification: %+v, %v", waiting, err)
	}
	answer := json.RawMessage(`{"input":"with answer"}`)
	resumed, err := change(ctx, func(tx pgx.Tx) (Job, error) {
		if _, err := Lock(ctx, tx, job.ID, actor); err != nil {
			return Job{}, err
		}
		input, err := GetInputTx(ctx, tx, job.ID, actor)
		if err != nil || string(input) != string(spec.Payload) {
			t.Fatalf("read clarification input: %s, %v", input, err)
		}
		return Resume(ctx, tx, job.ID, actor, waiting.Revision, answer)
	})
	if err != nil || resumed.Status != StatusQueued || resumed.Revision <= waiting.Revision || len(resumed.Result) != 0 {
		t.Fatalf("answer: %+v, %v", resumed, err)
	}
	if _, err := change(ctx, func(tx pgx.Tx) (Job, error) {
		return Resume(ctx, tx, job.ID, actor, waiting.Revision, answer)
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate answer: %v", err)
	}
	lease = claimForTest(t, ctx, "agent")
	if string(lease.Payload) != string(answer) {
		t.Fatalf("resumed input: %s", lease.Payload)
	}
	cancelled, err := Cancel(ctx, job.ID, actor)
	if err != nil || cancelled.Status != StatusCancelled {
		t.Fatalf("cancel running job: %+v, %v", cancelled, err)
	}
	if _, err := Complete(ctx, lease, Outcome{}); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("cancelled work could publish: %v", err)
	}
	if again, err := Cancel(ctx, job.ID, actor); err != nil || again.Revision != cancelled.Revision {
		t.Fatalf("idempotent cancellation: %+v, %v", again, err)
	}
	if revision, err := GetRevision(ctx, job.ID, actor); err != nil || revision != cancelled.Revision {
		t.Fatalf("revision read: %d, %v", revision, err)
	}
	if _, err := RetryJob(ctx, job.ID, actor); !errors.Is(err, ErrConflict) {
		t.Fatalf("cancelled job retried: %v", err)
	}
}

func TestJobCapacityAndInputExpiry(t *testing.T) {
	ctx := jobTestDatabase(t)
	actor, board := jobFixture(t, ctx)
	first := jobSpec(t, actor, board, "capacity")
	first.Payload = json.RawMessage(`{"fixture":true}`)
	initial, err := enqueueForTest(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < MaxActorActive; i++ {
		if _, err := enqueueForTest(ctx, jobSpec(t, actor, board, "capacity")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := change(ctx, func(tx pgx.Tx) (Job, error) {
		return PauseTx(ctx, tx, initial.ID, actor, true)
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := enqueueForTest(ctx, jobSpec(t, actor, board, "capacity")); !errors.Is(err, ErrCapacity) {
		t.Fatalf("paused job did not occupy an active slot: %v", err)
	}
	if replayed, err := enqueueForTest(ctx, first); err != nil || replayed.ID != initial.ID {
		t.Fatalf("replay with a full queue: %+v, %v", replayed, err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE jobs SET input_expires_at = clock_timestamp() WHERE id=$1`, initial.ID); err != nil {
		t.Fatal(err)
	}
	if err := Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	job, err := Get(ctx, initial.ID, actor)
	if err != nil || job.Status != StatusExpired || job.ErrorCode != "JOB_EXPIRED" {
		t.Fatalf("expired input: %+v, %v", job, err)
	}
	var retained int
	if err := db.Pool().QueryRow(ctx, `SELECT cached_bytes FROM jobs WHERE id=$1`, initial.ID).Scan(&retained); err != nil || retained != 0 {
		t.Fatalf("expired input retained %d bytes: %v", retained, err)
	}
	if _, err := enqueueForTest(ctx, jobSpec(t, actor, board, "capacity")); err != nil {
		t.Fatalf("expiry did not free a slot: %v", err)
	}
}

func TestJobRunnerRenewsWhileWorking(t *testing.T) {
	ctx := jobTestDatabase(t)
	actor, board := jobFixture(t, ctx)
	job, err := enqueueForTest(ctx, jobSpec(t, actor, board, "thumbnail"))
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	finish := make(chan struct{})
	runnerCtx, stop := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() {
		done <- Run(runnerCtx, Runner{LeaseDuration: 1200 * time.Millisecond, PollInterval: 20 * time.Millisecond,
			Handlers: map[string]Handler{"thumbnail": func(ctx context.Context, lease Lease) (Outcome, error) {
				close(started)
				select {
				case <-ctx.Done():
					return Outcome{}, ctx.Err()
				case <-finish:
					return Outcome{Result: json.RawMessage(`{"complete":true}`)}, nil
				}
			}},
		})
	}()
	t.Cleanup(func() {
		stop()
		if err := <-done; err != nil {
			t.Errorf("stop runner: %v", err)
		}
	})
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("runner did not start the job")
	}
	time.Sleep(1500 * time.Millisecond)
	if _, err := Claim(ctx, []string{"thumbnail"}, time.Second); !errors.Is(err, ErrNoWork) {
		t.Fatalf("active worker lost its heartbeat: %v", err)
	}
	close(finish)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		current, err := Get(ctx, job.ID, actor)
		if err != nil {
			t.Fatal(err)
		}
		if current.Status == StatusSucceeded && current.Attempt == 1 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("runner did not publish the result")
}

func jobSpec(t *testing.T, actor uuid.UUID, board, kind string) Spec {
	t.Helper()
	digest, err := Fingerprint(struct{ Board, Kind string }{Board: board, Kind: kind})
	if err != nil {
		t.Fatal(err)
	}
	return Spec{ActorID: actor, BoardID: board, Kind: kind, RequestID: uuid.New(), Fingerprint: digest}
}

func enqueueForTest(ctx context.Context, spec Spec) (Job, error) {
	return change(ctx, func(tx pgx.Tx) (Job, error) { return Enqueue(ctx, tx, spec) })
}

func claimForTest(t *testing.T, ctx context.Context, kind string) Lease {
	t.Helper()
	lease, err := Claim(ctx, []string{kind}, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return lease
}

func expireLease(t *testing.T, ctx context.Context, id uuid.UUID) {
	t.Helper()
	if _, err := db.Pool().Exec(ctx, `UPDATE jobs SET lease_until = clock_timestamp() WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
}

func jobFixture(t *testing.T, ctx context.Context) (uuid.UUID, string) {
	t.Helper()
	actor, board := uuid.New(), uuid.NewString()
	if _, err := db.Pool().Exec(ctx, `INSERT INTO users (id, email, password_hash, display_name)
		VALUES ($1, 'jobs-fixture@example.invalid', 'unused', 'Job fixture')`, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `INSERT INTO rooms (id, name, owner_id) VALUES ($1, 'Job fixture', $2)`, board, actor); err != nil {
		t.Fatal(err)
	}
	return actor, board
}

func jobTestDatabase(t *testing.T) context.Context {
	t.Helper()
	dsn := os.Getenv("OPENJAM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set OPENJAM_TEST_DATABASE_URL to run the PostgreSQL integration test")
	}
	isolated, err := url.Parse(dsn)
	if err != nil || (isolated.Scheme != "postgres" && isolated.Scheme != "postgresql") {
		t.Fatal("OPENJAM_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "openjam_job_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := pgx.Identifier{schema}.Sanitize()
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA IF EXISTS "+quoted+" CASCADE"); err != nil {
			t.Errorf("drop owned fixture schema: %v", err)
		}
		_ = admin.Close(cleanup)
	})
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	params := isolated.Query()
	params.Set("search_path", schema)
	isolated.RawQuery = params.Encode()
	if err := db.InitContext(ctx, isolated.String()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	var actual string
	if err := db.Pool().QueryRow(ctx, "SHOW search_path").Scan(&actual); err != nil || actual != schema {
		t.Fatalf("unexpected fixture search_path %q, %v", actual, err)
	}
	if err := db.MigrateContext(ctx); err != nil {
		t.Fatal(err)
	}
	return ctx
}
