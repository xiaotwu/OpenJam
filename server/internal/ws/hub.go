package ws

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/xiaotwu/shiori/server/internal/db"
)

// Hub tracks upgraded connections and delivers live room messages.
type Hub struct {
	connections     map[*Client]struct{}
	rooms           map[string]map[*Client]bool
	clientRooms     map[*Client]string
	documentMembers map[*Client]string
	presenceWake    chan struct{}
	presenceMu      sync.Mutex
	broadcast       chan *broadcastMessage
	done            chan struct{}
	instanceID      string
	closing         bool
	mu              sync.RWMutex
}

type broadcastMessage struct {
	roomID        string
	message       []byte
	sender        *Client
	accessChanged bool
}

func NewHub() *Hub {
	return &Hub{
		connections:     make(map[*Client]struct{}),
		rooms:           make(map[string]map[*Client]bool),
		clientRooms:     make(map[*Client]string),
		documentMembers: make(map[*Client]string),
		presenceWake:    make(chan struct{}, 1),
		broadcast:       make(chan *broadcastMessage, 256),
		done:            make(chan struct{}),
		instanceID:      generateInstanceID(),
	}
}

func generateInstanceID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *Hub) Run(ctx context.Context) {
	defer close(h.done)
	go h.runDocumentPresence(ctx)
	if db.HasRedis() {
		go h.subscribeToRedis(ctx)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case msg := <-h.broadcast:
			if !msg.accessChanged {
				h.sendToRoom(msg.roomID, msg.message, msg.sender, "")
			}
			if db.HasRedis() {
				h.publish(ctx, msg)
			}
		}
	}
}

func (h *Hub) Register(client *Client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closing {
		return false
	}
	h.connections[client] = struct{}{}
	return true
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	roomID := h.removeFromRoomLocked(client)
	if _, registered := h.connections[client]; registered {
		delete(h.connections, client)
		close(client.send)
	}
	h.mu.Unlock()

	h.releaseRoomPresence(client, roomID)
}

func (h *Hub) JoinRoom(client *Client, roomID string) {
	h.mu.Lock()
	oldRoom := h.removeFromRoomLocked(client)
	if h.rooms[roomID] == nil {
		h.rooms[roomID] = make(map[*Client]bool)
	}
	h.rooms[roomID][client] = true
	h.clientRooms[client] = roomID
	client.roomID = roomID
	h.mu.Unlock()

	if oldRoom != roomID {
		h.releaseRoomPresence(client, oldRoom)
	}
	if client.documentToken == "" && db.HasRedis() {
		_ = db.AddOnlineUser(context.Background(), roomID, client.user.ID.String())
	}
}

func (h *Hub) LeaveRoom(client *Client) {
	h.mu.Lock()
	roomID := h.removeFromRoomLocked(client)
	client.roomID = ""
	h.mu.Unlock()
	h.releaseRoomPresence(client, roomID)
}

func (h *Hub) removeFromRoomLocked(client *Client) string {
	roomID := h.clientRooms[client]
	if roomID == "" {
		return ""
	}
	delete(h.clientRooms, client)
	delete(h.documentMembers, client)
	delete(h.rooms[roomID], client)
	if len(h.rooms[roomID]) == 0 {
		delete(h.rooms, roomID)
	}
	return roomID
}

func (h *Hub) CloseConnections() {
	h.mu.Lock()
	h.closing = true
	clients := make([]*Client, 0, len(h.connections))
	for client := range h.connections {
		clients = append(clients, client)
	}
	h.mu.Unlock()

	deadline := time.Now().Add(time.Second)
	closeMessage := websocket.FormatCloseMessage(websocket.CloseServiceRestart, "Shiori is restarting")
	for _, client := range clients {
		_ = client.conn.WriteControl(websocket.CloseMessage, closeMessage, deadline)
		_ = client.conn.Close()
	}
}

func (h *Hub) Broadcast(roomID string, message []byte, sender *Client) {
	select {
	case h.broadcast <- &broadcastMessage{roomID: roomID, message: message, sender: sender}:
	case <-h.done:
	}
}

// NotifyDocument is a best-effort high-water hint after the database commits.
// A subscriber can read the authoritative change feed even if it misses this.
func (h *Hub) NotifyDocument(boardID string, epoch, seq int64) {
	message, err := json.Marshal(OutgoingMessage{
		Type:    MsgTypeDocumentChanged,
		Payload: documentChanged{BoardID: boardID, Epoch: epoch, Seq: seq},
	})
	if err != nil {
		return
	}
	h.tryBroadcast(&broadcastMessage{roomID: boardID, message: message})
}

func (h *Hub) tryBroadcast(message *broadcastMessage) {
	select {
	case h.broadcast <- message:
	case <-h.done:
	default:
	}
}

// NotifyAccessChanged invalidates live subscriptions after an ACL write. Each
// reconnect must pass the stored session and current board permission checks.
func (h *Hub) NotifyAccessChanged(boardID string) {
	h.closeRoomSubscriptions(boardID)
	h.tryBroadcast(&broadcastMessage{roomID: boardID, accessChanged: true})
}

func (h *Hub) closeRoomSubscriptions(boardID string) {
	for _, client := range h.GetRoomClients(boardID) {
		_ = client.conn.Close()
	}
}

func (h *Hub) publish(ctx context.Context, msg *broadcastMessage) {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	var senderID string
	if msg.sender != nil {
		senderID = msg.sender.user.ID.String()
	}
	messageType := "broadcast"
	if msg.accessChanged {
		messageType = "access_changed"
	}
	err := db.Publish(ctx, &db.PubSubMessage{
		RoomID:     msg.roomID,
		SenderID:   senderID,
		InstanceID: h.instanceID,
		Type:       messageType,
		Payload:    msg.message,
	})
	if err != nil && ctx.Err() == nil {
		log.Printf("Publish room message: %v", err)
	}
}

func (h *Hub) subscribeToRedis(ctx context.Context) {
	pubsub, err := db.Subscribe(ctx)
	if err != nil {
		log.Printf("Failed to subscribe to Redis: %v", err)
		return
	}
	defer pubsub.Close()

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, open := <-ch:
			if !open {
				return
			}
			var incoming db.PubSubMessage
			if err := json.Unmarshal([]byte(msg.Payload), &incoming); err != nil {
				log.Printf("Decode room message: %v", err)
				continue
			}
			if incoming.InstanceID == h.instanceID {
				continue
			}
			if incoming.Type == "access_changed" {
				h.closeRoomSubscriptions(incoming.RoomID)
			} else if incoming.Type == "broadcast" {
				h.sendToRoom(incoming.RoomID, incoming.Payload, nil, incoming.SenderID)
			}
		}
	}
}

func (h *Hub) sendToRoom(roomID string, message []byte, exclude *Client, excludeUser string) {
	var slow []*Client
	h.mu.RLock()
	for client := range h.rooms[roomID] {
		if client == exclude || (excludeUser != "" && client.user.ID.String() == excludeUser) {
			continue
		}
		select {
		case client.send <- message:
		default:
			slow = append(slow, client)
		}
	}
	h.mu.RUnlock()

	for _, client := range slow {
		// The read pump removes the client and closes its send queue.
		_ = client.conn.Close()
	}
}

func (h *Hub) GetRoomClients(roomID string) []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients, ok := h.rooms[roomID]
	if !ok {
		return nil
	}

	result := make([]*Client, 0, len(clients))
	for client := range clients {
		result = append(result, client)
	}
	return result
}
