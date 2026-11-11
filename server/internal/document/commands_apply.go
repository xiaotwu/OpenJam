package document

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/model"
)

type documentRecord struct {
	data     json.RawMessage
	position int64
	revision int64
	deleted  bool
}

func applyOperation(ctx context.Context, tx pgx.Tx, state *commitState, operation Operation) (Delta, error) {
	if state.room.Kind == model.ResourceSlides {
		if err := validateSlideOperation(operation); err != nil {
			return Delta{}, err
		}
	}
	if state.room.Kind == model.ResourceSheet && operation.Kind != "rename" {
		switch {
		case operation.Kind == "setCell":
			return applySheetCell(ctx, tx, state, operation)
		case operation.Collection == "pages" && (operation.Kind == "add" || operation.Kind == "delete" || operation.Kind == "restore"):
			if operation.Kind == "delete" && len(operation.Expected) == 0 {
				return Delta{}, invalidCommand("Removing a worksheet requires its previous name.")
			}
		default:
			return Delta{}, invalidCommand("Invalid worksheet edit.")
		}
	}
	if state.room.Kind == model.ResourceDoc && operation.Kind != "rename" && operation.Kind != "setDefaultPage" {
		if err := validateDocOperation(operation); err != nil {
			return Delta{}, err
		}
	}
	switch operation.Kind {
	case "rename":
		return renameDocument(state, operation)
	case "setDefaultPage":
		return Delta{}, setDefaultPage(ctx, tx, state, operation)
	}
	table := collectionTable(operation.Collection)
	if table == "" || !validEntityID(operation.ID) {
		return Delta{}, invalidCommand("Invalid document collection or ID.")
	}
	if operation.Position != nil && (operation.Collection != "pages" ||
		(operation.Kind != "add" && operation.Kind != "restore" && operation.Kind != "reorder") ||
		*operation.Position < 0 || *operation.Position > maxSafeSequence) {
		return Delta{}, invalidCommand("Invalid page position.")
	}

	record, err := findRecord(ctx, tx, table, state.room.ID, operation.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Delta{}, err
	}
	switch operation.Kind {
	case "add":
		if !errors.Is(err, pgx.ErrNoRows) {
			return Delta{}, operationConflict(operation, "", "This document ID already exists or was deleted.")
		}
		return addRecord(ctx, tx, state, table, operation)
	case "restore":
		if err != nil || !record.deleted {
			return Delta{}, operationConflict(operation, "", "Only a deleted object can be restored.")
		}
		return restoreRecord(ctx, tx, state, table, operation, record)
	case "reorder":
		if err != nil || record.deleted {
			return Delta{}, operationConflict(operation, "", "This page is no longer available.")
		}
		return reorderPage(ctx, tx, state, operation, record)
	case "vote":
		if operation.Collection != "elements" || err != nil || record.deleted {
			return Delta{}, operationConflict(operation, "", "This voting widget is no longer available.")
		}
		return voteOnWidget(ctx, tx, state, operation, record)
	case "patch", "delete":
		if err != nil || record.deleted {
			return Delta{}, operationConflict(operation, "", "This object is no longer available.")
		}
		if operation.Kind == "delete" {
			return deleteRecord(ctx, tx, state, table, operation, record)
		}
		return patchRecord(ctx, tx, state, table, operation, record)
	default:
		return Delta{}, invalidCommand("Unknown document operation.")
	}
}

func collectionTable(collection string) string {
	switch collection {
	case "pages":
		return "board_pages"
	case "elements":
		return "board_elements"
	case "stamps":
		return "board_stamps"
	default:
		return ""
	}
}

func findRecord(ctx context.Context, tx pgx.Tx, table, boardID, id string) (documentRecord, error) {
	var record documentRecord
	err := tx.QueryRow(ctx, fmt.Sprintf(`
		SELECT data, position, revision, deleted FROM %s WHERE board_id = $1 AND id = $2
	`, table), boardID, id).Scan(&record.data, &record.position, &record.revision, &record.deleted)
	return record, err
}

func operationConflict(operation Operation, field, message string) error {
	details := map[string]any{"collection": operation.Collection, "id": operation.ID}
	if field != "" {
		details["field"] = field
	}
	return &CommandFault{Code: "CONFLICT", Message: message, Details: details}
}

func fieldConflict(operation Operation, field string, current json.RawMessage) error {
	err := operationConflict(operation, field, "This field changed since the edit was prepared.").(*CommandFault)
	if len(current) <= 8192 {
		if len(current) == 0 {
			current = json.RawMessage("null")
		}
		err.Details["current"] = current
	}
	return err
}

func renameDocument(state *commitState, operation Operation) (Delta, error) {
	if operation.Collection != "" || operation.ID != "" || len(operation.Fields) != 0 ||
		len(operation.Unset) != 0 || operation.Position != nil || len(operation.Expected) > 1 {
		return Delta{}, invalidCommand("Invalid rename operation.")
	}
	name := strings.TrimSpace(rawString(operation.Value))
	if name == "" || utf8.RuneCountInString(name) > 255 || strings.ContainsRune(name, 0) {
		return Delta{}, invalidCommand("A file name must contain between 1 and 255 characters.")
	}
	current := jsonString(state.room.Name)
	if expected, supplied := operation.Expected["name"]; supplied {
		if !equalJSON(expected, current) {
			return Delta{}, fieldConflict(operation, "name", current)
		}
	} else if len(operation.Expected) != 0 {
		return Delta{}, invalidCommand("A rename can only compare the previous name.")
	} else if state.baseSeq < state.head.Seq {
		return Delta{}, fieldConflict(operation, "name", current)
	}
	state.room.Name = name
	state.nameDirty = true
	return Delta{Kind: "rename", Value: jsonString(name)}, nil
}

func addRecord(ctx context.Context, tx pgx.Tx, state *commitState, table string, operation Operation) (Delta, error) {
	fields, err := fullRecord(operation)
	if err != nil {
		return Delta{}, err
	}
	switch operation.Collection {
	case "elements":
		fields["createdBy"] = jsonString(state.actor.String())
		if err := validateVotingEdit(fields, nil); err != nil {
			return Delta{}, err
		}
	case "stamps":
		fields["userId"] = jsonString(state.actor.String())
	}
	if operation.Collection != "pages" && len(fields["pageId"]) == 0 {
		fields["pageId"] = jsonString(state.head.DefaultPageID)
	}
	data, pageID, err := validateRecord(ctx, tx, state.room, operation, fields)
	if err != nil {
		return Delta{}, err
	}

	var position int64
	if operation.Collection == "pages" {
		position, err = makePagePosition(ctx, tx, state.room.ID, operation.Position)
		if err != nil {
			return Delta{}, err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO board_pages (board_id, id, data, position, revision) VALUES ($1, $2, $3, $4, $5)
		`, state.room.ID, operation.ID, data, position, state.seq)
	} else {
		err = tx.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %s (board_id, id, page_id, data, position, revision)
			VALUES ($1::varchar, $2, $3, $4, (
				SELECT COALESCE(max(position) + 1, 0) FROM %s WHERE board_id = $1
			), $5)
			RETURNING position
		`, table, table), state.room.ID, operation.ID, pageID, data, state.seq).Scan(&position)
	}
	if err != nil {
		return Delta{}, err
	}
	return upsertDelta(ctx, tx, state.room.ID, table, operation, data, position)
}

func fullRecord(operation Operation) (map[string]json.RawMessage, error) {
	if len(operation.Fields) != 0 || len(operation.Unset) != 0 || len(operation.Expected) != 0 {
		return nil, invalidCommand("An add or restore must carry one complete value.")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(operation.Value, &fields); err != nil || rawString(fields["id"]) != operation.ID {
		return nil, invalidCommand("The object value must contain its matching ID.")
	}
	return fields, nil
}

func makePagePosition(ctx context.Context, tx pgx.Tx, boardID string, requested *int64) (int64, error) {
	var count int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM board_pages WHERE board_id = $1 AND NOT deleted`, boardID).Scan(&count); err != nil {
		return 0, err
	}
	position := count
	if requested != nil {
		position = min(*requested, count)
	}
	// Page insertions address logical indexes, including after page tombstones.
	_, err := tx.Exec(ctx, `
		WITH ranked AS (
			SELECT id, row_number() OVER (ORDER BY position, id) - 1 AS index
			FROM board_pages WHERE board_id = $1 AND NOT deleted
		)
		UPDATE board_pages p SET position = r.index + CASE WHEN r.index >= $2 THEN 1 ELSE 0 END
		FROM ranked r WHERE p.board_id = $1 AND p.id = r.id
		AND p.position IS DISTINCT FROM r.index + CASE WHEN r.index >= $2 THEN 1 ELSE 0 END
	`, boardID, position)
	return position, err
}

func patchRecord(ctx context.Context, tx pgx.Tx, state *commitState, table string, operation Operation, record documentRecord) (Delta, error) {
	if len(operation.Value) != 0 || len(operation.Fields)+len(operation.Unset) == 0 {
		return Delta{}, invalidCommand("A patch must contain changed fields or keys to unset.")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(record.data, &fields); err != nil {
		return Delta{}, err
	}
	for key, expected := range operation.Expected {
		if !equalJSON(fields[key], expected) {
			return Delta{}, fieldConflict(operation, key, fields[key])
		}
	}
	for key, value := range operation.Fields {
		if err := validatePatchField(state, operation, record, key, fields[key]); err != nil {
			return Delta{}, err
		}
		fields[key] = value
	}
	for _, key := range operation.Unset {
		if _, set := operation.Fields[key]; set {
			return Delta{}, invalidCommand("A field cannot be set and unset in the same patch.")
		}
		if err := validatePatchField(state, operation, record, key, fields[key]); err != nil {
			return Delta{}, err
		}
		delete(fields, key)
	}
	if operation.Collection == "elements" && (operation.Fields["widgetData"] != nil || slices.Contains(operation.Unset, "widgetData")) {
		if err := validateVotingEdit(fields, record.data); err != nil {
			return Delta{}, err
		}
	}
	data, pageID, err := validateRecord(ctx, tx, state.room, operation, fields)
	if err != nil {
		return Delta{}, err
	}
	if operation.Collection == "pages" {
		_, err = tx.Exec(ctx, `UPDATE board_pages SET data = $3, revision = $4 WHERE board_id = $1 AND id = $2`,
			state.room.ID, operation.ID, data, state.seq)
	} else {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			UPDATE %s SET data = $3, page_id = $4, revision = $5 WHERE board_id = $1 AND id = $2
		`, table), state.room.ID, operation.ID, data, pageID, state.seq)
	}
	if err != nil {
		return Delta{}, err
	}
	return upsertDelta(ctx, tx, state.room.ID, table, operation, data, record.position)
}

func validatePatchField(state *commitState, operation Operation, record documentRecord, key string, current json.RawMessage) error {
	switch key {
	case "id", "type", "createdAt", "createdBy", "userId", "widgetType":
		return invalidCommand("This identity field cannot be edited.")
	case "text", "name", "widgetData":
		if _, compared := operation.Expected[key]; !compared && state.baseSeq < state.head.Seq && record.revision > state.baseSeq {
			return fieldConflict(operation, key, current)
		}
	}
	return nil
}

func validateRecord(ctx context.Context, tx pgx.Tx, room lockedRoom, operation Operation, fields map[string]json.RawMessage) (json.RawMessage, string, error) {
	boardID := room.ID
	for _, key := range []string{"__proto__", "constructor", "prototype"} {
		if _, found := fields[key]; found {
			return nil, "", invalidCommand("The document contains a reserved field.")
		}
	}
	data, err := json.Marshal(fields)
	if err != nil {
		return nil, "", invalidCommand("The document object is invalid.")
	}
	if operation.Collection == "pages" {
		if room.Kind == model.ResourceDoc {
			if err := validateDocBlock(fields); err != nil {
				return nil, "", err
			}
		}
		if room.Kind == model.ResourceSheet {
			if err := validateSheetTab(fields); err != nil {
				return nil, "", err
			}
		}
		if room.Kind == model.ResourceSlides {
			if err := validateSlidePage(fields, data); err != nil {
				return nil, "", err
			}
		}
		if name := rawString(fields["name"]); strings.TrimSpace(name) == "" || strings.ContainsRune(name, 0) {
			return nil, "", invalidCommand("A page name is required.")
		}
		return data, "", nil
	}
	if operation.Collection == "elements" {
		if room.Kind == model.ResourceSlides {
			if err := validateSlideObject(fields, data); err != nil {
				return nil, "", err
			}
		}
		if _, err := model.ValidateElements([]json.RawMessage{data}); err != nil {
			return nil, "", invalidCommand("Invalid element shape or type.")
		}
		if err := validateImageRecord(ctx, tx, boardID, operation, fields); err != nil {
			return nil, "", err
		}
	}
	pageID := rawString(fields["pageId"])
	if !validEntityID(pageID) {
		return nil, "", invalidCommand("A document object requires a valid page ID.")
	}
	var live bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM board_pages WHERE board_id = $1 AND id = $2 AND NOT deleted)
	`, boardID, pageID).Scan(&live); err != nil {
		return nil, "", err
	}
	if !live {
		return nil, "", operationConflict(operation, "pageId", "The destination page is no longer available.")
	}
	return data, pageID, nil
}

func restoreRecord(ctx context.Context, tx pgx.Tx, state *commitState, table string, operation Operation, record documentRecord) (Delta, error) {
	if _, err := fullRecord(operation); err != nil {
		return Delta{}, err
	}
	var actor uuid.NullUUID
	var client uuid.NullUUID
	if err := tx.QueryRow(ctx, fmt.Sprintf(`
		SELECT deleted_by, deleted_client_id FROM %s WHERE board_id = $1 AND id = $2
	`, table), state.room.ID, operation.ID).Scan(&actor, &client); err != nil {
		return Delta{}, err
	}
	if !actor.Valid || !client.Valid || actor.UUID != state.actor || client.UUID.String() != state.clientID {
		return Delta{}, operationConflict(operation, "", "Only the editor and client that deleted this object can restore it.")
	}
	position := record.position
	if operation.Collection == "pages" {
		requested := operation.Position
		if requested == nil {
			requested = &record.position
		}
		var err error
		position, err = makePagePosition(ctx, tx, state.room.ID, requested)
		if err != nil {
			return Delta{}, err
		}
	} else {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(record.data, &fields); err != nil {
			return Delta{}, err
		}
		if _, _, err := validateRecord(ctx, tx, state.room, operation, fields); err != nil {
			return Delta{}, err
		}
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf(`
		UPDATE %s SET position = $3, revision = $4, deleted = FALSE,
			deleted_by = NULL, deleted_client_id = NULL WHERE board_id = $1 AND id = $2
	`, table), state.room.ID, operation.ID, position, state.seq); err != nil {
		return Delta{}, err
	}
	return upsertDelta(ctx, tx, state.room.ID, table, operation, record.data, position)
}

func deleteRecord(ctx context.Context, tx pgx.Tx, state *commitState, table string, operation Operation, record documentRecord) (Delta, error) {
	if len(operation.Value)+len(operation.Fields)+len(operation.Unset) != 0 {
		return Delta{}, invalidCommand("A delete can only carry an ID and an expected object.")
	}
	if len(operation.Expected) != 0 {
		expected, err := json.Marshal(operation.Expected)
		if err != nil || !equalJSON(record.data, expected) {
			return Delta{}, operationConflict(operation, "", "This object changed since the deletion was prepared.")
		}
	}
	if operation.Collection == "pages" {
		if err := checkPageDelete(ctx, tx, state.room.ID, operation); err != nil {
			return Delta{}, err
		}
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf(`
		UPDATE %s SET deleted = TRUE, revision = $3, deleted_by = $4, deleted_client_id = $5
		WHERE board_id = $1 AND id = $2
	`, table), state.room.ID, operation.ID, state.seq, state.actor, state.clientID); err != nil {
		return Delta{}, err
	}
	if operation.Collection == "pages" && state.head.DefaultPageID == operation.ID {
		if err := tx.QueryRow(ctx, `
			SELECT id FROM board_pages WHERE board_id = $1 AND NOT deleted ORDER BY position, id LIMIT 1
		`, state.room.ID).Scan(&state.head.DefaultPageID); err != nil {
			return Delta{}, err
		}
	}
	return Delta{Kind: "delete", Collection: operation.Collection, ID: operation.ID}, nil
}

func checkPageDelete(ctx context.Context, tx pgx.Tx, boardID string, operation Operation) error {
	var count int64
	var occupied bool
	err := tx.QueryRow(ctx, `
		SELECT count(*), EXISTS (
			SELECT 1 FROM board_elements WHERE board_id = $1 AND page_id = $2 AND NOT deleted
		) OR EXISTS (
			SELECT 1 FROM board_stamps WHERE board_id = $1 AND page_id = $2 AND NOT deleted
		)
		FROM board_pages WHERE board_id = $1 AND NOT deleted
	`, boardID, operation.ID).Scan(&count, &occupied)
	if err != nil {
		return err
	}
	if count <= 1 {
		return operationConflict(operation, "", "This file must keep at least one page or block.")
	}
	if occupied {
		return operationConflict(operation, "", "Move or remove the page contents before deleting it.")
	}
	return nil
}

func upsertDelta(ctx context.Context, tx pgx.Tx, boardID, table string, operation Operation, data json.RawMessage, position int64) (Delta, error) {
	var index int64
	err := tx.QueryRow(ctx, fmt.Sprintf(`
		SELECT count(*) FROM %s WHERE board_id = $1 AND NOT deleted AND (position, id) < ($2, $3)
	`, table), boardID, position, operation.ID).Scan(&index)
	if err != nil {
		return Delta{}, err
	}
	return Delta{Kind: "upsert", Collection: operation.Collection, ID: operation.ID, Value: data, Position: &index}, nil
}
