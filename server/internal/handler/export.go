package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/storage"
)

type ExportPNGRequest struct {
	ImageData string `json:"imageData" binding:"required"`
}

type ExportJSONRequest struct {
	Operations []interface{} `json:"operations"`
}

func ExportPNG(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	roomID := c.Param("id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Room ID required"})
		return
	}

	var req ExportPNGRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	imageData, err := base64.StdEncoding.DecodeString(req.ImageData)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid image data"})
		return
	}

	filename := fmt.Sprintf("exports/%s/%s-%s.png", roomID, time.Now().Format("2006-01-02"), uuid.New().String()[:8])

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	url, err := storage.UploadFile(ctx, filename, bytes.NewReader(imageData), int64(len(imageData)), "image/png")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload image"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url":      url,
		"filename": filename,
	})
}

func ExportJSON(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	roomID := c.Param("id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Room ID required"})
		return
	}

	operations, err := model.GetOperationsByRoom(c.Request.Context(), roomID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get operations"})
		return
	}

	exportData := map[string]interface{}{
		"roomId":     roomID,
		"exportedAt": time.Now().UTC().Format(time.RFC3339),
		"exportedBy": user.ID,
		"operations": operations,
	}

	jsonData, err := json.MarshalIndent(exportData, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to serialize data"})
		return
	}

	filename := fmt.Sprintf("exports/%s/%s-%s.json", roomID, time.Now().Format("2006-01-02"), uuid.New().String()[:8])

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	url, err := storage.UploadFile(ctx, filename, bytes.NewReader(jsonData), int64(len(jsonData)), "application/json")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url":      url,
		"filename": filename,
	})
}

func GetExport(c *gin.Context) {
	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Export key required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	url, err := storage.GetPresignedURL(ctx, key, 15*time.Minute)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Export not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": url})
}
