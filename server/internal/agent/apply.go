package agent

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/jobs"
)

type ApplyInput struct {
	Revision int64     `json:"revision"`
	ClientID uuid.UUID `json:"clientId"`
}

func Apply(ctx context.Context, config Config, boardID string, actor, id uuid.UUID, input ApplyInput) (Application, error) {
	if input.Revision < 1 || input.ClientID == uuid.Nil {
		return Application{}, invalid("Provide the current draft revision and an editor client ID.")
	}
	var application Application
	err := writeTx(ctx, func(tx pgx.Tx) error {
		head, err := document.LockFileSnapshot(ctx, tx, boardID, actor, true)
		if err != nil {
			return err
		}
		job, err := readScopedJob(ctx, tx, boardID, actor, id, true)
		if err != nil {
			return err
		}
		meta, err := runMetadata(ctx, tx, job, true)
		if err != nil {
			return err
		}
		if meta.revision != nil {
			if *meta.revision != input.Revision || *meta.client != input.ClientID {
				return conflict("RUN_ALREADY_APPLIED", "This draft was already applied.")
			}
			replay, err := meta.application(job, true)
			if err == nil {
				application = *replay
			}
			return err
		}
		if job.Status != jobs.StatusSucceeded || job.Revision != input.Revision {
			return jobs.ErrConflict
		}
		if len(job.Result) == 0 {
			return conflict("DRAFT_EXPIRED", "This draft expired. Generate a new draft.")
		}
		var result storedResult
		if err := decodeStrict(job.Result, &result); err != nil {
			return err
		}
		if result.Preview == nil || result.Preview.PageID != meta.PageID || result.Preview.Placement != meta.Placement {
			return jobs.ErrConflict
		}
		if _, err := verifyBasis(ctx, tx, config, boardID, head, result.Basis, meta.Provider, meta.Model); err != nil {
			return err
		}
		if err := checkPlacement(ctx, tx, boardID, *result.Preview); err != nil {
			return err
		}
		ack, err := document.CommitTx(ctx, tx, boardID, actor, document.Command{
			ProtocolVersion: document.ProtocolVersion, Epoch: head.Epoch, BaseSeq: head.Seq,
			ClientID: input.ClientID.String(), CommandID: job.ID.String(), Operations: result.Preview.Operations,
		})
		if err != nil {
			return err
		}
		if err := recordAttributions(ctx, tx, boardID, actor, job.ID, ack); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE agent_runs SET proposal_revision = $2, applied_epoch = $3, applied_seq = $4,
			applied_client_id = $5, applied_at = clock_timestamp() WHERE job_id = $1 AND applied_at IS NULL`,
			job.ID, input.Revision, ack.Epoch, ack.Seq, input.ClientID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return jobs.ErrConflict
		}
		if err := jobs.BumpRevisionTx(ctx, tx, job.ID, actor); err != nil {
			return err
		}
		application = Application{Ack: ack, PageID: meta.PageID}
		return nil
	})
	return application, err
}

func checkPlacement(ctx context.Context, tx pgx.Tx, boardID string, preview Preview) error {
	if preview.Placement != currentPage {
		return nil
	}
	rectangles, err := pageGeometry(ctx, tx, boardID, preview.PageID)
	if err != nil {
		return err
	}
	for _, existing := range rectangles {
		if existing.intersects(preview.Bounds) {
			return conflict("TARGET_OCCUPIED", "The draft area now contains another object. Generate a new placement.")
		}
	}
	return nil
}
