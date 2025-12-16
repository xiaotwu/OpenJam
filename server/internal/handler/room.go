package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

type CreateRoomRequest struct {
	Name string `json:"name" binding:"required,min=1"`
}

func CreateRoom(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	var req CreateRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)

	room, err := model.CreateRoom(c.Request.Context(), name, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create room"})
		return
	}

	c.JSON(http.StatusOK, room)
}

func ListRooms(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	rooms, err := model.GetRoomsByOwner(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list rooms"})
		return
	}

	if rooms == nil {
		rooms = []*model.Room{}
	}

	c.JSON(http.StatusOK, gin.H{"rooms": rooms})
}

func GetRoom(c *gin.Context) {
	roomID := c.Param("id")
	if roomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Room ID required"})
		return
	}

	room, err := model.GetRoom(c.Request.Context(), roomID)
	if err != nil {
		if errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Room not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get room"})
		return
	}

	c.JSON(http.StatusOK, room)
}

func DeleteRoom(c *gin.Context) {
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

	err := model.DeleteRoom(c.Request.Context(), roomID, user.ID)
	if err != nil {
		if errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Room not found"})
			return
		}
		if errors.Is(err, model.ErrNotRoomOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Not room owner"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete room"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type SaveBoardRequest struct {
	Name          string      `json:"name"`
	Elements      interface{} `json:"elements"`
	Stamps        interface{} `json:"stamps,omitempty"`
	Pages         interface{} `json:"pages,omitempty"`
	CurrentPageId string      `json:"currentPageId,omitempty"`
}

func SaveBoard(c *gin.Context) {
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

	var req SaveBoardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	_, err := model.EnsureRoom(c.Request.Context(), roomID, req.Name, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to ensure room exists: " + err.Error()})
		return
	}

	boardData := &model.BoardData{
		Name:          req.Name,
		Elements:      req.Elements,
		Stamps:        req.Stamps,
		Pages:         req.Pages,
		CurrentPageId: req.CurrentPageId,
	}

	if err := model.SaveBoardData(c.Request.Context(), roomID, boardData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save board: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"savedAt": time.Now().Format(time.RFC3339),
	})
}

func LoadBoard(c *gin.Context) {
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

	data, err := model.LoadBoardData(c.Request.Context(), roomID)
	if err != nil {
		if errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusOK, gin.H{
				"name":     "Untitled Board",
				"elements": []interface{}{},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load board"})
		return
	}

	c.JSON(http.StatusOK, data)
}
