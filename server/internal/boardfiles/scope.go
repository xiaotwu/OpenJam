package boardfiles

import (
	"encoding/json"
	"errors"
	"slices"

	"github.com/google/uuid"
	"github.com/project-wb/server/internal/document"
)

var (
	ErrInvalidScope   = errors.New("invalid export scope")
	ErrInvalidTheme   = errors.New("invalid render theme")
	ErrEmptySelection = errors.New("the selected objects are no longer available")
	ErrTooLarge       = errors.New("board file exceeds the size limit")
	ErrInvalidFile    = errors.New("invalid OpenJam board file")
	ErrExternalImage  = errors.New("replace linked images with uploaded images to include them in a board file")
)

type ExportRequest struct {
	RequestID  uuid.UUID `json:"requestId"`
	Format     string    `json:"format"`
	Scope      string    `json:"scope"`
	PageID     string    `json:"pageId,omitempty"`
	ElementIDs []string  `json:"elementIds,omitempty"`
	StampIDs   []string  `json:"stampIds,omitempty"`
	Theme      string    `json:"theme,omitempty"`
}

func normalizeTheme(theme string) (string, error) {
	switch theme {
	case "", "light":
		return "", nil
	case "dark":
		return theme, nil
	default:
		return "", ErrInvalidTheme
	}
}

func (req *ExportRequest) normalize() error {
	if req.RequestID == uuid.Nil || (req.Format != "png" && req.Format != "json" && req.Format != "zip") {
		return ErrInvalidScope
	}
	if req.Scope == "" {
		req.Scope = "board"
	}
	theme, err := normalizeTheme(req.Theme)
	if err != nil {
		return err
	}
	req.Theme = ""
	if req.Format == "png" {
		req.Theme = theme
	}
	if len(req.ElementIDs)+len(req.StampIDs) > document.PortableRecordLimit {
		return ErrTooLarge
	}
	switch req.Scope {
	case "board":
		if req.PageID != "" || len(req.ElementIDs)+len(req.StampIDs) > 0 {
			return ErrInvalidScope
		}
	case "page":
		if len(req.ElementIDs)+len(req.StampIDs) > 0 {
			return ErrInvalidScope
		}
	case "selection":
		if req.PageID == "" || len(req.ElementIDs)+len(req.StampIDs) == 0 {
			return ErrInvalidScope
		}
		slices.Sort(req.ElementIDs)
		req.ElementIDs = slices.Compact(req.ElementIDs)
		slices.Sort(req.StampIDs)
		req.StampIDs = slices.Compact(req.StampIDs)
	default:
		return ErrInvalidScope
	}
	return nil
}

type recordLocation struct {
	ID, PageID string
}

func scopeDocument(content document.Document, req ExportRequest) (document.Document, error) {
	if req.Scope == "board" {
		return content, nil
	}
	pageID := req.PageID
	if pageID == "" {
		pageID = content.DefaultPageID
	}
	scoped := document.Document{
		Name: content.Name, DefaultPageID: pageID,
		Elements: []json.RawMessage{}, Stamps: []json.RawMessage{},
	}
	for _, page := range content.Pages {
		var location recordLocation
		if err := json.Unmarshal(page, &location); err != nil {
			return document.Document{}, err
		}
		if location.ID == pageID {
			scoped.Pages = []json.RawMessage{page}
			break
		}
	}
	if len(scoped.Pages) == 0 {
		return document.Document{}, ErrInvalidScope
	}
	selection := req.Scope == "selection"
	elementsByID := make(map[string]renderElement)
	if selection {
		for _, raw := range content.Elements {
			var element renderElement
			if err := json.Unmarshal(raw, &element); err != nil {
				return document.Document{}, err
			}
			if element.PageID == pageID {
				elementsByID[element.ID] = element
			}
		}
	}
	for _, raw := range content.Elements {
		var location recordLocation
		if err := json.Unmarshal(raw, &location); err != nil {
			return document.Document{}, err
		}
		if location.PageID != pageID || (selection && !containsID(req.ElementIDs, location.ID)) {
			continue
		}
		if selection {
			var err error
			raw, err = isolateSelectionElement(raw, elementsByID[location.ID], elementsByID, req.ElementIDs)
			if err != nil {
				return document.Document{}, err
			}
		}
		scoped.Elements = append(scoped.Elements, raw)
	}
	for _, raw := range content.Stamps {
		var location recordLocation
		if err := json.Unmarshal(raw, &location); err != nil {
			return document.Document{}, err
		}
		if location.PageID == pageID && (!selection || containsID(req.StampIDs, location.ID)) {
			scoped.Stamps = append(scoped.Stamps, raw)
		}
	}
	if selection && (len(scoped.Elements) != len(req.ElementIDs) || len(scoped.Stamps) != len(req.StampIDs)) {
		return document.Document{}, ErrEmptySelection
	}
	return scoped, nil
}

func containsID(ids []string, id string) bool {
	_, found := slices.BinarySearch(ids, id)
	return found
}

func isolateSelectionElement(raw json.RawMessage, el renderElement, pageElements map[string]renderElement, ids []string) (json.RawMessage, error) {
	if el.Type != "frame" && el.Type != "connector" {
		return raw, nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	switch el.Type {
	case "frame":
		children := []string{}
		for _, id := range el.ChildIDs {
			if containsID(ids, id) {
				children = append(children, id)
			}
		}
		fields["childIds"], _ = json.Marshal(children)
	case "connector":
		for _, side := range []struct {
			id, anchor, elementKey, anchorKey, pointKey string
		}{
			{el.StartElementID, el.StartAnchor, "startElementId", "startAnchor", "startPoint"},
			{el.EndElementID, el.EndAnchor, "endElementId", "endAnchor", "endPoint"},
		} {
			if side.id == "" || containsID(ids, side.id) {
				continue
			}
			if target, found := pageElements[side.id]; found {
				fields[side.pointKey], _ = json.Marshal(elementAnchor(target, side.anchor))
			}
			delete(fields, side.elementKey)
			delete(fields, side.anchorKey)
		}
	}
	return json.Marshal(fields)
}
