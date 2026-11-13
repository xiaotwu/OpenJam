package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/middleware"
	"github.com/xiaotwu/shiori/server/internal/model"
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

	rooms, err := model.GetRoomsAccessibleByUser(c.Request.Context(), user.ID)
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

	access, err := model.GetRoomAccess(c.Request.Context(), roomID, user.ID)
	if err != nil {
		if errors.Is(err, model.ErrRoomAccessDenied) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Room access denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify room access"})
		return
	}
	if access.IsOwner {
		room.Permission = "owner"
	} else {
		room.Permission = string(access.Permission)
	}

	c.JSON(http.StatusOK, room)
}

func UpdateRoom(c *gin.Context, notify func(string, int64, int64)) {
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

	ctx := c.Request.Context()
	ack, err := document.RenameOwned(ctx, roomID, user.ID, name)
	var room *model.Room
	if errors.Is(err, document.ErrLegacyMode) {
		room, err = model.UpdateRoom(ctx, roomID, name, user.ID)
		if document.LegacyWriteFenced(err) {
			// A V2 editor may have activated the board while we took the
			// legacy branch. Retry through the authoritative command path.
			ack, err = document.RenameOwned(ctx, roomID, user.ID, name)
		}
	}
	if err == nil && room == nil {
		notify(ack.BoardID, ack.Epoch, ack.Seq)
		room, err = model.GetRoom(ctx, roomID)
	}
	if err != nil {
		if rejectLegacyWrite(c, err) {
			return
		}
		if errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Room not found"})
			return
		}
		if errors.Is(err, model.ErrNotRoomOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Not room owner"})
			return
		}
		writeDocumentError(c, err)
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
	Name              string      `json:"name"`
	Elements          interface{} `json:"elements"`
	Stamps            interface{} `json:"stamps,omitempty"`
	Pages             interface{} `json:"pages,omitempty"`
	CurrentPageId     string      `json:"currentPageId,omitempty"`
	ExpectedUpdatedAt *time.Time  `json:"expectedUpdatedAt,omitempty"`
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

	// A room must already exist before a board can be saved into it. Auto-creating
	// a room on first save would let any authenticated user claim an arbitrary room
	// UUID (including one that collides with a room another user is about to make),
	// silently becoming its owner. Rooms are created via POST /api/rooms.
	if _, err := model.GetRoom(c.Request.Context(), roomID); err != nil {
		if errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Room not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load room"})
		return
	}
	if err := model.UserCanEditRoom(c.Request.Context(), roomID, user.ID); err != nil {
		if errors.Is(err, model.ErrRoomAccessDenied) || errors.Is(err, model.ErrNotRoomOwner) || errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Room edit access denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify room access"})
		return
	}

	elements := req.Elements
	if elements == nil {
		elements = []interface{}{}
	}

	// Validate structural integrity before persisting.
	if _, err := model.ValidateElements(elements); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid board elements: " + err.Error()})
		return
	}
	if err := model.ValidateStamps(req.Stamps); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid stamps: " + err.Error()})
		return
	}
	if err := model.ValidatePages(req.Pages); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid pages: " + err.Error()})
		return
	}

	boardData := &model.BoardData{
		Name:          name,
		Elements:      elements,
		Stamps:        req.Stamps,
		Pages:         req.Pages,
		CurrentPageId: req.CurrentPageId,
	}

	expected := time.Time{}
	if req.ExpectedUpdatedAt != nil {
		expected = *req.ExpectedUpdatedAt
	}

	newUpdatedAt, err := model.SaveBoardDataForEditorWithVersion(c.Request.Context(), roomID, user.ID, boardData, expected)
	if err != nil {
		if rejectLegacyWrite(c, err) {
			return
		}
		if errors.Is(err, model.ErrRoomAccessDenied) || errors.Is(err, model.ErrNotRoomOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Room edit access denied"})
			return
		}
		if errors.Is(err, model.ErrBoardConflict) {
			if active, _ := document.IsActive(c.Request.Context(), roomID); active {
				writeLegacyUpgrade(c)
				return
			}
			current, lerr := model.LoadBoardDataForUser(c.Request.Context(), roomID, user.ID)
			if lerr != nil {
				c.JSON(http.StatusConflict, gin.H{"error": "Board was modified by someone else; reload to merge"})
				return
			}
			c.JSON(http.StatusConflict, gin.H{
				"error":    "Board was modified by someone else; reload to merge",
				"conflict": true,
				"board":    current,
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save board"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"savedAt":   newUpdatedAt.Format(time.RFC3339Nano),
		"updatedAt": newUpdatedAt.Format(time.RFC3339Nano),
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

	ctx := c.Request.Context()
	snapshot, err := document.Open(ctx, roomID, user.ID, false)
	if err == nil {
		c.JSON(http.StatusOK, model.BoardData{
			Name:          snapshot.Document.Name,
			Elements:      snapshot.Document.Elements,
			Stamps:        snapshot.Document.Stamps,
			Pages:         snapshot.Document.Pages,
			CurrentPageId: snapshot.Document.DefaultPageID,
			UpdatedAt:     snapshot.UpdatedAt,
		})
		return
	}
	if !errors.Is(err, document.ErrLegacyMode) {
		writeDocumentError(c, err)
		return
	}
	data, err := model.LoadBoardDataForUser(ctx, roomID, user.ID)
	if err != nil {
		if errors.Is(err, model.ErrRoomNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Board not found"})
			return
		}
		if errors.Is(err, model.ErrRoomAccessDenied) || errors.Is(err, model.ErrNotRoomOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Room access denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load board"})
		return
	}

	c.JSON(http.StatusOK, data)
}
