package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/xiaotwu/shiori/server/internal/assets"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/middleware"
)

const archiveOptionsLimit = 160 << 10

func RegisterProjectArchiveRoutes(api *gin.RouterGroup) {
	// Bound compressed and expanded data in flight across all archive actions.
	slots := make(chan struct{}, 1)
	archive := api.Group("/v2", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			c.Header("Retry-After", "5")
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": "PROJECT_ARCHIVE_BUSY", "error": "Another project archive is running. Try again in a moment."})
			return
		}
		deadline := time.Now().Add(2 * time.Minute)
		ctx, cancel := context.WithDeadline(c.Request.Context(), deadline)
		defer cancel()
		controller := http.NewResponseController(c.Writer)
		_ = controller.SetReadDeadline(deadline)
		_ = controller.SetWriteDeadline(deadline)
		defer func() {
			_ = controller.SetReadDeadline(time.Time{})
			_ = controller.SetWriteDeadline(time.Time{})
		}()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	})

	archive.GET("/projects/:projectId/archive", func(c *gin.Context) {
		id, ok := readDirectoryID(c, c.Param("projectId"))
		if !ok {
			return
		}
		name, data, err := document.ExportProjectArchive(c.Request.Context(), middleware.GetUser(c).ID, id, c.Query("origin"))
		if err != nil {
			writeArchiveError(c, err)
			return
		}
		name = strings.Trim(strings.Map(func(r rune) rune {
			if unicode.IsControl(r) || strings.ContainsRune("/\\:*?\"<>|", r) {
				return '-'
			}
			return r
		}, name), " .")
		if name == "" {
			name = "Shiori"
		}
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name + ".shiori-project.zip"}))
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(http.StatusOK, "application/zip", data)
	})
	archive.POST("/project-archives/inspect", func(c *gin.Context) {
		if contentType, _, _ := mime.ParseMediaType(c.GetHeader("Content-Type")); contentType != "application/zip" {
			writeArchiveError(c, document.ErrProjectArchiveInvalid)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, document.ProjectArchiveMaxZIP)
		data, err := readArchiveBody(c.Request.Body, document.ProjectArchiveMaxZIP)
		if err != nil {
			writeArchiveError(c, err)
			return
		}
		info, err := document.InspectProjectArchive(data)
		if err != nil {
			writeArchiveError(c, err)
			return
		}
		c.JSON(http.StatusOK, info)
	})
	archive.POST("/workspaces/:workspaceId/project-archives", func(c *gin.Context) {
		workspace, ok := readDirectoryID(c, c.Param("workspaceId"))
		if !ok {
			return
		}
		actor := middleware.GetUser(c).ID
		if err := document.ArchiveRestoreAllowed(c.Request.Context(), actor, workspace); err != nil {
			writeArchiveError(c, err)
			return
		}
		input, data, err := readProjectRestore(c)
		if err != nil {
			writeArchiveError(c, err)
			return
		}
		project, err := document.RestoreProjectArchive(c.Request.Context(), actor, workspace, data, input)
		if err != nil {
			writeArchiveError(c, err)
			return
		}
		c.JSON(http.StatusCreated, project)
	})
}

func readArchiveBody(body io.Reader, limit int) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(body, int64(limit)+1))
	var tooLarge *http.MaxBytesError
	var timeout net.Error
	switch {
	case len(raw) > limit || errors.As(err, &tooLarge):
		return nil, document.ErrProjectArchiveLimit
	case errors.As(err, &timeout) && timeout.Timeout():
		return nil, context.DeadlineExceeded
	case err != nil:
		return nil, document.ErrProjectArchiveInvalid
	default:
		return raw, nil
	}
}

func readProjectRestore(c *gin.Context) (document.ProjectArchiveRestore, []byte, error) {
	var input document.ProjectArchiveRestore
	var raw []byte
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, document.ProjectArchiveMaxZIP+archiveOptionsLimit+16384)
	reader, err := c.Request.MultipartReader()
	if err != nil {
		return input, nil, document.ErrProjectArchiveInvalid
	}
	seenOptions := false
	for range 3 {
		part, err := reader.NextPart()
		var tooLarge *http.MaxBytesError
		switch {
		case err == io.EOF:
			if seenOptions && len(raw) != 0 {
				return input, raw, nil
			}
			return input, nil, document.ErrProjectArchiveInvalid
		case errors.As(err, &tooLarge):
			return input, nil, document.ErrProjectArchiveLimit
		case err != nil:
			return input, nil, document.ErrProjectArchiveInvalid
		}
		switch part.FormName() {
		case "options":
			if seenOptions {
				return input, nil, document.ErrProjectArchiveInvalid
			}
			seenOptions = true
			options, err := readArchiveBody(part, archiveOptionsLimit)
			if err != nil {
				return input, nil, err
			}
			decoder := json.NewDecoder(bytes.NewReader(options))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
				return input, nil, document.ErrProjectArchiveInvalid
			}
		case "archive":
			if raw != nil {
				return input, nil, document.ErrProjectArchiveInvalid
			}
			raw, err = readArchiveBody(part, document.ProjectArchiveMaxZIP)
			if err != nil {
				return input, nil, err
			}
		default:
			return input, nil, document.ErrProjectArchiveInvalid
		}
	}
	return input, nil, document.ErrProjectArchiveInvalid
}

func writeArchiveError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, document.ErrProjectArchiveLimit), errors.Is(err, document.ErrProjectTooLarge):
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "PROJECT_ARCHIVE_LIMIT", "error": err.Error()})
	case errors.Is(err, document.ErrProjectArchiveInvalid), errors.Is(err, assets.ErrInvalidImage), errors.Is(err, assets.ErrTooLarge):
		c.JSON(http.StatusBadRequest, gin.H{"code": "PROJECT_ARCHIVE_INVALID", "error": err.Error()})
	case errors.Is(err, assets.ErrUnavailable), errors.Is(err, assets.ErrStagingFull):
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "PROJECT_ARCHIVE_STORAGE", "error": "Private image storage is unavailable or busy. Try again later."})
	case errors.Is(err, context.DeadlineExceeded):
		c.JSON(http.StatusGatewayTimeout, gin.H{"code": "PROJECT_ARCHIVE_TIMEOUT", "error": "The project archive took too long. Try again."})
	default:
		writeProjectResult(c, http.StatusOK, nil, err)
	}
}
