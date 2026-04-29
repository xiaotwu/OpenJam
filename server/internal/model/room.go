package model

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

type Room struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	OwnerID    uuid.UUID `json:"ownerId"`
	Permission string    `json:"permission,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

var ErrRoomNotFound = errors.New("room not found")
var ErrNotRoomOwner = errors.New("not room owner")
var ErrRoomAccessDenied = errors.New("room access denied")
var ErrInvalidRoomPermission = errors.New("invalid room permission")
var ErrInvalidSharePermission = errors.New("invalid share permission")
var ErrRoomMemberIsOwner = errors.New("room owner already has access")
var ErrRoomMemberNotFound = errors.New("room member not found")

type RoomPermission string

const (
	RoomPermissionView    RoomPermission = "view"
	RoomPermissionComment RoomPermission = "comment"
	RoomPermissionEdit    RoomPermission = "edit"
)

type SharePermission string

const (
	SharePermissionRestricted    SharePermission = "restricted"
	SharePermissionAnyoneView    SharePermission = "anyone-view"
	SharePermissionAnyoneComment SharePermission = "anyone-comment"
	SharePermissionAnyoneEdit    SharePermission = "anyone-edit"
)

type RoomAccess struct {
	IsOwner    bool
	Permission RoomPermission
}

type RoomMember struct {
	UserID      uuid.UUID      `json:"userId"`
	Email       string         `json:"email"`
	DisplayName string         `json:"displayName"`
	AvatarColor string         `json:"avatarColor"`
	Permission  RoomPermission `json:"permission"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

type RoomShareSettings struct {
	LinkPermission SharePermission `json:"linkPermission"`
	Members        []*RoomMember   `json:"members"`
}

func NormalizeRoomPermission(permission string) (RoomPermission, bool) {
	switch RoomPermission(strings.ToLower(strings.TrimSpace(permission))) {
	case RoomPermissionView:
		return RoomPermissionView, true
	case RoomPermissionComment:
		return RoomPermissionComment, true
	case RoomPermissionEdit:
		return RoomPermissionEdit, true
	default:
		return "", false
	}
}

func NormalizeSharePermission(permission string) (SharePermission, bool) {
	switch SharePermission(strings.ToLower(strings.TrimSpace(permission))) {
	case SharePermissionRestricted:
		return SharePermissionRestricted, true
	case SharePermissionAnyoneView:
		return SharePermissionAnyoneView, true
	case SharePermissionAnyoneComment:
		return SharePermissionAnyoneComment, true
	case SharePermissionAnyoneEdit:
		return SharePermissionAnyoneEdit, true
	default:
		return "", false
	}
}

func RoomPermissionAllowsEdit(permission RoomPermission) bool {
	return permission == RoomPermissionEdit
}

func SharePermissionToRoomPermission(permission SharePermission) (RoomPermission, bool) {
	switch permission {
	case SharePermissionAnyoneView:
		return RoomPermissionView, true
	case SharePermissionAnyoneComment:
		return RoomPermissionComment, true
	case SharePermissionAnyoneEdit:
		return RoomPermissionEdit, true
	default:
		return "", false
	}
}

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

func GetRoomsAccessibleByUser(ctx context.Context, userID uuid.UUID) ([]*Room, error) {
	rows, err := db.Pool().Query(ctx, `
		SELECT r.id, r.name, r.owner_id, r.created_at, r.updated_at,
			CASE WHEN r.owner_id = $1 THEN 'owner' ELSE rm.permission END AS permission
		FROM rooms r
		LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $1
		WHERE r.owner_id = $1 OR rm.user_id = $1
		ORDER BY r.updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rooms []*Room
	for rows.Next() {
		room := &Room{}
		if err := rows.Scan(&room.ID, &room.Name, &room.OwnerID, &room.CreatedAt, &room.UpdatedAt, &room.Permission); err != nil {
			return nil, err
		}
		rooms = append(rooms, room)
	}

	return rooms, rows.Err()
}

func GetRoomAccess(ctx context.Context, roomID string, userID uuid.UUID) (*RoomAccess, error) {
	var ownerID uuid.UUID
	var memberPermission sql.NullString
	var linkPermission sql.NullString

	err := db.Pool().QueryRow(ctx, `
		SELECT r.owner_id, rm.permission, rss.link_permission
		FROM rooms r
		LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $2
		LEFT JOIN room_share_settings rss ON rss.room_id = r.id
		WHERE r.id = $1
	`, roomID, userID).Scan(&ownerID, &memberPermission, &linkPermission)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}

	if ownerID == userID {
		return &RoomAccess{IsOwner: true, Permission: RoomPermissionEdit}, nil
	}

	if memberPermission.Valid {
		permission, ok := NormalizeRoomPermission(memberPermission.String)
		if ok {
			return &RoomAccess{Permission: permission}, nil
		}
	}

	if linkPermission.Valid {
		sharePermission, ok := NormalizeSharePermission(linkPermission.String)
		if ok {
			if permission, allowed := SharePermissionToRoomPermission(sharePermission); allowed {
				return &RoomAccess{Permission: permission}, nil
			}
		}
	}

	return nil, ErrRoomAccessDenied
}

func UserCanAccessRoom(ctx context.Context, roomID string, userID uuid.UUID) error {
	_, err := GetRoomAccess(ctx, roomID, userID)
	return err
}

func UserCanEditRoom(ctx context.Context, roomID string, userID uuid.UUID) error {
	access, err := GetRoomAccess(ctx, roomID, userID)
	if err != nil {
		return err
	}
	if access.IsOwner || RoomPermissionAllowsEdit(access.Permission) {
		return nil
	}
	return ErrRoomAccessDenied
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

func UpdateRoom(ctx context.Context, id, name string, userID uuid.UUID) (*Room, error) {
	room, err := GetRoom(ctx, id)
	if err != nil {
		return nil, err
	}
	if room.OwnerID != userID {
		return nil, ErrNotRoomOwner
	}

	updated := &Room{}
	err = db.Pool().QueryRow(ctx, `
		UPDATE rooms
		SET name = $1, updated_at = NOW()
		WHERE id = $2
		RETURNING id, name, owner_id, created_at, updated_at
	`, name, id).Scan(&updated.ID, &updated.Name, &updated.OwnerID, &updated.CreatedAt, &updated.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}

	return updated, nil
}

func EnsureRoom(ctx context.Context, id, name string, ownerID uuid.UUID) (*Room, error) {
	return EnsureRoomOwned(ctx, id, name, ownerID)
}

func EnsureRoomAccessible(ctx context.Context, id, name string, userID uuid.UUID) (*Room, error) {
	room, err := GetRoom(ctx, id)
	if err == nil {
		if err := UserCanAccessRoom(ctx, id, userID); err != nil {
			return nil, err
		}
		return room, nil
	}
	if !errors.Is(err, ErrRoomNotFound) {
		return nil, err
	}

	return CreateRoomWithID(ctx, id, name, userID)
}

func EnsureRoomEditable(ctx context.Context, id, name string, userID uuid.UUID) (*Room, error) {
	room, err := GetRoom(ctx, id)
	if err == nil {
		if err := UserCanEditRoom(ctx, id, userID); err != nil {
			return nil, err
		}
		return room, nil
	}
	if !errors.Is(err, ErrRoomNotFound) {
		return nil, err
	}

	return CreateRoomWithID(ctx, id, name, userID)
}

func EnsureRoomOwned(ctx context.Context, id, name string, ownerID uuid.UUID) (*Room, error) {
	room, err := GetRoom(ctx, id)
	if err == nil {
		if room.OwnerID != ownerID {
			return nil, ErrNotRoomOwner
		}
		return room, nil
	}
	if !errors.Is(err, ErrRoomNotFound) {
		return nil, err
	}

	if name == "" {
		name = "Untitled Board"
	}

	return CreateRoomWithID(ctx, id, name, ownerID)
}

func CreateRoomWithID(ctx context.Context, id, name string, ownerID uuid.UUID) (*Room, error) {
	if name == "" {
		name = "Untitled Board"
	}

	room := &Room{}
	err := db.Pool().QueryRow(ctx, `
		INSERT INTO rooms (id, name, owner_id, board_data)
		VALUES ($1, $2, $3, '{}')
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

func SaveBoardDataForOwner(ctx context.Context, roomID string, ownerID uuid.UUID, data *BoardData) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	result, err := db.Pool().Exec(ctx, `
		UPDATE rooms
		SET board_data = $1::jsonb, name = $2, updated_at = NOW()
		WHERE id = $3 AND owner_id = $4
	`, jsonData, data.Name, roomID, ownerID)
	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return ErrNotRoomOwner
	}

	return nil
}

func SaveBoardDataForEditor(ctx context.Context, roomID string, userID uuid.UUID, data *BoardData) error {
	if err := UserCanEditRoom(ctx, roomID, userID); err != nil {
		return err
	}

	return SaveBoardData(ctx, roomID, data)
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

func LoadBoardDataForUser(ctx context.Context, roomID string, userID uuid.UUID) (*BoardData, error) {
	if err := UserCanAccessRoom(ctx, roomID, userID); err != nil {
		return nil, err
	}
	return LoadBoardData(ctx, roomID)
}

func LoadBoardDataForOwner(ctx context.Context, roomID string, ownerID uuid.UUID) (*BoardData, error) {
	room, err := GetRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}
	if room.OwnerID != ownerID {
		return nil, ErrNotRoomOwner
	}
	return LoadBoardData(ctx, roomID)
}

func GetRoomShareSettings(ctx context.Context, roomID string, userID uuid.UUID) (*RoomShareSettings, error) {
	if err := UserCanAccessRoom(ctx, roomID, userID); err != nil {
		return nil, err
	}

	linkPermission := SharePermissionRestricted
	err := db.Pool().QueryRow(ctx, `
		SELECT COALESCE(
			(SELECT link_permission FROM room_share_settings WHERE room_id = $1),
			'restricted'
		)
	`, roomID).Scan(&linkPermission)
	if err != nil {
		return nil, err
	}

	members, err := ListRoomMembers(ctx, roomID, userID)
	if err != nil {
		return nil, err
	}

	return &RoomShareSettings{
		LinkPermission: linkPermission,
		Members:        members,
	}, nil
}

func UpdateRoomShareSettings(ctx context.Context, roomID string, ownerID uuid.UUID, linkPermission SharePermission) (*RoomShareSettings, error) {
	if _, ok := NormalizeSharePermission(string(linkPermission)); !ok {
		return nil, ErrInvalidSharePermission
	}

	room, err := GetRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}
	if room.OwnerID != ownerID {
		return nil, ErrNotRoomOwner
	}

	_, err = db.Pool().Exec(ctx, `
		INSERT INTO room_share_settings (room_id, link_permission, updated_by, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (room_id) DO UPDATE
		SET link_permission = EXCLUDED.link_permission,
			updated_by = EXCLUDED.updated_by,
			updated_at = NOW()
	`, roomID, linkPermission, ownerID)
	if err != nil {
		return nil, err
	}

	return GetRoomShareSettings(ctx, roomID, ownerID)
}

func ListRoomMembers(ctx context.Context, roomID string, userID uuid.UUID) ([]*RoomMember, error) {
	if err := UserCanAccessRoom(ctx, roomID, userID); err != nil {
		return nil, err
	}

	rows, err := db.Pool().Query(ctx, `
		SELECT u.id, u.email, u.display_name, u.avatar_color, rm.permission, rm.created_at, rm.updated_at
		FROM room_members rm
		JOIN users u ON u.id = rm.user_id
		WHERE rm.room_id = $1
		ORDER BY rm.updated_at DESC, u.display_name ASC
	`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]*RoomMember, 0)
	for rows.Next() {
		member := &RoomMember{}
		if err := rows.Scan(
			&member.UserID,
			&member.Email,
			&member.DisplayName,
			&member.AvatarColor,
			&member.Permission,
			&member.CreatedAt,
			&member.UpdatedAt,
		); err != nil {
			return nil, err
		}
		members = append(members, member)
	}

	return members, rows.Err()
}

func InviteRoomMemberByEmail(ctx context.Context, roomID string, ownerID uuid.UUID, email string, permission RoomPermission) (*RoomMember, error) {
	normalizedPermission, ok := NormalizeRoomPermission(string(permission))
	if !ok {
		return nil, ErrInvalidRoomPermission
	}

	room, err := GetRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}
	if room.OwnerID != ownerID {
		return nil, ErrNotRoomOwner
	}

	user, err := GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if err != nil {
		return nil, err
	}
	if user.ID == ownerID {
		return nil, ErrRoomMemberIsOwner
	}

	_, err = db.Pool().Exec(ctx, `
		INSERT INTO room_members (room_id, user_id, permission, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (room_id, user_id) DO UPDATE
		SET permission = EXCLUDED.permission,
			updated_at = NOW()
	`, roomID, user.ID, normalizedPermission)
	if err != nil {
		return nil, err
	}

	return GetRoomMember(ctx, roomID, user.ID)
}

func GetRoomMember(ctx context.Context, roomID string, userID uuid.UUID) (*RoomMember, error) {
	member := &RoomMember{}
	err := db.Pool().QueryRow(ctx, `
		SELECT u.id, u.email, u.display_name, u.avatar_color, rm.permission, rm.created_at, rm.updated_at
		FROM room_members rm
		JOIN users u ON u.id = rm.user_id
		WHERE rm.room_id = $1 AND rm.user_id = $2
	`, roomID, userID).Scan(
		&member.UserID,
		&member.Email,
		&member.DisplayName,
		&member.AvatarColor,
		&member.Permission,
		&member.CreatedAt,
		&member.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomMemberNotFound
		}
		return nil, err
	}
	return member, nil
}

func RemoveRoomMember(ctx context.Context, roomID string, ownerID, memberID uuid.UUID) error {
	room, err := GetRoom(ctx, roomID)
	if err != nil {
		return err
	}
	if room.OwnerID != ownerID {
		return ErrNotRoomOwner
	}
	if memberID == ownerID {
		return ErrRoomMemberIsOwner
	}

	result, err := db.Pool().Exec(ctx, `
		DELETE FROM room_members
		WHERE room_id = $1 AND user_id = $2
	`, roomID, memberID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrRoomMemberNotFound
	}
	return nil
}
