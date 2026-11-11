package model

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
)

var (
	ErrInvalidShareLifetime = errors.New("sharing expiration must be between 1 and 30 days")
	ErrInvalidInviteEmail   = errors.New("enter a valid invitation email address")
	ErrShareCredentialGone  = errors.New("this board credential expired, was revoked, or is invalid")
	ErrInviteAccount        = errors.New("sign in with the account that was invited")
	ErrShareRecordNotFound  = errors.New("board sharing record not found")
	ErrAlreadyBoardMember   = errors.New("this account already has direct access")
	ErrLegacyShareClosed    = errors.New("create an expiring sharing link for a V2 board")
	ErrTooManyActiveShares  = errors.New("this board has reached its active sharing limit")
)

const maxActiveBoardShares = 100

type BoardInvitation struct {
	ID         uuid.UUID      `json:"id"`
	Email      string         `json:"email"`
	Permission RoomPermission `json:"permission"`
	CreatedAt  time.Time      `json:"createdAt"`
	ExpiresAt  time.Time      `json:"expiresAt"`
	AcceptedAt *time.Time     `json:"acceptedAt,omitempty"`
	RevokedAt  *time.Time     `json:"revokedAt,omitempty"`
}

type BoardShareLink struct {
	ID              uuid.UUID      `json:"id"`
	Permission      RoomPermission `json:"permission"`
	CreatedAt       time.Time      `json:"createdAt"`
	ExpiresAt       time.Time      `json:"expiresAt"`
	RevokedAt       *time.Time     `json:"revokedAt,omitempty"`
	RedemptionCount int            `json:"redemptionCount"`
}

type LegacyBoardShare struct {
	Permission SharePermission `json:"permission"`
	ExpiresAt  time.Time       `json:"expiresAt"`
}

type BoardSharing struct {
	Members     []*RoomMember     `json:"members"`
	Invitations []BoardInvitation `json:"invitations"`
	Links       []BoardShareLink  `json:"links"`
	LegacyLink  *LegacyBoardShare `json:"legacyLink,omitempty"`
}

// All ACL mutations take the same room lock as document writes.
func lockBoardSharing(ctx context.Context, tx pgx.Tx, boardID string) (uuid.UUID, error) {
	var owner uuid.UUID
	err := tx.QueryRow(ctx, `SELECT owner_id FROM rooms WHERE id = $1 FOR UPDATE`, boardID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrRoomNotFound
	}
	return owner, err
}

func requireBoardOwner(ctx context.Context, tx pgx.Tx, boardID string, actor uuid.UUID) error {
	if _, err := lockBoardSharing(ctx, tx, boardID); err != nil {
		return err
	}
	access, err := QueryRoomAccess(ctx, tx, boardID, actor)
	if errors.Is(err, ErrRoomAccessDenied) || (err == nil && !access.IsOwner) {
		return ErrNotRoomOwner
	}
	if err != nil {
		return err
	}
	return nil
}

func shareToken() (string, [32]byte, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return "", [32]byte{}, err
	}
	return base64.RawURLEncoding.EncodeToString(secret[:]), sha256.Sum256(secret[:]), nil
}

func shareTokenHash(token string) ([32]byte, error) {
	if len(token) != base64.RawURLEncoding.EncodedLen(32) {
		return [32]byte{}, ErrShareCredentialGone
	}
	secret, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(secret) != 32 {
		return [32]byte{}, ErrShareCredentialGone
	}
	return sha256.Sum256(secret), nil
}

func validShareLifetime(days int) bool { return days >= 1 && days <= 30 }

func boardShareInvitation(row pgx.CollectableRow) (BoardInvitation, error) {
	var invite BoardInvitation
	err := row.Scan(&invite.ID, &invite.Email, &invite.Permission, &invite.CreatedAt, &invite.ExpiresAt, &invite.AcceptedAt, &invite.RevokedAt)
	return invite, err
}

func boardShareLink(row pgx.CollectableRow) (BoardShareLink, error) {
	var link BoardShareLink
	err := row.Scan(&link.ID, &link.Permission, &link.CreatedAt, &link.ExpiresAt, &link.RevokedAt, &link.RedemptionCount)
	return link, err
}

func GetBoardSharing(ctx context.Context, boardID string, actor uuid.UUID) (BoardSharing, error) {
	sharing := BoardSharing{}
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		access, err := QueryRoomAccess(ctx, tx, boardID, actor)
		if err != nil {
			return err
		}
		if !access.IsOwner {
			return ErrNotRoomOwner
		}
		sharing.Members, err = queryBoardMembers(ctx, tx, boardID)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT id, email, permission, created_at, expires_at, accepted_at, revoked_at
			FROM board_share_invitations WHERE room_id = $1
			ORDER BY (revoked_at IS NULL AND accepted_at IS NULL AND expires_at > statement_timestamp()) DESC, created_at DESC, id
			LIMIT $2
		`, boardID, maxActiveBoardShares)
		if err != nil {
			return err
		}
		sharing.Invitations, err = pgx.CollectRows(rows, boardShareInvitation)
		if err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `
			SELECT l.id, l.permission, l.created_at, l.expires_at, l.revoked_at,
				(SELECT count(*) FROM board_share_link_grants g WHERE g.link_id = l.id)
			FROM board_share_links l WHERE l.room_id = $1
			ORDER BY (l.revoked_at IS NULL AND l.expires_at > statement_timestamp()) DESC, l.created_at DESC, l.id
			LIMIT $2
		`, boardID, maxActiveBoardShares)
		if err != nil {
			return err
		}
		sharing.Links, err = pgx.CollectRows(rows, boardShareLink)
		if err != nil {
			return err
		}
		var legacy LegacyBoardShare
		err = tx.QueryRow(ctx, `SELECT link_permission, legacy_access_expires_at FROM room_share_settings
			WHERE room_id = $1 AND link_permission <> 'restricted' AND legacy_access_expires_at > statement_timestamp()`, boardID).Scan(&legacy.Permission, &legacy.ExpiresAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err == nil {
			sharing.LegacyLink = &legacy
		}
		return err
	})
	return sharing, err
}

func CreateBoardInvitation(ctx context.Context, boardID string, owner uuid.UUID, email string, permission RoomPermission, days int) (BoardInvitation, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || len(email) > 254 {
		return BoardInvitation{}, "", ErrInvalidInviteEmail
	}
	permission, ok := NormalizeRoomPermission(string(permission))
	if !ok {
		return BoardInvitation{}, "", ErrInvalidRoomPermission
	}
	if !validShareLifetime(days) {
		return BoardInvitation{}, "", ErrInvalidShareLifetime
	}
	token, digest, err := shareToken()
	if err != nil {
		return BoardInvitation{}, "", err
	}
	var invite BoardInvitation
	err = pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, boardID, owner); err != nil {
			return err
		}
		var already bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM users u WHERE lower(u.email) = $2 AND (u.id = $3 OR EXISTS
				(SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = u.id))
		)`, boardID, email, owner).Scan(&already); err != nil {
			return err
		}
		if already {
			return ErrAlreadyBoardMember
		}
		if _, err := tx.Exec(ctx, `UPDATE board_share_invitations SET revoked_at = statement_timestamp()
			WHERE room_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, boardID, email); err != nil {
			return err
		}
		if err := checkShareLimit(tx.QueryRow(ctx, `SELECT count(*) >= $2 FROM board_share_invitations
			WHERE room_id = $1 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > statement_timestamp()`, boardID, maxActiveBoardShares)); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `INSERT INTO board_share_invitations (room_id, email, permission, token_hash, created_by, expires_at)
			VALUES ($1, $2, $3, $4, $5, statement_timestamp() + $6::int * INTERVAL '1 day')
			RETURNING id, email, permission, created_at, expires_at`, boardID, email, permission, digest[:], owner, days).
			Scan(&invite.ID, &invite.Email, &invite.Permission, &invite.CreatedAt, &invite.ExpiresAt)
	})
	if err != nil {
		return BoardInvitation{}, "", err
	}
	return invite, token, nil
}

func AcceptBoardInvitation(ctx context.Context, boardID string, actor uuid.UUID, token string) (*RoomAccess, error) {
	digest, err := shareTokenHash(token)
	if err != nil {
		return nil, err
	}
	var access *RoomAccess
	err = pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if _, err := lockBoardSharing(ctx, tx, boardID); err != nil {
			return err
		}
		var id uuid.UUID
		var permission RoomPermission
		var email, actorEmail string
		var accepted uuid.NullUUID
		var consumed, available bool
		err := tx.QueryRow(ctx, `SELECT i.id, i.permission, i.email, lower(u.email), i.accepted_by,
			i.accepted_at IS NOT NULL, i.expires_at > statement_timestamp() AND i.revoked_at IS NULL
			FROM board_share_invitations i JOIN users u ON u.id = $3
			WHERE i.room_id = $1 AND i.token_hash = $2`, boardID, digest[:], actor).
			Scan(&id, &permission, &email, &actorEmail, &accepted, &consumed, &available)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrShareCredentialGone
		}
		if err != nil {
			return err
		}
		if !available && !consumed {
			return ErrShareCredentialGone
		}
		if email != actorEmail || (consumed && (!accepted.Valid || accepted.UUID != actor)) {
			return ErrInviteAccount
		}
		if !consumed {
			// Existing direct access wins over a pending invitation. An old
			// invite cannot undo a later grant or downgrade.
			if _, err := tx.Exec(ctx, `INSERT INTO room_members (room_id, user_id, permission)
				VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO NOTHING`, boardID, actor, permission); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE board_share_invitations SET accepted_by = $2, accepted_at = statement_timestamp()
				WHERE id = $1`, id, actor); err != nil {
				return err
			}
		}
		access, err = QueryRoomAccess(ctx, tx, boardID, actor)
		return err
	})
	return access, err
}

func RevokeBoardInvitation(ctx context.Context, boardID string, owner, inviteID uuid.UUID) error {
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, boardID, owner); err != nil {
			return err
		}
		result, err := tx.Exec(ctx, `UPDATE board_share_invitations SET revoked_at = COALESCE(revoked_at, statement_timestamp())
			WHERE room_id = $1 AND id = $2 AND accepted_at IS NULL`, boardID, inviteID)
		if err == nil && result.RowsAffected() == 0 {
			return ErrShareRecordNotFound
		}
		return err
	})
}

func CreateBoardShareLink(ctx context.Context, boardID string, owner uuid.UUID, permission RoomPermission, days int) (BoardShareLink, string, error) {
	if permission != RoomPermissionView && permission != RoomPermissionComment {
		return BoardShareLink{}, "", ErrInvalidSharePermission
	}
	if !validShareLifetime(days) {
		return BoardShareLink{}, "", ErrInvalidShareLifetime
	}
	token, digest, err := shareToken()
	if err != nil {
		return BoardShareLink{}, "", err
	}
	var link BoardShareLink
	err = pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, boardID, owner); err != nil {
			return err
		}
		if err := checkShareLimit(tx.QueryRow(ctx, `SELECT count(*) >= $2 FROM board_share_links
			WHERE room_id = $1 AND revoked_at IS NULL AND expires_at > statement_timestamp()`, boardID, maxActiveBoardShares)); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `INSERT INTO board_share_links (room_id, permission, token_hash, created_by, expires_at)
			VALUES ($1, $2, $3, $4, statement_timestamp() + $5::int * INTERVAL '1 day')
			RETURNING id, permission, created_at, expires_at`, boardID, permission, digest[:], owner, days).
			Scan(&link.ID, &link.Permission, &link.CreatedAt, &link.ExpiresAt)
	})
	if err != nil {
		return BoardShareLink{}, "", err
	}
	return link, token, nil
}

func RedeemBoardShareLink(ctx context.Context, boardID string, actor uuid.UUID, token string) (*RoomAccess, error) {
	digest, err := shareTokenHash(token)
	if err != nil {
		return nil, err
	}
	var access *RoomAccess
	err = pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if _, err := lockBoardSharing(ctx, tx, boardID); err != nil {
			return err
		}
		var linkID uuid.UUID
		err := tx.QueryRow(ctx, `SELECT id FROM board_share_links WHERE room_id = $1 AND token_hash = $2
			AND revoked_at IS NULL AND expires_at > statement_timestamp()`, boardID, digest[:]).Scan(&linkID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrShareCredentialGone
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO board_share_link_grants (room_id, link_id, user_id)
			VALUES ($1, $2, $3) ON CONFLICT (link_id, user_id) DO NOTHING`, boardID, linkID, actor); err != nil {
			return err
		}
		access, err = QueryRoomAccess(ctx, tx, boardID, actor)
		return err
	})
	return access, err
}

func RevokeBoardShareLink(ctx context.Context, boardID string, owner, linkID uuid.UUID) error {
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, boardID, owner); err != nil {
			return err
		}
		result, err := tx.Exec(ctx, `UPDATE board_share_links SET revoked_at = COALESCE(revoked_at, statement_timestamp())
			WHERE room_id = $1 AND id = $2`, boardID, linkID)
		if err == nil && result.RowsAffected() == 0 {
			return ErrShareRecordNotFound
		}
		return err
	})
}

func SetBoardMemberRole(ctx context.Context, boardID string, owner, member uuid.UUID, permission RoomPermission) (*RoomMember, error) {
	permission, ok := NormalizeRoomPermission(string(permission))
	if !ok {
		return nil, ErrInvalidRoomPermission
	}
	var result *RoomMember
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, boardID, owner); err != nil {
			return err
		}
		if member == owner {
			return ErrRoomMemberIsOwner
		}
		tag, err := tx.Exec(ctx, `UPDATE room_members SET permission = $3, updated_at = statement_timestamp()
			WHERE room_id = $1 AND user_id = $2`, boardID, member, permission)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrRoomMemberNotFound
		}
		if err := revokePendingMemberInvites(ctx, tx, boardID, member); err != nil {
			return err
		}
		result, err = queryBoardMember(ctx, tx, boardID, member)
		return err
	})
	return result, err
}

func revokePendingMemberInvites(ctx context.Context, tx pgx.Tx, boardID string, member uuid.UUID) error {
	_, err := tx.Exec(ctx, `UPDATE board_share_invitations SET revoked_at = statement_timestamp()
		WHERE room_id = $1 AND email = (SELECT lower(email) FROM users WHERE id = $2)
		AND accepted_at IS NULL AND revoked_at IS NULL`, boardID, member)
	return err
}

func checkShareLimit(row pgx.Row) error {
	var full bool
	if err := row.Scan(&full); err != nil {
		return err
	}
	if full {
		return ErrTooManyActiveShares
	}
	return nil
}

func DisableLegacyBoardLink(ctx context.Context, boardID string, owner uuid.UUID) error {
	return pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := requireBoardOwner(ctx, tx, boardID, owner); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE room_share_settings SET link_permission = 'restricted', legacy_access_expires_at = NULL,
			updated_by = $2, updated_at = statement_timestamp() WHERE room_id = $1`, boardID, owner)
		return err
	})
}
