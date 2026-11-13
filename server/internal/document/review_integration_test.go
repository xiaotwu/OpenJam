package document

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestBoardReviewWithPostgres(t *testing.T) {
	ctx := documentTestDatabase(t)
	owner := testDocumentUser(t, ctx, "review-owner@example.invalid")
	reviewer := testDocumentUser(t, ctx, "review-author@example.invalid")
	viewer := testDocumentUser(t, ctx, "review-reader@example.invalid")
	room, err := model.CreateRoom(ctx, "Review fixture", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range []struct {
		user *model.User
		role model.RoomPermission
	}{{reviewer, model.RoomPermissionComment}, {viewer, model.RoomPermissionView}} {
		if _, err := model.InviteRoomMemberByEmail(ctx, room.ID, owner.ID, member.user.Email, member.role); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := Open(ctx, room.ID, owner.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	clientID := uuid.NewString()
	command := func(baseSeq int64, operations ...Operation) {
		t.Helper()
		mustCommit(t, ctx, room.ID, owner.ID, Command{ProtocolVersion: ProtocolVersion, Epoch: snapshot.Epoch,
			BaseSeq: baseSeq, ClientID: clientID, CommandID: uuid.NewString(), Operations: operations})
	}
	command(0,
		Operation{Kind: "add", Collection: "pages", ID: "review", Value: json.RawMessage(`{"id":"review","name":"Review"}`)},
		Operation{Kind: "add", Collection: "elements", ID: "note", Value: json.RawMessage(`{"id":"note","type":"sticky","pageId":"review","text":"Design","x":35,"y":70}`)},
	)
	threadID := uuid.New()
	input := CreateReviewThread{
		CreateReviewComment: CreateReviewComment{RequestID: threadID, ReviewDraft: ReviewDraft{
			Body: "Check this design", MentionUserIDs: []uuid.UUID{viewer.ID},
		}},
		Anchor: ReviewAnchor{PageID: "review", ElementID: "note"},
	}
	viewerInput := input
	viewerInput.MentionUserIDs = []uuid.UUID{owner.ID}
	if _, err := AddReviewThread(ctx, room.ID, viewer.ID, viewerInput); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("viewer create: %v", err)
	}
	thread, err := AddReviewThread(ctx, room.ID, reviewer.ID, input)
	if err != nil || thread.ID != threadID || thread.Anchor.Status != "live" {
		t.Fatalf("create review: %+v, %v", thread, err)
	}
	if replay, err := AddReviewThread(ctx, room.ID, reviewer.ID, input); err != nil || replay.ID != threadID || replay.CommentCount != 1 {
		t.Fatalf("replay review: %+v, %v", replay, err)
	}
	people, err := ListReviewPeople(ctx, room.ID, reviewer.ID)
	if err != nil || len(people) != 2 {
		t.Fatalf("people: %+v, %v", people, err)
	}
	list, err := ListReviewThreads(ctx, room.ID, viewer.ID, "mentioned", nil, 1)
	if err != nil || len(list.Threads) != 1 || list.UnreadCount != 1 || list.CanComment {
		t.Fatalf("viewer mentioned: %+v, %v", list, err)
	}
	notifications, err := ListReviewNotifications(ctx, room.ID, viewer.ID, 10)
	if err != nil || len(notifications) != 1 || notifications[0].ThreadID != threadID {
		t.Fatalf("notifications: %+v, %v", notifications, err)
	}
	if err := MarkReviewNotificationRead(ctx, room.ID, viewer.ID, threadID); err != nil {
		t.Fatal(err)
	}
	list, err = ListReviewThreads(ctx, room.ID, viewer.ID, "all", nil, 1)
	if err != nil || list.UnreadCount != 0 {
		t.Fatalf("read notification: %+v, %v", list, err)
	}
	replyInput := CreateReviewComment{RequestID: uuid.New(), ReviewDraft: ReviewDraft{Body: "Reply"}}
	reply, err := AddReviewReply(ctx, room.ID, owner.ID, threadID, replyInput)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AddReviewReply(ctx, room.ID, owner.ID, threadID, replyInput); err != nil {
		t.Fatal(err)
	}
	edit := EditReviewComment{ExpectedUpdatedAt: reply.UpdatedAt, ReviewDraft: ReviewDraft{Body: "Updated reply"}}
	if _, err := ChangeReviewComment(ctx, room.ID, reviewer.ID, threadID, reply.ID, edit); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("non-author edit: %v", err)
	}
	if changed, err := ChangeReviewComment(ctx, room.ID, owner.ID, threadID, reply.ID, edit); err != nil || changed.Body != edit.Body {
		t.Fatalf("author edit: %+v, %v", changed, err)
	}
	if _, err := ChangeReviewComment(ctx, room.ID, owner.ID, threadID, reply.ID, edit); !hasFaultCode(err, "REVIEW_COMMENT_CHANGED") {
		t.Fatalf("stale edit: %v", err)
	}
	if resolved, err := SetReviewResolved(ctx, room.ID, reviewer.ID, threadID, true); err != nil || resolved.ResolvedAt == nil {
		t.Fatalf("resolve: %+v, %v", resolved, err)
	}
	if _, err := AddReviewReply(ctx, room.ID, owner.ID, threadID, CreateReviewComment{
		RequestID: uuid.New(), ReviewDraft: ReviewDraft{Body: "Reply to closed thread"},
	}); !hasFaultCode(err, "REVIEW_THREAD_RESOLVED") {
		t.Fatalf("reply to resolved: %v", err)
	}
	if reopened, err := SetReviewResolved(ctx, room.ID, owner.ID, threadID, false); err != nil || reopened.ResolvedAt != nil {
		t.Fatalf("reopen: %+v, %v", reopened, err)
	}
	command(1, Operation{Kind: "patch", Collection: "elements", ID: "note",
		Fields: map[string]json.RawMessage{"pageId": jsonString(snapshot.Document.DefaultPageID)}})
	detail, err := GetReviewThread(ctx, room.ID, viewer.ID, threadID, nil, 1)
	if err != nil || detail.NextCursor == nil || detail.Thread.CommentCount != 2 || detail.Thread.Anchor.Status != "moved" {
		t.Fatalf("moved anchor with pagination: %+v, %v", detail, err)
	}
	detail, err = GetReviewThread(ctx, room.ID, viewer.ID, threadID, detail.NextCursor, 1)
	if err != nil || len(detail.Comments) != 1 || detail.Comments[0].Body != edit.Body || detail.NextCursor != nil {
		t.Fatalf("reply page: %+v, %v", detail, err)
	}
	command(2, Operation{Kind: "delete", Collection: "elements", ID: "note"})
	detail, err = GetReviewThread(ctx, room.ID, viewer.ID, threadID, nil, 30)
	if err != nil || detail.Thread.Anchor.Status != "missing-object" || detail.Thread.Anchor.X == nil || *detail.Thread.Anchor.X != 35 || len(detail.Comments) != 2 {
		t.Fatalf("deleted anchor preserves thread: %+v, %v", detail, err)
	}
	if err := model.RemoveRoomMember(ctx, room.ID, owner.ID, viewer.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := ListReviewNotifications(ctx, room.ID, viewer.ID, 10); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("revoked reader notifications: %v", err)
	}
	x, y := 24.25, -50.5
	point, err := AddReviewThread(ctx, room.ID, reviewer.ID, CreateReviewThread{
		CreateReviewComment: CreateReviewComment{RequestID: uuid.New(), ReviewDraft: ReviewDraft{Body: "Check this point"}},
		Anchor:              ReviewAnchor{PageID: "review", X: &x, Y: &y},
	})
	if err != nil || point.Anchor.Status != "live" || point.Anchor.X == nil || *point.Anchor.X != x || point.Anchor.ElementID != "" {
		t.Fatalf("point anchor: %+v, %v", point, err)
	}
	list, err = ListReviewThreads(ctx, room.ID, reviewer.ID, "open", nil, 1)
	if err != nil || len(list.Threads) != 1 || list.Threads[0].ID != point.ID || list.NextCursor == nil {
		t.Fatalf("review list first page: %+v, %v", list, err)
	}
	list, err = ListReviewThreads(ctx, room.ID, reviewer.ID, "open", list.NextCursor, 1)
	if err != nil || len(list.Threads) != 1 || list.Threads[0].ID != threadID || list.NextCursor != nil {
		t.Fatalf("review list second page: %+v, %v", list, err)
	}
}
