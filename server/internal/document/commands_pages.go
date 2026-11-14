package document

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
)

func reorderPage(ctx context.Context, tx pgx.Tx, state *commitState, operation Operation, record documentRecord) (Delta, error) {
	if operation.Collection != "pages" || operation.Position == nil || len(operation.Value) != 0 ||
		len(operation.Fields) != 0 || len(operation.Unset) != 0 || len(operation.Expected) != 1 {
		return Delta{}, invalidCommand("Page reordering requires a position and the previous page order.")
	}
	var expected []string
	if err := json.Unmarshal(operation.Expected["order"], &expected); err != nil || expected == nil {
		return Delta{}, invalidCommand("Invalid previous page order.")
	}
	rows, err := tx.Query(ctx, `SELECT id FROM board_pages WHERE board_id = $1 AND NOT deleted ORDER BY position, id`, state.room.ID)
	if err != nil {
		return Delta{}, err
	}
	order, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return Delta{}, err
	}
	if !slices.Equal(order, expected) {
		current, err := json.Marshal(order)
		if err != nil {
			return Delta{}, err
		}
		return Delta{}, fieldConflict(operation, "order", current)
	}
	if *operation.Position >= int64(len(order)) {
		return Delta{}, invalidCommand("The requested page position is outside the page list.")
	}
	index := slices.Index(order, operation.ID)
	order = slices.Delete(order, index, index+1)
	order = slices.Insert(order, int(*operation.Position), operation.ID)
	if _, err := tx.Exec(ctx, `
		UPDATE board_pages AS page SET position = rank.ordinality - 1
		FROM unnest($2::text[]) WITH ORDINALITY AS rank(id, ordinality)
		WHERE page.board_id = $1 AND page.id = rank.id AND page.position IS DISTINCT FROM rank.ordinality - 1
	`, state.room.ID, order); err != nil {
		return Delta{}, err
	}
	return Delta{Kind: "upsert", Collection: "pages", ID: operation.ID, Value: record.data, Position: operation.Position}, nil
}

func setDefaultPage(ctx context.Context, tx pgx.Tx, state *commitState, operation Operation) error {
	pageID := rawString(operation.Value)
	if !validEntityID(pageID) || operation.Collection != "" || operation.ID != "" || operation.Position != nil ||
		len(operation.Fields) != 0 || len(operation.Unset) != 0 || len(operation.Expected) != 1 || operation.Expected["defaultPageId"] == nil {
		return invalidCommand("Choosing a default page requires the previous default page ID.")
	}
	if current := jsonString(state.head.DefaultPageID); !equalJSON(operation.Expected["defaultPageId"], current) {
		return fieldConflict(operation, "defaultPageId", current)
	}
	page, err := findRecord(ctx, tx, "board_pages", state.room.ID, pageID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && page.deleted) {
		return operationConflict(operation, "defaultPageId", "The requested default page is no longer available.")
	}
	if err != nil {
		return err
	}
	state.head.DefaultPageID = pageID
	return nil
}
