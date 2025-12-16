package ws

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/project-wb/server/internal/model"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024
)

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	user   *model.User
	roomID string
	clock  map[string]int64
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

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
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
	ticker := time.NewTicker(pingPeriod)
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

	_, err := model.EnsureRoom(ctx, join.RoomID, "Whiteboard", c.user.ID)
	if err != nil {
		c.sendError("Failed to join room")
		return
	}

	c.hub.JoinRoom(c, join.RoomID)

	operations, err := model.GetOperationsByRoom(ctx, join.RoomID)
	if err != nil {
		log.Printf("Failed to get operations: %v", err)
		operations = []*model.Operation{}
	}

	clients := c.hub.GetRoomClients(join.RoomID)
	users := make([]UserInfo, 0, len(clients))
	for _, client := range clients {
		users = append(users, UserInfo{
			ID:          client.user.ID.String(),
			DisplayName: client.user.DisplayName,
			AvatarColor: client.user.AvatarColor,
		})
	}

	c.sendMessage(MsgTypeSync, SyncPayload{
		Operations: operations,
		Users:      users,
	})

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
	c.hub.Broadcast(join.RoomID, presenceBytes, c)
}

func (c *Client) handleLeave() {
	if c.roomID == "" {
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

	ctx := context.Background()
	if err := model.SaveOperation(ctx, op); err != nil {
		log.Printf("Failed to save operation: %v", err)
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
	c.hub.Broadcast(c.roomID, opBytes, nil)
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
	}
}

func (c *Client) sendError(message string) {
	c.sendMessage(MsgTypeError, map[string]string{"message": message})
}
