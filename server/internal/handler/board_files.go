package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/boardfiles"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/jobs"
	"github.com/project-wb/server/internal/middleware"
)

func RegisterBoardFileRoutes(boards *gin.RouterGroup) {
	boards.POST("/files/export", queueBoardExport)
	boards.GET("/thumbnail", boardThumbnail)
}

func RegisterBoardImportRoutes(api *gin.RouterGroup) {
	api.POST("/v2/board-imports", queueBoardImport)
}

func queueBoardExport(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"code": "INVALID_EXPORT", "error": "Expected a JSON export request"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var request boardfiles.ExportRequest
	if err := decoder.Decode(&request); err != nil {
		writeFileRequestDecodeError(c, err)
		return
	}
	if err := decoder.Decode(new(json.RawMessage)); !errors.Is(err, io.EOF) {
		writeFileRequestDecodeError(c, err)
		return
	}
	job, err := boardfiles.EnqueueExport(c.Request.Context(), boardID, middleware.GetUser(c).ID, request)
	if err != nil {
		writeBoardFileError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, job)
}

func queueBoardImport(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	requestHeader := c.GetHeader("Idempotency-Key")
	requestID, err := uuid.Parse(requestHeader)
	if err != nil || requestID == uuid.Nil || requestID.String() != requestHeader {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST_ID", "error": "Provide a canonical UUID in the Idempotency-Key header"})
		return
	}
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || (mediaType != "application/json" && mediaType != "application/zip") {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"code": "INVALID_BOARD_FILE", "error": "Upload an OpenJam JSON or ZIP file"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, boardfiles.MaxPackageBytes)
	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		writeFileRequestDecodeError(c, err)
		return
	}
	job, err := boardfiles.EnqueueImport(c.Request.Context(), middleware.GetUser(c).ID, requestID, data, mediaType)
	if err != nil {
		writeBoardFileError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, job)
}

func boardThumbnail(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	result, err := boardfiles.GetThumbnail(c.Request.Context(), boardID, middleware.GetUser(c).ID, c.Query("theme"))
	switch {
	case errors.Is(err, document.ErrLegacyMode), errors.Is(err, document.ErrPortableTooLarge):
		c.Status(http.StatusNoContent)
	case err != nil:
		writeBoardFileError(c, err)
	case result.Pending:
		c.Header("Retry-After", "2")
		c.JSON(http.StatusAccepted, gin.H{"status": "pending"})
	case len(result.Artifact.Data) > 0:
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(http.StatusOK, "image/png", result.Artifact.Data)
	default:
		c.Status(http.StatusNoContent)
	}
}

func writeFileRequestDecodeError(c *gin.Context, err error) {
	var limit *http.MaxBytesError
	if errors.As(err, &limit) {
		writeBoardFileError(c, boardfiles.ErrTooLarge)
		return
	}
	c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_FILE_REQUEST", "error": "Invalid board file request"})
}

func writeBoardFileError(c *gin.Context, err error) {
	status, code, message := http.StatusBadRequest, "", ""
	switch {
	case errors.Is(err, boardfiles.ErrInvalidScope):
		code, message = "INVALID_EXPORT_SCOPE", "Choose a board, page or selection to export"
	case errors.Is(err, boardfiles.ErrInvalidTheme):
		code, message = "INVALID_RENDER_THEME", "Choose a light or dark render theme"
	case errors.Is(err, boardfiles.ErrEmptySelection):
		status, code, message = http.StatusConflict, "SELECTION_CHANGED", "Choose the objects to export again"
	case errors.Is(err, boardfiles.ErrTooLarge), errors.Is(err, document.ErrPortableTooLarge):
		status, code, message = http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "The file is too large. Export a page or smaller selection"
	case errors.Is(err, boardfiles.ErrInvalidFile), errors.Is(err, jobs.ErrInvalid):
		code, message = "INVALID_BOARD_FILE", "Invalid OpenJam board file"
	case errors.Is(err, jobs.ErrConflict):
		status, code, message = http.StatusConflict, "IDEMPOTENCY_CONFLICT", "This request ID was already used with different contents"
	case errors.Is(err, jobs.ErrCapacity):
		status, code, message = http.StatusTooManyRequests, "JOB_CAPACITY", "The job queue is full. Try again after pending jobs complete"
	default:
		writeDocumentError(c, err)
		return
	}
	c.JSON(status, gin.H{"code": code, "error": message})
}
