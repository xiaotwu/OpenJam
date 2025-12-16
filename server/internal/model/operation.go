package model

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/project-wb/server/internal/db"
)

type OpType string

const (
	OpTypeDraw  OpType = "draw"
	OpTypeErase OpType = "erase"
	OpTypeUndo  OpType = "undo"
	OpTypeClear OpType = "clear"
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type DrawPayload struct {
	PathID string  `json:"pathId"`
	Color  string  `json:"color"`
	Width  float64 `json:"width"`
	Points []Point `json:"points"`
}

type ErasePayload struct {
	PathID string  `json:"pathId"`
	Width  float64 `json:"width"`
	Points []Point `json:"points"`
}

type UndoPayload struct {
	TargetOpID string `json:"targetOpId"`
}

type ClearPayload struct{}

type VectorClock map[string]int64

type Operation struct {
	ID          int64       `json:"id,omitempty"`
	RoomID      string      `json:"roomId"`
	UserID      uuid.UUID   `json:"userId"`
	OpID        string      `json:"opId"`
	OpType      OpType      `json:"opType"`
	Payload     interface{} `json:"payload"`
	VectorClock VectorClock `json:"vectorClock"`
	CreatedAt   time.Time   `json:"createdAt,omitempty"`
}

func SaveOperation(ctx context.Context, op *Operation) error {
	payloadBytes, err := json.Marshal(op.Payload)
	if err != nil {
		return err
	}

	clockBytes, err := json.Marshal(op.VectorClock)
	if err != nil {
		return err
	}

	_, err = db.Pool().Exec(ctx, `
		INSERT INTO operations (room_id, user_id, op_id, op_type, payload, vector_clock)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (room_id, op_id) DO NOTHING
	`, op.RoomID, op.UserID, op.OpID, op.OpType, payloadBytes, clockBytes)

	return err
}

func GetOperationsByRoom(ctx context.Context, roomID string) ([]*Operation, error) {
	rows, err := db.Pool().Query(ctx, `
		SELECT id, room_id, user_id, op_id, op_type, payload, vector_clock, created_at
		FROM operations
		WHERE room_id = $1
		ORDER BY id ASC
	`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var operations []*Operation
	for rows.Next() {
		op := &Operation{}
		var payloadBytes, clockBytes []byte

		if err := rows.Scan(&op.ID, &op.RoomID, &op.UserID, &op.OpID, &op.OpType, &payloadBytes, &clockBytes, &op.CreatedAt); err != nil {
			return nil, err
		}

		switch op.OpType {
		case OpTypeDraw:
			var payload DrawPayload
			if err := json.Unmarshal(payloadBytes, &payload); err == nil {
				op.Payload = payload
			}
		case OpTypeErase:
			var payload ErasePayload
			if err := json.Unmarshal(payloadBytes, &payload); err == nil {
				op.Payload = payload
			}
		case OpTypeUndo:
			var payload UndoPayload
			if err := json.Unmarshal(payloadBytes, &payload); err == nil {
				op.Payload = payload
			}
		case OpTypeClear:
			op.Payload = ClearPayload{}
		default:
			var payload map[string]interface{}
			json.Unmarshal(payloadBytes, &payload)
			op.Payload = payload
		}

		if err := json.Unmarshal(clockBytes, &op.VectorClock); err != nil {
			op.VectorClock = make(VectorClock)
		}

		operations = append(operations, op)
	}

	return operations, nil
}

func GetOperationsSince(ctx context.Context, roomID string, afterID int64) ([]*Operation, error) {
	rows, err := db.Pool().Query(ctx, `
		SELECT id, room_id, user_id, op_id, op_type, payload, vector_clock, created_at
		FROM operations
		WHERE room_id = $1 AND id > $2
		ORDER BY id ASC
	`, roomID, afterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var operations []*Operation
	for rows.Next() {
		op := &Operation{}
		var payloadBytes, clockBytes []byte

		if err := rows.Scan(&op.ID, &op.RoomID, &op.UserID, &op.OpID, &op.OpType, &payloadBytes, &clockBytes, &op.CreatedAt); err != nil {
			return nil, err
		}

		var payload map[string]interface{}
		json.Unmarshal(payloadBytes, &payload)
		op.Payload = payload

		if err := json.Unmarshal(clockBytes, &op.VectorClock); err != nil {
			op.VectorClock = make(VectorClock)
		}

		operations = append(operations, op)
	}

	return operations, nil
}

func DeleteOperationsByRoom(ctx context.Context, roomID string) error {
	_, err := db.Pool().Exec(ctx, "DELETE FROM operations WHERE room_id = $1", roomID)
	return err
}
