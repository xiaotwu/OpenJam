package handler

import (
	"bytes"
	"context"
	"errors"
	"mime"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/jobs"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

func RegisterFileJobRoutes(api *gin.RouterGroup) {
	routes := api.Group("/v2/jobs", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		c.Next()
	})
	routes.GET("", listFileJobs)
	routes.GET("/:jobId", func(c *gin.Context) { fileJobAction(c, "read") })
	routes.GET("/:jobId/artifact", func(c *gin.Context) { fileJobAction(c, "download") })
	routes.HEAD("/:jobId/artifact", func(c *gin.Context) { fileJobAction(c, "download") })
	routes.POST("/:jobId/cancel", func(c *gin.Context) { fileJobAction(c, "cancel") })
	routes.POST("/:jobId/retry", func(c *gin.Context) { fileJobAction(c, "retry") })
}

func listFileJobs(c *gin.Context) {
	ctx := c.Request.Context()
	actor := middleware.GetUser(c).ID
	boardID := c.Query("boardId")
	kind := "board_import"
	if boardID != "" {
		if err := requireFileJobAccess(c, db.Pool(), boardID); err != nil {
			writeFileJobError(c, err)
			return
		}
		kind = "board_export"
	}
	entries, err := jobs.List(ctx, actor, boardID, []string{kind}, 20)
	if err != nil {
		writeFileJobError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": entries})
}

func fileJobAction(c *gin.Context, action string) {
	id, err := uuid.Parse(c.Param("jobId"))
	if err != nil || id == uuid.Nil {
		writeFileJobError(c, jobs.ErrNotFound)
		return
	}
	ctx := c.Request.Context()
	actor := middleware.GetUser(c).ID
	var job jobs.Job
	var artifact jobs.Artifact
	write := action == "cancel" || action == "retry"
	options := pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	if write {
		options = pgx.TxOptions{IsoLevel: pgx.ReadCommitted}
	}
	err = pgx.BeginTxFunc(ctx, db.Pool(), options, func(tx pgx.Tx) error {
		var err error
		job, err = jobs.GetTx(ctx, tx, id, actor)
		if err != nil {
			return err
		}
		if job.Kind != "board_export" && job.Kind != "board_import" {
			return jobs.ErrNotFound
		}
		if job.BoardID != "" {
			if write {
				var locked string
				if err := tx.QueryRow(ctx, "SELECT id FROM rooms WHERE id=$1 FOR UPDATE", job.BoardID).Scan(&locked); err != nil {
					return err
				}
			}
			if err := requireFileJobAccess(c, tx, job.BoardID); err != nil {
				return err
			}
		}
		switch action {
		case "download":
			artifact, err = jobs.GetArtifactTx(ctx, tx, id, actor)
		case "cancel":
			job, err = jobs.CancelTx(ctx, tx, id, actor)
		case "retry":
			job, err = jobs.RetryJobTx(ctx, tx, id, actor)
		}
		return err
	})
	if err != nil {
		writeFileJobError(c, err)
		return
	}
	if action != "download" {
		c.JSON(http.StatusOK, job)
		return
	}
	c.Header("Content-Type", artifact.ContentType)
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": artifact.Filename}))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("ETag", `"`+artifact.SHA256+`"`)
	http.ServeContent(c.Writer, c.Request, artifact.Filename, time.Time{}, bytes.NewReader(artifact.Data))
}

func requireFileJobAccess(c *gin.Context, query interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, boardID string) error {
	access, err := model.QueryRoomAccess(c.Request.Context(), query, boardID, middleware.GetUser(c).ID)
	if err != nil {
		return err
	}
	if !access.IsOwner && !model.RoomPermissionAllowsEdit(access.Permission) {
		return model.ErrRoomAccessDenied
	}
	return nil
}

func writeFileJobError(c *gin.Context, err error) {
	status, code, message := http.StatusInternalServerError, "JOB_UNAVAILABLE", "Could not read or update the job."
	switch {
	case errors.Is(err, jobs.ErrNotFound), errors.Is(err, model.ErrRoomNotFound), errors.Is(err, pgx.ErrNoRows):
		status, code, message = http.StatusNotFound, "JOB_NOT_FOUND", "Job not found."
	case errors.Is(err, model.ErrRoomAccessDenied):
		status, code, message = http.StatusForbidden, "ACCESS_DENIED", "Editing access is required for this export."
	case errors.Is(err, jobs.ErrArtifactUnavailable):
		status, code, message = http.StatusGone, "ARTIFACT_UNAVAILABLE", "The export is unavailable or has expired."
	case errors.Is(err, jobs.ErrConflict):
		status, code, message = http.StatusConflict, "JOB_CONFLICT", "This job cannot be changed in its current state."
	case errors.Is(err, jobs.ErrInvalid):
		status, code, message = http.StatusBadRequest, "INVALID_JOB", "Invalid job request."
	case errors.Is(err, jobs.ErrCapacity):
		status, code, message = http.StatusTooManyRequests, "JOB_CAPACITY", "The job queue is full. Try again later."
	}
	c.JSON(status, gin.H{"code": code, "error": message})
}
