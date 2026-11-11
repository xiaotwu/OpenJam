package document

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/sheetformat"
)

type sheetPage struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	SheetTab bool   `json:"sheetTab"`
}

type sheetCellEdit struct {
	PageID  string `json:"pageId"`
	Address string `json:"address"`
	sheetformat.Value
}

type sheetCell struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Display string `json:"display,omitempty"`
	sheetCellEdit
}

func CreateSheet(ctx context.Context, actor, projectID uuid.UUID, name string, tabs []sheetformat.Tab) (model.DirectoryBoard, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 255 || strings.ContainsRune(name, 0) {
		return model.DirectoryBoard{}, invalidCommand("Enter a spreadsheet name of up to 255 characters.")
	}
	if len(tabs) == 0 {
		tabs = []sheetformat.Tab{{Name: "Sheet1"}}
	}
	if err := sheetformat.CheckBook(tabs); err != nil {
		return model.DirectoryBoard{}, err
	}
	results := sheetformat.Calculate(tabs)
	content := Document{Name: name, Elements: []json.RawMessage{}, Stamps: []json.RawMessage{}}
	for i, tab := range tabs {
		id := uuid.NewString()
		page := sheetPage{ID: id, Name: tab.Name, SheetTab: true}
		data, err := json.Marshal(page)
		if err != nil {
			return model.DirectoryBoard{}, err
		}
		content.Pages = append(content.Pages, data)
		if content.DefaultPageID == "" {
			content.DefaultPageID = id
		}
		addresses := make([]sheetformat.Address, 0, len(tab.Cells))
		for address := range tab.Cells {
			addresses = append(addresses, address)
		}
		slices.SortFunc(addresses, func(a, b sheetformat.Address) int {
			return (a.Row-b.Row)*sheetformat.MaxColumns + a.Col - b.Col
		})
		for _, address := range addresses {
			value := tab.Cells[address]
			if value.Kind == "" {
				continue
			}
			record := sheetCell{ID: id + ":" + address.String(), Type: "sheetCell", Display: results[i][address].Display,
				sheetCellEdit: sheetCellEdit{PageID: id, Address: address.String(), Value: value}}
			data, err := json.Marshal(record)
			if err != nil {
				return model.DirectoryBoard{}, err
			}
			content.Elements = append(content.Elements, data)
		}
	}
	return createNativeResource(ctx, actor, projectID, content, model.ResourceSheet, "Initial spreadsheet", nil)
}

func SheetWorkbook(snapshot Snapshot) ([]sheetformat.Tab, []string, error) {
	if snapshot.ResourceKind != model.ResourceSheet {
		return nil, nil, model.ErrRoomNotFound
	}
	tabs, pages, _, err := decodeWorkbook(snapshot.Document)
	return tabs, pages, err
}

func validateSheetTab(fields map[string]json.RawMessage) error {
	id := rawString(fields["id"])
	parsed, err := uuid.Parse(id)
	if len(fields) != 3 || err != nil || parsed.String() != id ||
		string(fields["sheetTab"]) != "true" || !sheetformat.ValidTabName(rawString(fields["name"])) {
		return invalidCommand("Use a worksheet name of 1–31 characters without Excel's reserved characters.")
	}
	return nil
}

func applySheetCell(ctx context.Context, tx pgx.Tx, state *commitState, operation Operation) (Delta, error) {
	var edit sheetCellEdit
	var expected sheetformat.Value
	if operation.Collection != "elements" || len(operation.Expected) != 2 || operation.Position != nil ||
		len(operation.Fields) != 0 || len(operation.Unset) != 0 ||
		json.Unmarshal(operation.Value, &edit) != nil ||
		json.Unmarshal(operation.Expected["input"], &expected.Input) != nil ||
		json.Unmarshal(operation.Expected["valueType"], &expected.Kind) != nil ||
		string(operation.Expected["input"]) == "null" || string(operation.Expected["valueType"]) == "null" {
		return Delta{}, invalidCommand("A cell edit requires its previous input and value type.")
	}
	_, addressOK := sheetformat.ParseAddress(edit.Address)
	page, pageErr := uuid.Parse(edit.PageID)
	if !addressOK || pageErr != nil || page.String() != edit.PageID || operation.ID != edit.PageID+":"+edit.Address {
		return Delta{}, invalidCommand("Invalid worksheet cell address.")
	}
	if err := sheetformat.CheckValue(edit.Value); err != nil {
		return Delta{}, invalidCommand(err.Error())
	}
	if err := sheetformat.CheckValue(expected); err != nil {
		return Delta{}, invalidCommand(err.Error())
	}
	var live bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM board_pages WHERE board_id = $1 AND id = $2 AND NOT deleted)",
		state.room.ID, edit.PageID).Scan(&live); err != nil {
		return Delta{}, err
	}
	if !live {
		return Delta{}, operationConflict(operation, "pageId", "The worksheet is no longer available.")
	}
	var current sheetCell
	var data json.RawMessage
	err := tx.QueryRow(ctx, "SELECT data FROM board_elements WHERE board_id = $1 AND id = $2 AND NOT deleted",
		state.room.ID, operation.ID).Scan(&data)
	if err == nil {
		if err := json.Unmarshal(data, &current); err != nil {
			return Delta{}, err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Delta{}, err
	}
	if current.Value != expected {
		return Delta{}, fieldConflict(operation, "input", jsonString(current.Input))
	}
	if edit.Value == current.Value {
		return Delta{}, nil
	}
	delta := Delta{Collection: "elements", ID: operation.ID}
	if edit.Kind == "" {
		delta.Kind = "delete"
		_, err = tx.Exec(ctx, "DELETE FROM board_elements WHERE board_id = $1 AND id = $2", state.room.ID, operation.ID)
		return delta, err
	}
	record := sheetCell{ID: operation.ID, Type: "sheetCell", sheetCellEdit: edit}
	if edit.Kind == "formula" {
		// Keep the last result until the entire command has been applied.
		record.Display = current.Display
	}
	data, err = json.Marshal(record)
	if err != nil {
		return Delta{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO board_elements (board_id, id, page_id, data, position, revision)
		VALUES ($1::varchar, $2, $3, $4, (SELECT COALESCE(max(position) + 1, 0) FROM board_elements WHERE board_id = $1), $5)
		ON CONFLICT (board_id, id) DO UPDATE SET data = EXCLUDED.data, revision = EXCLUDED.revision, deleted = false
	`, state.room.ID, operation.ID, edit.PageID, data, state.seq)
	delta.Kind, delta.Value = "upsert", data
	return delta, err
}

type formulaRecord struct {
	cell    sheetCell
	tab     int
	address sheetformat.Address
}

func decodeWorkbook(content Document) ([]sheetformat.Tab, []string, []formulaRecord, error) {
	tabs := make([]sheetformat.Tab, len(content.Pages))
	pages := make([]string, len(content.Pages))
	index := make(map[string]int, len(pages))
	for i, data := range content.Pages {
		var page sheetPage
		if err := json.Unmarshal(data, &page); err != nil || !page.SheetTab {
			return nil, nil, nil, sheetformat.ErrInvalid
		}
		tabs[i] = sheetformat.Tab{Name: page.Name, Cells: map[sheetformat.Address]sheetformat.Value{}}
		pages[i] = page.ID
		index[page.ID] = i
	}
	var formulas []formulaRecord
	for _, data := range content.Elements {
		var cell sheetCell
		if err := json.Unmarshal(data, &cell); err != nil || cell.Type != "sheetCell" {
			return nil, nil, nil, sheetformat.ErrInvalid
		}
		address, valid := sheetformat.ParseAddress(cell.Address)
		i, exists := index[cell.PageID]
		if !valid || !exists || cell.ID != cell.PageID+":"+cell.Address {
			return nil, nil, nil, sheetformat.ErrInvalid
		}
		tabs[i].Cells[address] = cell.Value
		if cell.Kind == "formula" {
			formulas = append(formulas, formulaRecord{cell: cell, tab: i, address: address})
		}
	}
	return tabs, pages, formulas, sheetformat.CheckBook(tabs)
}

func refreshSheet(ctx context.Context, tx pgx.Tx, id string) ([]Delta, error) {
	pages, err := readRecords(ctx, tx, "SELECT data FROM board_pages WHERE board_id = $1 AND NOT deleted ORDER BY position, id", id)
	if err != nil {
		return nil, err
	}
	elements, err := readRecords(ctx, tx, "SELECT data FROM board_elements WHERE board_id = $1 AND NOT deleted ORDER BY position, id", id)
	if err != nil {
		return nil, err
	}
	tabs, _, formulas, err := decodeWorkbook(Document{Pages: pages, Elements: elements})
	if err != nil {
		return nil, invalidCommand(err.Error())
	}
	if len(formulas) == 0 {
		return nil, nil
	}
	results := sheetformat.Calculate(tabs)
	var changes []Delta
	var updated []sheetCell
	for _, record := range formulas {
		value := results[record.tab][record.address].Display
		if record.cell.Display == value {
			continue
		}
		record.cell.Display = value
		data, err := json.Marshal(record.cell)
		if err != nil {
			return nil, err
		}
		updated = append(updated, record.cell)
		changes = append(changes, Delta{Kind: "upsert", Collection: "elements", ID: record.cell.ID, Value: data})
	}
	if len(updated) == 0 {
		return nil, nil
	}
	data, err := json.Marshal(updated)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE board_elements AS cell SET data = item.value
		FROM jsonb_array_elements($2::jsonb) AS item(value)
		WHERE cell.board_id = $1 AND cell.id = item.value->>'id'
	`, id, data)
	return changes, err
}
