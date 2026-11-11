package handler

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/project-wb/server/internal/docformat"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

func RegisterDocsRoutes(api *gin.RouterGroup) {
	routes := api.Group("/v2", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		c.Next()
	})
	routes.POST("/projects/:projectId/docs", createDoc)
	routes.POST("/projects/:projectId/docs/import", importDoc)
	routes.GET("/docs/:id/export", exportDoc)
}

func createDoc(c *gin.Context) {
	projectID, ok := readDirectoryID(c, c.Param("projectId"))
	if !ok {
		return
	}
	name, ok := readDirectoryName(c)
	if !ok {
		return
	}
	created, err := document.CreateDoc(c.Request.Context(), middleware.GetUser(c).ID, projectID, name, nil)
	writeDocsResult(c, created, err)
}

func importDoc(c *gin.Context) {
	projectID, ok := readDirectoryID(c, c.Param("projectId"))
	if !ok {
		return
	}
	actor := middleware.GetUser(c).ID
	if err := model.CheckProjectEdit(c.Request.Context(), actor, projectID); err != nil {
		writeDocsResult(c, nil, err)
		return
	}
	name := strings.TrimSpace(c.Query("name"))
	if name == "" || utf8.RuneCountInString(name) > 255 || strings.ContainsRune(name, 0) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Enter a document name of up to 255 characters."})
		return
	}
	format := c.Query("format")
	if format != "md" && format != "docx" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose Markdown or DOCX."})
		return
	}
	// A raw bounded body keeps imports atomic and avoids writing uploads to disk.
	data, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, docformat.MaxUploadBytes))
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Choose a file smaller than 4 MiB."})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "The file upload could not be read."})
		return
	}
	var blocks []docformat.Block
	if format == "md" {
		blocks, err = docformat.ReadMarkdown(data)
	} else {
		blocks, err = docformat.ReadDOCX(data, docRequestOrigin(c.Request))
	}
	if err != nil {
		writeDocsResult(c, nil, err)
		return
	}
	created, err := document.CreateDoc(c.Request.Context(), actor, projectID, name, blocks)
	writeDocsResult(c, created, err)
}

func exportDoc(c *gin.Context) {
	id, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	format := c.Query("format")
	contentType := "text/markdown; charset=utf-8"
	if format == "docx" {
		contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	} else if format != "md" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose Markdown or DOCX."})
		return
	}
	snapshot, err := document.Open(c.Request.Context(), id, middleware.GetUser(c).ID, false)
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	blocks, err := document.DocBlocks(snapshot)
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	var data []byte
	if format == "md" {
		data = docformat.WriteMarkdown(blocks)
	} else {
		data, err = docformat.WriteDOCX(blocks, docRequestOrigin(c.Request))
		if errors.Is(err, docformat.ErrTooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "The Word export is too large."})
			return
		}
		if err != nil {
			writeDocumentError(c, err)
			return
		}
	}
	name := strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r < 32 || r == 127 {
			return '_'
		}
		return r
	}, snapshot.Document.Name))
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name + "." + format}))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, contentType, data)
}

func writeDocsResult(c *gin.Context, result any, err error) {
	var fault *document.CommandFault
	switch {
	case errors.Is(err, docformat.ErrTooLarge):
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": err.Error()})
	case errors.Is(err, docformat.ErrInvalidFile):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.As(err, &fault):
		writeDocumentError(c, err)
	default:
		writeDirectoryResult(c, http.StatusCreated, result, err)
	}
}

func docRequestOrigin(request *http.Request) string {
	scheme := "http"
	if request.TLS != nil || strings.EqualFold(request.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	host := request.Host
	value, err := url.Parse(scheme + "://" + host)
	if err != nil || value.Host == "" || value.User != nil || value.Path != "" || value.RawQuery != "" || value.Fragment != "" {
		return ""
	}
	return value.String()
}
