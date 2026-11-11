package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

func RegisterDirectoryRoutes(api *gin.RouterGroup) {
	directory := api.Group("/v2")
	directory.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		if middleware.GetUser(c) == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
			return
		}
		c.Next()
	})
	directory.GET("/directory", getDirectory)
	directory.POST("/organizations", createDirectoryOrganization)
	directory.POST("/organizations/:orgId/workspaces", createDirectoryWorkspace)
	directory.POST("/workspaces/:workspaceId/projects", createDirectoryProject)
	directory.POST("/projects/:projectId/boards", createDirectoryBoard)
	directory.PUT("/boards/:id/favorite", setDirectoryBoardFavorite)
	directory.PUT("/boards/:id/archive", setDirectoryBoardArchived)
	directory.PUT("/boards/:id/location", moveDirectoryBoard)
}

func getDirectory(c *gin.Context) {
	directory, err := model.ListDirectory(c.Request.Context(), middleware.GetUser(c).ID)
	writeDirectoryResult(c, http.StatusOK, directory, err)
}

func createDirectoryOrganization(c *gin.Context) {
	name, ok := readDirectoryName(c)
	if !ok {
		return
	}
	organization, err := model.CreateOrganization(c.Request.Context(), middleware.GetUser(c).ID, name)
	writeDirectoryResult(c, http.StatusCreated, organization, err)
}

func createDirectoryWorkspace(c *gin.Context) {
	organizationID, ok := readDirectoryID(c, c.Param("orgId"))
	if !ok {
		return
	}
	name, ok := readDirectoryName(c)
	if !ok {
		return
	}
	workspace, err := model.CreateWorkspace(c.Request.Context(), middleware.GetUser(c).ID, organizationID, name)
	writeDirectoryResult(c, http.StatusCreated, workspace, err)
}

func createDirectoryProject(c *gin.Context) {
	workspaceID, ok := readDirectoryID(c, c.Param("workspaceId"))
	if !ok {
		return
	}
	name, ok := readDirectoryName(c)
	if !ok {
		return
	}
	project, err := model.CreateProject(c.Request.Context(), middleware.GetUser(c).ID, workspaceID, name)
	writeDirectoryResult(c, http.StatusCreated, project, err)
}

func createDirectoryBoard(c *gin.Context) {
	projectID, ok := readDirectoryID(c, c.Param("projectId"))
	if !ok {
		return
	}
	name, ok := readDirectoryName(c)
	if !ok {
		return
	}
	board, err := model.CreateProjectBoard(c.Request.Context(), middleware.GetUser(c).ID, projectID, name)
	writeDirectoryResult(c, http.StatusCreated, board, err)
}

func setDirectoryBoardFavorite(c *gin.Context) {
	boardID, ok := readDirectoryBoardID(c)
	if !ok {
		return
	}
	var req struct {
		Favorite *bool `json:"favorite"`
	}
	if !readDirectoryBody(c, &req) {
		return
	}
	if req.Favorite == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "favorite is required"})
		return
	}
	err := model.SetBoardFavorite(c.Request.Context(), middleware.GetUser(c).ID, boardID, *req.Favorite)
	writeDirectoryResult(c, http.StatusOK, gin.H{"favorite": *req.Favorite}, err)
}

func setDirectoryBoardArchived(c *gin.Context) {
	boardID, ok := readDirectoryBoardID(c)
	if !ok {
		return
	}
	var req struct {
		Archived *bool `json:"archived"`
	}
	if !readDirectoryBody(c, &req) {
		return
	}
	if req.Archived == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "archived is required"})
		return
	}
	archivedAt, err := model.SetBoardArchived(c.Request.Context(), middleware.GetUser(c).ID, boardID, *req.Archived)
	writeDirectoryResult(c, http.StatusOK, gin.H{"archivedAt": archivedAt}, err)
}

func moveDirectoryBoard(c *gin.Context) {
	boardID, ok := readDirectoryBoardID(c)
	if !ok {
		return
	}
	var req struct {
		ProjectID string `json:"projectId"`
	}
	if !readDirectoryBody(c, &req) {
		return
	}
	projectID, ok := readDirectoryID(c, req.ProjectID)
	if !ok {
		return
	}
	err := model.MoveBoard(c.Request.Context(), middleware.GetUser(c).ID, boardID, projectID)
	writeDirectoryResult(c, http.StatusOK, gin.H{"projectId": projectID}, err)
}

func readDirectoryBoardID(c *gin.Context) (string, bool) {
	id := c.Param("id")
	// Older room links can use non-UUID identifiers.
	if id == "" || utf8.RuneCountInString(id) > 36 || strings.ContainsRune(id, 0) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid board ID"})
		return "", false
	}
	return id, true
}

func readDirectoryID(c *gin.Context, raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid directory ID"})
		return uuid.Nil, false
	}
	return id, true
}

func readDirectoryName(c *gin.Context) (string, bool) {
	var req struct {
		Name string `json:"name"`
	}
	if !readDirectoryBody(c, &req) {
		return "", false
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > 120 || strings.ContainsRune(name, 0) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name must contain 1 to 120 characters"})
		return "", false
	}
	return name, true
}

func readDirectoryBody(c *gin.Context, target any) bool {
	const maxBodyBytes = 8 << 10
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(target)
	if err == nil {
		err = decoder.Decode(new(json.RawMessage))
		if errors.Is(err, io.EOF) {
			return true
		}
	}
	var limitErr *http.MaxBytesError
	if errors.As(err, &limitErr) {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Directory request is too large"})
		return false
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid directory request"})
	return false
}

func writeDirectoryResult(c *gin.Context, status int, result any, err error) {
	switch {
	case err == nil:
		c.JSON(status, result)
	case errors.Is(err, model.ErrDirectoryNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Directory resource not found"})
	case errors.Is(err, model.ErrCrossOrganization):
		c.JSON(http.StatusConflict, gin.H{"error": "Boards can only move within their organization"})
	default:
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Directory operation failed"})
	}
}
