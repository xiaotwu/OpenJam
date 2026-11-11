package ws

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"sync"

	"github.com/project-wb/server/internal/db"
)

/* Hub maintains the set of active clients and broadcasts messages */
type Hub struct {
	rooms       map[string]map[*Client]bool
	clientRooms map[*Client]string
	register    chan *Client
	unregister  chan *Client
	joinRoom    chan *joinRequest
	leaveRoom   chan *Client
	broadcast   chan *broadcastMessage
	instanceID  string
	mu          sync.RWMutex
}

type joinRequest struct {
	client *Client
	roomID string
}

type broadcastMessage struct {
	roomID  string
	message []byte
	sender  *Client
}

func NewHub() *Hub {
	return &Hub{
		rooms:       make(map[string]map[*Client]bool),
		clientRooms: make(map[*Client]string),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		joinRoom:    make(chan *joinRequest),
		leaveRoom:   make(chan *Client),
		broadcast:   make(chan *broadcastMessage, 256),
		instanceID:  generateInstanceID(),
	}
}

func generateInstanceID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *Hub) Run() {
	if db.HasRedis() {
		go h.subscribeToRedis()
	}

	for {
		select {
		case client := <-h.register:
			log.Printf("Client registered: %s", client.user.ID)

		case client := <-h.unregister:
			h.removeClient(client)

		case req := <-h.joinRoom:
			h.handleJoinRoom(req.client, req.roomID)

		case client := <-h.leaveRoom:
			h.handleLeaveRoom(client)

		case msg := <-h.broadcast:
			h.handleBroadcast(msg)
		}
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}

func (h *Hub) JoinRoom(client *Client, roomID string) {
	h.joinRoom <- &joinRequest{client: client, roomID: roomID}
}

func (h *Hub) LeaveRoom(client *Client) {
	h.leaveRoom <- client
}

func (h *Hub) Broadcast(roomID string, message []byte, sender *Client) {
	h.broadcast <- &broadcastMessage{roomID: roomID, message: message, sender: sender}
}

func (h *Hub) BroadcastToOtherServers(roomID string, message []byte, senderID string) {
	if !db.HasRedis() {
		return
	}

	ctx := context.Background()
	msg := &db.PubSubMessage{
		RoomID:   roomID,
		SenderID: senderID,
		Type:     "broadcast",
		Payload:  message,
	}
	if err := db.Publish(ctx, msg); err != nil {
		log.Printf("Failed to publish to Redis: %v", err)
	}
}

func (h *Hub) subscribeToRedis() {
	ctx := context.Background()
	pubsub, err := db.Subscribe(ctx)
	if err != nil {
		log.Printf("Failed to subscribe to Redis: %v", err)
		return
	}
	defer pubsub.Close()

	log.Println("📡 Redis Pub/Sub listener started")

	ch := pubsub.Channel()
	for msg := range ch {
		var pubsubMsg db.PubSubMessage
		if err := json.Unmarshal([]byte(msg.Payload), &pubsubMsg); err != nil {
			log.Printf("Failed to unmarshal pub/sub message: %v", err)
			continue
		}

		h.broadcastLocal(pubsubMsg.RoomID, pubsubMsg.Payload, pubsubMsg.SenderID)
	}
}

func (h *Hub) broadcastLocal(roomID string, message []byte, excludeSenderID string) {
	h.mu.RLock()
	clients, ok := h.rooms[roomID]
	h.mu.RUnlock()

	if !ok {
		return
	}

	for client := range clients {
		if excludeSenderID != "" && client.user.ID.String() == excludeSenderID {
			continue
		}

		select {
		case client.send <- message:
		default:
		}
	}
}

func (h *Hub) handleJoinRoom(client *Client, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if oldRoom, ok := h.clientRooms[client]; ok {
		if clients, exists := h.rooms[oldRoom]; exists {
			delete(clients, client)
			if len(clients) == 0 {
				delete(h.rooms, oldRoom)
			}
		}
		if db.HasRedis() {
			_ = db.RemoveOnlineUser(context.Background(), oldRoom, client.user.ID.String())
		}
	}

	if _, ok := h.rooms[roomID]; !ok {
		h.rooms[roomID] = make(map[*Client]bool)
	}
	h.rooms[roomID][client] = true
	h.clientRooms[client] = roomID
	client.roomID = roomID

	if db.HasRedis() {
		_ = db.AddOnlineUser(context.Background(), roomID, client.user.ID.String())
	}

	log.Printf("Client %s joined room %s", client.user.ID, roomID)
}

func (h *Hub) handleLeaveRoom(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if roomID, ok := h.clientRooms[client]; ok {
		if clients, exists := h.rooms[roomID]; exists {
			delete(clients, client)
			if len(clients) == 0 {
				delete(h.rooms, roomID)
			}
		}
		delete(h.clientRooms, client)
		client.roomID = ""

		if db.HasRedis() {
			_ = db.RemoveOnlineUser(context.Background(), roomID, client.user.ID.String())
		}
	}
}

func (h *Hub) removeClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if roomID, ok := h.clientRooms[client]; ok {
		if clients, exists := h.rooms[roomID]; exists {
			delete(clients, client)
			if len(clients) == 0 {
				delete(h.rooms, roomID)
			}
		}
		delete(h.clientRooms, client)

		if db.HasRedis() {
			_ = db.RemoveOnlineUser(context.Background(), roomID, client.user.ID.String())
		}
	}

	close(client.send)
	log.Printf("Client removed: %s", client.user.ID)
}

func (h *Hub) handleBroadcast(msg *broadcastMessage) {
	h.mu.RLock()
	clients, ok := h.rooms[msg.roomID]
	h.mu.RUnlock()

	if !ok {
		return
	}

	if db.HasRedis() && msg.sender != nil {
		h.BroadcastToOtherServers(msg.roomID, msg.message, msg.sender.user.ID.String())
	}

	for client := range clients {
		if msg.sender != nil && client == msg.sender {
			continue
		}

		select {
		case client.send <- msg.message:
		default:
			h.mu.Lock()
			delete(clients, client)
			delete(h.clientRooms, client)
			close(client.send)
			h.mu.Unlock()
		}
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
