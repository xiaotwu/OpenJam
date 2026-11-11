package document

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/jackc/pgx/v5"
)

type elementRelation struct {
	pageID   string
	kind     string
	groupID  string
	startID  string
	endID    string
	children []string
}

func trackRelationships(state *commitState, operation Operation, delta Delta) error {
	if operation.Collection != "elements" || delta.Kind != "upsert" {
		return nil
	}
	var affected, incoming bool
	switch operation.Kind {
	case "restore":
		affected, incoming = true, true
	case "add":
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(delta.Value, &fields); err != nil {
			return err
		}
		kind := rawString(fields["type"])
		affected = kind == "connector" || kind == "frame" || len(fields["groupId"]) > 0
	case "patch":
		for _, key := range []string{"pageId", "childIds", "startElementId", "endElementId", "groupId"} {
			if operation.Fields[key] != nil || slices.Contains(operation.Unset, key) {
				affected = true
				incoming = incoming || key == "pageId"
			}
		}
	}
	if affected {
		if state.relations == nil {
			state.relations = make(map[string]bool)
		}
		state.relations[operation.ID] = state.relations[operation.ID] || incoming
	}
	return nil
}

func checkRelationships(ctx context.Context, tx pgx.Tx, state *commitState) error {
	if len(state.relations) == 0 {
		return nil
	}
	// Read only relationship metadata, so a move never loads image or widget payloads.
	rows, err := tx.Query(ctx, `
		SELECT id, page_id, data->>'type', COALESCE(data->>'groupId', ''),
			COALESCE(data->>'startElementId', ''), COALESCE(data->>'endElementId', ''),
			COALESCE(data->'childIds', '[]'::jsonb)
		FROM board_elements WHERE board_id = $1 AND NOT deleted ORDER BY id
	`, state.room.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	elements := make(map[string]elementRelation)
	var order []string
	for rows.Next() {
		var id string
		var element elementRelation
		var children json.RawMessage
		if err := rows.Scan(&id, &element.pageID, &element.kind, &element.groupID, &element.startID, &element.endID, &children); err != nil {
			return err
		}
		if element.kind == "frame" {
			if err := json.Unmarshal(children, &element.children); err != nil {
				if _, changed := state.relations[id]; changed {
					return relationshipConflict(id, "childIds", "Frame children must be object IDs.")
				}
				element.children = nil
			}
		}
		elements[id] = element
		order = append(order, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	groupPages := make(map[string]string)
	separatedGroups := make(map[string]bool)
	for _, element := range elements {
		if element.groupID == "" {
			continue
		}
		if pageID, found := groupPages[element.groupID]; found && pageID != element.pageID {
			separatedGroups[element.groupID] = true
		}
		groupPages[element.groupID] = element.pageID
	}
	for _, id := range order {
		element := elements[id]
		_, changed := state.relations[id]
		if changed && element.groupID != "" && (!validEntityID(element.groupID) || separatedGroups[element.groupID]) {
			return relationshipConflict(id, "groupId", "Move all grouped objects to the same page or ungroup them first.")
		}
		if element.kind == "frame" {
			seen := make(map[string]bool, len(element.children))
			for _, child := range element.children {
				if (changed && seen[child]) || !validRelationship(elements, state, id, child, changed) {
					return relationshipConflict(id, "childIds", "A frame and its children must be available on the same page.")
				}
				seen[child] = true
			}
		}
		if element.kind == "connector" {
			if element.startID != "" && !validRelationship(elements, state, id, element.startID, changed) {
				return relationshipConflict(id, "startElementId", "A connector and its anchors must be available on the same page.")
			}
			if element.endID != "" && !validRelationship(elements, state, id, element.endID, changed) {
				return relationshipConflict(id, "endElementId", "A connector and its anchors must be available on the same page.")
			}
		}
	}
	visited := make(map[string]uint8)
	for _, id := range order {
		if _, changed := state.relations[id]; changed && cyclicFrame(id, elements, visited) {
			return relationshipConflict(id, "childIds", "Frames cannot contain themselves, directly or through another frame.")
		}
	}
	return nil
}

func validRelationship(elements map[string]elementRelation, state *commitState, source, target string, changed bool) bool {
	if !changed && !state.relations[target] {
		return true
	}
	other, exists := elements[target]
	return source != target && exists && elements[source].pageID == other.pageID
}

func cyclicFrame(id string, elements map[string]elementRelation, visited map[string]uint8) bool {
	if elements[id].kind != "frame" || visited[id] == 2 {
		return false
	}
	if visited[id] == 1 {
		return true
	}
	visited[id] = 1
	for _, child := range elements[id].children {
		if cyclicFrame(child, elements, visited) {
			return true
		}
	}
	visited[id] = 2
	return false
}

func relationshipConflict(id, field, message string) error {
	return operationConflict(Operation{Collection: "elements", ID: id}, field, message)
}
