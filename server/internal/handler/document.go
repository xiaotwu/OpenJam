package handler

import (
	"errors"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/xiaotwu/shiori/server/internal/agent"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/middleware"
)

func documentBoardRoutes(api *gin.RouterGroup) *gin.RouterGroup {
	return api.Group("/v2/boards/:id", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		if middleware.GetUser(c) == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHENTICATED", "error": "Sign in to open this board"})
			return
		}
		c.Next()
	})
}

func RegisterDocumentRoutes(api *gin.RouterGroup, notify func(string, int64, int64), notifyAccessChanged func(string), agentConfig agent.Config) {
	boards := documentBoardRoutes(api)
	boards.GET("/snapshot", getDocumentSnapshot)
	boards.GET("/changes", getDocumentChanges)
	boards.POST("/commands", func(c *gin.Context) {
		postDocumentCommand(c, notify)
	})
	RegisterBoardVersionRoutes(boards, notify)
	RegisterBoardReviewRoutes(boards)
	RegisterBoardSharingRoutes(boards, notifyAccessChanged)
	boards.POST("/copy", copyCurrentBoard)
	RegisterBoardFileRoutes(boards)
	RegisterBoardAgentRoutes(boards, agentConfig, notify)
	boards.GET("/agent-attributions", getBoardAgentAttributions)
}

func getDocumentSnapshot(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	snapshot, err := document.Open(c.Request.Context(), boardID, middleware.GetUser(c).ID, true)
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	c.JSON(http.StatusOK, snapshot)
}

func getDocumentChanges(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	epoch, epochErr := strconv.ParseInt(c.Query("epoch"), 10, 64)
	after, afterErr := strconv.ParseInt(c.Query("afterSeq"), 10, 64)
	limit, limitErr := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if epochErr != nil || afterErr != nil || limitErr != nil || epoch < 1 || after < 0 || limit < 1 || limit > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CURSOR", "error": "Invalid change cursor"})
		return
	}
	page, err := document.Changes(c.Request.Context(), boardID, middleware.GetUser(c).ID, epoch, after, limit)
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

func postDocumentCommand(c *gin.Context, notify func(string, int64, int64)) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || contentType != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"code": "INVALID_COMMAND", "error": "Expected an application/json command"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, document.MaxCommandBytes)
	command, err := document.DecodeCommand(c.Request.Body)
	if err != nil {
		var limitErr *http.MaxBytesError
		if errors.As(err, &limitErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "COMMAND_TOO_LARGE", "error": "Board command is too large"})
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_COMMAND", "error": "Invalid board command"})
		}
		return
	}
	ack, err := document.Commit(c.Request.Context(), boardID, middleware.GetUser(c).ID, command)
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	notify(ack.BoardID, ack.Epoch, ack.Seq)
	c.JSON(http.StatusOK, ack)
}

func readDocumentBoardID(c *gin.Context) (string, bool) {
	boardID := c.Param("id")
	if strings.TrimSpace(boardID) == "" || utf8.RuneCountInString(boardID) > 36 || strings.ContainsRune(boardID, 0) {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_BOARD_ID", "error": "Invalid board ID"})
		return "", false
	}
	return boardID, true
}

func writeDocumentError(c *gin.Context, err error) {
	failure := document.DescribeError(err)
	if failure.Status >= 500 {
		_ = c.Error(err)
	}
	c.JSON(failure.Status, failure)
}

func rejectLegacyWrite(c *gin.Context, err error) bool {
	if !document.LegacyWriteFenced(err) {
		return false
	}
	writeLegacyUpgrade(c)
	return true
}

func writeLegacyUpgrade(c *gin.Context) {
	c.JSON(http.StatusConflict, gin.H{
		"code":  "PROTOCOL_UPGRADE_REQUIRED",
		"error": "This board uses persistent sync. Reload Shiori to edit it.",
	})
}
