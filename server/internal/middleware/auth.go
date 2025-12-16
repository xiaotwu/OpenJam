package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/project-wb/server/internal/model"
)

const UserContextKey = "user"
const SessionContextKey = "session"

func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization required"})
			return
		}

		session, err := model.GetSession(c.Request.Context(), token)
		if err != nil || session == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired session"})
			return
		}

		user, err := model.GetUserByID(c.Request.Context(), session.UserID)
		if err != nil {
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

func extractToken(c *gin.Context) string {
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}

	if token := c.Query("token"); token != "" {
		return token
	}

	if cookie, err := c.Cookie("wb_session"); err == nil {
		return cookie
	}

	return ""
}
