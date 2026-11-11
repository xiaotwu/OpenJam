package handler

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/sheetformat"
)

func RegisterSheetsRoutes(api *gin.RouterGroup) {
	routes := api.Group("/v2", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		c.Next()
	})
	routes.POST("/projects/:projectId/sheets", createSheet)
	routes.POST("/projects/:projectId/sheets/import", importSheet)
	routes.GET("/sheets/:id/export", exportSheet)
}

func createSheet(c *gin.Context) {
	project, ok := readDirectoryID(c, c.Param("projectId"))
	if !ok {
		return
	}
	name, ok := readDirectoryName(c)
	if !ok {
		return
	}
	created, err := document.CreateSheet(c.Request.Context(), middleware.GetUser(c).ID, project, name, nil)
	writeSheetsResult(c, created, err)
}

func importSheet(c *gin.Context) {
	project, ok := readDirectoryID(c, c.Param("projectId"))
	if !ok {
		return
	}
	actor := middleware.GetUser(c).ID
	ctx := c.Request.Context()
	if err := model.CheckProjectEdit(ctx, actor, project); err != nil {
		writeSheetsResult(c, nil, err)
		return
	}
	name := strings.TrimSpace(c.Query("name"))
	if name == "" || utf8.RuneCountInString(name) > 255 || strings.ContainsRune(name, 0) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Enter a spreadsheet name of up to 255 characters."})
		return
	}
	format := c.Query("format")
	if !validSheetFormat(format) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose CSV or XLSX."})
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, sheetformat.MaxUploadBytes))
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Choose a file up to 4 MiB."})
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "The file upload could not be read."})
		}
		return
	}
	read := sheetformat.ReadCSV
	if format == "xlsx" {
		read = sheetformat.ReadXLSX
	}
	tabs, err := read(data)
	if err != nil {
		writeSheetsResult(c, nil, err)
		return
	}
	created, err := document.CreateSheet(ctx, actor, project, name, tabs)
	writeSheetsResult(c, created, err)
}

func exportSheet(c *gin.Context) {
	id, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	format := c.Query("format")
	if !validSheetFormat(format) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose CSV or XLSX."})
		return
	}
	snapshot, err := document.Open(c.Request.Context(), id, middleware.GetUser(c).ID, false)
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	tabs, pages, err := document.SheetWorkbook(snapshot)
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	computed := sheetformat.Calculate(tabs)
	contentType := "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	var data []byte
	if format == "xlsx" {
		data, err = sheetformat.WriteXLSX(tabs, computed)
	} else {
		page := c.DefaultQuery("sheet", snapshot.Document.DefaultPageID)
		index := slices.Index(pages, page)
		if index < 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "Worksheet not found."})
			return
		}
		contentType = "text/csv; charset=utf-8"
		data, err = sheetformat.WriteCSV(tabs[index], computed[index])
	}
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	name := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r < 32 || r == 127 {
			return '_'
		}
		return r
	}, snapshot.Document.Name)
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name + "." + format}))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, contentType, data)
}

func validSheetFormat(format string) bool {
	return format == "csv" || format == "xlsx"
}

func writeSheetsResult(c *gin.Context, result any, err error) {
	var fault *document.CommandFault
	switch {
	case errors.Is(err, sheetformat.ErrLimit):
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": err.Error()})
	case errors.Is(err, sheetformat.ErrInvalid):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.As(err, &fault):
		writeDocumentError(c, err)
	default:
		writeDirectoryResult(c, http.StatusCreated, result, err)
	}
}
