package handler

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/slideformat"
)

const pptxContentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

// Limit simultaneous in-memory Office conversions, including raster decoding.
var slideConversions = make(chan struct{}, 2)

func RegisterSlidesRoutes(api *gin.RouterGroup) {
	routes := api.Group("/v2", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		c.Next()
	})
	routes.POST("/projects/:projectId/slides", createPresentation)
	routes.POST("/projects/:projectId/slides/import", importPresentation)
	routes.GET("/slides/:id/export", exportPresentation)
}

func createPresentation(c *gin.Context) {
	project, ok := readDirectoryID(c, c.Param("projectId"))
	if !ok {
		return
	}
	name, ok := readDirectoryName(c)
	if !ok {
		return
	}
	result, err := document.CreatePresentation(c.Request.Context(), middleware.GetUser(c).ID, project, name, slideformat.Deck{})
	writeSlidesResult(c, result, err)
}

func importPresentation(c *gin.Context) {
	project, ok := readDirectoryID(c, c.Param("projectId"))
	if !ok {
		return
	}
	actor := middleware.GetUser(c).ID
	ctx := c.Request.Context()
	if err := model.CheckProjectEdit(ctx, actor, project); err != nil {
		writeSlidesResult(c, nil, err)
		return
	}
	name := strings.TrimSpace(c.Query("name"))
	if name == "" || utf8.RuneCountInString(name) > 255 || !slideformat.ValidText(name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Enter a presentation name of up to 255 characters."})
		return
	}
	if c.Request.ContentLength > slideformat.MaxUploadBytes {
		writeSlidesResult(c, nil, slideformat.ErrLimit)
		return
	}
	if !reserveSlideConversion(c) {
		return
	}
	defer func() { <-slideConversions }()
	controller := http.NewResponseController(c.Writer)
	_ = controller.SetReadDeadline(time.Now().Add(45 * time.Second))
	data, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, slideformat.MaxUploadBytes))
	_ = controller.SetReadDeadline(time.Time{})
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			writeSlidesResult(c, nil, slideformat.ErrLimit)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "The file upload could not be read."})
		}
		return
	}
	deck, err := slideformat.ReadPPTX(data)
	if err != nil {
		writeSlidesResult(c, nil, err)
		return
	}
	resource, err := document.CreatePresentation(ctx, actor, project, name, deck)
	writeSlidesResult(c, struct {
		model.DirectoryBoard
		Warnings []string `json:"warnings,omitempty"`
	}{resource, deck.Warnings}, err)
}

func exportPresentation(c *gin.Context) {
	id, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	actor := middleware.GetUser(c).ID
	if !reserveSlideConversion(c) {
		return
	}
	defer func() { <-slideConversions }()
	snapshot, err := document.Open(ctx, id, actor, false)
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	slides, err := document.PresentationSlides(snapshot)
	if err != nil {
		writeDocumentError(c, err)
		return
	}
	media, err := document.ReadPresentationMedia(ctx, snapshot, actor)
	if err != nil {
		writeSlidesResult(c, nil, err)
		return
	}
	data, err := slideformat.WritePPTX(slides, media)
	if err != nil {
		writeSlidesResult(c, nil, err)
		return
	}
	name := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r < 32 || r == 127 {
			return '_'
		}
		return r
	}, snapshot.Document.Name)
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name + ".pptx"}))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, pptxContentType, data)
}

func reserveSlideConversion(c *gin.Context) bool {
	select {
	case slideConversions <- struct{}{}:
		return true
	default:
		c.Header("Retry-After", "2")
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Presentation conversions are busy. Try again shortly."})
		return false
	}
}

func writeSlidesResult(c *gin.Context, result any, err error) {
	var fault *document.CommandFault
	switch {
	case errors.Is(err, slideformat.ErrLimit):
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": err.Error() + ". PPTX uploads can be up to 32 MiB."})
	case errors.Is(err, slideformat.ErrInvalid):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error() + ". Choose a valid .pptx file."})
	case errors.As(err, &fault), errors.Is(err, model.ErrRoomAccessDenied):
		writeDocumentError(c, err)
	case errors.Is(err, assets.ErrUnavailable), errors.Is(err, assets.ErrStagingFull), errors.Is(err, assets.ErrQuota),
		errors.Is(err, assets.ErrTooLarge), errors.Is(err, assets.ErrNotFound), errors.Is(err, assets.ErrInvalidImage):
		writeBoardAssetError(c, err)
	default:
		writeDirectoryResult(c, http.StatusCreated, result, err)
	}
}
