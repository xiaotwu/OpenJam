package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/middleware"
)

func RegisterProjectSyncRoutes(api *gin.RouterGroup, notify func(string, int64, int64)) {
	project := api.Group("/v2/projects/:projectId", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	})
	route := func(run func(*gin.Context, uuid.UUID, uuid.UUID)) gin.HandlerFunc {
		return func(c *gin.Context) {
			id, ok := readDirectoryID(c, c.Param("projectId"))
			if ok {
				run(c, middleware.GetUser(c).ID, id)
			}
		}
	}
	project.POST("/import", route(func(c *gin.Context, actor, id uuid.UUID) {
		var input document.ProjectImport
		if readDirectoryBody(c, &input) {
			result, err := document.ImportProject(c.Request.Context(), actor, id, input)
			writeProjectResult(c, http.StatusCreated, result, err)
		}
	}))
	project.GET("/sync", route(func(c *gin.Context, actor, id uuid.UUID) {
		links, err := document.ListProjectLinks(c.Request.Context(), actor, id)
		writeProjectResult(c, http.StatusOK, gin.H{"links": links}, err)
	}))
	project.GET("/sync/:peerId", route(func(c *gin.Context, actor, id uuid.UUID) {
		if peer, ok := readDirectoryID(c, c.Param("peerId")); ok {
			preview, err := document.PreviewProjectSync(c.Request.Context(), actor, id, peer)
			writeProjectResult(c, http.StatusOK, preview, err)
		}
	}))
	project.POST("/sync/:peerId", route(func(c *gin.Context, actor, id uuid.UUID) {
		peer, ok := readDirectoryID(c, c.Param("peerId"))
		var input document.ProjectSyncRequest
		if ok && readDirectoryBody(c, &input) {
			result, err := document.SyncProject(c.Request.Context(), actor, id, peer, input)
			notifyProjectDocuments(notify, result, err)
			writeProjectResult(c, http.StatusOK, result, err)
		}
	}))
	project.GET("/versions", route(func(c *gin.Context, actor, id uuid.UUID) {
		var before *uuid.UUID
		if raw := c.Query("before"); raw != "" {
			value, ok := readDirectoryID(c, raw)
			if !ok {
				return
			}
			before = &value
		}
		result, err := document.ListProjectVersions(c.Request.Context(), actor, id, before)
		writeProjectResult(c, http.StatusOK, result, err)
	}))
	project.POST("/versions", route(func(c *gin.Context, actor, id uuid.UUID) {
		var input document.ProjectVersionRequest
		if readDirectoryBody(c, &input) {
			result, err := document.NameProjectVersion(c.Request.Context(), actor, id, input)
			writeProjectResult(c, http.StatusCreated, result, err)
		}
	}))
	project.GET("/versions/:versionId/restore", route(func(c *gin.Context, actor, id uuid.UUID) {
		if version, ok := readDirectoryID(c, c.Param("versionId")); ok {
			preview, err := document.PreviewProjectRestore(c.Request.Context(), actor, id, version)
			writeProjectResult(c, http.StatusOK, preview, err)
		}
	}))
	project.POST("/versions/:versionId/restore", route(func(c *gin.Context, actor, id uuid.UUID) {
		version, ok := readDirectoryID(c, c.Param("versionId"))
		var input document.ProjectRestoreRequest
		if ok && readDirectoryBody(c, &input) {
			result, err := document.RestoreProjectVersion(c.Request.Context(), actor, id, version, input)
			notifyProjectDocuments(notify, result, err)
			writeProjectResult(c, http.StatusOK, result, err)
		}
	}))
}

func notifyProjectDocuments(notify func(string, int64, int64), result document.ProjectAction, err error) {
	if err == nil && notify != nil {
		for _, file := range result.Updates {
			notify(file.BoardID, file.Epoch, file.Seq)
		}
	}
}

func writeProjectResult(c *gin.Context, status int, result any, err error) {
	var fault *document.ProjectFault
	switch {
	case errors.As(err, &fault):
		status := http.StatusConflict
		if fault.Code == "PROJECT_INPUT" {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"code": fault.Code, "error": fault.Message})
	case errors.Is(err, document.ErrProjectTooLarge):
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "PROJECT_LIMIT", "error": err.Error()})
	case errors.Is(err, assets.ErrQuota):
		c.JSON(http.StatusConflict, gin.H{"code": "PROJECT_IMAGE_LIMIT", "error": "A destination file has reached its private image limit."})
	case errors.Is(err, assets.ErrNotFound), errors.Is(err, assets.ErrInvalidReference), errors.Is(err, document.ErrMigrationBlocked):
		c.JSON(http.StatusConflict, gin.H{"code": "PROJECT_FILE_UNAVAILABLE", "error": "A project file or one of its images could not be read. Review the files and try again."})
	default:
		writeDirectoryResult(c, status, result, err)
	}
}
