package model

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"golang.org/x/crypto/bcrypt"
)

const (
	SessionCacheDuration = 15 * time.Minute
	UserCacheDuration    = 10 * time.Minute
)

type User struct {
	ID          uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	AvatarColor string    `json:"avatarColor"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type UserWithPassword struct {
	User
	PasswordHash string
}

var ErrUserNotFound = errors.New("user not found")
var ErrEmailExists = errors.New("email already exists")
var ErrInvalidCredentials = errors.New("invalid email or password")

func CreateUser(ctx context.Context, email, password, displayName string) (*User, error) {
	var exists bool
	err := db.Pool().QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)", email).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrEmailExists
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	colors := []string{"#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"}
	avatarColor := colors[time.Now().UnixNano()%int64(len(colors))]

	user := &User{}
	err = db.Pool().QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, avatar_color)
		VALUES ($1, $2, $3, $4)
		RETURNING id, email, display_name, avatar_color, created_at, updated_at
	`, email, string(hash), displayName, avatarColor).Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.AvatarColor, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	return user, nil
}

func AuthenticateUser(ctx context.Context, email, password string) (*User, error) {
	var user UserWithPassword
	err := db.Pool().QueryRow(ctx, `
		SELECT id, email, password_hash, display_name, avatar_color, created_at, updated_at
		FROM users WHERE email = $1
	`, email).Scan(
		&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName, &user.AvatarColor, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return &user.User, nil
}

func GetUserByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var cachedUser User
	if err := db.GetCachedUser(ctx, id.String(), &cachedUser); err == nil {
		return &cachedUser, nil
	}

	user := &User{}
	err := db.Pool().QueryRow(ctx, `
		SELECT id, email, display_name, avatar_color, created_at, updated_at
		FROM users WHERE id = $1
	`, id).Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.AvatarColor, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}

	_ = db.CacheUser(ctx, id.String(), user, UserCacheDuration)

	return user, nil
}

func UpdateUserProfile(ctx context.Context, id uuid.UUID, displayName, avatarColor string) (*User, error) {
	user := &User{}
	err := db.Pool().QueryRow(ctx, `
		UPDATE users 
		SET display_name = $2, avatar_color = $3, updated_at = NOW()
		WHERE id = $1
		RETURNING id, email, display_name, avatar_color, created_at, updated_at
	`, id, displayName, avatarColor).Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.AvatarColor, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}

	_ = db.InvalidateUser(ctx, id.String())
	_ = db.CacheUser(ctx, id.String(), user, UserCacheDuration)

	return user, nil
}

type Session struct {
	Token     string    `json:"token"`
	UserID    uuid.UUID `json:"userId"`
	ExpiresAt time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
}

func CreateSession(ctx context.Context, userID uuid.UUID, maxAge int) (*Session, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(tokenBytes)

	expiresAt := time.Now().Add(time.Duration(maxAge) * time.Second)

	session := &Session{
		Token:     token,
		UserID:    userID,
		ExpiresAt: expiresAt,
	}

	_, err := db.Pool().Exec(ctx, `
		INSERT INTO sessions (token, user_id, expires_at)
		VALUES ($1, $2, $3)
	`, token, userID, expiresAt)
	if err != nil {
		return nil, err
	}

	cacheDuration := time.Until(expiresAt)
	if cacheDuration > SessionCacheDuration {
		cacheDuration = SessionCacheDuration
	}
	_ = db.CacheSession(ctx, token, session, cacheDuration)

	return session, nil
}

func GetSession(ctx context.Context, token string) (*Session, error) {
	var cachedSession Session
	if err := db.GetCachedSession(ctx, token, &cachedSession); err == nil {
		if time.Now().Before(cachedSession.ExpiresAt) {
			return &cachedSession, nil
		}
		_ = db.InvalidateSession(ctx, token)
	}

	session := &Session{}
	err := db.Pool().QueryRow(ctx, `
		SELECT token, user_id, expires_at, created_at
		FROM sessions WHERE token = $1 AND expires_at > NOW()
	`, token).Scan(&session.Token, &session.UserID, &session.ExpiresAt, &session.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	cacheDuration := time.Until(session.ExpiresAt)
	if cacheDuration > SessionCacheDuration {
		cacheDuration = SessionCacheDuration
	}
	_ = db.CacheSession(ctx, token, session, cacheDuration)

	return session, nil
}

func DeleteSession(ctx context.Context, token string) error {
	_ = db.InvalidateSession(ctx, token)

	_, err := db.Pool().Exec(ctx, "DELETE FROM sessions WHERE token = $1", token)
	return err
}

func DeleteExpiredSessions(ctx context.Context) error {
	_, err := db.Pool().Exec(ctx, "DELETE FROM sessions WHERE expires_at < NOW()")
	return err
}
