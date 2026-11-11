package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/jobs"
	"github.com/project-wb/server/internal/model"
)

type Metadata struct {
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Workflow  string `json:"workflow"`
	Placement string `json:"placement"`
	PageID    string `json:"pageId"`
}

type Application struct {
	Ack    document.Ack `json:"ack"`
	PageID string       `json:"pageId"`
}

type Run struct {
	jobs.Job
	Metadata
	Result       *PreviewResult `json:"result,omitempty"`
	Applied      *Application   `json:"applied,omitempty"`
	Conversation *Conversation  `json:"conversation,omitempty"`
	Shared       bool           `json:"shared,omitempty"`
}

type AnswerInput struct {
	Revision int64  `json:"revision"`
	Answer   string `json:"answer"`
}

type runRecord struct {
	Metadata
	revision     *int64
	epoch        *int64
	seq          *int64
	client       *uuid.UUID
	change       []byte
	conversation *Conversation
	shared       bool
}

const metaColumns = `r.provider, r.model, r.workflow, r.placement, r.page_id,
	r.proposal_revision, r.applied_epoch, r.applied_seq, r.applied_client_id,
	c.prompt, c.answer, c.published IS NOT NULL`

func (r *runRecord) columns() []any {
	return []any{&r.Provider, &r.Model, &r.Workflow, &r.Placement, &r.PageID,
		&r.revision, &r.epoch, &r.seq, &r.client}
}

func runMetadata(ctx context.Context, tx pgx.Tx, job jobs.Job, withChange bool) (runRecord, error) {
	var r runRecord
	var prompt, answer *string
	const from = ` FROM agent_runs r LEFT JOIN agent_conversations c
		ON c.job_id = r.job_id AND c.expires_at > statement_timestamp()`
	sql := `SELECT ` + metaColumns + from
	fields := append(r.columns(), &prompt, &answer, &r.shared)
	args := []any{job.ID}
	if withChange {
		sql = `SELECT ` + metaColumns + `, d.payload` + from + `
			LEFT JOIN board_changes d ON d.board_id = $2 AND d.epoch = r.applied_epoch AND d.seq = r.applied_seq`
		fields = append(fields, &r.change)
		args = append(args, job.BoardID)
	}
	err := tx.QueryRow(ctx, sql+` WHERE r.job_id = $1`, args...).Scan(fields...)
	if errors.Is(err, pgx.ErrNoRows) {
		return runRecord{}, jobs.ErrNotFound
	}
	if prompt != nil {
		r.conversation = &Conversation{Prompt: *prompt}
		if answer != nil {
			r.conversation.Answer = *answer
		}
	}
	return r, err
}

func (r runRecord) application(job jobs.Job, replayed bool) (*Application, error) {
	if r.revision == nil {
		return nil, nil
	}
	ack := document.Ack{
		BoardID: job.BoardID, Epoch: *r.epoch, Seq: *r.seq,
		ClientID: r.client.String(), CommandID: job.ID.String(), Replayed: replayed,
	}
	if len(r.change) > 0 {
		var delta document.Change
		if err := json.Unmarshal(r.change, &delta); err != nil {
			return nil, err
		}
		ack.Change = &delta
	}
	return &Application{Ack: ack, PageID: r.PageID}, nil
}

func makeRun(job jobs.Job, meta runRecord) (Run, error) {
	run := Run{Job: job, Metadata: meta.Metadata, Conversation: meta.conversation, Shared: meta.shared}
	if len(job.Result) > 0 {
		var result storedResult
		if err := decodeStrict(job.Result, &result); err != nil {
			return Run{}, err
		}
		run.Result = &result.PreviewResult
	}
	var err error
	run.Applied, err = meta.application(job, true)
	return run, err
}

func Start(ctx context.Context, config Config, boardID string, actor uuid.UUID, input StartInput) (Run, error) {
	if err := normalizeStart(&input); err != nil {
		return Run{}, err
	}
	digest, err := jobs.Fingerprint(input)
	if err != nil {
		return Run{}, err
	}
	spec := jobs.Spec{ActorID: actor, BoardID: boardID, Kind: Kind, RequestID: input.RequestID, Fingerprint: digest, MaxAttempts: 3}
	if isCloudProvider(input.Provider) {
		// An interrupted cloud call may already have reached the provider.
		spec.MaxAttempts = 1
		spec.ExpiredLeaseCode = "PROVIDER_OUTCOME_UNKNOWN"
	}
	var result Run
	err = writeTx(ctx, func(tx pgx.Tx) error {
		head, err := document.LockFileSnapshot(ctx, tx, boardID, actor, true)
		if err != nil {
			return err
		}
		existing, found, err := jobs.Find(ctx, tx, spec)
		if err != nil {
			return err
		}
		if found {
			meta, err := runMetadata(ctx, tx, existing, true)
			if err != nil {
				return err
			}
			result, err = makeRun(existing, meta)
			return err
		}
		namespace := uuid.NewSHA1(input.RequestID, []byte(boardID+":"+actor.String()))
		basis, err := captureBasis(ctx, tx, config, boardID, head, input, namespace)
		if err != nil {
			return err
		}
		spec.Payload, err = json.Marshal(jobInput{
			Basis: basis, Provider: input.Provider, Model: input.Model, Workflow: input.Workflow, Prompt: input.Prompt,
		})
		if err != nil {
			return err
		}
		job, err := jobs.Enqueue(ctx, tx, spec)
		if err != nil {
			return err
		}
		meta := Metadata{
			Provider: input.Provider, Model: input.Model, Workflow: input.Workflow, Placement: basis.Placement, PageID: basis.PageID,
		}
		if _, err := tx.Exec(ctx, `INSERT INTO agent_runs (job_id, provider, model, workflow, placement, page_id)
			VALUES ($1, $2, $3, $4, $5, $6)`, job.ID, meta.Provider, meta.Model, meta.Workflow, meta.Placement, meta.PageID); err != nil {
			return err
		}
		if err := createConversation(ctx, tx, job, input.Prompt); err != nil {
			return err
		}
		result = Run{Job: job, Metadata: meta, Conversation: &Conversation{Prompt: input.Prompt}}
		return nil
	})
	return result, err
}

func Get(ctx context.Context, boardID string, actor, id uuid.UUID) (Run, error) {
	var result Run
	err := readTx(ctx, func(tx pgx.Tx) error {
		if err := requireEditor(ctx, tx, boardID, actor); err != nil {
			return err
		}
		job, err := readScopedJob(ctx, tx, boardID, actor, id, false)
		if err != nil {
			return err
		}
		meta, err := runMetadata(ctx, tx, job, true)
		if err != nil {
			return err
		}
		result, err = makeRun(job, meta)
		return err
	})
	return result, err
}

func List(ctx context.Context, boardID string, actor uuid.UUID) ([]Run, error) {
	result := make([]Run, 0, 20)
	err := readTx(ctx, func(tx pgx.Tx) error {
		if err := requireEditor(ctx, tx, boardID, actor); err != nil {
			return err
		}
		entries, err := jobs.ListTx(ctx, tx, actor, boardID, []string{Kind}, 20)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			meta, err := runMetadata(ctx, tx, entry, false)
			if err != nil {
				return err
			}
			run, err := makeRun(entry, meta)
			if err != nil {
				return err
			}
			result = append(result, run)
		}
		return nil
	})
	return result, err
}

func Revision(ctx context.Context, boardID string, actor, id uuid.UUID) (int64, error) {
	if err := requireEditor(ctx, db.Pool(), boardID, actor); err != nil {
		return 0, err
	}
	var result int64
	err := db.Pool().QueryRow(ctx, `SELECT revision FROM jobs WHERE
		id = $1 AND actor_id = $2 AND board_id = $3 AND kind = $4`, id, actor, boardID, Kind).Scan(&result)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, jobs.ErrNotFound
	}
	return result, err
}

func Answer(ctx context.Context, config Config, boardID string, actor, id uuid.UUID, input AnswerInput) (Run, error) {
	input.Answer = strings.TrimSpace(input.Answer)
	if input.Revision < 1 || !validText(input.Answer, 1000, false) {
		return Run{}, invalid("Provide the current draft revision and a clarification of 1–1000 characters.")
	}
	return changeRun(ctx, boardID, actor, id, func(tx pgx.Tx, head document.FileSnapshot, job jobs.Job, meta runRecord) (jobs.Job, error) {
		if job.Status != jobs.StatusAwaitingInput || job.Revision != input.Revision {
			return jobs.Job{}, jobs.ErrConflict
		}
		payload, err := jobs.GetInputTx(ctx, tx, job.ID, actor)
		if err != nil {
			return jobs.Job{}, err
		}
		var request jobInput
		if err := decodeStrict(payload, &request); err != nil || request.Answer != "" {
			return jobs.Job{}, jobs.ErrConflict
		}
		if _, err := verifyBasis(ctx, tx, config, boardID, head, request.Basis, request.Provider, request.Model); err != nil {
			return jobs.Job{}, err
		}
		request.Answer = input.Answer
		data, err := json.Marshal(request)
		if err != nil {
			return jobs.Job{}, err
		}
		resumed, err := jobs.Resume(ctx, tx, job.ID, actor, job.Revision, data)
		if err != nil {
			return jobs.Job{}, err
		}
		if err := recordAnswer(ctx, tx, resumed, input.Answer); err != nil {
			return jobs.Job{}, err
		}
		return resumed, nil
	})
}

func Pause(ctx context.Context, boardID string, actor, id uuid.UUID) (Run, error) {
	return changeRun(ctx, boardID, actor, id, func(tx pgx.Tx, _ document.FileSnapshot, job jobs.Job, meta runRecord) (jobs.Job, error) {
		cloud := isCloudProvider(meta.Provider)
		if cloud && job.Status == jobs.StatusRunning {
			return jobs.Job{}, conflict("CLOUD_RUN_IN_PROGRESS", "An in-flight cloud call cannot be paused safely.")
		}
		return jobs.PauseTx(ctx, tx, job.ID, actor, !cloud)
	})
}

func Resume(ctx context.Context, config Config, boardID string, actor, id uuid.UUID) (Run, error) {
	return changeRun(ctx, boardID, actor, id, func(tx pgx.Tx, head document.FileSnapshot, job jobs.Job, _ runRecord) (jobs.Job, error) {
		if job.Status == jobs.StatusPaused {
			payload, err := jobs.GetInputTx(ctx, tx, job.ID, actor)
			if err != nil {
				return jobs.Job{}, err
			}
			var request jobInput
			if err := decodeStrict(payload, &request); err != nil {
				return jobs.Job{}, jobs.ErrConflict
			}
			if _, err := verifyBasis(ctx, tx, config, boardID, head, request.Basis, request.Provider, request.Model); err != nil {
				return jobs.Job{}, err
			}
		}
		return jobs.ResumePausedTx(ctx, tx, job.ID, actor)
	})
}

func Cancel(ctx context.Context, boardID string, actor, id uuid.UUID) (Run, error) {
	return changeRun(ctx, boardID, actor, id, func(tx pgx.Tx, _ document.FileSnapshot, job jobs.Job, _ runRecord) (jobs.Job, error) {
		return jobs.CancelTx(ctx, tx, job.ID, actor)
	})
}

func Retry(ctx context.Context, config Config, boardID string, actor, id uuid.UUID) (Run, error) {
	return changeRun(ctx, boardID, actor, id, func(tx pgx.Tx, _ document.FileSnapshot, job jobs.Job, meta runRecord) (jobs.Job, error) {
		if _, err := currentPolicy(ctx, tx, config, boardID, meta.Provider, meta.Model, 0, true); err != nil {
			return jobs.Job{}, err
		}
		return jobs.RetryJobTx(ctx, tx, job.ID, actor)
	})
}

func changeRun(ctx context.Context, boardID string, actor, id uuid.UUID,
	change func(pgx.Tx, document.FileSnapshot, jobs.Job, runRecord) (jobs.Job, error)) (Run, error) {
	var result Run
	err := writeTx(ctx, func(tx pgx.Tx) error {
		head, err := document.LockFileSnapshot(ctx, tx, boardID, actor, true)
		if err != nil {
			return err
		}
		job, err := readScopedJob(ctx, tx, boardID, actor, id, true)
		if err != nil {
			return err
		}
		meta, err := runMetadata(ctx, tx, job, false)
		if err != nil {
			return err
		}
		job, err = change(tx, head, job, meta)
		if err != nil {
			return err
		}
		meta, err = runMetadata(ctx, tx, job, false)
		if err != nil {
			return err
		}
		result, err = makeRun(job, meta)
		return err
	})
	return result, err
}

func readScopedJob(ctx context.Context, tx pgx.Tx, boardID string, actor, id uuid.UUID, lock bool) (jobs.Job, error) {
	read := jobs.GetTx
	if lock {
		read = jobs.Lock
	}
	job, err := read(ctx, tx, id, actor)
	if err == nil && (job.Kind != Kind || job.BoardID != boardID) {
		return jobs.Job{}, jobs.ErrNotFound
	}
	return job, err
}

func readTx(ctx context.Context, apply func(pgx.Tx) error) error {
	return pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, apply)
}

func DescribeError(err error) *Fault {
	var fault *Fault
	if errors.As(err, &fault) {
		return fault
	}
	switch {
	case errors.Is(err, model.ErrRoomAccessDenied):
		return &Fault{403, "ACCESS_DENIED", "Board editing access is required."}
	case errors.Is(err, model.ErrRoomNotFound), errors.Is(err, jobs.ErrNotFound), errors.Is(err, model.ErrDirectoryNotFound):
		return &Fault{404, "AGENT_NOT_FOUND", "The board, organization, or run is unavailable."}
	case errors.Is(err, jobs.ErrConflict):
		return &Fault{409, "RUN_CONFLICT", "This request or run is no longer in the expected state."}
	case errors.Is(err, jobs.ErrCapacity):
		return &Fault{429, "JOB_CAPACITY", "The job queue is full. Try again later."}
	case errors.Is(err, jobs.ErrInvalid):
		return &Fault{400, "INVALID_AGENT_REQUEST", "Invalid agent request."}
	}
	failure := document.DescribeError(err)
	return &Fault{failure.Status, failure.Code, failure.Error}
}
