package model

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

type Room struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	OwnerID   uuid.UUID `json:"ownerId"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

var ErrRoomNotFound = errors.New("room not found")
var ErrNotRoomOwner = errors.New("not room owner")

func CreateRoom(ctx context.Context, name string, ownerID uuid.UUID) (*Room, error) {
	id := uuid.New().String()

	room := &Room{}
	err := db.Pool().QueryRow(ctx, `
		INSERT INTO rooms (id, name, owner_id)
		VALUES ($1, $2, $3)
		RETURNING id, name, owner_id, created_at, updated_at
	`, id, name, ownerID).Scan(&room.ID, &room.Name, &room.OwnerID, &room.CreatedAt, &room.UpdatedAt)
	if err != nil {
		return nil, err
	}

	return room, nil
}

func GetRoom(ctx context.Context, id string) (*Room, error) {
	room := &Room{}
	err := db.Pool().QueryRow(ctx, `
		SELECT id, name, owner_id, created_at, updated_at
		FROM rooms WHERE id = $1
	`, id).Scan(&room.ID, &room.Name, &room.OwnerID, &room.CreatedAt, &room.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}
	return room, nil
}

func GetRoomsByOwner(ctx context.Context, ownerID uuid.UUID) ([]*Room, error) {
	rows, err := db.Pool().Query(ctx, `
		SELECT id, name, owner_id, created_at, updated_at
		FROM rooms WHERE owner_id = $1
		ORDER BY updated_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rooms []*Room
	for rows.Next() {
		room := &Room{}
		if err := rows.Scan(&room.ID, &room.Name, &room.OwnerID, &room.CreatedAt, &room.UpdatedAt); err != nil {
			return nil, err
		}
		rooms = append(rooms, room)
	}

	return rooms, nil
}

func DeleteRoom(ctx context.Context, id string, userID uuid.UUID) error {
	room, err := GetRoom(ctx, id)
	if err != nil {
		return err
	}
	if room.OwnerID != userID {
		return ErrNotRoomOwner
	}

	_, err = db.Pool().Exec(ctx, "DELETE FROM rooms WHERE id = $1", id)
	return err
}

func EnsureRoom(ctx context.Context, id, name string, ownerID uuid.UUID) (*Room, error) {
	room, err := GetRoom(ctx, id)
	if err == nil {
		return room, nil
	}
	if !errors.Is(err, ErrRoomNotFound) {
		return nil, err
	}

	room = &Room{}
	err = db.Pool().QueryRow(ctx, `
		INSERT INTO rooms (id, name, owner_id, board_data)
		VALUES ($1, $2, $3, '{}')
		ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
		RETURNING id, name, owner_id, created_at, updated_at
	`, id, name, ownerID).Scan(&room.ID, &room.Name, &room.OwnerID, &room.CreatedAt, &room.UpdatedAt)
	if err != nil {
		return nil, err
	}

	return room, nil
}

type BoardData struct {
	Name          string      `json:"name"`
	Elements      interface{} `json:"elements"`
	Stamps        interface{} `json:"stamps,omitempty"`
	Pages         interface{} `json:"pages,omitempty"`
	CurrentPageId string      `json:"currentPageId,omitempty"`
}

func SaveBoardData(ctx context.Context, roomID string, data *BoardData) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	result, err := db.Pool().Exec(ctx, `
		UPDATE rooms 
		SET board_data = $1::jsonb, name = $2, updated_at = NOW()
		WHERE id = $3
	`, jsonData, data.Name, roomID)
	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return ErrRoomNotFound
	}

	return nil
}

func LoadBoardData(ctx context.Context, roomID string) (*BoardData, error) {
	var jsonData []byte
	err := db.Pool().QueryRow(ctx, `
		SELECT COALESCE(board_data, '{}')::jsonb FROM rooms WHERE id = $1
	`, roomID).Scan(&jsonData)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}

	var data BoardData
	if err := json.Unmarshal(jsonData, &data); err != nil {
		return nil, err
	}
	return &data, nil
}
