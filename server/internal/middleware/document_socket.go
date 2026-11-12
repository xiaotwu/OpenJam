package middleware

import (
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/project-wb/server/internal/model"
)

type documentSocketAdmission struct {
	rejected    *RateLimiter
	lookups     *RateLimiter
	accounts    *RateLimiter
	inFlight    chan struct{}
	findSession func(context.Context, string) (*model.Session, error)
	findUser    func(context.Context, uuid.UUID) (*model.User, error)
}

func DocumentSocketAuth() gin.HandlerFunc {
	gate := documentSocketAdmission{
		rejected: NewRateLimiter(2, 3),
		// An office gateway can reconnect 50 sessions at once. Bound the
		// burst and keep the sustained lookup rate at two per IP per second.
		lookups:     NewRateLimiter(2, 64),
		accounts:    NewRateLimiter(2, 3),
		inFlight:    make(chan struct{}, 64),
		findSession: model.GetStoredSession,
		findUser:    model.GetUserByID,
	}
	return gate.authenticate
}

func (gate *documentSocketAdmission) authenticate(c *gin.Context) {
	ip := clientIP(c)
	// Preserve cookie precedence for browser sockets. V2 does not accept
	// credentials in the URL.
	token, _ := c.Cookie("wb_session")
	if token == "" {
		header := c.GetHeader("Authorization")
		if strings.HasPrefix(header, "Bearer ") {
			token = strings.TrimPrefix(header, "Bearer ")
		}
	}
	var tokenBytes [32]byte
	if len(token) != hex.EncodedLen(len(tokenBytes)) {
		gate.reject(c, ip, http.StatusUnauthorized, "Invalid or expired session")
		return
	}
	if _, err := hex.Decode(tokenBytes[:], []byte(token)); err != nil {
		gate.reject(c, ip, http.StatusUnauthorized, "Invalid or expired session")
		return
	}
	if !websocket.IsWebSocketUpgrade(c.Request) {
		gate.reject(c, ip, http.StatusBadRequest, "WebSocket upgrade required")
		return
	}
	if !gate.lookups.allow(ip) {
		limitDocumentSocket(c)
		return
	}
	select {
	case gate.inFlight <- struct{}{}:
		defer func() { <-gate.inFlight }()
	default:
		limitDocumentSocket(c)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()
	session, err := gate.findSession(ctx, token)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": "DOCUMENT_UNAVAILABLE", "error": "Session service unavailable"})
		return
	}
	if session == nil {
		gate.reject(c, ip, http.StatusUnauthorized, "Invalid or expired session")
		return
	}
	// Charge only the identity from the authoritative session row. Multiple
	// valid session tokens for one account share this budget.
	if !gate.accounts.allow(session.UserID.String()) {
		limitDocumentSocket(c)
		return
	}
	user, err := gate.findUser(ctx, session.UserID)
	if errors.Is(err, model.ErrUserNotFound) {
		gate.reject(c, ip, http.StatusUnauthorized, "User not found")
		return
	}
	if err != nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": "DOCUMENT_UNAVAILABLE", "error": "User service unavailable"})
		return
	}
	c.Set(UserContextKey, user)
	c.Set(SessionContextKey, session)
	c.Next()
}

func (gate *documentSocketAdmission) reject(c *gin.Context, ip string, status int, message string) {
	if !gate.rejected.allow(ip) {
		limitDocumentSocket(c)
		return
	}
	c.AbortWithStatusJSON(status, gin.H{"error": message})
}

func limitDocumentSocket(c *gin.Context) {
	c.Header("Retry-After", "1")
	c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
		"code": "RATE_LIMITED", "error": "Too many WebSocket connection attempts. Try again shortly.",
	})
}
