package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

func RegisterBoardAssetRoutes(api *gin.RouterGroup) {
	boards := documentBoardRoutes(api)
	boards.POST("/assets", uploadBoardImage)
	boards.GET("/assets/:assetId", getBoardImage)
	boards.HEAD("/assets/:assetId", getBoardImage)
}

// Limit concurrent upload bodies and decoders independently of per-user
// request limits, since decoded images can occupy much more than their uploads.
var boardImageUploads = make(chan struct{}, 4)

func uploadBoardImage(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	deadline := time.Now().Add(40 * time.Second)
	ctx, cancel := context.WithDeadline(c.Request.Context(), deadline)
	defer cancel()
	actor := middleware.GetUser(c).ID
	if err := model.UserCanEditRoom(ctx, boardID, actor); err != nil {
		writeDocumentError(c, err)
		return
	}
	if c.Request.ContentLength > assets.MaxImageBytes {
		writeBoardAssetError(c, assets.ErrTooLarge)
		return
	}
	select {
	case boardImageUploads <- struct{}{}:
		defer func() { <-boardImageUploads }()
	default:
		c.Header("Retry-After", "2")
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "ASSET_UPLOAD_BUSY", "error": "Image uploads are busy. Try again shortly."})
		return
	}
	body := http.MaxBytesReader(c.Writer, c.Request.Body, assets.MaxImageBytes)
	defer body.Close()
	controller := http.NewResponseController(c.Writer)
	_ = controller.SetReadDeadline(deadline)
	data, err := io.ReadAll(body)
	_ = controller.SetReadDeadline(time.Time{})
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeBoardAssetError(c, assets.ErrTooLarge)
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_UPLOAD", "error": "Could not read the image upload"})
		return
	}
	meta, err := assets.Upload(ctx, boardID, actor, data, c.GetHeader("Content-Type"))
	if err != nil {
		writeBoardAssetError(c, err)
		return
	}
	c.JSON(http.StatusCreated, meta)
}

func getBoardImage(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	deadline := time.Now().Add(30 * time.Second)
	ctx, cancel := context.WithDeadline(c.Request.Context(), deadline)
	defer cancel()
	meta, content, err := assets.Get(ctx, boardID, middleware.GetUser(c).ID, c.Param("assetId"))
	if err != nil {
		writeBoardAssetError(c, err)
		return
	}
	defer content.Close()
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Type", meta.MIMEType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
	c.Header("ETag", `"`+meta.ID+`"`)
	controller := http.NewResponseController(c.Writer)
	_ = controller.SetWriteDeadline(deadline)
	defer func() { _ = controller.SetWriteDeadline(time.Time{}) }()
	http.ServeContent(c.Writer, c.Request, "", time.Time{}, content)
}

func copyCurrentBoard(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	var request struct {
		Name string `json:"name"`
	}
	if !readVersionRequest(c, &request) {
		return
	}
	copied, err := document.CopyCurrent(c.Request.Context(), boardID, middleware.GetUser(c).ID, request.Name)
	if err != nil {
		writeBoardAssetError(c, err)
		return
	}
	c.JSON(http.StatusCreated, copied)
}

func writeBoardAssetError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, assets.ErrInvalidReference):
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ASSET_ID", "error": "Invalid image asset ID"})
	case errors.Is(err, assets.ErrInvalidImage):
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"code": "INVALID_IMAGE", "error": "Choose a valid static PNG, JPEG, GIF or WebP image"})
	case errors.Is(err, assets.ErrTooLarge):
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "IMAGE_TOO_LARGE", "error": "Images are limited to 8 MiB, 8192 pixels per side and 16 megapixels"})
	case errors.Is(err, assets.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"code": "ASSET_NOT_FOUND", "error": "Image asset not found on this board"})
	case errors.Is(err, assets.ErrQuota):
		c.JSON(http.StatusConflict, gin.H{"code": "ASSET_QUOTA", "error": "This board has reached its image storage limit"})
	case errors.Is(err, assets.ErrUnavailable), errors.Is(err, assets.ErrStagingFull):
		_ = c.Error(err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "ASSET_STORAGE_UNAVAILABLE", "error": "Private image storage is temporarily unavailable"})
	default:
		writeDocumentError(c, err)
	}
}
