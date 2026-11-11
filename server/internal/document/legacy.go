package document

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

type normalizedLegacy struct {
	Document Document
	Extra    json.RawMessage
}

func normalizeLegacy(name string, raw json.RawMessage) (normalizedLegacy, error) {
	fields := map[string]json.RawMessage{}
	if len(raw) != 0 && !bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		if err := json.Unmarshal(raw, &fields); err != nil {
			return normalizedLegacy{}, fmt.Errorf("%w: board snapshot must be a JSON object", ErrMigrationBlocked)
		}
	}

	pages, pageIDs, err := normalizeRecords(fields["pages"], "page", nil, "")
	if err != nil {
		return normalizedLegacy{}, err
	}
	if len(pages) == 0 {
		pages = append(pages, json.RawMessage(`{"id":"page-1","name":"Page 1"}`))
		pageIDs["page-1"] = true
	}
	var first struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(pages[0], &first); err != nil {
		return normalizedLegacy{}, err
	}
	defaultPageID := rawString(fields["currentPageId"])
	if !pageIDs[defaultPageID] {
		defaultPageID = first.ID
	}
	elements, _, err := normalizeRecords(fields["elements"], "element", pageIDs, first.ID)
	if err != nil {
		return normalizedLegacy{}, err
	}
	stamps, _, err := normalizeRecords(fields["stamps"], "stamp", pageIDs, first.ID)
	if err != nil {
		return normalizedLegacy{}, err
	}
	for _, field := range []string{"name", "pages", "elements", "stamps", "currentPageId", "updatedAt"} {
		delete(fields, field)
	}
	extra, err := json.Marshal(fields)
	if err != nil {
		return normalizedLegacy{}, err
	}
	return normalizedLegacy{
		Document: Document{
			Name: name, DefaultPageID: defaultPageID, Pages: pages, Elements: elements, Stamps: stamps,
		},
		Extra: extra,
	}, nil
}

func normalizeRecords(raw json.RawMessage, kind string, pages map[string]bool, firstPageID string) ([]json.RawMessage, map[string]bool, error) {
	var input []map[string]json.RawMessage
	if len(raw) != 0 {
		if err := json.Unmarshal(raw, &input); err != nil {
			return nil, nil, fmt.Errorf("%w: %ss must be an array of objects", ErrMigrationBlocked, kind)
		}
	}
	result := make([]json.RawMessage, 0, len(input))
	ids := make(map[string]bool, len(input))
	for i, fields := range input {
		id := rawString(fields["id"])
		if !validEntityID(id) || ids[id] {
			return nil, nil, fmt.Errorf("%w: %s at index %d has a missing, invalid, or duplicate ID", ErrMigrationBlocked, kind, i)
		}
		ids[id] = true
		if kind == "page" {
			if strings.TrimSpace(rawString(fields["name"])) == "" {
				fields["name"] = jsonString(fmt.Sprintf("Page %d", i+1))
			}
		} else if !pages[rawString(fields["pageId"])] {
			fields["pageId"] = jsonString(firstPageID)
		}
		if kind == "element" && strings.TrimSpace(rawString(fields["type"])) == "" {
			return nil, nil, fmt.Errorf("%w: element at index %d has no type", ErrMigrationBlocked, i)
		}
		data, err := json.Marshal(fields)
		if err != nil {
			return nil, nil, err
		}
		result = append(result, data)
	}
	return result, ids, nil
}

func rawString(raw json.RawMessage) string {
	var value string
	_ = json.Unmarshal(raw, &value)
	return value
}

func jsonString(value string) json.RawMessage {
	data, _ := json.Marshal(value)
	return data
}

func validEntityID(id string) bool {
	return len(id) <= 1024 && strings.TrimSpace(id) != "" && !strings.ContainsRune(id, 0)
}

func legacyProjection(document Document, extra json.RawMessage) ([]byte, error) {
	var extraFields map[string]json.RawMessage
	if err := json.Unmarshal(extra, &extraFields); err != nil {
		return nil, err
	}
	fields := make(map[string]any, len(extraFields)+5)
	for key, value := range extraFields {
		fields[key] = value
	}
	fields["name"] = document.Name
	fields["currentPageId"] = document.DefaultPageID
	fields["pages"] = document.Pages
	fields["elements"] = document.Elements
	fields["stamps"] = document.Stamps
	return json.Marshal(fields)
}
