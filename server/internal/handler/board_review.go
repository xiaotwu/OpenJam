package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/middleware"
)

func RegisterBoardReviewRoutes(boards *gin.RouterGroup) {
	review := boards.Group("/review")
	review.GET("/threads", reviewBoard(listBoardReviewThreads))
	review.POST("/threads", reviewBoard(addBoardReviewThread))
	review.GET("/threads/:threadId", reviewBoard(getBoardReviewThread))
	review.POST("/threads/:threadId/replies", reviewBoard(addBoardReviewReply))
	review.PUT("/threads/:threadId", reviewBoard(setBoardReviewResolved))
	review.PUT("/threads/:threadId/comments/:commentId", reviewBoard(editBoardReviewComment))
	review.GET("/people", reviewBoard(listBoardReviewPeople))
	review.GET("/notifications", reviewBoard(listBoardReviewNotifications))
	review.PUT("/notifications/:commentId/read", reviewBoard(markBoardReviewNotificationRead))
}

func reviewBoard(handler func(*gin.Context, string, uuid.UUID)) gin.HandlerFunc {
	return func(c *gin.Context) {
		boardID, ok := readDocumentBoardID(c)
		if ok {
			handler(c, boardID, middleware.GetUser(c).ID)
		}
	}
}

func readReviewID(c *gin.Context, key string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(key))
	if err != nil || id == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REVIEW_ID", "error": "Invalid review ID"})
		return uuid.Nil, false
	}
	return id, true
}

func readReviewPage(c *gin.Context) (int, *uuid.UUID, bool) {
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if err != nil || limit < 1 || limit > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CURSOR", "error": "Invalid review page size"})
		return 0, nil, false
	}
	if cursor := c.Query("cursor"); cursor != "" {
		id, err := uuid.Parse(cursor)
		if err != nil || id == uuid.Nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CURSOR", "error": "Invalid review cursor"})
			return 0, nil, false
		}
		return limit, &id, true
	}
	return limit, nil, true
}

func decodeReviewBody(c *gin.Context, result any) bool {
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || contentType != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"code": "INVALID_REVIEW", "error": "Expected an application/json review request"})
		return false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	err = decoder.Decode(result)
	if err == nil {
		var trailing json.RawMessage
		err = decoder.Decode(&trailing)
		if errors.Is(err, io.EOF) {
			return true
		}
	}
	var bodyLimit *http.MaxBytesError
	if errors.As(err, &bodyLimit) {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "REVIEW_TOO_LARGE", "error": "Review request is too large"})
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REVIEW", "error": "Invalid review request"})
	}
	return false
}

func writeReviewResult(c *gin.Context, status int, value any, err error) {
	if errors.Is(err, document.ErrReviewNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"code": "REVIEW_NOT_FOUND", "error": "Comment or review thread not found"})
	} else if err != nil {
		writeDocumentError(c, err)
	} else {
		c.JSON(status, value)
	}
}

func listBoardReviewThreads(c *gin.Context, boardID string, actor uuid.UUID) {
	limit, cursor, ok := readReviewPage(c)
	if !ok {
		return
	}
	filter := c.DefaultQuery("status", "open")
	switch filter {
	case "all", "open", "resolved", "mentioned":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REVIEW_FILTER", "error": "Invalid review filter"})
		return
	}
	result, err := document.ListReviewThreads(c.Request.Context(), boardID, actor, filter, cursor, limit)
	writeReviewResult(c, http.StatusOK, result, err)
}

func addBoardReviewThread(c *gin.Context, boardID string, actor uuid.UUID) {
	var input document.CreateReviewThread
	if decodeReviewBody(c, &input) {
		result, err := document.AddReviewThread(c.Request.Context(), boardID, actor, input)
		writeReviewResult(c, http.StatusCreated, result, err)
	}
}

func getBoardReviewThread(c *gin.Context, boardID string, actor uuid.UUID) {
	threadID, ok := readReviewID(c, "threadId")
	if !ok {
		return
	}
	limit, cursor, ok := readReviewPage(c)
	if ok {
		result, err := document.GetReviewThread(c.Request.Context(), boardID, actor, threadID, cursor, limit)
		writeReviewResult(c, http.StatusOK, result, err)
	}
}

func addBoardReviewReply(c *gin.Context, boardID string, actor uuid.UUID) {
	threadID, ok := readReviewID(c, "threadId")
	if !ok {
		return
	}
	var input document.CreateReviewComment
	if decodeReviewBody(c, &input) {
		result, err := document.AddReviewReply(c.Request.Context(), boardID, actor, threadID, input)
		writeReviewResult(c, http.StatusCreated, result, err)
	}
}

func setBoardReviewResolved(c *gin.Context, boardID string, actor uuid.UUID) {
	threadID, ok := readReviewID(c, "threadId")
	if !ok {
		return
	}
	var input struct {
		Resolved *bool `json:"resolved"`
	}
	if !decodeReviewBody(c, &input) {
		return
	}
	if input.Resolved == nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REVIEW", "error": "Expected a resolved state"})
		return
	}
	result, err := document.SetReviewResolved(c.Request.Context(), boardID, actor, threadID, *input.Resolved)
	writeReviewResult(c, http.StatusOK, result, err)
}

func editBoardReviewComment(c *gin.Context, boardID string, actor uuid.UUID) {
	threadID, ok := readReviewID(c, "threadId")
	if !ok {
		return
	}
	commentID, ok := readReviewID(c, "commentId")
	if !ok {
		return
	}
	var input document.EditReviewComment
	if decodeReviewBody(c, &input) {
		result, err := document.ChangeReviewComment(c.Request.Context(), boardID, actor, threadID, commentID, input)
		writeReviewResult(c, http.StatusOK, result, err)
	}
}

func listBoardReviewPeople(c *gin.Context, boardID string, actor uuid.UUID) {
	result, err := document.ListReviewPeople(c.Request.Context(), boardID, actor)
	writeReviewResult(c, http.StatusOK, gin.H{"people": result}, err)
}

func listBoardReviewNotifications(c *gin.Context, boardID string, actor uuid.UUID) {
	limit, _, ok := readReviewPage(c)
	if ok {
		result, err := document.ListReviewNotifications(c.Request.Context(), boardID, actor, limit)
		writeReviewResult(c, http.StatusOK, gin.H{"notifications": result}, err)
	}
}

func markBoardReviewNotificationRead(c *gin.Context, boardID string, actor uuid.UUID) {
	commentID, ok := readReviewID(c, "commentId")
	if ok {
		err := document.MarkReviewNotificationRead(c.Request.Context(), boardID, actor, commentID)
		writeReviewResult(c, http.StatusOK, gin.H{"ok": true}, err)
	}
}
