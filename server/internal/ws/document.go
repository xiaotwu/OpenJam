package ws

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/model"
)

const (
	MsgTypeSubscribe       MessageType = "subscribe"
	MsgTypeSubscribed      MessageType = "subscribed"
	MsgTypeCommit          MessageType = "commit"
	MsgTypeAck             MessageType = "ack"
	MsgTypeDocumentChanged MessageType = "document_changed"
	MsgTypePresenceState   MessageType = "presence_state"
	MsgTypePresentView     MessageType = "present_view"
)

const (
	documentPingPeriod       = 5 * time.Second
	documentPongWait         = 15 * time.Second
	documentPresenceInterval = 4 * time.Second
	documentPresenceTTL      = 15 * time.Second
	documentPresenceTimeout  = 250 * time.Millisecond
)

type documentChanged struct {
	BoardID string `json:"boardId"`
	Epoch   int64  `json:"epoch"`
	Seq     int64  `json:"seq"`
}

type documentPresenceLease struct {
	ConnectionID string   `json:"connectionId"`
	User         UserInfo `json:"user"`
}

type documentPresenceState struct {
	Users []UserInfo `json:"users"`
}

func (c *Client) UseDocumentProtocol(token string) {
	c.documentToken = token
	lease, _ := json.Marshal(documentPresenceLease{
		ConnectionID: uuid.NewString(),
		User: UserInfo{
			ID: c.user.ID.String(), DisplayName: c.user.DisplayName, AvatarColor: c.user.AvatarColor,
		},
	})
	c.documentLease = string(lease)
}

func (c *Client) handleDocumentMessage(msg IncomingMessage) {
	switch msg.Type {
	case MsgTypeSubscribe:
		c.subscribeDocument(msg.Payload)
	case MsgTypeCommit:
		c.commitDocument(msg.Payload)
	case MsgTypeLeave:
		c.handleLeave()
	case MsgTypeCursor:
		c.documentCursor(msg.Payload)
	case MsgTypePresentView:
		c.presentDocumentView(msg.Payload)
	default:
		c.sendDocumentFailure(document.Failure{Code: "INVALID_COMMAND", Error: "Unsupported document message"})
	}
}

func (c *Client) subscribeDocument(payload json.RawMessage) {
	var request struct {
		BoardID  string `json:"boardId"`
		Epoch    int64  `json:"epoch"`
		AfterSeq int64  `json:"afterSeq"`
	}
	err := json.Unmarshal(payload, &request)
	if err != nil || strings.TrimSpace(request.BoardID) == "" || utf8.RuneCountInString(request.BoardID) > 36 ||
		strings.ContainsRune(request.BoardID, 0) || request.Epoch < 1 || request.AfterSeq < 0 {
		c.sendDocumentFailure(document.Failure{Code: "INVALID_CURSOR", Error: "Invalid document subscription"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if !c.checkDocumentSession(ctx) {
		return
	}
	state, err := document.Subscription(ctx, request.BoardID, c.user.ID)
	if err != nil {
		c.sendDocumentFailure(document.DescribeError(err))
		return
	}
	if state.Epoch != request.Epoch || request.AfterSeq > state.HeadSeq {
		c.sendDocumentFailure(document.Failure{Code: "RESYNC_REQUIRED", Error: "Refresh the board snapshot"})
		return
	}

	if c.roomID != "" && c.roomID != request.BoardID {
		c.handleLeave()
	}
	joined := c.roomID != request.BoardID
	if joined {
		c.hub.JoinRoom(c, request.BoardID)
	}
	// Read the barrier after registering for wake-ups. The HTTP feed also
	// closes any gap when a notification is lost between these operations.
	state, err = document.Subscription(ctx, request.BoardID, c.user.ID)
	if err != nil || state.Epoch != request.Epoch {
		c.hub.LeaveRoom(c)
		if err != nil {
			c.sendDocumentFailure(document.DescribeError(err))
		} else {
			c.sendDocumentFailure(document.Failure{Code: "RESYNC_REQUIRED", Error: "Refresh the board snapshot"})
		}
		return
	}
	c.lastCursorAccess = time.Now()
	c.documentEpoch = state.Epoch
	c.setDocumentPermission(state.Permission)
	c.sendMessage(MsgTypeSubscribed, struct {
		document.SubscriptionState
		Users []UserInfo `json:"users"`
	}{state, c.hub.initialDocumentUsers(ctx, c, request.BoardID)})
	c.hub.activateDocumentPresence(c, request.BoardID)
}

func (h *Hub) initialDocumentUsers(ctx context.Context, client *Client, roomID string) []UserInfo {
	local := []string{client.documentLease}
	h.mu.RLock()
	for member := range h.rooms[roomID] {
		if h.documentMembers[member] == roomID && member != client {
			local = append(local, member.documentLease)
		}
	}
	h.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, documentPresenceTimeout)
	defer cancel()
	remote, _ := db.RefreshDocumentPresence(ctx, map[string][]string{roomID: nil}, documentPresenceTTL)
	return mergeDocumentUsers(remote[roomID], local)
}

func (h *Hub) activateDocumentPresence(client *Client, roomID string) {
	h.mu.Lock()
	h.documentMembers[client] = roomID
	h.mu.Unlock()
	h.wakeDocumentPresence()
}

func (h *Hub) releaseRoomPresence(client *Client, roomID string) {
	if roomID == "" {
		return
	}
	if client.documentToken == "" {
		_ = db.RemoveOnlineUser(context.Background(), roomID, client.user.ID.String())
		return
	}
	// Wait for any refresh that already captured this connection. After the
	// membership is removed, subsequent refreshes cannot renew its lease.
	h.presenceMu.Lock()
	ctx, cancel := context.WithTimeout(context.Background(), documentPresenceTimeout)
	_ = db.RemoveDocumentPresence(ctx, roomID, client.documentLease)
	cancel()
	h.presenceMu.Unlock()
	h.wakeDocumentPresence()
}

func (h *Hub) wakeDocumentPresence() {
	select {
	case h.presenceWake <- struct{}{}:
	default:
	}
}

func (h *Hub) runDocumentPresence(ctx context.Context) {
	ticker := time.NewTicker(documentPresenceInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-h.presenceWake:
		}
		h.refreshDocumentPresence(ctx)
	}
}

func (h *Hub) refreshDocumentPresence(ctx context.Context) {
	h.presenceMu.Lock()
	h.mu.RLock()
	rooms := make(map[string][]string)
	for client, roomID := range h.documentMembers {
		rooms[roomID] = append(rooms[roomID], client.documentLease)
	}
	h.mu.RUnlock()
	ctx, cancel := context.WithTimeout(ctx, documentPresenceTimeout)
	remote, _ := db.RefreshDocumentPresence(ctx, rooms, documentPresenceTTL)
	cancel()
	h.presenceMu.Unlock()

	for roomID, local := range rooms {
		users := mergeDocumentUsers(remote[roomID], local)
		message, err := json.Marshal(OutgoingMessage{Type: MsgTypePresenceState, Payload: documentPresenceState{Users: users}})
		if err != nil {
			continue
		}
		h.mu.RLock()
		for client := range h.rooms[roomID] {
			if h.documentMembers[client] != roomID {
				continue
			}
			select {
			case client.send <- message:
			default:
			}
		}
		h.mu.RUnlock()
	}
}

func mergeDocumentUsers(remote, local []string) []UserInfo {
	byID := make(map[string]UserInfo, len(remote)+len(local))
	for _, leases := range [][]string{remote, local} {
		for _, member := range leases {
			var lease documentPresenceLease
			if json.Unmarshal([]byte(member), &lease) == nil && lease.User.ID != "" {
				byID[lease.User.ID] = lease.User
			}
		}
	}
	users := make([]UserInfo, 0, len(byID))
	for _, user := range byID {
		users = append(users, user)
	}
	sort.Slice(users, func(i, j int) bool { return users[i].ID < users[j].ID })
	return users
}

func (c *Client) commitDocument(payload json.RawMessage) {
	if c.roomID == "" {
		c.sendDocumentFailure(document.Failure{Code: "INVALID_COMMAND", Error: "Subscribe to a board before committing"})
		return
	}
	command, err := document.DecodeCommand(bytes.NewReader(payload))
	if err != nil {
		c.sendDocumentFailure(document.Failure{Code: "INVALID_COMMAND", Error: "Invalid board command"})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if !c.checkDocumentSession(ctx) {
		return
	}
	ack, err := document.Commit(ctx, c.roomID, c.user.ID, command)
	if err != nil {
		if errors.Is(err, model.ErrRoomAccessDenied) || errors.Is(err, model.ErrRoomNotFound) {
			c.hub.LeaveRoom(c)
		}
		c.sendDocumentFailure(document.DescribeError(err))
		return
	}
	c.sendMessage(MsgTypeAck, ack)
	c.hub.NotifyDocument(ack.BoardID, ack.Epoch, ack.Seq)
}

func (c *Client) documentCursor(payload json.RawMessage) {
	if c.roomID == "" {
		return
	}
	if time.Since(c.lastCursorAccess) <= time.Second || c.checkDocumentSubscription() {
		c.handleCursor(payload)
	}
}

func (c *Client) checkDocumentSubscription() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if !c.checkDocumentSession(ctx) {
		c.hub.LeaveRoom(c)
		return false
	}
	state, err := document.Subscription(ctx, c.roomID, c.user.ID)
	if err != nil || state.Epoch != c.documentEpoch {
		c.hub.LeaveRoom(c)
		if err != nil {
			c.sendDocumentFailure(document.DescribeError(err))
		} else {
			c.sendDocumentFailure(document.Failure{Code: "RESYNC_REQUIRED", Error: "Refresh the board snapshot"})
		}
		return false
	}
	c.lastCursorAccess = time.Now()
	c.setDocumentPermission(state.Permission)
	return true
}

func (c *Client) setDocumentPermission(permission string) {
	if permission == "owner" {
		c.permission = model.RoomPermissionEdit
		return
	}
	c.permission, _ = model.NormalizeRoomPermission(permission)
}

func (c *Client) checkDocumentSession(ctx context.Context) bool {
	session, err := model.GetStoredSession(ctx, c.documentToken)
	if err != nil {
		c.sendDocumentFailure(document.DescribeError(err))
		return false
	}
	if session == nil || session.UserID != c.user.ID {
		c.hub.LeaveRoom(c)
		c.sendDocumentFailure(document.Failure{Code: "UNAUTHENTICATED", Error: "Sign in to sync this board"})
		return false
	}
	return true
}

func (c *Client) sendDocumentFailure(failure document.Failure) {
	c.sendMessage(MsgTypeError, struct {
		document.Failure
		Message string `json:"message"`
	}{failure, failure.Error})
}
