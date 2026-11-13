package document

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/assets"
	"github.com/xiaotwu/shiori/server/internal/model"
	"github.com/xiaotwu/shiori/server/internal/slideformat"
)

type slidePage struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SlidePage bool   `json:"slidePage"`
	slideformat.Frame
}

type slideObject struct {
	ID        string `json:"id"`
	PageID    string `json:"pageId"`
	CreatedBy string `json:"createdBy"`
	slideformat.Object
}

func CreatePresentation(ctx context.Context, actor, projectID uuid.UUID, name string, deck slideformat.Deck) (model.DirectoryBoard, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 255 || !slideformat.ValidText(name) {
		return model.DirectoryBoard{}, invalidCommand("Enter a presentation name of up to 255 characters.")
	}
	if len(deck.Slides) == 0 {
		deck.Slides = []slideformat.Slide{slideformat.BlankSlide()}
	}
	if err := slideformat.CheckDeck(deck.Slides); err != nil {
		return model.DirectoryBoard{}, err
	}
	content := Document{Name: name, Elements: []json.RawMessage{}, Stamps: []json.RawMessage{}}
	for _, slide := range deck.Slides {
		id := uuid.NewString()
		page := slidePage{ID: id, Name: slide.Name, SlidePage: true, Frame: slide.Frame}
		data, err := json.Marshal(page)
		if err != nil {
			return model.DirectoryBoard{}, err
		}
		content.Pages = append(content.Pages, data)
		if content.DefaultPageID == "" {
			content.DefaultPageID = id
		}
		for _, object := range slide.Objects {
			record := slideObject{ID: uuid.NewString(), PageID: id, CreatedBy: actor.String(), Object: object}
			data, err := json.Marshal(record)
			if err != nil {
				return model.DirectoryBoard{}, err
			}
			content.Elements = append(content.Elements, data)
		}
	}
	ids, err := assets.References(content.Elements)
	if err != nil {
		return model.DirectoryBoard{}, err
	}
	media := make([]assets.Metadata, 0, len(ids))
	var mediaBytes int64
	for _, id := range ids {
		asset, exists := deck.Media[id]
		_, supported := slideformat.MediaExtension(asset.Metadata.MIMEType)
		if !exists || !supported || asset.Metadata.ID != id {
			return model.DirectoryBoard{}, slideformat.ErrInvalid
		}
		mediaBytes += asset.Metadata.Size
	}
	if mediaBytes > slideformat.MaxMediaBytes {
		return model.DirectoryBoard{}, slideformat.ErrLimit
	}
	for _, id := range ids {
		asset := deck.Media[id]
		if err := assets.Stage(ctx, asset.Metadata, asset.Data); err != nil {
			return model.DirectoryBoard{}, err
		}
		media = append(media, asset.Metadata)
	}
	return createNativeResource(ctx, actor, projectID, content, model.ResourceSlides, "Initial presentation", media)
}

func PresentationSlides(snapshot Snapshot) ([]slideformat.Slide, error) {
	if snapshot.ResourceKind != model.ResourceSlides {
		return nil, model.ErrRoomNotFound
	}
	slides := make([]slideformat.Slide, len(snapshot.Document.Pages))
	positions := make(map[string]int, len(slides))
	for i, raw := range snapshot.Document.Pages {
		var page slidePage
		if err := json.Unmarshal(raw, &page); err != nil || !page.SlidePage {
			return nil, slideformat.ErrInvalid
		}
		slides[i] = slideformat.Slide{Name: page.Name, Frame: page.Frame}
		positions[page.ID] = i
	}
	for _, raw := range snapshot.Document.Elements {
		var record slideObject
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, slideformat.ErrInvalid
		}
		i, exists := positions[record.PageID]
		if !exists {
			return nil, slideformat.ErrInvalid
		}
		slides[i].Objects = append(slides[i].Objects, record.Object)
	}
	return slides, slideformat.CheckDeck(slides)
}

func validateSlideOperation(operation Operation) error {
	switch operation.Kind {
	case "rename", "setDefaultPage":
		return nil
	}
	if operation.Collection != "pages" && operation.Collection != "elements" {
		return invalidCommand("Presentations only accept slide, text and image edits.")
	}
	switch operation.Kind {
	case "add", "restore":
		return nil
	case "delete":
		if len(operation.Expected) > 0 {
			return nil
		}
	case "reorder":
		if operation.Collection == "pages" {
			return nil
		}
	case "patch":
		editable := []string{"name", "background"}
		if operation.Collection == "elements" {
			editable = []string{"x", "y", "width", "height", "rotation", "text", "fontFamily", "fontSize", "fontWeight", "fontStyle",
				"textAlign", "color", "assetId", "originalWidth", "originalHeight", "caption", "crop"}
		}
		for key := range operation.Fields {
			if !slices.Contains(editable, key) || operation.Expected[key] == nil {
				return invalidCommand("An edit must compare the previous value of each changed field.")
			}
		}
		for _, key := range operation.Unset {
			if operation.Collection != "elements" || (key != "crop" && key != "caption" && key != "text") || operation.Expected[key] == nil {
				return invalidCommand("Only optional object fields can be cleared.")
			}
		}
		return nil
	}
	return invalidCommand("Invalid slide edit.")
}

func validSlideID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id.String() == value
}

func validateSlidePage(fields map[string]json.RawMessage, data json.RawMessage) error {
	var page slidePage
	if len(fields) != 6 || json.Unmarshal(data, &page) != nil || !page.SlidePage || !validSlideID(page.ID) {
		return invalidCommand("Invalid slide metadata.")
	}
	if err := slideformat.CheckFrame(page.Name, page.Frame); err != nil {
		return invalidCommand(err.Error())
	}
	return nil
}

func validateSlideObject(fields map[string]json.RawMessage, data json.RawMessage) error {
	var record slideObject
	if json.Unmarshal(data, &record) != nil || !validSlideID(record.ID) || !validSlideID(record.PageID) {
		return invalidCommand("Invalid slide object.")
	}
	allowed := []string{"id", "pageId", "createdBy", "type", "x", "y", "width", "height", "rotation"}
	switch record.Type {
	case "text":
		allowed = append(allowed, "text", "fontFamily", "fontSize", "fontWeight", "fontStyle", "textAlign", "color")
	case "image":
		allowed = append(allowed, "assetId", "originalWidth", "originalHeight", "caption", "crop")
	}
	for key := range fields {
		if !slices.Contains(allowed, key) {
			return invalidCommand("A slide object contains an unsupported field.")
		}
	}
	if err := slideformat.CheckObject(record.Object); err != nil {
		return invalidCommand(err.Error())
	}
	return nil
}

func checkSlideSize(ctx context.Context, tx pgx.Tx, id string) error {
	var pages, dimensions, objects, perSlide, bytes, media, mediaBytes, unsupported int
	err := tx.QueryRow(ctx, `
		WITH items AS (
			SELECT page_id, data FROM board_elements WHERE board_id = $1 AND NOT deleted
		), pictures AS (
			SELECT size_bytes, mime_type FROM asset_blobs
			WHERE id IN (SELECT data->>'assetId' FROM items WHERE data->>'type' = 'image')
		)
		SELECT count(*), count(DISTINCT (page.data->>'width', page.data->>'height')),
			(SELECT count(*) FROM items),
			(SELECT coalesce(max(n), 0) FROM (SELECT count(*) AS n FROM items GROUP BY page_id) counts),
			(SELECT coalesce(sum(octet_length(data->>'text')), 0) FROM items),
			(SELECT count(*) FROM pictures), (SELECT coalesce(sum(size_bytes), 0) FROM pictures),
			(SELECT count(*) FROM pictures WHERE mime_type NOT IN ('image/png', 'image/jpeg'))
		FROM board_pages page WHERE page.board_id = $1 AND NOT page.deleted
	`, id).Scan(&pages, &dimensions, &objects, &perSlide, &bytes, &media, &mediaBytes, &unsupported)
	if err != nil {
		return err
	}
	if dimensions != 1 {
		return invalidCommand("All slides must share the presentation dimensions.")
	}
	if unsupported != 0 {
		return invalidCommand("Choose a PNG or JPEG image for this presentation.")
	}
	if pages < 1 || pages > slideformat.MaxSlides || objects > slideformat.MaxObjects || perSlide > slideformat.MaxSlideObjects ||
		bytes > slideformat.MaxBodyBytes || media > slideformat.MaxImages || mediaBytes > slideformat.MaxMediaBytes {
		return invalidCommand("Presentation limits are 60 slides, 100 objects on each slide, 1,200 objects total, 1 MiB of text and 24 MiB of images.")
	}
	return nil
}

func ReadPresentationMedia(ctx context.Context, snapshot Snapshot, actor uuid.UUID) (map[string]slideformat.Media, error) {
	ids, err := assets.References(snapshot.Document.Elements)
	if err != nil {
		return nil, err
	}
	media := make(map[string]slideformat.Media, len(ids))
	var total int64
	for _, id := range ids {
		meta, data, err := readSlideImage(ctx, snapshot.BoardID, actor, id, slideformat.MaxMediaBytes-total)
		if err != nil {
			return nil, err
		}
		total += meta.Size
		media[id] = slideformat.Media{Metadata: meta, Data: data}
	}
	return media, nil
}

func readSlideImage(ctx context.Context, boardID string, actor uuid.UUID, id string, remaining int64) (assets.Metadata, []byte, error) {
	meta, content, err := assets.Get(ctx, boardID, actor, id)
	if err != nil {
		return assets.Metadata{}, nil, err
	}
	defer content.Close()
	if meta.Size > remaining {
		return assets.Metadata{}, nil, slideformat.ErrLimit
	}
	data := make([]byte, meta.Size)
	if _, err := io.ReadFull(content, data); err != nil {
		return assets.Metadata{}, nil, errors.Join(assets.ErrUnavailable, err)
	}
	return meta, data, nil
}
