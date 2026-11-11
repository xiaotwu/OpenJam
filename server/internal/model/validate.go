package model

import (
	"encoding/json"
	"fmt"
	"strings"
)

// BoardElement is a minimal structural mirror of the frontend Element type.
// We validate shape rather than enforce every field so that the backend can
// reject malformed/garbage payloads without being coupled to the full TS type.
type BoardElement struct {
	ID       string                 `json:"id"`
	Type     string                 `json:"type"`
	X        float64                `json:"x"`
	Y        float64                `json:"y"`
	Width    float64                `json:"width"`
	Height   float64                `json:"height"`
	ZIndex   float64                `json:"zIndex"`
	Locked   bool                   `json:"locked"`
	Opacity  float64                `json:"opacity"`
	// Allow arbitrary extra fields (stroke, text, widgetData, etc.) without
	// rejecting them; we only validate the structural core.
	WidgetData map[string]interface{} `json:"-"`
}

// validElementTypes mirrors the frontend ElementType union.
var validElementTypes = map[string]bool{
	"sticky":    true,
	"shape":     true,
	"text":      true,
	"connector": true,
	"drawing":   true,
	"image":     true,
	"frame":     true,
	"widget":    true,
}

// ValidateElements unmarshals a raw JSON array of elements and validates each
// entry has the required core fields and a known type. Returns the count on
// success or an error describing the first problem found.
func ValidateElements(raw interface{}) (int, error) {
	if raw == nil {
		return 0, nil
	}

	rawBytes, err := json.Marshal(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid elements payload: %w", err)
	}

	// Treat nil/null or empty as valid (empty board).
	if string(rawBytes) == "null" || string(rawBytes) == "[]" {
		return 0, nil
	}

	var arr []json.RawMessage
	if err := json.Unmarshal(rawBytes, &arr); err != nil {
		return 0, fmt.Errorf("elements must be an array: %w", err)
	}

	for i, rawEl := range arr {
		var el BoardElement
		if err := json.Unmarshal(rawEl, &el); err != nil {
			return 0, fmt.Errorf("element %d has invalid structure: %w", i, err)
		}
		if strings.TrimSpace(el.ID) == "" {
			return 0, fmt.Errorf("element %d is missing required field 'id'", i)
		}
		if !validElementTypes[el.Type] {
			return 0, fmt.Errorf("element %d has invalid type %q", i, el.Type)
		}
	}

	return len(arr), nil
}

// ValidateStamps does a light structural check: must be an array of objects
// each carrying an id. Stamps are optional so nil/empty is fine.
func ValidateStamps(raw interface{}) error {
	if raw == nil {
		return nil
	}
	rawBytes, err := json.Marshal(raw)
	if err != nil {
		return fmt.Errorf("invalid stamps payload: %w", err)
	}
	if string(rawBytes) == "null" || string(rawBytes) == "[]" {
		return nil
	}

	var arr []map[string]json.RawMessage
	if err := json.Unmarshal(rawBytes, &arr); err != nil {
		return fmt.Errorf("stamps must be an array: %w", err)
	}
	for i, s := range arr {
		idRaw, ok := s["id"]
		if !ok {
			return fmt.Errorf("stamp %d is missing field 'id'", i)
		}
		var id string
		if err := json.Unmarshal(idRaw, &id); err != nil || strings.TrimSpace(id) == "" {
			return fmt.Errorf("stamp %d has invalid id", i)
		}
	}
	return nil
}

// ValidatePages checks the pages array: each page needs an id and name.
func ValidatePages(raw interface{}) error {
	if raw == nil {
		return nil
	}
	rawBytes, err := json.Marshal(raw)
	if err != nil {
		return fmt.Errorf("invalid pages payload: %w", err)
	}
	if string(rawBytes) == "null" || string(rawBytes) == "[]" {
		return nil
	}

	var arr []map[string]json.RawMessage
	if err := json.Unmarshal(rawBytes, &arr); err != nil {
		return fmt.Errorf("pages must be an array: %w", err)
	}
	for i, p := range arr {
		idRaw, ok := p["id"]
		if !ok {
			return fmt.Errorf("page %d is missing field 'id'", i)
		}
		var id string
		if err := json.Unmarshal(idRaw, &id); err != nil || strings.TrimSpace(id) == "" {
			return fmt.Errorf("page %d has invalid id", i)
		}
	}
	return nil
}