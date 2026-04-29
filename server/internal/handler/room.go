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

type UpdateRoomRequest struct {
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

	room, err := model.GetRoom(c.Request.Context(), roomID)
	if err != nil {
		if errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Room not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get room"})
		return
	}

	// Only the room owner can access the room (TODO: expand to room members)
	if room.OwnerID != user.ID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not room owner"})
		return
	}

	c.JSON(http.StatusOK, room)
}

func UpdateRoom(c *gin.Context) {
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

	var req UpdateRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Room name required"})
		return
	}

	room, err := model.UpdateRoom(c.Request.Context(), roomID, name, user.ID)
	if err != nil {
		if errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Room not found"})
			return
		}
		if errors.Is(err, model.ErrNotRoomOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Not room owner"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update room"})
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

const maxBoardPayloadBytes = 25 * 1024 * 1024

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

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBoardPayloadBytes)

	var req SaveBoardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Board payload is too large"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Untitled Board"
	}

	_, err := model.EnsureRoomOwned(c.Request.Context(), roomID, name, user.ID)
	if err != nil {
		if errors.Is(err, model.ErrNotRoomOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Not room owner"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to ensure room exists"})
		return
	}

	elements := req.Elements
	if elements == nil {
		elements = []interface{}{}
	}

	boardData := &model.BoardData{
		Name:          name,
		Elements:      elements,
		Stamps:        req.Stamps,
		Pages:         req.Pages,
		CurrentPageId: req.CurrentPageId,
	}

	if err := model.SaveBoardDataForOwner(c.Request.Context(), roomID, user.ID, boardData); err != nil {
		if errors.Is(err, model.ErrNotRoomOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Not room owner"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save board"})
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

	data, err := model.LoadBoardDataForOwner(c.Request.Context(), roomID, user.ID)
	if err != nil {
		if errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusOK, gin.H{
				"name":     "Untitled Board",
				"elements": []interface{}{},
			})
			return
		}
		if errors.Is(err, model.ErrNotRoomOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Not room owner"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load board"})
		return
	}

	c.JSON(http.StatusOK, data)
}
