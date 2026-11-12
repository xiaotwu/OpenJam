package handler

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/ws"
)

// allowedOrigins is set by InitWebSocket from the config's CorsOrigins.
var allowedOrigins []string

// InitWebSocket configures the WebSocket upgrader with the allowed CORS origins.
func InitWebSocket(origins []string) {
	allowedOrigins = origins
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" || origin == "http://"+r.Host || origin == "https://"+r.Host {
			return true
		}
		for _, allowed := range allowedOrigins {
			if allowed == "*" || allowed == origin {
				return true
			}
		}
		return false
	},
}

func HandleWebSocket(hub *ws.Hub, c *gin.Context) {
	// Legacy clients can also use the old token query parameter.
	token := ""
	if cookie, err := c.Cookie("wb_session"); err == nil && cookie != "" {
		token = cookie
	}
	if token == "" {
		token = c.Query("token")
	}
	if token == "" {
		auth := c.GetHeader("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
	}

	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Token required"})
		return
	}

	session, err := model.GetSession(c.Request.Context(), token)
	if err != nil || session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid session"})
		return
	}

	user, err := model.GetUserByID(c.Request.Context(), session.UserID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
		return
	}

	upgradeWebSocket(hub, c, upgrader, user, "")
}

func HandleDocumentWebSocket(hub *ws.Hub, c *gin.Context) {
	user, session := middleware.GetUser(c), middleware.GetSession(c)
	if user == nil || session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization required"})
		return
	}
	socketUpgrader := upgrader
	socketUpgrader.HandshakeTimeout = 3 * time.Second
	socketUpgrader.CheckOrigin = func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" || origin == "http://"+r.Host || origin == "https://"+r.Host {
			return true
		}
		for _, allowed := range allowedOrigins {
			if allowed == origin {
				return true
			}
		}
		return false
	}
	upgradeWebSocket(hub, c, socketUpgrader, user, session.Token)
}

func upgradeWebSocket(hub *ws.Hub, c *gin.Context, socketUpgrader websocket.Upgrader, user *model.User, documentToken string) {
	conn, err := socketUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := ws.NewClient(hub, conn, user)
	if documentToken != "" {
		client.UseDocumentProtocol(documentToken)
	}
	if !hub.Register(client) {
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseServiceRestart, "OpenJam is restarting"), time.Now().Add(time.Second))
		_ = conn.Close()
		return
	}

	go client.WritePump()
	go client.ReadPump()
}
