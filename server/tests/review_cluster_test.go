package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/document"
)

func TestReviewCluster(t *testing.T) {
	a := os.Getenv("OPENJAM_CLUSTER_PRIMARY")
	b := os.Getenv("OPENJAM_CLUSTER_SECONDARY")
	dsn := os.Getenv("OPENJAM_CLUSTER_DATABASE_URL")
	if a == "" || b == "" || dsn == "" {
		t.Skip("requires two loopback Docker API endpoints and the disposable cluster database")
	}
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 8 * time.Second}
	owner, _ := registerClusterUser(t, client, a, "Review owner")
	editor, editorEmail := registerClusterUser(t, client, b, "Review editor")
	reviewer, reviewerEmail := registerClusterUser(t, client, b, "Review commenter")
	reader, readerEmail := registerClusterUser(t, client, a, "Link viewer")
	ownerID := clusterJSON[struct{ User struct{ ID string } }](t, client, a, owner, "GET", "/api/me", nil, 200).User.ID
	room := clusterJSON[struct{ ID string }](t, client, a, owner, "POST", "/api/rooms", map[string]any{"name": "Review and version fixture"}, 200)
	board := "/api/v2/boards/" + room.ID
	sharing := board + "/sharing"
	review := board + "/review"
	versions := board + "/versions"
	first := clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	clusterJSON[document.Failure](t, client, b, reader, "GET", board+"/snapshot", nil, 403)

	type access struct{ Permission, Source string }
	type invite struct {
		Invitation struct{ ID string }
		Token      string
	}
	newInvite := func(email, permission string) invite {
		return clusterJSON[invite](t, client, a, owner, "POST", sharing+"/invitations", map[string]any{
			"email": email, "permission": permission, "expiresInDays": 7,
		}, 201)
	}
	editorInvite := newInvite(editorEmail, "edit")
	reviewerInvite := newInvite(reviewerEmail, "comment")
	clusterJSON[document.Failure](t, client, b, reader, "POST", sharing+"/invitations/accept", map[string]any{"token": reviewerInvite.Token}, 403)
	for _, item := range []struct{ auth, token, role string }{
		{editor, editorInvite.Token, "edit"}, {reviewer, reviewerInvite.Token, "comment"},
	} {
		got := clusterJSON[access](t, client, b, item.auth, "POST", sharing+"/invitations/accept", map[string]any{"token": item.token}, 200)
		if got.Permission != item.role || got.Source != "member" {
			t.Fatalf("accepted invitation grant = %+v", got)
		}
	}
	withdrawn := newInvite(readerEmail, "edit")
	if result := clusterRequest(client, a, owner, "DELETE", sharing+"/invitations/"+withdrawn.Invitation.ID, nil); result.err != nil || result.status != 204 {
		t.Fatalf("revoke invitation = %d %s %v", result.status, result.body, result.err)
	}
	clusterJSON[document.Failure](t, client, b, reader, "POST", sharing+"/invitations/accept", map[string]any{"token": withdrawn.Token}, 410)
	type createdLink struct {
		Link  struct{ ID string }
		Token string
	}
	expired := clusterJSON[createdLink](t, client, a, owner, "POST", sharing+"/links", map[string]any{"permission": "comment", "expiresInDays": 7}, 201)
	forceExpiredTestLink(t, dsn, room.ID, expired.Link.ID)
	clusterJSON[document.Failure](t, client, b, reader, "POST", sharing+"/links/redeem", map[string]any{"token": expired.Token}, 410)
	link := clusterJSON[createdLink](t, client, a, owner, "POST", sharing+"/links", map[string]any{"permission": "view", "expiresInDays": 7}, 201)
	linkAccess := clusterJSON[access](t, client, b, reader, "POST", sharing+"/links/redeem", map[string]any{"token": link.Token}, 200)
	if linkAccess.Permission != "view" || linkAccess.Source != "link" {
		t.Fatalf("redeemed view link = %+v", linkAccess)
	}
	clusterJSON[document.Failure](t, client, b, reader, "GET", sharing, nil, 403)
	t.Log("email-bound invitations and a signed-in view link granted only their effective roles")

	editorClient := uuid.NewString()
	ownerClient := uuid.NewString()
	newObject := func(id, text string) map[string]any {
		return map[string]any{"kind": "add", "collection": "elements", "id": id, "value": map[string]any{
			"id": id, "type": "sticky", "pageId": first.Document.DefaultPageID, "text": text, "x": 10, "y": 20,
		}}
	}
	batch := clusterCommand(editorClient, first.Epoch, first.Seq, newObject("reference", "Initial reference"))
	batch["operations"] = []any{newObject("reference", "Initial reference"), newObject("companion", "Second item")}
	initialAck := clusterJSON[document.Ack](t, client, b, editor, "POST", board+"/commands", batch, 200)
	if initialAck.Seq != first.Seq+1 || len(initialAck.Change.Operations) != 2 {
		t.Fatalf("batch not committed atomically: %+v", initialAck)
	}
	update := func(field string, value any) map[string]any {
		return map[string]any{"kind": "patch", "collection": "elements", "id": "reference", "fields": map[string]any{field: value}}
	}
	move := clusterCommand(editorClient, first.Epoch, initialAck.Seq, update("x", 160))
	companionMove := map[string]any{"kind": "patch", "collection": "elements", "id": "companion", "fields": map[string]any{"x": 25}}
	move["operations"] = []any{update("x", 160), companionMove}
	color := clusterCommand(ownerClient, first.Epoch, initialAck.Seq, update("color", "blue"))
	results := concurrentCommands(t, client, board, a, owner, color, b, editor, move)
	for _, result := range results {
		if result.status != 200 {
			t.Fatalf("concurrent board edit returned %d: %s", result.status, result.body)
		}
	}
	var moveAck document.Ack
	if err := json.Unmarshal(results[1].body, &moveAck); err != nil || moveAck.Change == nil || len(moveAck.Change.Operations) != 2 {
		t.Fatalf("concurrent batch receipt = %+v, %v", moveAck, err)
	}
	geometry := func(before, after int, companionBefore, companionAfter int) []any {
		return []any{
			map[string]any{"kind": "patch", "collection": "elements", "id": "reference", "fields": map[string]any{"x": after}, "expected": map[string]any{"x": before}},
			map[string]any{"kind": "patch", "collection": "elements", "id": "companion", "fields": map[string]any{"x": companionAfter}, "expected": map[string]any{"x": companionBefore}},
		}
	}
	undo := clusterCommand(editorClient, first.Epoch, initialAck.Seq+2, update("x", 10))
	undo["operations"], undo["dependsOn"] = geometry(160, 10, 25, 10), moveAck.CommandID
	undone := clusterJSON[document.Ack](t, client, a, editor, "POST", board+"/commands", undo, 200)
	peerUndo := clusterJSON[document.Snapshot](t, client, b, editor, "GET", board+"/snapshot", nil, 200)
	if undone.Seq != initialAck.Seq+3 || elementFields(t, peerUndo, "reference")["color"] != "blue" ||
		elementFields(t, peerUndo, "reference")["x"] != float64(10) || elementFields(t, peerUndo, "companion")["x"] != float64(10) {
		t.Fatalf("batch undo overwrote a remote field or left one item behind: %+v", peerUndo)
	}
	redo := clusterCommand(editorClient, first.Epoch, undone.Seq, update("x", 160))
	redo["operations"], redo["dependsOn"] = geometry(10, 160, 10, 25), undone.CommandID
	clusterJSON[document.Ack](t, client, b, editor, "POST", board+"/commands", redo, 200)
	clusterJSON[document.Failure](t, client, b, reviewer, "POST", board+"/commands", move, 403)
	milestone := clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	object := elementFields(t, milestone, "reference")
	if milestone.Seq != initialAck.Seq+4 || object["x"] != float64(160) || object["color"] != "blue" || elementFields(t, milestone, "companion")["x"] != float64(25) {
		t.Fatalf("independent edits did not merge: %+v", milestone)
	}
	t.Log("a grouped move, undo and redo each used one sequence and preserved the other editor's independent change")

	nameRequest := map[string]any{"name": "Review milestone", "expectedEpoch": milestone.Epoch, "expectedSeq": milestone.Seq}
	named := clusterJSON[struct{ ID, Hash string }](t, client, a, editor, "POST", versions, nameRequest, 201)
	if named.ID == "" || named.Hash != milestone.Hash {
		t.Fatalf("named version = %+v", named)
	}
	preview := clusterJSON[struct{ Document document.Document }](t, client, b, editor, "GET", versions+"/"+named.ID, nil, 200)
	if preview.Document.Name != milestone.Document.Name || len(preview.Document.Elements) != 2 {
		t.Fatalf("peer version preview = %+v", preview)
	}

	threadID := uuid.NewString()
	threadRequest := map[string]any{"requestId": threadID, "body": "Please verify the reference", "mentionUserIds": []string{ownerID},
		"anchor": map[string]any{"pageId": milestone.Document.DefaultPageID, "elementId": "reference"}}
	clusterJSON[document.Failure](t, client, b, reader, "POST", review+"/threads", threadRequest, 403)
	clusterJSON[map[string]any](t, client, b, reviewer, "POST", review+"/threads", threadRequest, 201, 200)
	threadPath := review + "/threads/" + threadID
	reply := map[string]any{"requestId": uuid.NewString(), "body": "Confirmed from the other replica"}
	clusterJSON[map[string]any](t, client, a, owner, "POST", threadPath+"/replies", reply, 201, 200)
	clusterJSON[map[string]any](t, client, b, reviewer, "PUT", threadPath, map[string]any{"resolved": true}, 200)
	readThread := func(base, auth, path string) document.ReviewThreadDetail {
		return clusterJSON[document.ReviewThreadDetail](t, client, base, auth, "GET", path, nil, 200)
	}
	if view := readThread(a, reader, threadPath); view.CanComment || view.Thread.Anchor.Status != "live" {
		t.Fatalf("viewer review capabilities = %+v", view)
	}
	threadBefore := readThread(a, reviewer, threadPath)
	if threadBefore.Thread.Body != "Please verify the reference" || threadBefore.Thread.ResolvedAt == nil ||
		len(threadBefore.Comments) != 2 || threadBefore.Comments[1].Body != "Confirmed from the other replica" {
		t.Fatalf("review was not visible on the peer: %+v", threadBefore)
	}
	readNotifications := func(base string) []document.ReviewNotification {
		return clusterJSON[struct{ Notifications []document.ReviewNotification }](t, client, base, owner, "GET", review+"/notifications", nil, 200).Notifications
	}
	notifications := readNotifications(b)
	if len(notifications) != 1 || notifications[0].ThreadID.String() != threadID || notifications[0].ReadAt != nil {
		t.Fatalf("mention did not appear on the other replica: %+v", notifications)
	}
	clusterJSON[map[string]any](t, client, a, owner, "PUT", review+"/notifications/"+notifications[0].CommentID.String()+"/read", nil, 200)
	if read := readNotifications(b); len(read) != 1 || read[0].ReadAt == nil {
		t.Fatalf("mention read state did not propagate: %+v", read)
	}
	t.Log("a commenter created an anchored thread, an owner replied on the other replica, and the mentioned owner received a notification")

	addedLater := clusterJSON[document.Ack](t, client, b, editor, "POST", board+"/commands",
		clusterCommand(editorClient, milestone.Epoch, milestone.Seq, newObject("later", "Created after the milestone")), 200)
	laterThread := uuid.NewString()
	clusterJSON[map[string]any](t, client, b, reviewer, "POST", review+"/threads", map[string]any{
		"requestId": laterThread, "body": "Keep this review after restoration",
		"anchor": map[string]any{"pageId": milestone.Document.DefaultPageID, "elementId": "later"},
	}, 201, 200)
	diverged := clusterJSON[document.Snapshot](t, client, b, editor, "GET", board+"/snapshot", nil, 200)
	restoreRoute := versions + "/" + named.ID + "/restore"
	restoreID := uuid.NewString()
	restore := map[string]any{"requestId": restoreID, "expectedEpoch": milestone.Epoch, "expectedSeq": milestone.Seq}
	clusterJSON[document.Failure](t, client, a, owner, "POST", restoreRoute, restore, 409)
	restore["expectedSeq"] = addedLater.Seq
	clusterJSON[document.Failure](t, client, b, editor, "POST", restoreRoute, restore, 403)
	type restoreResult struct {
		Epoch, Seq            int64
		Hash, BeforeVersionID string
		Replayed              bool
	}
	restored := clusterJSON[restoreResult](t, client, a, owner, "POST", restoreRoute, restore, 200)
	replayed := clusterJSON[restoreResult](t, client, b, owner, "POST", restoreRoute, restore, 200)
	if restored.Epoch != milestone.Epoch+1 || restored.Seq != diverged.Seq+1 || restored.Hash != milestone.Hash ||
		restored.BeforeVersionID == "" || restored.Replayed || !replayed.Replayed || replayed.Seq != restored.Seq || replayed.Epoch != restored.Epoch {
		t.Fatalf("version restore or replay = %+v / %+v", restored, replayed)
	}
	checkpoint := clusterJSON[struct{ Version struct{ Hash string } }](t, client, b, owner, "GET", versions+"/"+restored.BeforeVersionID, nil, 200)
	if checkpoint.Version.Hash != diverged.Hash {
		t.Fatalf("recovery checkpoint hash = %s, want %s", checkpoint.Version.Hash, diverged.Hash)
	}
	left := clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	right := clusterJSON[document.Snapshot](t, client, b, editor, "GET", board+"/snapshot", nil, 200)
	if left.Hash != milestone.Hash || right.Hash != left.Hash || left.Epoch != restored.Epoch || right.Seq != restored.Seq || len(right.Document.Elements) != 2 {
		t.Fatalf("restored replicas diverged: %+v %+v", left, right)
	}
	old := clusterJSON[document.Failure](t, client, b, editor, "POST", board+"/commands",
		clusterCommand(editorClient, milestone.Epoch, addedLater.Seq, update("color", "red")), 409)
	if old.Code != "STALE_EPOCH" {
		t.Fatalf("stale pre-restore command = %+v", old)
	}
	if after := readThread(b, reviewer, threadPath); !reflect.DeepEqual(after, threadBefore) {
		t.Fatalf("original anchored review changed during restoration: %+v", after)
	}
	if later := readThread(b, reviewer, review+"/threads/"+laterThread); later.Thread.Body != "Keep this review after restoration" ||
		later.Thread.Anchor.ElementID != "later" || later.Thread.Anchor.Status != "missing-object" {
		t.Fatalf("review lost its original anchor or content: %+v", later)
	}
	t.Logf("restored board %s at epoch %d sequence %d hash %s, with review and pre-restore checkpoint intact", room.ID, restored.Epoch, restored.Seq, restored.Hash)

	viewerSocket := clusterSocket(t, b, reader, "/ws/v2")
	writeSocket(t, viewerSocket, "subscribe", map[string]any{"boardId": room.ID, "epoch": restored.Epoch, "afterSeq": restored.Seq})
	readSocket(t, viewerSocket, "subscribed")
	presenterSocket := clusterSocket(t, a, owner, "/ws/v2")
	writeSocket(t, presenterSocket, "subscribe", map[string]any{"boardId": room.ID, "epoch": restored.Epoch, "afterSeq": restored.Seq})
	readSocket(t, presenterSocket, "subscribed")
	writeSocket(t, presenterSocket, "present_view", map[string]any{"active": true, "pageId": first.Document.DefaultPageID, "x": 200, "y": 300, "scale": 1.25})
	var presented struct {
		UserID, PageID string
		Active         bool
		Epoch          int64
		X, Y, Scale    float64
	}
	if err := json.Unmarshal(readSocket(t, viewerSocket, "present_view"), &presented); err != nil || !presented.Active || presented.UserID != ownerID || presented.Epoch != restored.Epoch || presented.Scale != 1.25 {
		t.Fatalf("remote presentation = %+v, %v", presented, err)
	}
	result := clusterRequest(client, a, owner, "DELETE", sharing+"/links/"+link.Link.ID, nil)
	if result.err != nil || result.status != 204 {
		t.Fatalf("revoke link = %d %s %v", result.status, result.body, result.err)
	}
	_ = viewerSocket.SetReadDeadline(time.Now().Add(8 * time.Second))
	for {
		if _, _, err := viewerSocket.ReadMessage(); err != nil {
			if timeout, ok := err.(interface{ Timeout() bool }); ok && timeout.Timeout() {
				t.Fatalf("revocation did not close the peer's active subscription: %v", err)
			}
			break
		}
	}
	clusterJSON[document.Failure](t, client, b, reader, "GET", board+"/snapshot", nil, 403)
	clusterJSON[document.Failure](t, client, b, reader, "GET", review+"/threads", nil, 403)
	t.Log("viewer received the live presentation, then revocation closed the peer subscription and denied document and review reads")
}

func forceExpiredTestLink(t *testing.T, dsn, roomID, linkID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	updated, err := conn.Exec(ctx, `
		UPDATE board_share_links SET created_at = statement_timestamp() - INTERVAL '2 days',
			expires_at = statement_timestamp() - INTERVAL '1 day'
		WHERE room_id = $1 AND id = $2
	`, roomID, linkID)
	if err != nil || updated.RowsAffected() != 1 {
		t.Fatalf("expire the disposable share link: %v", err)
	}
}
