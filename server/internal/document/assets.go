package document

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/assets"
)

func validateImageRecord(ctx context.Context, tx pgx.Tx, boardID string, operation Operation, fields map[string]json.RawMessage) error {
	id, err := assets.Reference(fields)
	if err != nil {
		return invalidCommand("An image asset requires a valid asset ID and no external source.")
	}
	if id != "" {
		err := assets.RequireLinked(ctx, tx, boardID, []string{id})
		if errors.Is(err, assets.ErrNotFound) {
			return operationConflict(operation, "assetId", "Upload this image to the destination board before adding it.")
		}
		return err
	}
	if rawString(fields["type"]) != "image" || operation.Kind == "restore" {
		return nil
	}
	if operation.Kind == "patch" && operation.Fields["src"] == nil && operation.Fields["assetId"] == nil &&
		!slices.Contains(operation.Unset, "src") && !slices.Contains(operation.Unset, "assetId") {
		return nil
	}
	var source string
	if value := fields["src"]; value != nil && json.Unmarshal(value, &source) != nil {
		return invalidCommand("Invalid image source.")
	}
	if source == "" {
		return nil
	}
	// Retain existing legacy images when a page or object is duplicated. New
	// image bytes always enter the board through the private upload endpoint.
	var copiedLegacyImage bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM board_elements WHERE board_id = $1
			AND data->>'type' = 'image' AND NOT (data ? 'assetId') AND data->>'src' = $2
		)
	`, boardID, source).Scan(&copiedLegacyImage); err != nil {
		return err
	}
	if !copiedLegacyImage {
		return invalidCommand("Upload new images as private board assets.")
	}
	return nil
}

func requireDocumentAssets(ctx context.Context, tx pgx.Tx, boardID string, content Document) error {
	ids, err := assets.References(content.Elements)
	if err != nil {
		return err
	}
	return assets.RequireLinked(ctx, tx, boardID, ids)
}
