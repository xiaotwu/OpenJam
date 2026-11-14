package document

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/model"
)

const (
	PortableDocumentLimit = 12 * 1024 * 1024
	PortableRecordLimit   = 10000
)

var ErrPortableTooLarge = errors.New("board is too large for a single portable file")

// FileSnapshot holds a board position locked in the caller's transaction. This
// lets a file job capture the document and enqueue its input in one transaction.
type FileSnapshot struct {
	room          lockedRoom
	head          Head
	OwnerID       uuid.UUID
	Epoch         int64
	Seq           int64
	DefaultPageID string
}

func LockFileSnapshot(ctx context.Context, tx pgx.Tx, boardID string, actor uuid.UUID, edit bool) (FileSnapshot, error) {
	room, err := lockRoom(ctx, tx, boardID)
	if err != nil {
		return FileSnapshot{}, err
	}
	access, err := model.QueryRoomAccess(ctx, tx, boardID, actor)
	if err != nil {
		return FileSnapshot{}, err
	}
	if room.Kind != model.ResourceBoard {
		return FileSnapshot{}, model.ErrRoomNotFound
	}
	if edit && !access.IsOwner && !model.RoomPermissionAllowsEdit(access.Permission) {
		return FileSnapshot{}, model.ErrRoomAccessDenied
	}
	head, err := activeHead(ctx, tx, boardID)
	if err != nil {
		return FileSnapshot{}, err
	}
	result := FileSnapshot{room: room, head: head, Epoch: head.Epoch, Seq: head.Seq, DefaultPageID: head.DefaultPageID}
	err = tx.QueryRow(ctx, "SELECT owner_id FROM rooms WHERE id = $1", boardID).Scan(&result.OwnerID)
	return result, err
}

func (file FileSnapshot) Capture(ctx context.Context, tx pgx.Tx, pageID string) (Snapshot, error) {
	var size, count int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(octet_length(data::text)), 0), COUNT(*) FROM (
			SELECT data FROM board_pages WHERE board_id = $1 AND NOT deleted AND ($2 = '' OR id = $2)
			UNION ALL SELECT data FROM board_elements WHERE board_id = $1 AND NOT deleted AND ($2 = '' OR page_id = $2)
			UNION ALL SELECT data FROM board_stamps WHERE board_id = $1 AND NOT deleted AND ($2 = '' OR page_id = $2)
		) AS records
	`, file.room.ID, pageID).Scan(&size, &count)
	if err != nil {
		return Snapshot{}, err
	}
	if size > PortableDocumentLimit || count > PortableRecordLimit {
		return Snapshot{}, ErrPortableTooLarge
	}
	if pageID == "" {
		return snapshotLocked(ctx, tx, file.room, file.head, "")
	}
	snapshot := Snapshot{
		ProtocolVersion: ProtocolVersion, BoardID: file.room.ID, Epoch: file.Epoch, Seq: file.Seq,
		UpdatedAt: file.room.UpdatedAt, Document: Document{Name: file.room.Name, DefaultPageID: pageID},
	}
	for _, collection := range []struct {
		selectRecords string
		values        *[]json.RawMessage
	}{
		{`SELECT data FROM board_pages WHERE board_id = $1 AND id = $2 AND NOT deleted`, &snapshot.Document.Pages},
		{`SELECT data FROM board_elements WHERE board_id = $1 AND page_id = $2 AND NOT deleted ORDER BY position, id`, &snapshot.Document.Elements},
		{`SELECT data FROM board_stamps WHERE board_id = $1 AND page_id = $2 AND NOT deleted ORDER BY position, id`, &snapshot.Document.Stamps},
	} {
		*collection.values, err = readRecords(ctx, tx, collection.selectRecords, file.room.ID, pageID)
		if err != nil {
			return Snapshot{}, err
		}
	}
	_, snapshot.Hash, err = encodeDocument(snapshot.Document)
	return snapshot, err
}

func NormalizeLegacyFile(name string, raw json.RawMessage) (Document, error) {
	normalized, err := normalizeLegacy(name, raw)
	return normalized.Document, err
}

// ValidatePortable checks a file before any board rows are created. Existing
// dormant references to deleted objects may appear in saved document snapshots.
func ValidatePortable(content Document) error {
	if strings.TrimSpace(content.Name) == "" || utf8.RuneCountInString(content.Name) > 255 ||
		strings.ContainsRune(content.Name, 0) || len(content.Pages) == 0 {
		return invalidCommand("A board file needs a valid name and at least one page.")
	}
	if len(content.Pages)+len(content.Elements)+len(content.Stamps) > PortableRecordLimit {
		return ErrPortableTooLarge
	}
	if _, err := model.ValidateElements(content.Elements); err != nil {
		return invalidCommand("A board file contains an invalid element type or shape.")
	}
	pages := make(map[string]bool, len(content.Pages))
	for _, records := range [][]json.RawMessage{content.Pages, content.Elements, content.Stamps} {
		seen := make(map[string]bool, len(records))
		for _, raw := range records {
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
				return invalidCommand("A board file contains an invalid record.")
			}
			id := rawString(fields["id"])
			if !validEntityID(id) || seen[id] {
				return invalidCommand("A board file contains a missing or duplicate record ID.")
			}
			seen[id] = true
			for _, key := range []string{"__proto__", "constructor", "prototype"} {
				if fields[key] != nil {
					return invalidCommand("A board file contains a reserved field.")
				}
			}
			if len(pages) > 0 && fields["pageId"] != nil && !pages[rawString(fields["pageId"])] {
				return invalidCommand("A board file contains an unknown page reference.")
			}
		}
		if len(pages) == 0 {
			pages = seen
		}
	}
	if !pages[content.DefaultPageID] {
		return invalidCommand("The default page in a board file is missing.")
	}
	for _, raw := range content.Pages {
		var page struct{ Name string }
		if err := json.Unmarshal(raw, &page); err != nil || strings.TrimSpace(page.Name) == "" ||
			strings.ContainsRune(page.Name, 0) {
			return invalidCommand("A board file contains a page with an invalid name.")
		}
	}
	elements := make(map[string]elementRelation, len(content.Elements))
	for _, raw := range content.Elements {
		var value struct {
			ID, PageID, Type, GroupID, StartElementID, EndElementID string
			ChildIDs                                                []string
			Points                                                  []struct{ X, Y float64 }
		}
		if err := json.Unmarshal(raw, &value); err != nil || !pages[value.PageID] ||
			(value.Type == "drawing" && value.Points == nil) {
			return invalidCommand("A board file contains an invalid object or page reference.")
		}
		elements[value.ID] = elementRelation{
			pageID: value.PageID, kind: value.Type, groupID: value.GroupID, startID: value.StartElementID,
			endID: value.EndElementID, children: value.ChildIDs,
		}
	}
	groups := make(map[string]string)
	visited := make(map[string]uint8)
	for id, value := range elements {
		if value.groupID != "" {
			if pageID, exists := groups[value.groupID]; exists && pageID != value.pageID {
				return invalidCommand("A group in a board file spans several pages.")
			}
			groups[value.groupID] = value.pageID
		}
		if cyclicFrame(id, elements, visited) {
			return invalidCommand("A frame in a board file contains itself.")
		}
		var references []string
		switch value.kind {
		case "frame":
			references = value.children
		case "connector":
			references = []string{value.startID, value.endID}
		}
		for _, reference := range references {
			if target, exists := elements[reference]; exists && (reference == id || target.pageID != value.pageID) {
				return invalidCommand("A relationship in a board file crosses a page boundary.")
			}
		}
	}
	for _, raw := range content.Stamps {
		var value struct {
			PageID, Emoji         string
			X, Y, Scale, Rotation float64
		}
		if err := json.Unmarshal(raw, &value); err != nil || !pages[value.PageID] || value.Emoji == "" {
			return invalidCommand("A board file contains an invalid stamp.")
		}
	}
	return nil
}

// ImportPortable must run in the fenced job completion transaction. Linking
// assets before materialization keeps the board and its assets atomic.
func ImportPortable(ctx context.Context, tx pgx.Tx, actor uuid.UUID, content Document, link func(string) error) (VersionBoardState, error) {
	room := lockedRoom{ID: uuid.NewString(), Name: content.Name, Kind: model.ResourceBoard}
	if err := tx.QueryRow(ctx, `
		INSERT INTO rooms (id, name, owner_id) VALUES ($1, $2, $3) RETURNING updated_at
	`, room.ID, room.Name, actor).Scan(&room.UpdatedAt); err != nil {
		return VersionBoardState{}, err
	}
	head := Head{Mode: modeActive, Epoch: 1, DefaultPageID: content.DefaultPageID}
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_heads (board_id, mode, epoch, default_page_id) VALUES ($1, $2, $3, $4)
	`, room.ID, head.Mode, head.Epoch, head.DefaultPageID); err != nil {
		return VersionBoardState{}, err
	}
	if err := link(room.ID); err != nil {
		return VersionBoardState{}, err
	}
	if err := materializeDocument(ctx, tx, room.ID, head.Seq, content); err != nil {
		return VersionBoardState{}, err
	}
	snapshot, err := snapshotLocked(ctx, tx, room, head, "owner")
	if err != nil {
		return VersionBoardState{}, err
	}
	if _, err := storeVersion(ctx, tx, snapshot, versionMarker{
		kind: versionCheckpoint, name: "Imported board", actor: &actor,
	}); err != nil {
		return VersionBoardState{}, err
	}
	return versionBoardState(snapshot), nil
}
