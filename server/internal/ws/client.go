package ws

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/model"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024
)

type Client struct {
	hub              *Hub
	conn             *websocket.Conn
	send             chan []byte
	user             *model.User
	roomID           string
	permission       model.RoomPermission
	clock            map[string]int64
	documentToken    string
	documentEpoch    int64
	documentLease    string
	lastCursorAccess time.Time
	lastViewport     time.Time
}

type MessageType string

const (
	MsgTypeJoin     MessageType = "join"
	MsgTypeLeave    MessageType = "leave"
	MsgTypeOp       MessageType = "op"
	MsgTypeCursor   MessageType = "cursor"
	MsgTypeSync     MessageType = "sync"
	MsgTypePresence MessageType = "presence"
	MsgTypeError    MessageType = "error"
)

type IncomingMessage struct {
	Type    MessageType     `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type OutgoingMessage struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload"`
}

type JoinPayload struct {
	RoomID string `json:"roomId"`
}

type OperationPayload struct {
	OpID        string                 `json:"opId"`
	OpType      string                 `json:"opType"`
	Data        map[string]interface{} `json:"data"`
	VectorClock map[string]int64       `json:"vectorClock"`
}

type CursorPayload struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Color string  `json:"color"`
	Name  string  `json:"name"`
}

type SyncPayload struct {
	Operations []*model.Operation `json:"operations"`
	Users      []UserInfo         `json:"users"`
}

type PresencePayload struct {
	UserID string    `json:"userId"`
	Action string    `json:"action"`
	User   *UserInfo `json:"user,omitempty"`
}

type UserInfo struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	AvatarColor string `json:"avatarColor"`
}

func NewClient(hub *Hub, conn *websocket.Conn, user *model.User) *Client {
	return &Client{
		hub:   hub,
		conn:  conn,
		send:  make(chan []byte, 256),
		user:  user,
		clock: make(map[string]int64),
	}
}

func (c *Client) ReadPump() {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
	}()

	wait := pongWait
	if c.documentToken != "" {
		wait = documentPongWait
	}
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(wait))
	c.conn.SetPongHandler(func(string) error {
		if c.documentToken != "" && c.roomID != "" && time.Since(c.lastCursorAccess) > time.Second {
			c.checkDocumentSubscription()
		}
		return c.conn.SetReadDeadline(time.Now().Add(wait))
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		c.handleMessage(message)
	}
}

func (c *Client) WritePump() {
	period := pingPeriod
	if c.documentToken != "" {
		period = documentPingPeriod
	}
	ticker := time.NewTicker(period)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) handleMessage(data []byte) {
	var msg IncomingMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		c.sendError("Invalid message format")
		return
	}
	if c.documentToken != "" {
		c.handleDocumentMessage(msg)
		return
	}

	switch msg.Type {
	case MsgTypeJoin:
		c.handleJoin(msg.Payload)
	case MsgTypeLeave:
		c.handleLeave()
	case MsgTypeOp:
		c.handleOperation(msg.Payload)
	case MsgTypeCursor:
		c.handleCursor(msg.Payload)
	default:
		c.sendError("Unknown message type")
	}
}

func (c *Client) handleJoin(payload json.RawMessage) {
	var join JoinPayload
	if err := json.Unmarshal(payload, &join); err != nil {
		c.sendError("Invalid join payload")
		return
	}

	if join.RoomID == "" {
		c.sendError("Room ID required")
		return
	}

	ctx := context.Background()

	// A WS join must not create rooms. Rooms are created explicitly via the
	// REST API (or via the first board save). Auto-creating here would let any
	// authenticated user claim an arbitrary room UUID just by joining it.
	access, err := model.GetRoomAccess(ctx, join.RoomID, c.user.ID)
	if err != nil {
		c.sendError("Failed to join room")
		return
	}
	active, err := document.IsActive(ctx, join.RoomID)
	if err != nil {
		c.sendError("Failed to check board protocol")
		return
	}
	if active {
		c.sendUpgradeRequired()
		return
	}
	c.permission = access.Permission

	c.hub.JoinRoom(c, join.RoomID)

	operations, err := model.GetOperationsByRoom(ctx, join.RoomID)
	if err != nil {
		log.Printf("Failed to get operations: %v", err)
		operations = []*model.Operation{}
	}

	c.sendMessage(MsgTypeSync, SyncPayload{
		Operations: operations,
		Users:      c.roomUsers(join.RoomID),
	})
	c.announceJoined(join.RoomID)
}

func (c *Client) roomUsers(roomID string) []UserInfo {
	clients := c.hub.GetRoomClients(roomID)
	users := make([]UserInfo, 0, len(clients))
	for _, client := range clients {
		users = append(users, UserInfo{
			ID: client.user.ID.String(), DisplayName: client.user.DisplayName, AvatarColor: client.user.AvatarColor,
		})
	}
	return users
}

func (c *Client) announceJoined(roomID string) {
	presenceMsg := OutgoingMessage{
		Type: MsgTypePresence,
		Payload: PresencePayload{
			UserID: c.user.ID.String(),
			Action: "join",
			User: &UserInfo{
				ID:          c.user.ID.String(),
				DisplayName: c.user.DisplayName,
				AvatarColor: c.user.AvatarColor,
			},
		},
	}
	presenceBytes, _ := json.Marshal(presenceMsg)
	c.hub.Broadcast(roomID, presenceBytes, c)
}

func (c *Client) handleLeave() {
	if c.roomID == "" {
		return
	}
	if c.documentToken != "" {
		c.hub.LeaveRoom(c)
		return
	}

	presenceMsg := OutgoingMessage{
		Type: MsgTypePresence,
		Payload: PresencePayload{
			UserID: c.user.ID.String(),
			Action: "leave",
		},
	}
	presenceBytes, _ := json.Marshal(presenceMsg)
	c.hub.Broadcast(c.roomID, presenceBytes, c)

	c.hub.LeaveRoom(c)
}

func (c *Client) handleOperation(payload json.RawMessage) {
	if c.roomID == "" {
		c.sendError("Not in a room")
		return
	}

	var opPayload OperationPayload
	if err := json.Unmarshal(payload, &opPayload); err != nil {
		c.sendError("Invalid operation payload")
		return
	}

	// Re-check edit permission against the database on every op rather than
	// trusting the snapshot captured at join time. A member whose access is
	// revoked (or downgraded edit -> view) mid-session must not be able to keep
	// writing over an already-open socket. GetRoomAccess is a single indexed
	// PK/FK lookup; op frequency is low enough that this stays cheap.
	ctx := context.Background()
	access, err := model.GetRoomAccess(ctx, c.roomID, c.user.ID)
	if err != nil || !model.RoomPermissionAllowsEdit(access.Permission) {
		// Keep the cached permission in sync so a re-granted user can edit again
		// without reconnecting, and a revoked user stops here.
		if err == nil {
			c.permission = access.Permission
		}
		c.sendError("You do not have permission to edit this board")
		return
	}
	c.permission = access.Permission

	if opPayload.OpID == "" {
		opPayload.OpID = uuid.New().String()
	}

	c.clock[c.user.ID.String()]++
	opPayload.VectorClock = c.clock

	op := &model.Operation{
		RoomID:      c.roomID,
		UserID:      c.user.ID,
		OpID:        opPayload.OpID,
		OpType:      model.OpType(opPayload.OpType),
		Payload:     opPayload.Data,
		VectorClock: opPayload.VectorClock,
	}

	if err := model.SaveOperation(ctx, op); err != nil {
		if document.LegacyWriteFenced(err) {
			c.sendUpgradeRequired()
		} else {
			log.Printf("Failed to save operation: %v", err)
			c.sendError("Failed to save operation")
		}
		return
	}

	opMsg := OutgoingMessage{
		Type: MsgTypeOp,
		Payload: map[string]interface{}{
			"opId":        opPayload.OpID,
			"opType":      opPayload.OpType,
			"data":        opPayload.Data,
			"vectorClock": opPayload.VectorClock,
			"userId":      c.user.ID.String(),
		},
	}
	opBytes, _ := json.Marshal(opMsg)
	c.hub.Broadcast(c.roomID, opBytes, c)
}

func (c *Client) handleCursor(payload json.RawMessage) {
	if c.roomID == "" {
		return
	}

	var cursor CursorPayload
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return
	}

	cursor.Color = c.user.AvatarColor
	cursor.Name = c.user.DisplayName

	cursorMsg := OutgoingMessage{
		Type: MsgTypeCursor,
		Payload: map[string]interface{}{
			"userId": c.user.ID.String(),
			"x":      cursor.X,
			"y":      cursor.Y,
			"color":  cursor.Color,
			"name":   cursor.Name,
		},
	}
	cursorBytes, _ := json.Marshal(cursorMsg)
	c.hub.Broadcast(c.roomID, cursorBytes, c)
}

func (c *Client) sendMessage(msgType MessageType, payload interface{}) {
	msg := OutgoingMessage{Type: msgType, Payload: payload}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	select {
	case c.send <- data:
	default:
		if c.documentToken != "" {
			// Reconnect and recover from the durable feed if a response cannot
			// fit into the bounded WebSocket send queue.
			_ = c.conn.Close()
		}
	}
}

func (c *Client) sendError(message string) {
	c.sendMessage(MsgTypeError, map[string]string{"message": message})
}

func (c *Client) sendUpgradeRequired() {
	c.sendMessage(MsgTypeError, map[string]string{
		"code":    "PROTOCOL_UPGRADE_REQUIRED",
		"message": "This board uses persistent sync. Reload Shiori to edit it.",
	})
}
