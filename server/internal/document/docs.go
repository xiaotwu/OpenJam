package document

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/docformat"
	"github.com/project-wb/server/internal/model"
)

type docPage struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	DocBlock bool   `json:"docBlock"`
	docformat.Block
}

func CreateDoc(ctx context.Context, actor, projectID uuid.UUID, name string, blocks []docformat.Block) (model.DirectoryBoard, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 255 || strings.ContainsRune(name, 0) {
		return model.DirectoryBoard{}, invalidCommand("Enter a document name of up to 255 characters.")
	}
	if len(blocks) == 0 {
		blocks = []docformat.Block{{FontFamily: docformat.DefaultFont}}
	}
	if err := docformat.CheckBlocks(blocks); err != nil {
		return model.DirectoryBoard{}, err
	}
	content := Document{Name: name, Elements: []json.RawMessage{}, Stamps: []json.RawMessage{}}
	for _, block := range blocks {
		page := docPage{ID: uuid.NewString(), Name: "Block", DocBlock: true, Block: block}
		if content.DefaultPageID == "" {
			content.DefaultPageID = page.ID
		}
		value, err := json.Marshal(page)
		if err != nil {
			return model.DirectoryBoard{}, err
		}
		content.Pages = append(content.Pages, value)
	}

	return createNativeResource(ctx, actor, projectID, content, model.ResourceDoc, "Initial document", nil)
}

func createNativeResource(ctx context.Context, actor, projectID uuid.UUID, content Document, kind, versionName string, media []assets.Metadata) (model.DirectoryBoard, error) {
	var resource model.DirectoryBoard
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		created, err := model.CreateProjectCollaborativeResource(ctx, tx, actor, projectID, content.Name, kind)
		if err != nil {
			return err
		}
		room := lockedRoom{ID: created.ID, Name: created.Name, Kind: created.Kind, UpdatedAt: created.UpdatedAt}
		if err := assets.Grant(ctx, tx, room.ID, media); err != nil {
			return err
		}
		head := Head{Mode: modeActive, Epoch: 1, DefaultPageID: content.DefaultPageID}
		if _, err := tx.Exec(ctx, `
			INSERT INTO board_heads (board_id, mode, epoch, default_page_id) VALUES ($1, $2, $3, $4)
		`, room.ID, head.Mode, head.Epoch, head.DefaultPageID); err != nil {
			return err
		}
		if err := materializeDocument(ctx, tx, room.ID, head.Seq, content); err != nil {
			return err
		}
		snapshot, err := snapshotLocked(ctx, tx, room, head, created.Permission)
		if err != nil {
			return err
		}
		if _, err := storeVersion(ctx, tx, snapshot, versionMarker{kind: versionCheckpoint, name: versionName, actor: &actor}); err != nil {
			return err
		}
		resource = created
		return nil
	})
	return resource, err
}

func DocBlocks(snapshot Snapshot) ([]docformat.Block, error) {
	if snapshot.ResourceKind != model.ResourceDoc {
		return nil, model.ErrRoomNotFound
	}
	blocks := make([]docformat.Block, 0, len(snapshot.Document.Pages))
	for _, record := range snapshot.Document.Pages {
		var page docPage
		if err := json.Unmarshal(record, &page); err != nil || !page.DocBlock {
			return nil, docformat.ErrInvalidFile
		}
		blocks = append(blocks, page.Block)
	}
	return blocks, docformat.CheckBlocks(blocks)
}

func validateDocOperation(operation Operation) error {
	if operation.Collection != "pages" {
		return invalidCommand("Docs only accept text block edits.")
	}
	switch operation.Kind {
	case "add", "restore", "reorder":
		return nil
	case "delete":
		if len(operation.Expected) != 0 {
			return nil
		}
	case "patch":
		if len(operation.Unset) != 0 {
			break
		}
		for field := range operation.Fields {
			if field != "text" && field != "fontFamily" {
				return invalidCommand("A block edit can only change its text or font.")
			}
			if operation.Expected[field] == nil {
				return invalidCommand("A block edit must compare the previous text or font.")
			}
		}
		return nil
	}
	return invalidCommand("Invalid document block edit.")
}

func validateDocBlock(fields map[string]json.RawMessage) error {
	var block docformat.Block
	var marker bool
	if len(fields) != 5 || rawString(fields["name"]) != "Block" ||
		json.Unmarshal(fields["docBlock"], &marker) != nil || !marker ||
		json.Unmarshal(fields["text"], &block.Text) != nil || string(fields["text"]) == "null" ||
		json.Unmarshal(fields["fontFamily"], &block.FontFamily) != nil {
		return invalidCommand("Invalid document block.")
	}
	if err := docformat.CheckBlocks([]docformat.Block{block}); err != nil {
		return invalidCommand(err.Error())
	}
	return nil
}

func checkDocSize(ctx context.Context, tx pgx.Tx, roomID string) error {
	var count, size int
	err := tx.QueryRow(ctx, `
		SELECT count(*), coalesce(sum(octet_length(data->>'text')), 0)
		FROM board_pages WHERE board_id = $1 AND NOT deleted
	`, roomID).Scan(&count, &size)
	if err == nil && (count > docformat.MaxBlocks || size > docformat.MaxBodyBytes) {
		return invalidCommand(docformat.ErrTooLarge.Error())
	}
	return err
}
