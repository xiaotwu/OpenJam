package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
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

	c.SetCookie("wb_session", session.Token, 86400*7, "/", "", false, true)

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

	c.SetCookie("wb_session", session.Token, 86400*7, "/", "", false, true)

	c.JSON(http.StatusOK, AuthResponse{
		Token: session.Token,
		User:  user,
	})
}

func Logout(c *gin.Context) {
	token := ""

	if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token = strings.TrimPrefix(auth, "Bearer ")
	} else if cookie, err := c.Cookie("wb_session"); err == nil {
		token = cookie
	}

	if token != "" {
		_ = model.DeleteSession(c.Request.Context(), token)
	}

	c.SetCookie("wb_session", "", -1, "/", "", false, true)

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
