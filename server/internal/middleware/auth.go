package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/xiaotwu/shiori/server/internal/model"
)

const UserContextKey = "user"
const SessionContextKey = "session"

func AuthRequired() gin.HandlerFunc {
	return authenticate(model.GetSession, true)
}

func DocumentAuthRequired() gin.HandlerFunc {
	return authenticate(model.GetStoredSession, false)
}

func authenticate(getSession func(context.Context, string) (*model.Session, error), allowQuery bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c, allowQuery)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization required"})
			return
		}

		session, err := getSession(c.Request.Context(), token)
		if err != nil && !allowQuery {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": "DOCUMENT_UNAVAILABLE", "error": "Session service unavailable"})
			return
		}
		if err != nil || session == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired session"})
			return
		}

		user, err := model.GetUserByID(c.Request.Context(), session.UserID)
		if err != nil {
			if !allowQuery && !errors.Is(err, model.ErrUserNotFound) {
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": "DOCUMENT_UNAVAILABLE", "error": "User service unavailable"})
				return
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
			return
		}

		c.Set(UserContextKey, user)
		c.Set(SessionContextKey, session)
		c.Next()
	}
}

func GetUser(c *gin.Context) *model.User {
	if user, exists := c.Get(UserContextKey); exists {
		return user.(*model.User)
	}
	return nil
}

func GetSession(c *gin.Context) *model.Session {
	if session, exists := c.Get(SessionContextKey); exists {
		return session.(*model.Session)
	}
	return nil
}

func extractToken(c *gin.Context, allowQuery bool) string {
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}

	if allowQuery {
		if token := c.Query("token"); token != "" {
			return token
		}
	}

	if cookie, err := c.Cookie("wb_session"); err == nil {
		return cookie
	}

	return ""
}
