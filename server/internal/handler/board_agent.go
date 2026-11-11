package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/agent"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

type agentRoutes struct {
	config agent.Config
	notify func(string, int64, int64)
}

func RegisterBoardAgentRoutes(boards *gin.RouterGroup, config agent.Config, notify func(string, int64, int64)) {
	r := agentRoutes{config: config, notify: notify}
	boards.GET("/agent/settings", r.getSettings)
	boards.PUT("/agent/settings", r.setSettings)
	runs := boards.Group("/agent-runs")
	runs.POST("", r.start)
	runs.GET("", r.list)
	runs.GET("/:runId", r.get)
	runs.GET("/:runId/events", r.events)
	runs.GET("/:runId/shared", r.getShared)
	runs.POST("/:runId/answer", r.answer)
	runs.POST("/:runId/pause", r.pause)
	runs.POST("/:runId/resume", r.resume)
	runs.POST("/:runId/cancel", r.cancel)
	runs.POST("/:runId/retry", r.retry)
	runs.POST("/:runId/apply", r.apply)
	runs.PUT("/:runId/share", r.setShared)
}

func RegisterAgentOrganizationRoutes(api *gin.RouterGroup, config agent.Config) {
	api.PUT("/v2/orgs/:orgId/agent-settings", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		org, err := uuid.Parse(c.Param("orgId"))
		if err != nil || org == uuid.Nil {
			writeAgentError(c, model.ErrDirectoryNotFound)
			return
		}
		var input agent.SettingsInput
		if !bindAgentJSON(c, &input) {
			return
		}
		value, err := agent.SetOrganizationSettings(c.Request.Context(), config, org, middleware.GetUser(c).ID, input)
		writeAgentResult(c, http.StatusOK, value, err)
	})
}

func (r agentRoutes) getSettings(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	value, err := agent.ReadSettings(c.Request.Context(), r.config, boardID, middleware.GetUser(c).ID)
	writeAgentResult(c, http.StatusOK, value, err)
}

func (r agentRoutes) setSettings(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	var input agent.SettingsInput
	if !bindAgentJSON(c, &input) {
		return
	}
	value, err := agent.SetBoardSettings(c.Request.Context(), r.config, boardID, middleware.GetUser(c).ID, input)
	writeAgentResult(c, http.StatusOK, value, err)
}

func (r agentRoutes) start(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	var input agent.StartInput
	if !bindAgentJSON(c, &input) {
		return
	}
	run, err := agent.Start(c.Request.Context(), r.config, boardID, middleware.GetUser(c).ID, input)
	writeAgentResult(c, http.StatusAccepted, run, err)
}

func (r agentRoutes) list(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	runs, err := agent.List(c.Request.Context(), boardID, middleware.GetUser(c).ID)
	writeAgentResult(c, http.StatusOK, gin.H{"runs": runs}, err)
}

func (r agentRoutes) get(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	run, err := agent.Get(c.Request.Context(), board, middleware.GetUser(c).ID, id)
	writeAgentResult(c, http.StatusOK, run, err)
}

func (r agentRoutes) getShared(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	run, err := agent.GetShared(c.Request.Context(), board, middleware.GetUser(c).ID, id)
	writeAgentResult(c, http.StatusOK, run, err)
}

func (r agentRoutes) setShared(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	var input struct {
		Shared *bool `json:"shared"`
	}
	if !bindAgentJSON(c, &input) {
		return
	}
	if input.Shared == nil {
		writeAgentError(c, &agent.Fault{Status: http.StatusBadRequest, Code: "INVALID_AGENT_REQUEST", Message: "Provide the desired sharing state."})
		return
	}
	run, err := agent.SetShared(c.Request.Context(), board, middleware.GetUser(c).ID, id, *input.Shared)
	writeAgentResult(c, http.StatusOK, run, err)
}

func (r agentRoutes) answer(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	var input agent.AnswerInput
	if !bindAgentJSON(c, &input) {
		return
	}
	run, err := agent.Answer(c.Request.Context(), r.config, board, middleware.GetUser(c).ID, id, input)
	writeAgentResult(c, http.StatusOK, run, err)
}

func (r agentRoutes) cancel(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	run, err := agent.Cancel(c.Request.Context(), board, middleware.GetUser(c).ID, id)
	writeAgentResult(c, http.StatusOK, run, err)
}

func (r agentRoutes) pause(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	run, err := agent.Pause(c.Request.Context(), board, middleware.GetUser(c).ID, id)
	writeAgentResult(c, http.StatusOK, run, err)
}

func (r agentRoutes) resume(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	run, err := agent.Resume(c.Request.Context(), r.config, board, middleware.GetUser(c).ID, id)
	writeAgentResult(c, http.StatusOK, run, err)
}

func (r agentRoutes) retry(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	run, err := agent.Retry(c.Request.Context(), r.config, board, middleware.GetUser(c).ID, id)
	writeAgentResult(c, http.StatusOK, run, err)
}

func (r agentRoutes) apply(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	var input agent.ApplyInput
	if !bindAgentJSON(c, &input) {
		return
	}
	value, err := agent.Apply(c.Request.Context(), r.config, board, middleware.GetUser(c).ID, id, input)
	if err == nil && !value.Ack.Replayed && r.notify != nil {
		r.notify(board, value.Ack.Epoch, value.Ack.Seq)
	}
	writeAgentResult(c, http.StatusOK, value, err)
}

func (r agentRoutes) events(c *gin.Context) {
	board, id, ok := readAgentRunIDs(c)
	if !ok {
		return
	}
	var last int64
	if raw := c.GetHeader("Last-Event-ID"); raw != "" {
		var err error
		last, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || last < 0 {
			writeAgentError(c, &agent.Fault{Status: http.StatusBadRequest, Code: "INVALID_EVENT_ID", Message: "Invalid event cursor."})
			return
		}
	}
	session := middleware.GetSession(c)
	if session == nil {
		writeAgentError(c, &agent.Fault{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Message: "Sign in to follow this run."})
		return
	}
	ctx, done := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer done()
	run, err := agent.Get(ctx, board, session.UserID, id)
	if err != nil {
		writeAgentError(c, err)
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "private, no-store, no-transform")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	controller := http.NewResponseController(c.Writer)
	_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.WriteString(c.Writer, "retry: 1000\n\n"); err != nil {
		return
	}
	if run.Revision != last {
		if err := sendAgentState(c, run); err != nil {
			return
		}
		last = run.Revision
	}
	c.Writer.Flush()
	_ = controller.SetWriteDeadline(time.Time{})
	poll := time.NewTicker(750 * time.Millisecond)
	defer poll.Stop()
	keepAlive := time.NewTicker(12 * time.Second)
	defer keepAlive.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-keepAlive.C:
			_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := io.WriteString(c.Writer, ": keep-alive\n\n"); err != nil {
				return
			}
			c.Writer.Flush()
			_ = controller.SetWriteDeadline(time.Time{})
		case <-poll.C:
			current, err := model.GetStoredSession(ctx, session.Token)
			if err != nil || current == nil || current.UserID != session.UserID {
				return
			}
			revision, err := agent.Revision(ctx, board, session.UserID, id)
			if err != nil {
				return
			}
			if revision != last {
				next, err := agent.Get(ctx, board, session.UserID, id)
				_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err != nil || sendAgentState(c, next) != nil {
					return
				}
				_ = controller.SetWriteDeadline(time.Time{})
				last = next.Revision
			}
		}
	}
}

func sendAgentState(c *gin.Context, run agent.Run) error {
	data, err := json.Marshal(run)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(c.Writer, "id: %d\nevent: state\ndata: %s\n\n", run.Revision, data); err != nil {
		return err
	}
	c.Writer.Flush()
	return nil
}

func readAgentRunIDs(c *gin.Context) (string, uuid.UUID, bool) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return "", uuid.Nil, false
	}
	id, err := uuid.Parse(c.Param("runId"))
	if err != nil || id == uuid.Nil {
		writeAgentError(c, &agent.Fault{Status: http.StatusNotFound, Code: "AGENT_NOT_FOUND", Message: "Run not found."})
		return "", uuid.Nil, false
	}
	return boardID, id, true
}

func bindAgentJSON(c *gin.Context, output any) bool {
	return bindAgentJSONWithLimit(c, output, 128<<10)
}

func bindAgentJSONWithLimit(c *gin.Context, output any, limit int64) bool {
	media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || media != "application/json" {
		writeAgentError(c, &agent.Fault{Status: http.StatusUnsupportedMediaType, Code: "INVALID_CONTENT_TYPE", Message: "Use application/json."})
		return false
	}
	body := http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(output); err == nil {
		err = decoder.Decode(new(any))
		if errors.Is(err, io.EOF) {
			return true
		}
	}
	var max *http.MaxBytesError
	if errors.As(err, &max) {
		writeAgentError(c, &agent.Fault{Status: http.StatusRequestEntityTooLarge, Code: "AGENT_INPUT_TOO_LARGE", Message: "The agent request is too large."})
	} else {
		writeAgentError(c, &agent.Fault{Status: http.StatusBadRequest, Code: "INVALID_AGENT_REQUEST", Message: "Invalid agent request."})
	}
	return false
}

func writeAgentResult(c *gin.Context, status int, value any, err error) {
	if err != nil {
		writeAgentError(c, err)
		return
	}
	c.JSON(status, value)
}

func writeAgentError(c *gin.Context, err error) {
	fault := agent.DescribeError(err)
	c.JSON(fault.Status, gin.H{"code": fault.Code, "error": fault.Message})
}
