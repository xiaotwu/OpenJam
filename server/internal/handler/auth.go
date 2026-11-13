package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/xiaotwu/shiori/server/internal/middleware"
	"github.com/xiaotwu/shiori/server/internal/model"
)

type RegisterRequest struct {
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=6"`
	DisplayName string `json:"displayName" binding:"required,min=1"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type AuthResponse struct {
	Token string      `json:"token"`
	User  *model.User `json:"user"`
}

const sessionCookieMaxAge = 86400 * 7

// secureCookies is toggled by SetCookieSecurity based on ENVIRONMENT. In
// production the session cookie is marked Secure + SameSite=Lax; in local
// development (plain HTTP) we keep Secure off so the cookie still works.
var secureCookies = false

// SetCookieSecurity is called from main with the configured environment.
func SetCookieSecurity(environment string) {
	secureCookies = environment == "production"
}

// setSessionCookie writes the session cookie with HttpOnly and SameSite=Lax
// always, plus Secure when serving over HTTPS in production. SameSite=Lax
// blocks the cookie on cross-site POST (CSRF) while allowing top-level
// navigation so shared links still open the app logged-in.
func setSessionCookie(c *gin.Context, token string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     middleware.SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   secureCookies || c.Request.TLS != nil,
		SameSite: http.SameSiteLaxMode,
	})
}

func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	displayName := strings.TrimSpace(req.DisplayName)

	user, err := model.CreateUser(c.Request.Context(), email, req.Password, displayName)
	if err != nil {
		if errors.Is(err, model.ErrEmailExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "Email already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	session, err := model.CreateSession(c.Request.Context(), user.ID, 86400*7)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	setSessionCookie(c, session.Token, sessionCookieMaxAge)

	c.JSON(http.StatusOK, AuthResponse{
		Token: session.Token,
		User:  user,
	})
}

func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))

	user, err := model.AuthenticateUser(c.Request.Context(), email, req.Password)
	if err != nil {
		if errors.Is(err, model.ErrInvalidCredentials) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to authenticate"})
		return
	}

	session, err := model.CreateSession(c.Request.Context(), user.ID, 86400*7)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	setSessionCookie(c, session.Token, sessionCookieMaxAge)

	c.JSON(http.StatusOK, AuthResponse{
		Token: session.Token,
		User:  user,
	})
}

func Logout(c *gin.Context) {
	token := ""

	if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token = strings.TrimPrefix(auth, "Bearer ")
	} else if cookie, err := c.Cookie(middleware.SessionCookieName); err == nil {
		token = cookie
	}

	if token != "" {
		if err := model.DeleteSession(c.Request.Context(), token); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Could not end the session. Try again."})
			return
		}
	}

	setSessionCookie(c, "", -1)

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func Me(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

type UpdateProfileRequest struct {
	DisplayName string `json:"displayName" binding:"required,min=1"`
	AvatarColor string `json:"avatarColor" binding:"required"`
}

func UpdateProfile(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	displayName := strings.TrimSpace(req.DisplayName)
	avatarColor := strings.TrimSpace(req.AvatarColor)

	updatedUser, err := model.UpdateUserProfile(c.Request.Context(), user.ID, displayName, avatarColor)
	if err != nil {
		if errors.Is(err, model.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": updatedUser})
}
