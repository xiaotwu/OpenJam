package model

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/db"
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
var ErrBoardConflict = errors.New("board was modified by someone else")

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
	Source     string
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
		FROM rooms WHERE owner_id = $1 AND resource_kind = 'board'
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
		SELECT r.id, r.name, r.owner_id, r.created_at, r.updated_at, a.permission
		FROM openjam_visible_boards($1) a JOIN rooms r ON r.id = a.board_id
		WHERE r.resource_kind = 'board' ORDER BY r.updated_at DESC
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
	return QueryRoomAccess(ctx, db.Pool(), roomID, userID)
}

type roomAccessQuery interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// QueryRoomAccess uses the supplied transaction when access must be checked
// against the same database view as a document read or write.
func QueryRoomAccess(ctx context.Context, query roomAccessQuery, roomID string, userID uuid.UUID) (*RoomAccess, error) {
	var permission, source *string
	err := query.QueryRow(ctx, "SELECT permission, source FROM openjam_board_access($1, $2)", roomID, userID).
		Scan(&permission, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRoomNotFound
	}
	if err != nil {
		return nil, err
	}
	if permission == nil || source == nil {
		return nil, ErrRoomAccessDenied
	}
	if *permission == "owner" {
		return &RoomAccess{IsOwner: true, Permission: RoomPermissionEdit, Source: *source}, nil
	}
	return &RoomAccess{Permission: RoomPermission(*permission), Source: *source}, nil
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
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, id, userID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "DELETE FROM rooms WHERE id = $1", id)
		return err
	})
}

func UpdateRoom(ctx context.Context, id, name string, userID uuid.UUID) (*Room, error) {
	updated := &Room{}
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, id, userID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			UPDATE rooms SET name = $1, updated_at = NOW() WHERE id = $2
			RETURNING id, name, owner_id, created_at, updated_at
		`, name, id).Scan(&updated.ID, &updated.Name, &updated.OwnerID, &updated.CreatedAt, &updated.UpdatedAt)
	})
	if err != nil {
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
	access, err := GetRoomAccess(ctx, id, ownerID)
	if errors.Is(err, ErrRoomAccessDenied) || (err == nil && !access.IsOwner) {
		return nil, ErrNotRoomOwner
	}
	if err == nil {
		return GetRoom(ctx, id)
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
	UpdatedAt     time.Time   `json:"updatedAt,omitempty"`
}

func SaveBoardData(ctx context.Context, roomID string, data *BoardData) error {
	_, err := SaveBoardDataWithVersion(ctx, roomID, data, time.Time{})
	return err
}

// SaveBoardDataWithVersion saves the board with optional optimistic locking.
// When expectedUpdatedAt is non-zero, the UPDATE only succeeds if the row's
// updated_at still matches; a zero RowsAffected on a match condition means
// the row changed underneath us and returns ErrBoardConflict. Returns the new
// updated_at so callers can chain subsequent saves.
func SaveBoardDataWithVersion(ctx context.Context, roomID string, data *BoardData, expectedUpdatedAt time.Time) (time.Time, error) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return time.Time{}, err
	}

	var expected *time.Time
	if !expectedUpdatedAt.IsZero() {
		expected = &expectedUpdatedAt
	}

	var newUpdatedAt time.Time
	err = db.Pool().QueryRow(ctx, `
		UPDATE rooms
		SET board_data = $1::jsonb, name = $2, updated_at = NOW()
		WHERE id = $3 AND ($4::timestamptz IS NULL OR updated_at = $4)
		RETURNING updated_at
	`, jsonData, data.Name, roomID, expected).Scan(&newUpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		if expected == nil {
			return time.Time{}, ErrRoomNotFound
		}
		return time.Time{}, ErrBoardConflict
	}
	return newUpdatedAt, err
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
	_, err := SaveBoardDataForEditorWithVersion(ctx, roomID, userID, data, time.Time{})
	return err
}

func SaveBoardDataForEditorWithVersion(ctx context.Context, roomID string, userID uuid.UUID, data *BoardData, expectedUpdatedAt time.Time) (time.Time, error) {
	if err := UserCanEditRoom(ctx, roomID, userID); err != nil {
		return time.Time{}, err
	}

	return SaveBoardDataWithVersion(ctx, roomID, data, expectedUpdatedAt)
}

func LoadBoardData(ctx context.Context, roomID string) (*BoardData, error) {
	var jsonData []byte
	var name string
	var updatedAt time.Time
	data := &BoardData{}
	err := db.Pool().QueryRow(ctx, `
		SELECT COALESCE(board_data, '{}')::jsonb, name, updated_at FROM rooms WHERE id = $1
	`, roomID).Scan(&jsonData, &name, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}

	if err := json.Unmarshal(jsonData, data); err != nil {
		return nil, err
	}
	// Directory renames and server revisions are stored in the room row.
	data.Name = name
	data.UpdatedAt = updatedAt
	return data, nil
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
	settings := &RoomShareSettings{Members: make([]*RoomMember, 0)}
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		access, err := QueryRoomAccess(ctx, tx, roomID, userID)
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT COALESCE((SELECT link_permission FROM room_share_settings
			WHERE room_id = $1 AND legacy_access_expires_at > statement_timestamp()), 'restricted')`, roomID).
			Scan(&settings.LinkPermission); err != nil {
			return err
		}
		if access.IsOwner {
			settings.Members, err = queryBoardMembers(ctx, tx, roomID)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return settings, nil
}

func UpdateRoomShareSettings(ctx context.Context, roomID string, ownerID uuid.UUID, linkPermission SharePermission) (*RoomShareSettings, error) {
	if _, ok := NormalizeSharePermission(string(linkPermission)); !ok {
		return nil, ErrInvalidSharePermission
	}

	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, roomID, ownerID); err != nil {
			return err
		}
		if linkPermission != SharePermissionRestricted {
			var active bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM board_heads WHERE board_id = $1 AND mode = 'active')`, roomID).Scan(&active); err != nil {
				return err
			}
			if active {
				return ErrLegacyShareClosed
			}
		}
		_, err := tx.Exec(ctx, `INSERT INTO room_share_settings (room_id, link_permission, updated_by, updated_at, legacy_access_expires_at)
			VALUES ($1, $2::varchar, $3, statement_timestamp(), CASE WHEN $2::varchar = 'restricted' THEN NULL
			ELSE statement_timestamp() + INTERVAL '30 days' END)
			ON CONFLICT (room_id) DO UPDATE SET link_permission = EXCLUDED.link_permission,
			updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at,
			legacy_access_expires_at = EXCLUDED.legacy_access_expires_at`, roomID, linkPermission, ownerID)
		return err
	})
	if err != nil {
		return nil, err
	}

	return GetRoomShareSettings(ctx, roomID, ownerID)
}

func queryBoardMembers(ctx context.Context, tx pgx.Tx, roomID string) ([]*RoomMember, error) {
	rows, err := tx.Query(ctx, `
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

	var member *RoomMember
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, roomID, ownerID); err != nil {
			return err
		}
		var userID uuid.UUID
		err := tx.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, strings.ToLower(strings.TrimSpace(email))).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserNotFound
		}
		if err != nil {
			return err
		}
		if userID == ownerID {
			return ErrRoomMemberIsOwner
		}
		if _, err := tx.Exec(ctx, `INSERT INTO room_members (room_id, user_id, permission, updated_at)
			VALUES ($1, $2, $3, statement_timestamp()) ON CONFLICT (room_id, user_id) DO UPDATE
			SET permission = EXCLUDED.permission, updated_at = EXCLUDED.updated_at`, roomID, userID, normalizedPermission); err != nil {
			return err
		}
		if err := revokePendingMemberInvites(ctx, tx, roomID, userID); err != nil {
			return err
		}
		member, err = queryBoardMember(ctx, tx, roomID, userID)
		return err
	})
	return member, err
}

func queryBoardMember(ctx context.Context, query roomAccessQuery, roomID string, userID uuid.UUID) (*RoomMember, error) {
	member := &RoomMember{}
	err := query.QueryRow(ctx, `
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
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, roomID, ownerID); err != nil {
			return err
		}
		if memberID == ownerID {
			return ErrRoomMemberIsOwner
		}
		result, err := tx.Exec(ctx, `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, memberID)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return ErrRoomMemberNotFound
		}
		return revokePendingMemberInvites(ctx, tx, roomID, memberID)
	})
}
