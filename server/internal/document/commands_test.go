package document

import (
	"encoding/json"
	"testing"
)

func TestDocumentCommandJSONEquality(t *testing.T) {
	if !equalJSON(
		json.RawMessage(`{"z":[1e2, -0], "a":{"b":9007199254740993}}`),
		json.RawMessage(`{"a":{"b":9007199254740993.0},"z":[100,0.0]}`),
	) {
		t.Fatal("equivalent JSON values differ")
	}
	if equalJSON(json.RawMessage(`9007199254740993`), json.RawMessage(`9007199254740992`)) {
		t.Fatal("distinct integers lost precision")
	}
	if !equalJSON(nil, json.RawMessage("null")) {
		t.Fatal("a missing expected field must match null")
	}
	for _, raw := range []string{`1e10000000`, `"a\u0000b"`} {
		if _, err := canonicalJSON([]byte(raw)); err == nil {
			t.Errorf("canonicalJSON(%s) should reject an unsupported PostgreSQL value", raw)
		}
	}
}
