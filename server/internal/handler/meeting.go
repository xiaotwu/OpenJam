package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/meetings"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

func registerMeetingRoutes(workshop *gin.RouterGroup, media *meetings.Media) {
	group := workshop.Group("/meetings")
	group.GET("/:id", func(c *gin.Context) {
		id, ok := readDirectoryID(c, c.Param("id"))
		if !ok {
			return
		}
		item, err := model.ReadMeeting(c.Request.Context(), middleware.GetUser(c).ID, id)
		writeWorkshopResult(c, http.StatusOK, gin.H{"meeting": item, "mediaEnabled": media != nil}, err)
	})
	group.PUT("/:id", func(c *gin.Context) {
		id, ok := readDirectoryID(c, c.Param("id"))
		var input model.MeetingDraft
		if !ok {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		if err := c.ShouldBindJSON(&input); err != nil {
			writeWorkshopResult(c, 0, nil, model.ErrWorkshopInput)
			return
		}
		err := model.CreateMeeting(c.Request.Context(), middleware.GetUser(c).ID, id, input)
		writeWorkshopResult(c, http.StatusOK, gin.H{"id": id}, err)
	})
	group.PUT("/:id/end", func(c *gin.Context) {
		id, ok := readDirectoryID(c, c.Param("id"))
		if !ok {
			return
		}
		err := model.EndMeeting(c.Request.Context(), middleware.GetUser(c).ID, id)
		writeWorkshopResult(c, http.StatusOK, gin.H{"ok": true}, err)
	})
	group.PUT("/:id/read", func(c *gin.Context) {
		id, ok := readDirectoryID(c, c.Param("id"))
		if !ok {
			return
		}
		err := model.MarkMeetingRead(c.Request.Context(), middleware.GetUser(c).ID, id)
		writeWorkshopResult(c, http.StatusOK, gin.H{"ok": true}, err)
	})
}

func RegisterMeetingSignal(r *gin.Engine, media *meetings.Media, limiter *middleware.RateLimiter, draining func() bool) {
	group := r.Group("/ws/meetings", middleware.DocumentAuthRequired(), middleware.RateLimitUser(limiter))
	// Forward only the versioned LiveKit join and validation endpoints.
	for _, path := range []string{"/rtc", "/rtc/v1", "/rtc/validate", "/rtc/v1/validate"} {
		group.GET("/:id"+path, func(c *gin.Context) {
			c.Header("Cache-Control", "no-store")
			id, ok := readDirectoryID(c, c.Param("id"))
			if !ok {
				return
			}
			if media == nil || draining() {
				c.String(http.StatusServiceUnavailable, "Meeting media is unavailable.")
				return
			}
			if !strings.HasSuffix(path, "/validate") && !strings.EqualFold(c.GetHeader("Upgrade"), "websocket") {
				c.Status(http.StatusUpgradeRequired)
				return
			}
			identity := middleware.GetSession(c).MeetingIdentity
			ctx, cancel := context.WithTimeout(c.Request.Context(), time.Second)
			open, allowed, err := model.MeetingParticipants(ctx, id, []uuid.UUID{identity})
			cancel()
			if err != nil {
				c.String(http.StatusServiceUnavailable, "Meeting permissions are unavailable.")
				return
			}
			if !open || len(allowed) == 0 {
				c.String(http.StatusForbidden, "You cannot join this meeting.")
				return
			}
			media.ServeSignal(c.Writer, c.Request, path, id, identity, middleware.GetUser(c).DisplayName)
		})
	}
}
