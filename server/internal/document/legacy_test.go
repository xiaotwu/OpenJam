package document

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestNormalizeLegacy(t *testing.T) {
	raw := json.RawMessage(`{
		"name":"stale title",
		"pages":[{"id":"intro","thumbnail":"inline"},{"id":"review","name":"Review"}],
		"currentPageId":"review",
		"elements":[
			{"id":"widget","type":"widget","widgetType":"custom","widgetData":{"score":9007199254740993}},
			{"id":"image","type":"image","pageId":"review","src":"data:image/png;base64,AA=="}
		],
		"stamps":[{"id":"stamp","pageId":"missing","emoji":"👍"}],
		"extension":{"keep":true}
	}`)
	result, err := normalizeLegacy("authoritative title", raw)
	if err != nil {
		t.Fatal(err)
	}
	doc := result.Document
	if doc.Name != "authoritative title" || doc.DefaultPageID != "review" || len(doc.Pages) != 2 {
		t.Fatalf("migration metadata = %+v", doc)
	}
	assertRecordField(t, doc.Pages[0], "name", `"Page 1"`)
	assertRecordField(t, doc.Pages[0], "thumbnail", `"inline"`)
	assertRecordField(t, doc.Elements[0], "pageId", `"intro"`)
	assertRecordField(t, doc.Elements[0], "widgetData", `{"score":9007199254740993}`)
	assertRecordField(t, doc.Elements[1], "pageId", `"review"`)
	assertRecordField(t, doc.Elements[1], "src", `"data:image/png;base64,AA=="`)
	assertRecordField(t, doc.Stamps[0], "pageId", `"intro"`)

	projection, err := legacyProjection(doc, result.Extra)
	if err != nil {
		t.Fatal(err)
	}
	assertRecordField(t, projection, "currentPageId", `"review"`)
	assertRecordField(t, projection, "extension", `{"keep":true}`)
}

func TestNormalizeLegacyEmptyOrAmbiguous(t *testing.T) {
	for _, raw := range []json.RawMessage{nil, json.RawMessage("null"), json.RawMessage("{}")} {
		result, err := normalizeLegacy("empty", raw)
		if err != nil || result.Document.DefaultPageID != "page-1" ||
			len(result.Document.Pages) != 1 || result.Document.Elements == nil || result.Document.Stamps == nil {
			t.Fatalf("empty migration %q = %+v, %v", raw, result, err)
		}
	}
	for _, raw := range []json.RawMessage{
		json.RawMessage(`[]`),
		json.RawMessage(`{"pages":[null]}`),
		json.RawMessage(`{"stamps":{}}`),
		json.RawMessage(`{"elements":[{"id":"a","type":"sticky"},{"id":"a","type":"text"}]}`),
		json.RawMessage(`{"elements":[{"id":"a"}]}`),
	} {
		if _, err := normalizeLegacy("ambiguous", raw); !errors.Is(err, ErrMigrationBlocked) {
			t.Errorf("normalize %s: got %v, want migration blocked", raw, err)
		}
	}
}

func assertRecordField(t *testing.T, record json.RawMessage, field, want string) {
	t.Helper()
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(record, &fields); err != nil {
		t.Fatal(err)
	}
	if got := string(fields[field]); got != want {
		t.Errorf("field %q = %s, want %s", field, got, want)
	}
}
