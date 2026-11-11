package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

func RegisterWorkshopRoutes(api *gin.RouterGroup) {
	routes := api.Group("/v2/workshop", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		c.Next()
	})
	routes.GET("/search", searchWorkshop)
	routes.GET("/teams/:teamId/graph", readWorkshopGraph)
	routes.GET("/inbox", readWorkshopInbox)
	routes.POST("/threads", startWorkshopThread)
	routes.GET("/threads/:id", readWorkshopThread)
	routes.POST("/threads/:id/replies", replyWorkshopThread)
	routes.PUT("/threads/:id/state", setWorkshopThreadState)
	routes.GET("/agenda", listWorkshopAgenda)
	routes.PUT("/agenda/:id", saveWorkshopAgenda)
	routes.DELETE("/agenda/:id", deleteWorkshopAgenda)
	routes.GET("/recents", listWorkshopRecents)
	routes.PUT("/recents/:id", recordWorkshopRecent)
}

func searchWorkshop(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	if query == "" || utf8.RuneCountInString(query) > 120 || strings.ContainsRune(query, 0) {
		writeWorkshopResult(c, 200, nil, model.ErrWorkshopInput)
		return
	}
	var team *uuid.UUID
	if raw := c.Query("team"); raw != "" {
		id, ok := readDirectoryID(c, raw)
		if !ok {
			return
		}
		team = &id
	}
	results, err := model.SearchWorkshop(c.Request.Context(), middleware.GetUser(c).ID, team, query)
	writeWorkshopResult(c, http.StatusOK, gin.H{"results": results}, err)
}

func readWorkshopGraph(c *gin.Context) {
	team, ok := readDirectoryID(c, c.Param("teamId"))
	if !ok {
		return
	}
	graph, err := model.ReadTeamGraph(c.Request.Context(), middleware.GetUser(c).ID, team)
	writeWorkshopResult(c, http.StatusOK, graph, err)
}

func readWorkshopInbox(c *gin.Context) {
	result, err := model.ReadWorkshopInbox(c.Request.Context(), middleware.GetUser(c).ID)
	writeWorkshopResult(c, http.StatusOK, result, err)
}

func startWorkshopThread(c *gin.Context) {
	var input model.NewWorkshopThread
	if !readDirectoryBody(c, &input) {
		return
	}
	err := model.StartWorkshopThread(c.Request.Context(), middleware.GetUser(c).ID, input)
	writeWorkshopResult(c, http.StatusCreated, gin.H{"id": input.ID}, err)
}

func readWorkshopThread(c *gin.Context) {
	id, ok := readDirectoryID(c, c.Param("id"))
	if !ok {
		return
	}
	var before int64
	if raw := c.Query("before"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 1 {
			writeWorkshopResult(c, 200, nil, model.ErrWorkshopInput)
			return
		}
		before = parsed
	}
	result, err := model.ReadWorkshopThread(c.Request.Context(), middleware.GetUser(c).ID, id, before)
	writeWorkshopResult(c, http.StatusOK, result, err)
}

func replyWorkshopThread(c *gin.Context) {
	id, ok := readDirectoryID(c, c.Param("id"))
	if !ok {
		return
	}
	var input struct {
		ID   uuid.UUID `json:"id"`
		Body string    `json:"body"`
	}
	if !readDirectoryBody(c, &input) {
		return
	}
	err := model.ReplyWorkshopThread(c.Request.Context(), middleware.GetUser(c).ID, id, input.ID, input.Body)
	writeWorkshopResult(c, http.StatusCreated, gin.H{"ok": true}, err)
}

func setWorkshopThreadState(c *gin.Context) {
	id, ok := readDirectoryID(c, c.Param("id"))
	if !ok {
		return
	}
	var input model.WorkshopThreadUpdate
	if !readDirectoryBody(c, &input) {
		return
	}
	err := model.UpdateWorkshopThread(c.Request.Context(), middleware.GetUser(c).ID, id, input)
	writeWorkshopResult(c, http.StatusOK, gin.H{"ok": true}, err)
}

func listWorkshopAgenda(c *gin.Context) {
	from, fromErr := time.Parse(time.RFC3339, c.Query("from"))
	to, toErr := time.Parse(time.RFC3339, c.Query("to"))
	if fromErr != nil || toErr != nil {
		writeWorkshopResult(c, 200, nil, model.ErrWorkshopInput)
		return
	}
	items, err := model.ReadAgenda(c.Request.Context(), middleware.GetUser(c).ID, from, to)
	writeWorkshopResult(c, http.StatusOK, gin.H{"items": items}, err)
}

func saveWorkshopAgenda(c *gin.Context) {
	id, ok := readDirectoryID(c, c.Param("id"))
	if !ok {
		return
	}
	var input model.AgendaDraft
	if !readDirectoryBody(c, &input) {
		return
	}
	err := model.SaveAgendaItem(c.Request.Context(), middleware.GetUser(c).ID, id, input)
	writeWorkshopResult(c, http.StatusOK, gin.H{"id": id}, err)
}

func deleteWorkshopAgenda(c *gin.Context) {
	id, ok := readDirectoryID(c, c.Param("id"))
	if !ok {
		return
	}
	revision, err := strconv.ParseInt(c.Query("revision"), 10, 64)
	if err != nil {
		writeWorkshopResult(c, 200, nil, model.ErrWorkshopInput)
		return
	}
	err = model.DeleteAgendaItem(c.Request.Context(), middleware.GetUser(c).ID, id, revision)
	writeWorkshopResult(c, http.StatusOK, gin.H{"ok": true}, err)
}

func listWorkshopRecents(c *gin.Context) {
	items, err := model.ReadRecentResources(c.Request.Context(), middleware.GetUser(c).ID)
	writeWorkshopResult(c, http.StatusOK, gin.H{"items": items}, err)
}

func recordWorkshopRecent(c *gin.Context) {
	board, ok := readDirectoryBoardID(c)
	if !ok {
		return
	}
	err := model.RecordRecentResource(c.Request.Context(), middleware.GetUser(c).ID, board)
	writeWorkshopResult(c, http.StatusOK, gin.H{"ok": true}, err)
}

func writeWorkshopResult(c *gin.Context, status int, result any, err error) {
	switch {
	case errors.Is(err, model.ErrWorkshopInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Check the workshop fields and try again."})
	case errors.Is(err, model.ErrWorkshopConflict):
		c.JSON(http.StatusConflict, gin.H{"error": "This item has changed. Refresh and try again."})
	case errors.Is(err, model.ErrRoomAccessDenied), errors.Is(err, model.ErrRoomNotFound), errors.Is(err, model.ErrDirectoryNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "This item is unavailable."})
	default:
		writeDirectoryResult(c, status, result, err)
	}
}
