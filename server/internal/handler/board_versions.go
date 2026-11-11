package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/middleware"
)

const maxVersionRequestBytes = 16 * 1024

func RegisterBoardVersionRoutes(boards *gin.RouterGroup, notify func(string, int64, int64)) {
	versions := boards.Group("/versions")
	versions.GET("", listBoardVersions)
	versions.POST("", nameBoardVersion)
	versions.GET("/:versionId", previewBoardVersion)
	versions.POST("/:versionId/restore", func(c *gin.Context) { restoreBoardVersion(c, notify) })
	versions.POST("/:versionId/copy", copyBoardVersion)
}

func listBoardVersions(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if err != nil || limit < 1 || limit > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CURSOR", "error": "Invalid version list limit"})
		return
	}
	var before *uuid.UUID
	if cursor := c.Query("before"); cursor != "" {
		id, ok := parseVersionID(c, cursor)
		if !ok {
			return
		}
		before = &id
	}
	versions, err := document.ListVersions(c.Request.Context(), boardID, middleware.GetUser(c).ID, before, limit)
	if err != nil {
		writeBoardVersionError(c, err)
		return
	}
	c.JSON(http.StatusOK, versions)
}

type versionHeadRequest struct {
	ExpectedEpoch *int64 `json:"expectedEpoch"`
	ExpectedSeq   *int64 `json:"expectedSeq"`
}

func (request versionHeadRequest) position(c *gin.Context) (document.VersionPosition, bool) {
	if request.ExpectedEpoch == nil || request.ExpectedSeq == nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_COMMAND", "error": "Expected epoch and sequence are required"})
		return document.VersionPosition{}, false
	}
	return document.VersionPosition{ExpectedEpoch: *request.ExpectedEpoch, ExpectedSeq: *request.ExpectedSeq}, true
}

func nameBoardVersion(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	var request struct {
		versionHeadRequest
		Name string `json:"name"`
	}
	if !readVersionRequest(c, &request) {
		return
	}
	position, ok := request.position(c)
	if !ok {
		return
	}
	version, err := document.NameVersion(c.Request.Context(), boardID, middleware.GetUser(c).ID, request.Name, position)
	if err != nil {
		writeBoardVersionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, version)
}

func previewBoardVersion(c *gin.Context) {
	boardID, versionID, ok := readVersionTarget(c)
	if !ok {
		return
	}
	preview, err := document.PreviewVersion(c.Request.Context(), boardID, middleware.GetUser(c).ID, versionID)
	if err != nil {
		writeBoardVersionError(c, err)
		return
	}
	c.JSON(http.StatusOK, preview)
}

func restoreBoardVersion(c *gin.Context, notify func(string, int64, int64)) {
	boardID, versionID, ok := readVersionTarget(c)
	if !ok {
		return
	}
	var request struct {
		versionHeadRequest
		RequestID string `json:"requestId"`
	}
	if !readVersionRequest(c, &request) {
		return
	}
	position, ok := request.position(c)
	if !ok {
		return
	}
	requestID, err := uuid.Parse(request.RequestID)
	if err != nil || requestID == uuid.Nil || requestID.String() != request.RequestID {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_COMMAND", "error": "A canonical restore request ID is required"})
		return
	}
	restored, err := document.RestoreVersion(c.Request.Context(), boardID, middleware.GetUser(c).ID, versionID, requestID, position)
	if err != nil {
		writeBoardVersionError(c, err)
		return
	}
	if notify != nil {
		notify(restored.BoardID, restored.Epoch, restored.Seq)
	}
	c.JSON(http.StatusOK, restored)
}

func copyBoardVersion(c *gin.Context) {
	boardID, versionID, ok := readVersionTarget(c)
	if !ok {
		return
	}
	var request struct {
		Name string `json:"name"`
	}
	if !readVersionRequest(c, &request) {
		return
	}
	copied, err := document.CopyVersion(c.Request.Context(), boardID, middleware.GetUser(c).ID, versionID, request.Name)
	if err != nil {
		writeBoardVersionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, copied)
}

func readVersionTarget(c *gin.Context) (string, uuid.UUID, bool) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return "", uuid.Nil, false
	}
	id, ok := parseVersionID(c, c.Param("versionId"))
	return boardID, id, ok
}

func parseVersionID(c *gin.Context, raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_VERSION_ID", "error": "Invalid version ID"})
		return uuid.Nil, false
	}
	return id, true
}

func readVersionRequest(c *gin.Context, request any) bool {
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || contentType != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"code": "INVALID_COMMAND", "error": "Expected an application/json version request"})
		return false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxVersionRequestBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var trailing json.RawMessage
	err = decoder.Decode(request)
	if err == nil {
		err = decoder.Decode(&trailing)
		if errors.Is(err, io.EOF) {
			return true
		}
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "COMMAND_TOO_LARGE", "error": "Version request is too large"})
		return false
	}
	c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_COMMAND", "error": "Invalid version request"})
	return false
}

func writeBoardVersionError(c *gin.Context, err error) {
	if errors.Is(err, document.ErrVersionNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"code": "VERSION_NOT_FOUND", "error": "Board version not found"})
		return
	}
	writeDocumentError(c, err)
}
