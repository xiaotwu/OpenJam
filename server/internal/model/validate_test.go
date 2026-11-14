package model

import (
	"testing"
)

func TestValidateElements_Empty(t *testing.T) {
	count, err := ValidateElements(nil)
	if err != nil {
		t.Fatalf("nil should be valid: %v", err)
	}
	if count != 0 {
		t.Fatalf("nil count = %d, want 0", count)
	}

	count, err = ValidateElements([]interface{}{})
	if err != nil {
		t.Fatalf("empty array should be valid: %v", err)
	}
	if count != 0 {
		t.Fatalf("empty count = %d, want 0", count)
	}
}

func TestValidateElements_Valid(t *testing.T) {
	elements := []interface{}{
		map[string]interface{}{
			"id":     "el_1",
			"type":   "sticky",
			"x":      10,
			"y":      20,
			"width":  200,
			"height": 200,
			"text":   "hello",
		},
		map[string]interface{}{
			"id":         "el_2",
			"type":       "widget",
			"x":          100,
			"y":          200,
			"width":      300,
			"height":     250,
			"widgetType": "timer",
		},
	}
	count, err := ValidateElements(elements)
	if err != nil {
		t.Fatalf("valid elements rejected: %v", err)
	}
	if count != 2 {
		t.Fatalf("count = %d, want 2", count)
	}
}

func TestValidateElements_MissingID(t *testing.T) {
	elements := []interface{}{
		map[string]interface{}{
			"type": "sticky",
			"x":    0,
			"y":    0,
		},
	}
	_, err := ValidateElements(elements)
	if err == nil {
		t.Fatal("missing id should be rejected")
	}
}

func TestValidateElements_InvalidType(t *testing.T) {
	elements := []interface{}{
		map[string]interface{}{
			"id":   "el_1",
			"type": "unknown-type",
		},
	}
	_, err := ValidateElements(elements)
	if err == nil {
		t.Fatal("invalid type should be rejected")
	}
}

func TestValidateElements_NotArray(t *testing.T) {
	_, err := ValidateElements("not an array")
	if err == nil {
		t.Fatal("non-array should be rejected")
	}
}

func TestValidateStamps_Valid(t *testing.T) {
	stamps := []interface{}{
		map[string]interface{}{"id": "stamp_1", "emoji": "😀"},
	}
	if err := ValidateStamps(stamps); err != nil {
		t.Fatalf("valid stamps rejected: %v", err)
	}
}

func TestValidateStamps_MissingID(t *testing.T) {
	stamps := []interface{}{
		map[string]interface{}{"emoji": "😀"},
	}
	if err := ValidateStamps(stamps); err == nil {
		t.Fatal("stamp missing id should be rejected")
	}
}

func TestValidatePages_Valid(t *testing.T) {
	pages := []interface{}{
		map[string]interface{}{"id": "page-1", "name": "Page 1"},
	}
	if err := ValidatePages(pages); err != nil {
		t.Fatalf("valid pages rejected: %v", err)
	}
}

func TestValidatePages_MissingID(t *testing.T) {
	pages := []interface{}{
		map[string]interface{}{"name": "Page 1"},
	}
	if err := ValidatePages(pages); err == nil {
		t.Fatal("page missing id should be rejected")
	}
}