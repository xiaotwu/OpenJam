package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/jobs"
	"github.com/project-wb/server/internal/model"
)

const (
	conversationCapacityLock  int64 = 0x4f4a4147434f4e56
	conversationMaxBytes            = 32 << 20
	conversationActorMaxBytes       = 4 << 20
	conversationMaxCount            = 4096
	conversationActorMaxCount       = 100
	conversationShareMaxBytes       = 128 << 10
)

type Conversation struct {
	Prompt string `json:"prompt"`
	Answer string `json:"answer,omitempty"`
}

// SharedRun is a deliberately separate projection. It cannot serialize a job
// payload, selection, command receipt, preview operations, or client's identity.
type SharedRun struct {
	ID           uuid.UUID      `json:"id"`
	BoardID      string         `json:"boardId"`
	Status       jobs.Status    `json:"status"`
	Revision     int64          `json:"revision"`
	Provider     string         `json:"provider"`
	Model        string         `json:"model"`
	Workflow     string         `json:"workflow"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
	ExpiresAt    time.Time      `json:"expiresAt"`
	Shared       bool           `json:"shared"`
	Conversation Conversation   `json:"conversation"`
	Result       *sharedPreview `json:"result,omitempty"`
}

type sharedPreview struct {
	Proposal      Proposal       `json:"proposal"`
	ExternalReply *ExternalReply `json:"externalReply,omitempty"`
}

func reserveConversation(ctx context.Context, tx pgx.Tx, actor uuid.UUID, extraBytes int, addsRow bool) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, conversationCapacityLock); err != nil {
		return err
	}
	var totalBytes, actorBytes, totalRows, actorRows int64
	err := tx.QueryRow(ctx, `
		SELECT coalesce(sum(c.cached_bytes), 0), coalesce(sum(c.cached_bytes) FILTER (WHERE j.actor_id = $1), 0),
			count(*), count(*) FILTER (WHERE j.actor_id = $1)
		FROM agent_conversations c JOIN jobs j ON j.id = c.job_id`, actor).
		Scan(&totalBytes, &actorBytes, &totalRows, &actorRows)
	if err != nil {
		return err
	}
	if totalBytes+int64(extraBytes) > conversationMaxBytes || actorBytes+int64(extraBytes) > conversationActorMaxBytes ||
		(addsRow && (totalRows >= conversationMaxCount || actorRows >= conversationActorMaxCount)) {
		return &Fault{http.StatusTooManyRequests, "AGENT_HISTORY_CAPACITY", "Recent conversation storage is full. Try again after older conversations expire."}
	}
	return nil
}

func createConversation(ctx context.Context, tx pgx.Tx, job jobs.Job, prompt string) error {
	if err := reserveConversation(ctx, tx, job.ActorID, len(prompt), true); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO agent_conversations (job_id, prompt, expires_at) VALUES ($1, $2, $3)`,
		job.ID, prompt, job.InputExpiresAt)
	return err
}

func recordAnswer(ctx context.Context, tx pgx.Tx, job jobs.Job, answer string) error {
	if err := reserveConversation(ctx, tx, job.ActorID, len(answer), false); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE agent_conversations SET answer = $2
		WHERE job_id = $1 AND answer IS NULL AND expires_at > clock_timestamp()`, job.ID, answer)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return jobs.ErrConflict
	}
	return nil
}

func SetShared(ctx context.Context, boardID string, actor, id uuid.UUID, shared bool) (Run, error) {
	return changeRun(ctx, boardID, actor, id, func(tx pgx.Tx, _ document.FileSnapshot, job jobs.Job, meta runRecord) (jobs.Job, error) {
		if meta.shared == shared {
			return job, nil
		}
		var published []byte
		if shared {
			var err error
			published, err = snapshotForSharing(job, meta)
			if err != nil {
				return jobs.Job{}, err
			}
			if err := reserveConversation(ctx, tx, actor, len(published), false); err != nil {
				return jobs.Job{}, err
			}
		}
		tag, err := tx.Exec(ctx, `UPDATE agent_conversations SET published = $2
			WHERE job_id = $1 AND expires_at > clock_timestamp()`, job.ID, published)
		if err != nil {
			return jobs.Job{}, err
		}
		if tag.RowsAffected() != 1 {
			return jobs.Job{}, jobs.ErrConflict
		}
		if err := jobs.BumpRevisionTx(ctx, tx, id, actor); err != nil {
			return jobs.Job{}, err
		}
		return jobs.GetTx(ctx, tx, id, actor)
	})
}

func snapshotForSharing(job jobs.Job, meta runRecord) ([]byte, error) {
	if (job.Status != jobs.StatusSucceeded && job.Status != jobs.StatusAwaitingInput) ||
		meta.conversation == nil || len(job.Result) == 0 {
		return nil, conflict("CONVERSATION_NOT_SHAREABLE", "Wait for a draft or a clarification before sharing the conversation.")
	}
	var result storedResult
	if err := decodeStrict(job.Result, &result); err != nil {
		return nil, err
	}
	snapshot := SharedRun{
		ID: job.ID, BoardID: job.BoardID, Status: job.Status, Revision: job.Revision,
		Provider: meta.Provider, Model: meta.Model, Workflow: meta.Workflow,
		CreatedAt: job.CreatedAt, UpdatedAt: job.UpdatedAt, ExpiresAt: job.InputExpiresAt,
		Shared: true, Conversation: *meta.conversation,
	}
	// Model-authored text can echo selected excerpts verbatim. The author can
	// share what they typed, while selected-source runs expose no model text.
	if len(result.Basis.Sources) == 0 {
		snapshot.Result = &sharedPreview{Proposal: result.Proposal, ExternalReply: result.ExternalReply}
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	if len(raw) > conversationShareMaxBytes {
		return nil, &Fault{http.StatusUnprocessableEntity, "SHARED_CONVERSATION_TOO_LARGE", "This conversation exceeds the sharing size limit."}
	}
	return raw, nil
}

func GetShared(ctx context.Context, boardID string, actor, id uuid.UUID) (SharedRun, error) {
	var result SharedRun
	err := readTx(ctx, func(tx pgx.Tx) error {
		access, err := model.QueryRoomAccess(ctx, tx, boardID, actor)
		if err != nil {
			return err
		}
		if !access.IsOwner && access.Source != "member" && access.Source != "project" {
			return model.ErrRoomAccessDenied
		}
		var snapshot []byte
		err = tx.QueryRow(ctx, `
			SELECT c.published FROM agent_conversations c JOIN jobs j ON j.id = c.job_id
			WHERE j.id = $1 AND j.board_id = $2 AND j.kind = $3
			AND c.published IS NOT NULL AND c.expires_at > statement_timestamp()`, id, boardID, Kind).Scan(&snapshot)
		if errors.Is(err, pgx.ErrNoRows) {
			return jobs.ErrNotFound
		}
		if err != nil {
			return err
		}
		return decodeStrict(snapshot, &result)
	})
	return result, err
}

// SweepConversations physically removes expired private and published text.
// Readers reject expired rows even while no worker is available to sweep.
func SweepConversations(ctx context.Context) error {
	_, err := db.Pool().Exec(ctx, `WITH expired AS (
		SELECT job_id FROM agent_conversations WHERE expires_at <= statement_timestamp()
		ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 64
	)
	DELETE FROM agent_conversations c USING expired WHERE c.job_id = expired.job_id`)
	return err
}
