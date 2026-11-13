package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/xiaotwu/shiori/server/internal/config"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/document"
)

func TestDocumentCluster(t *testing.T) {
	a := config.Env("SHIORI_CLUSTER_PRIMARY")
	b := config.Env("SHIORI_CLUSTER_SECONDARY")
	dsn := config.Env("SHIORI_CLUSTER_DATABASE_URL")
	if a == "" || b == "" || dsn == "" {
		t.Skip("requires two local Docker API endpoints and the disposable cluster database")
	}
	requireLocalCluster(t, a, b, dsn)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := db.InitContext(ctx, dsn); err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	client := &http.Client{Timeout: 8 * time.Second}
	owner, _ := registerClusterUser(t, client, a, "Owner")
	editor, editorEmail := registerClusterUser(t, client, b, "Editor")
	viewer, viewerEmail := registerClusterUser(t, client, b, "Viewer")
	room := clusterJSON[struct{ ID string }](t, client, a, owner, "POST", "/api/rooms",
		map[string]any{"name": "Migration and sync fixture"}, 200)
	legacyPath := "/api/rooms/" + room.ID
	boardPath := "/api/v2/boards/" + room.ID
	clusterJSON[map[string]any](t, client, a, owner, "POST", legacyPath+"/invites", map[string]any{"email": editorEmail, "permission": "edit"}, 201, 200)
	clusterJSON[map[string]any](t, client, a, owner, "POST", legacyPath+"/invites", map[string]any{"email": viewerEmail, "permission": "view"}, 201, 200)
	clusterJSON[map[string]any](t, client, a, owner, "POST", legacyPath+"/save", map[string]any{
		"name":  "Migration and sync fixture",
		"pages": []map[string]any{{"id": "p1", "name": "Notes"}, {"id": "p2", "name": "Next"}},
		"elements": []map[string]any{
			{"id": "note", "type": "sticky", "text": "Initial", "x": 1, "y": 2},
			{"id": "widget", "type": "widget", "widgetType": "kanban", "widgetData": map[string]any{"columns": []string{"Ideas"}}},
			{"id": "image", "type": "image", "src": "data:image/png;base64,c3ludGhldGlj", "pageId": "p2"},
		},
		"stamps": []map[string]any{{"id": "stamp", "emoji": "⭐", "x": 5, "y": 7}},
	}, 200)
	oldSocket := clusterSocket(t, a, owner, "/ws")
	writeSocket(t, oldSocket, "join", map[string]any{"roomId": room.ID})
	readSocket(t, oldSocket, "sync")
	writeSocket(t, oldSocket, "op", map[string]any{
		"opId": "unproven-tail", "opType": "add",
		"data": map[string]any{"elementId": "tail", "element": map[string]any{"id": "tail", "type": "text"}},
	})
	for {
		var exists bool
		err := db.Pool().QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM operations WHERE room_id=$1 AND op_id='unproven-tail')", room.ID).Scan(&exists)
		if err != nil {
			t.Fatal(err)
		}
		if exists {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("legacy operation did not persist")
		case <-time.After(10 * time.Millisecond):
		}
	}

	first := clusterJSON[document.Snapshot](t, client, a, owner, "GET", boardPath+"/snapshot", nil, 200)
	peer := clusterJSON[document.Snapshot](t, client, b, editor, "GET", boardPath+"/snapshot", nil, 200)
	if first.Epoch != 1 || first.Seq != 0 || len(first.Document.Elements) != 3 || len(first.Document.Pages) != 2 ||
		len(first.Document.Stamps) != 1 || first.Hash != peer.Hash || peer.Permission != "edit" ||
		elementFields(t, first, "note")["pageId"] != "p1" || elementFields(t, first, "image")["src"] != "data:image/png;base64,c3ludGhldGlj" {
		t.Fatalf("migration produced unexpected snapshots: %+v %+v", first, peer)
	}
	var archive bytes.Buffer
	if err := document.WriteLegacyArchive(ctx, room.ID, first.Epoch, &archive); err != nil || !strings.Contains(archive.String(), "unproven-tail") {
		t.Fatalf("unproven legacy operation was not archived: %v", err)
	}
	fenced := clusterJSON[document.Failure](t, client, b, owner, "POST", legacyPath+"/save",
		map[string]any{"name": "stale legacy save", "elements": []any{}}, 409)
	if fenced.Code != "PROTOCOL_UPGRADE_REQUIRED" {
		t.Fatalf("legacy save: %+v", fenced)
	}
	writeSocket(t, oldSocket, "op", map[string]any{"opId": "fenced", "opType": "delete", "data": map[string]any{"elementId": "note"}})
	var oldFailure document.Failure
	if err := json.Unmarshal(readSocket(t, oldSocket, "error"), &oldFailure); err != nil || oldFailure.Code != "PROTOCOL_UPGRADE_REQUIRED" {
		t.Fatalf("open legacy socket was not fenced: %+v %v", oldFailure, err)
	}
	_ = oldSocket.Close()
	t.Log("migration preserved pages, image and widget state, archived the unproven tail, and fenced legacy writes")

	ownerSocket := clusterSocket(t, a, owner, "/ws/v2")
	writeSocket(t, ownerSocket, "subscribe", map[string]any{"boardId": room.ID, "epoch": first.Epoch, "afterSeq": first.Seq})
	readSocket(t, ownerSocket, "subscribed")
	peerSocket := clusterSocket(t, b, editor, "/ws/v2")
	writeSocket(t, peerSocket, "subscribe", map[string]any{"boardId": room.ID, "epoch": first.Epoch, "afterSeq": first.Seq})
	readSocket(t, peerSocket, "subscribed")
	ownerPeerSocket := clusterSocket(t, b, owner, "/ws/v2")
	writeSocket(t, ownerPeerSocket, "subscribe", map[string]any{"boardId": room.ID, "epoch": first.Epoch, "afterSeq": first.Seq})
	readSocket(t, ownerPeerSocket, "subscribed")
	assertClusterPresence(t, peerSocket)
	ownerID, editorID := uuid.NewString(), uuid.NewString()
	text := clusterCommand(ownerID, first.Epoch, 0, map[string]any{
		"kind": "patch", "collection": "elements", "id": "note", "fields": map[string]any{"text": "Reviewed"},
		"expected": map[string]any{"text": "Initial"},
	})
	move := clusterCommand(editorID, first.Epoch, 0, map[string]any{
		"kind": "patch", "collection": "elements", "id": "note", "fields": map[string]any{"x": 80, "y": 90},
	})
	results := concurrentCommands(t, client, boardPath, a, owner, text, b, editor, move)
	var acks [2]document.Ack
	for i, result := range results {
		if result.status != 200 || json.Unmarshal(result.body, &acks[i]) != nil {
			t.Fatalf("independent edit failed: %d %s", result.status, result.body)
		}
	}
	if acks[0].Seq+acks[1].Seq != 3 || acks[0].Seq == acks[1].Seq {
		t.Fatalf("commit sequences were not unique and contiguous: %+v", acks)
	}
	assertCommitWake(t, peerSocket, acks[0].Seq)
	assertCommitWake(t, ownerPeerSocket, acks[0].Seq)
	_ = ownerPeerSocket.Close()
	assertClusterPresence(t, peerSocket)
	_ = peerSocket.Close()
	_ = ownerSocket.Close()
	combined := clusterJSON[document.Snapshot](t, client, b, editor, "GET", boardPath+"/snapshot", nil, 200)
	fields := elementFields(t, combined, "note")
	if fields["text"] != "Reviewed" || fields["x"] != float64(80) || fields["y"] != float64(90) {
		t.Fatalf("independent edits did not merge: %+v", fields)
	}

	// Retrying the first operation at the other replica must return its
	// original receipt, even if its initial response never reached the caller.
	replay := clusterJSON[document.Ack](t, client, b, owner, "POST", boardPath+"/commands", text, 200)
	if !replay.Replayed || replay.Seq != acks[0].Seq {
		t.Fatalf("unexpected retry receipt: %+v", replay)
	}
	badReplay := clusterCommand(ownerID, first.Epoch, 0, map[string]any{
		"kind": "patch", "collection": "elements", "id": "note", "fields": map[string]any{"x": 50, "y": 50},
	})
	badReplay["commandId"] = text["commandId"]
	conflict := clusterJSON[document.Failure](t, client, b, owner, "POST", boardPath+"/commands", badReplay, 409)
	if conflict.Code != "IDEMPOTENCY_CONFLICT" {
		t.Fatalf("changed replay: %+v", conflict)
	}
	clusterJSON[document.Failure](t, client, b, viewer, "POST", boardPath+"/commands", move, 403)

	left := clusterCommand(ownerID, first.Epoch, 2, map[string]any{
		"kind": "patch", "collection": "elements", "id": "note", "fields": map[string]any{"text": "Left"},
		"expected": map[string]any{"text": "Reviewed"},
	})
	right := clusterCommand(editorID, first.Epoch, 2, map[string]any{
		"kind": "patch", "collection": "elements", "id": "note", "fields": map[string]any{"text": "Right"},
		"expected": map[string]any{"text": "Reviewed"},
	})
	outcomes := concurrentCommands(t, client, boardPath, a, owner, left, b, editor, right)
	passed, rejected := 0, 0
	for _, result := range outcomes {
		if result.status == 200 {
			passed++
		}
		var failure document.Failure
		if result.status == 409 && json.Unmarshal(result.body, &failure) == nil && failure.Code == "CONFLICT" {
			rejected++
		}
	}
	if passed != 1 || rejected != 1 {
		t.Fatalf("text edits must produce one commit and one conflict: %+v", outcomes)
	}
	t.Log("cross-replica wake-ups reached other and same-account sessions, independent edits merged, one text edit conflicted, and replay reused its receipt")

	resumed := clusterSocket(t, b, editor, "/ws/v2")
	writeSocket(t, resumed, "subscribe", map[string]any{"boardId": room.ID, "epoch": first.Epoch, "afterSeq": 0})
	readSocket(t, resumed, "subscribed")
	socketCommand := clusterCommand(editorID, first.Epoch, 3, map[string]any{
		"kind": "patch", "collection": "elements", "id": "note", "fields": map[string]any{"x": 200, "y": 210},
	})
	writeSocket(t, resumed, "commit", socketCommand)
	var socketAck document.Ack
	if err := json.Unmarshal(readSocket(t, resumed, "ack"), &socketAck); err != nil || socketAck.Seq != 4 {
		t.Fatalf("WebSocket commit: %+v %v", socketAck, err)
	}
	duplicate := clusterCommand(ownerID, first.Epoch, socketAck.Seq, map[string]any{
		"kind": "patch", "collection": "elements", "id": "note", "fields": map[string]any{"color": "blue"},
	})
	duplicateResults := concurrentCommands(t, client, boardPath, a, owner, duplicate, b, owner, duplicate)
	var duplicateAcks [2]document.Ack
	for i, result := range duplicateResults {
		if result.status != 200 || json.Unmarshal(result.body, &duplicateAcks[i]) != nil || duplicateAcks[i].Seq != 5 {
			t.Fatalf("concurrent duplicate: %d %s", result.status, result.body)
		}
	}
	if duplicateAcks[0].Replayed == duplicateAcks[1].Replayed {
		t.Fatalf("exactly one request must reuse a receipt: %+v", duplicateAcks)
	}
	clusterJSON[map[string]any](t, client, a, owner, "PUT", legacyPath, map[string]any{"name": "Renamed through workbench"}, 200)
	assertCommitWake(t, resumed, 6)
	versionFence := clusterJSON[document.Failure](t, client, b, owner, "POST", legacyPath+"/save", map[string]any{
		"name": "outdated snapshot", "elements": []any{}, "expectedUpdatedAt": first.UpdatedAt,
	}, 409)
	if versionFence.Code != "PROTOCOL_UPGRADE_REQUIRED" {
		t.Fatalf("legacy save with old version: %+v", versionFence)
	}
	var cursor int64
	for {
		page := clusterJSON[document.ChangePage](t, client, b, editor, "GET",
			fmt.Sprintf("%s/changes?epoch=%d&afterSeq=%d&limit=2", boardPath, first.Epoch, cursor), nil, 200)
		for _, change := range page.Changes {
			if change.Seq != cursor+1 {
				t.Fatalf("change feed skipped %d: %+v", cursor+1, page)
			}
			cursor = change.Seq
		}
		if !page.HasMore {
			break
		}
	}
	finalA := clusterJSON[document.Snapshot](t, client, a, owner, "GET", boardPath+"/snapshot", nil, 200)
	finalB := clusterJSON[document.Snapshot](t, client, b, editor, "GET", boardPath+"/snapshot", nil, 200)
	if cursor != 6 || finalA.Seq != cursor || finalB.Seq != cursor || finalA.Hash != finalB.Hash || finalA.Document.Name != "Renamed through workbench" {
		t.Fatalf("replica snapshots diverged: %+v %+v cursor=%d", finalA, finalB, cursor)
	}
	t.Logf("reconnect caught up through sequence %d and both replicas returned hash %s", cursor, finalA.Hash)

	if _, err := document.Rollback(ctx, room.ID, first.Epoch, cursor-1); !errors.Is(err, document.ErrStaleRollback) {
		t.Fatalf("stale rollback should have failed: %v", err)
	}
	rolled, err := document.Rollback(ctx, room.ID, first.Epoch, cursor)
	if err != nil || rolled.Mode != "legacy" {
		t.Fatalf("rollback: %+v %v", rolled, err)
	}
	compat := clusterJSON[document.Failure](t, client, b, owner, "GET", boardPath+"/snapshot", nil, 409)
	if compat.Code != "LEGACY_MODE" {
		t.Fatalf("rollback was reactivated by a read: %+v", compat)
	}
	legacy := clusterJSON[struct {
		Name     string
		Elements []map[string]any
	}](t, client, b, owner, "GET", legacyPath+"/load", nil, 200)
	if legacy.Name != finalA.Document.Name || legacy.Elements[0]["x"] != float64(200) || len(legacy.Elements) != 3 {
		t.Fatalf("rollback did not project the committed document: %+v", legacy)
	}
	reactivated, err := document.Activate(ctx, room.ID)
	if err != nil || reactivated.Epoch != first.Epoch+1 || reactivated.Seq != cursor || reactivated.Hash != finalA.Hash {
		t.Fatalf("reactivation changed the projected contents: %+v %v", reactivated, err)
	}
	stale := clusterJSON[document.Failure](t, client, a, owner, "POST", boardPath+"/commands", text, 409)
	if stale.Code != "STALE_EPOCH" {
		t.Fatalf("old epoch accepted after reactivation: %+v", stale)
	}
	t.Logf("verified rollback and reactivation for fixture board %s at sequence %d", room.ID, cursor)
}

func assertCommitWake(t *testing.T, conn *websocket.Conn, seq int64) {
	t.Helper()
	for {
		var wake struct{ Seq int64 }
		if err := json.Unmarshal(readSocket(t, conn, "document_changed"), &wake); err != nil {
			t.Fatal(err)
		}
		if wake.Seq == seq {
			return
		}
	}
}

func assertClusterPresence(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	for {
		var state struct {
			Users []struct{ DisplayName string }
		}
		if err := json.Unmarshal(readSocket(t, conn, "presence_state"), &state); err != nil {
			t.Fatal(err)
		}
		seen := make(map[string]bool, len(state.Users))
		for _, user := range state.Users {
			if seen[user.DisplayName] {
				t.Fatalf("presence duplicated one account across connections: %+v", state.Users)
			}
			seen[user.DisplayName] = true
		}
		if seen["Owner"] && seen["Editor"] {
			return
		}
	}
}

func requireLocalCluster(t *testing.T, a, b, dsn string) {
	t.Helper()
	if a == b {
		t.Fatal("cluster test needs two distinct API replicas")
	}
	for _, raw := range []string{a, b, dsn} {
		parsed, err := url.Parse(raw)
		if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
			t.Fatal("cluster fixtures require loopback endpoints")
		}
	}
	dbURL, _ := url.Parse(dsn)
	if dbURL.Path != "/shiori_cluster_test" && dbURL.Path != "/openjam_cluster_test" {
		t.Fatal("cluster fixtures require the disposable shiori_cluster_test database")
	}
}

func registerClusterUser(t *testing.T, client *http.Client, base, name string) (string, string) {
	t.Helper()
	email := uuid.NewString() + "@example.test"
	payload := map[string]any{"email": email, "password": "local-fixture-only", "displayName": name}
	result := clusterRequest(client, base, "", "POST", "/api/auth/register", payload)
	deadline := time.Now().Add(12 * time.Second)
	for result.err == nil && result.status == http.StatusTooManyRequests && time.Now().Before(deadline) {
		time.Sleep(500 * time.Millisecond)
		result = clusterRequest(client, base, "", "POST", "/api/auth/register", payload)
	}
	if result.err != nil || result.status != http.StatusOK {
		t.Fatalf("register cluster fixture: status %d, %s, %v", result.status, result.body, result.err)
	}
	var user struct{ Token string }
	if err := json.Unmarshal(result.body, &user); err != nil {
		t.Fatal(err)
	}
	if user.Token == "" {
		t.Fatal("fixture registration returned an empty token")
	}
	return user.Token, email
}

type clusterResponse struct {
	status int
	body   []byte
	err    error
}

func clusterRequest(client *http.Client, base, token, method, route string, value any) clusterResponse {
	var reader io.Reader
	if value != nil {
		data, err := json.Marshal(value)
		if err != nil {
			return clusterResponse{err: err}
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, base+route, reader)
	if err != nil {
		return clusterResponse{err: err}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "wb_session", Value: token})
	}
	resp, err := client.Do(req)
	if err != nil {
		return clusterResponse{err: err}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return clusterResponse{status: resp.StatusCode, body: body, err: err}
}

func clusterJSON[T any](t *testing.T, client *http.Client, base, token, method, route string, value any, statuses ...int) T {
	t.Helper()
	result := clusterRequest(client, base, token, method, route, value)
	if result.err != nil {
		t.Fatal(result.err)
	}
	allowed := false
	for _, status := range statuses {
		allowed = allowed || status == result.status
	}
	var parsed T
	if !allowed {
		t.Fatalf("%s %s returned %d: %s", method, route, result.status, result.body)
	}
	if err := json.Unmarshal(result.body, &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed
}

func clusterCommand(clientID string, epoch, seq int64, operation map[string]any) map[string]any {
	return map[string]any{
		"protocolVersion": 2, "epoch": epoch, "baseSeq": seq, "clientId": clientID,
		"commandId": uuid.NewString(), "operations": []any{operation},
	}
}

func concurrentCommands(t *testing.T, client *http.Client, route, a, owner string, left any, b, editor string, right any) [2]clusterResponse {
	t.Helper()
	results := [2]chan clusterResponse{make(chan clusterResponse, 1), make(chan clusterResponse, 1)}
	go func() { results[0] <- clusterRequest(client, a, owner, "POST", route+"/commands", left) }()
	go func() { results[1] <- clusterRequest(client, b, editor, "POST", route+"/commands", right) }()
	output := [2]clusterResponse{<-results[0], <-results[1]}
	for _, result := range output {
		if result.err != nil {
			t.Fatal(result.err)
		}
	}
	return output
}

func elementFields(t *testing.T, snapshot document.Snapshot, id string) map[string]any {
	t.Helper()
	for _, raw := range snapshot.Document.Elements {
		var fields map[string]any
		if err := json.Unmarshal(raw, &fields); err != nil {
			t.Fatal(err)
		}
		if fields["id"] == id {
			return fields
		}
	}
	t.Fatalf("missing element %s", id)
	return nil
}

func clusterSocket(t *testing.T, base, token, route string) *websocket.Conn {
	t.Helper()
	for attempt := 0; ; attempt++ {
		conn, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(base, "http")+route,
			http.Header{"Origin": {base}, "Cookie": {"wb_session=" + token}})
		if err == nil {
			t.Cleanup(func() { _ = conn.Close() })
			return conn
		}
		if response == nil || response.StatusCode != http.StatusTooManyRequests || attempt == 3 {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		time.Sleep(500 * time.Millisecond)
	}
}

func writeSocket(t *testing.T, conn *websocket.Conn, kind string, payload any) {
	t.Helper()
	if err := conn.WriteJSON(map[string]any{"type": kind, "payload": payload}); err != nil {
		t.Fatal(err)
	}
}

func readSocket(t *testing.T, conn *websocket.Conn, kind string) json.RawMessage {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(8 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for {
		var response struct {
			Type    string
			Payload json.RawMessage
		}
		if err := conn.ReadJSON(&response); err != nil {
			t.Fatalf("read WebSocket %s: %v", kind, err)
		}
		if response.Type == kind {
			return response.Payload
		}
	}
}
