package boardfiles

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/jobs"
	"github.com/project-wb/server/internal/model"
)

const (
	KindExport    = "board_export"
	KindImport    = "board_import"
	KindThumbnail = "board_thumbnail"
)

type exportInput struct {
	Format   string            `json:"format"`
	Snapshot document.Snapshot `json:"snapshot"`
	Theme    string            `json:"theme,omitempty"`
}

type importInput struct {
	MediaType string `json:"mediaType"`
}

func EnqueueExport(ctx context.Context, boardID string, actor uuid.UUID, req ExportRequest) (jobs.Job, error) {
	if err := req.normalize(); err != nil {
		return jobs.Job{}, err
	}
	fingerprint, err := jobs.Fingerprint(req)
	if err != nil {
		return jobs.Job{}, err
	}
	spec := jobs.Spec{
		ActorID: actor, BoardID: boardID, Kind: KindExport,
		RequestID: req.RequestID, Fingerprint: fingerprint,
	}
	var job jobs.Job
	err = pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{}, func(tx pgx.Tx) error {
		locked, err := document.LockFileSnapshot(ctx, tx, boardID, actor, true)
		if err != nil {
			return err
		}
		existing, found, err := jobs.Find(ctx, tx, spec)
		if err != nil || found {
			job = existing
			return err
		}
		spec.Payload, err = captureFileInput(ctx, tx, locked, req)
		if err != nil {
			return err
		}
		job, err = jobs.Enqueue(ctx, tx, spec)
		return err
	})
	return job, err
}

func captureFileInput(ctx context.Context, tx pgx.Tx, locked document.FileSnapshot, req ExportRequest) (json.RawMessage, error) {
	pageID := req.PageID
	if req.Scope == "page" && pageID == "" {
		pageID = locked.DefaultPageID
	}
	snapshot, err := locked.Capture(ctx, tx, pageID)
	if err != nil {
		return nil, err
	}
	snapshot.Document, err = scopeDocument(snapshot.Document, req)
	if err != nil {
		return nil, err
	}
	if req.Scope == "selection" {
		scoped, err := json.Marshal(snapshot.Document)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(scoped)
		snapshot.Hash = hex.EncodeToString(digest[:])
	}
	data, err := json.Marshal(exportInput{Format: req.Format, Snapshot: snapshot, Theme: req.Theme})
	if err == nil && len(data) > jobs.MaxPayloadBytes {
		return nil, ErrTooLarge
	}
	return data, err
}

func EnqueueImport(ctx context.Context, actor, requestID uuid.UUID, data []byte, mediaType string) (jobs.Job, error) {
	if len(data) > MaxPackageBytes {
		return jobs.Job{}, ErrTooLarge
	}
	if len(data) == 0 || (mediaType != "application/json" && mediaType != "application/zip") {
		return jobs.Job{}, ErrInvalidFile
	}
	digest := sha256.Sum256(data)
	fingerprint, err := jobs.Fingerprint(struct {
		MediaType string
		Digest    [32]byte
	}{mediaType, digest})
	if err != nil {
		return jobs.Job{}, err
	}
	payload, err := json.Marshal(importInput{MediaType: mediaType})
	if err != nil {
		return jobs.Job{}, err
	}
	var job jobs.Job
	err = pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{}, func(tx pgx.Tx) error {
		var err error
		job, err = jobs.Enqueue(ctx, tx, jobs.Spec{
			ActorID: actor, RequestID: requestID, Kind: KindImport,
			Fingerprint: fingerprint, Payload: payload, Input: data,
		})
		return err
	})
	return job, err
}

type Thumbnail struct {
	Artifact jobs.Artifact
	Pending  bool
}

func GetThumbnail(ctx context.Context, boardID string, actor uuid.UUID, theme string) (Thumbnail, error) {
	theme, err := normalizeTheme(theme)
	if err != nil {
		return Thumbnail{}, err
	}
	var result Thumbnail
	err = pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{}, func(tx pgx.Tx) error {
		locked, err := document.LockFileSnapshot(ctx, tx, boardID, actor, false)
		if err != nil {
			return err
		}
		// Partition cache keys by head, day and theme. The artifact is shared only
		// through this route, after authorization, and ages out automatically.
		key := fmt.Sprintf("openjam-thumbnail/%s/%d/%d/%s", boardID, locked.Epoch, locked.Seq, time.Now().UTC().Format("2006-01-02"))
		if theme != "" {
			key += "/" + theme
		}
		requestID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(key))
		spec := jobs.Spec{
			BoardID: boardID, ActorID: locked.OwnerID, Kind: KindThumbnail,
			RequestID: requestID, Fingerprint: sha256.Sum256([]byte(key)),
		}
		existing, found, err := jobs.Find(ctx, tx, spec)
		if err != nil {
			return err
		}
		if found {
			switch existing.Status {
			case jobs.StatusSucceeded:
				result.Artifact, err = jobs.GetBoardArtifactTx(ctx, tx, boardID, KindThumbnail, requestID)
				if errors.Is(err, jobs.ErrArtifactUnavailable) {
					return nil
				}
				return err
			case jobs.StatusQueued, jobs.StatusRunning:
				result.Pending = true
			}
			return nil
		}
		spec.Payload, err = captureFileInput(ctx, tx, locked, ExportRequest{Format: "png", Scope: "page", Theme: theme})
		if err != nil {
			return err
		}
		if _, err := jobs.Enqueue(ctx, tx, spec); err != nil {
			return err
		}
		result.Pending = true
		return nil
	})
	return result, err
}

func Handlers() map[string]jobs.Handler {
	return map[string]jobs.Handler{
		KindExport:    runExport,
		KindImport:    runImport,
		KindThumbnail: runExport,
	}
}

func runExport(ctx context.Context, lease jobs.Lease) (jobs.Outcome, error) {
	var input exportInput
	if err := json.Unmarshal(lease.Payload, &input); err != nil || input.Snapshot.BoardID != lease.BoardID {
		return jobs.Outcome{}, jobs.Fail("INVALID_FILE_JOB")
	}
	if err := CheckExportAccess(ctx, lease.BoardID, lease.ActorID); err != nil {
		return jobs.Outcome{}, fileJobError(err)
	}
	snapshot := input.Snapshot
	thumbnail := lease.Kind == KindThumbnail
	var data []byte
	var err error
	switch input.Format {
	case "png":
		// Timer values reflect a single instant across worker retries.
		snapshot.UpdatedAt = lease.CreatedAt
		data, err = renderPNG(ctx, lease.ActorID, snapshot, thumbnail, input.Theme)
	case "json", "zip":
		var bundle boardPackage
		bundle, err = capturePackage(ctx, lease.ActorID, snapshot)
		if err == nil {
			data, err = encodePackage(bundle, input.Format)
		}
	default:
		return jobs.Outcome{}, jobs.Fail("INVALID_FILE_JOB")
	}
	if err != nil {
		return jobs.Outcome{}, fileJobError(err)
	}
	if len(data) == 0 || len(data) > jobs.MaxArtifactBytes {
		return jobs.Outcome{}, jobs.Fail("FILE_TOO_LARGE")
	}
	extension := input.Format
	mediaType := map[string]string{"png": "image/png", "json": "application/json", "zip": "application/zip"}[extension]
	outcome := jobs.Outcome{Artifact: &jobs.Artifact{
		Data: data, ContentType: mediaType, Filename: exportFilename(snapshot.Document.Name, extension),
	}}
	if thumbnail {
		outcome.OutputTTL = 25 * time.Hour
	}
	outcome.Commit = func(ctx context.Context, tx pgx.Tx) (json.RawMessage, error) {
		access, err := model.QueryRoomAccess(ctx, tx, lease.BoardID, lease.ActorID)
		if err == nil && !access.IsOwner && !model.RoomPermissionAllowsEdit(access.Permission) {
			err = model.ErrRoomAccessDenied
		}
		if err != nil {
			return nil, fileJobError(err)
		}
		return json.Marshal(packageSource{Epoch: snapshot.Epoch, Seq: snapshot.Seq, Hash: snapshot.Hash})
	}
	return outcome, nil
}

func CheckExportAccess(ctx context.Context, boardID string, actor uuid.UUID) error {
	access, err := model.GetRoomAccess(ctx, boardID, actor)
	if err != nil {
		return err
	}
	if !access.IsOwner && !model.RoomPermissionAllowsEdit(access.Permission) {
		return model.ErrRoomAccessDenied
	}
	return nil
}

func exportFilename(name, extension string) string {
	var result strings.Builder
	for _, ch := range name {
		if result.Len() >= 80 {
			break
		}
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			(ch >= '0' && ch <= '9') || ch == '-' || ch == '_' {
			result.WriteRune(ch)
		} else {
			result.WriteByte('-')
		}
	}
	slug := strings.Trim(result.String(), "-_")
	if slug == "" {
		slug = "openjam-board"
	}
	return slug + "." + extension
}

func runImport(ctx context.Context, lease jobs.Lease) (jobs.Outcome, error) {
	var input importInput
	if err := json.Unmarshal(lease.Payload, &input); err != nil ||
		(input.MediaType != "application/json" && input.MediaType != "application/zip") {
		return jobs.Outcome{}, jobs.Fail("INVALID_FILE_JOB")
	}
	bundle, err := decodePackage(lease.Input, input.MediaType)
	if err != nil {
		return jobs.Outcome{}, fileJobError(err)
	}
	if err := prepareImport(&bundle); err != nil {
		return jobs.Outcome{}, fileJobError(err)
	}
	metas := make([]assets.Metadata, 0, len(bundle.Assets))
	for _, asset := range bundle.Assets {
		if err := assets.Stage(ctx, asset.Metadata, asset.Data); err != nil {
			return jobs.Outcome{}, fileJobError(err)
		}
		metas = append(metas, asset.Metadata)
	}
	content := bundle.Document
	return jobs.Outcome{Commit: func(ctx context.Context, tx pgx.Tx) (json.RawMessage, error) {
		state, err := document.ImportPortable(ctx, tx, lease.ActorID, content, func(boardID string) error {
			return assets.Grant(ctx, tx, boardID, metas)
		})
		if err != nil {
			return nil, fileJobError(err)
		}
		return json.Marshal(state)
	}}, nil
}

func fileJobError(err error) error {
	switch {
	case errors.Is(err, ErrTooLarge), errors.Is(err, document.ErrPortableTooLarge), errors.Is(err, assets.ErrTooLarge):
		return jobs.Fail("FILE_TOO_LARGE")
	case errors.Is(err, ErrExternalImage):
		return jobs.Fail("UNSUPPORTED_IMAGE_SOURCE")
	case errors.Is(err, ErrInvalidFile), errors.Is(err, assets.ErrInvalidImage), errors.Is(err, assets.ErrNotFound):
		return jobs.Fail("INVALID_BOARD_FILE")
	case errors.Is(err, model.ErrRoomAccessDenied), errors.Is(err, model.ErrRoomNotFound):
		return jobs.Fail("ACCESS_DENIED")
	case errors.Is(err, assets.ErrQuota):
		return jobs.Fail("ASSET_QUOTA")
	case errors.Is(err, assets.ErrStagingFull):
		return jobs.Retry("ASSET_STAGING_FULL")
	case errors.Is(err, assets.ErrUnavailable):
		return jobs.Retry("ASSET_UNAVAILABLE")
	default:
		return err
	}
}
