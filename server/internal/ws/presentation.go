package ws

import (
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/project-wb/server/internal/model"
)

type presentedView struct {
	Active bool    `json:"active"`
	PageID string  `json:"pageId,omitempty"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Scale  float64 `json:"scale"`
}

func (c *Client) presentDocumentView(payload json.RawMessage) {
	if c.roomID == "" {
		return
	}
	var view presentedView
	if err := json.Unmarshal(payload, &view); err != nil || (view.Active && !validPresentedView(view)) {
		return
	}
	now := time.Now()
	if view.Active && now.Sub(c.lastViewport) < 100*time.Millisecond {
		return
	}
	if now.Sub(c.lastCursorAccess) > time.Second && !c.checkDocumentSubscription() {
		return
	}
	if !model.RoomPermissionAllowsEdit(c.permission) {
		return
	}
	if !view.Active {
		view = presentedView{}
	}
	c.lastViewport = now
	message, err := json.Marshal(OutgoingMessage{Type: MsgTypePresentView, Payload: struct {
		presentedView
		UserID string `json:"userId"`
		Epoch  int64  `json:"epoch"`
	}{view, c.user.ID.String(), c.documentEpoch}})
	if err == nil {
		c.hub.tryBroadcast(&broadcastMessage{roomID: c.roomID, message: message, sender: c})
	}
}

func validPresentedView(view presentedView) bool {
	return strings.TrimSpace(view.PageID) != "" && len(view.PageID) <= 1024 && !strings.ContainsRune(view.PageID, 0) &&
		math.Abs(view.X) <= 1e8 && math.Abs(view.Y) <= 1e8 && view.Scale >= 0.1 && view.Scale <= 5
}
