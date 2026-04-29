package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

type UpdateShareSettingsRequest struct {
	LinkPermission string `json:"linkPermission" binding:"required"`
}

type InviteRoomMemberRequest struct {
	Email      string `json:"email" binding:"required,email"`
	Permission string `json:"permission" binding:"required"`
}

func GetShareSettings(c *gin.Context) {
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

	settings, err := model.GetRoomShareSettings(c.Request.Context(), roomID, user.ID)
	if err != nil {
		writeRoomShareError(c, err, "Failed to get share settings")
		return
	}

	c.JSON(http.StatusOK, settings)
}

func UpdateShareSettings(c *gin.Context) {
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

	var req UpdateShareSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	permission, ok := model.NormalizeSharePermission(req.LinkPermission)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid link permission"})
		return
	}

	settings, err := model.UpdateRoomShareSettings(c.Request.Context(), roomID, user.ID, permission)
	if err != nil {
		writeRoomShareError(c, err, "Failed to update share settings")
		return
	}

	c.JSON(http.StatusOK, settings)
}

func InviteRoomMember(c *gin.Context) {
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

	var req InviteRoomMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	permission, ok := model.NormalizeRoomPermission(req.Permission)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid member permission"})
		return
	}

	member, err := model.InviteRoomMemberByEmail(
		c.Request.Context(),
		roomID,
		user.ID,
		strings.ToLower(strings.TrimSpace(req.Email)),
		permission,
	)
	if err != nil {
		writeRoomShareError(c, err, "Failed to invite member")
		return
	}

	c.JSON(http.StatusOK, member)
}

func RemoveRoomMember(c *gin.Context) {
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

	memberID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid member ID"})
		return
	}

	if err := model.RemoveRoomMember(c.Request.Context(), roomID, user.ID, memberID); err != nil {
		writeRoomShareError(c, err, "Failed to remove member")
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func writeRoomShareError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, model.ErrRoomNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Room not found"})
	case errors.Is(err, model.ErrNotRoomOwner):
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the board owner can change sharing"})
	case errors.Is(err, model.ErrRoomAccessDenied):
		c.JSON(http.StatusForbidden, gin.H{"error": "Room access denied"})
	case errors.Is(err, model.ErrUserNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "That user does not have an OpenJam account yet"})
	case errors.Is(err, model.ErrRoomMemberNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Room member not found"})
	case errors.Is(err, model.ErrRoomMemberIsOwner):
		c.JSON(http.StatusBadRequest, gin.H{"error": "The board owner already has full access"})
	case errors.Is(err, model.ErrInvalidRoomPermission), errors.Is(err, model.ErrInvalidSharePermission):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid sharing permission"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": fallback})
	}
}
