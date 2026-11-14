package document

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestDurableCommandsWithPostgres(t *testing.T) {
	ctx := documentTestDatabase(t)
	owner := testDocumentUser(t, ctx, "commands-owner@example.invalid")
	editor := testDocumentUser(t, ctx, "commands-editor@example.invalid")
	room, err := model.CreateRoom(ctx, "Durable commands fixture", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := model.InviteRoomMemberByEmail(ctx, room.ID, owner.ID, editor.Email, model.RoomPermissionEdit); err != nil {
		t.Fatal(err)
	}
	snapshot, err := Open(ctx, room.ID, owner.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	ownerClient, editorClient := uuid.NewString(), uuid.NewString()
	makeCommand := func(base int64, clientID string, operations ...Operation) Command {
		return Command{
			ProtocolVersion: ProtocolVersion, Epoch: snapshot.Epoch, BaseSeq: base,
			ClientID: clientID, CommandID: uuid.NewString(), Operations: operations,
		}
	}
	initial := makeCommand(0, ownerClient,
		Operation{Kind: "add", Collection: "pages", ID: "next", Value: json.RawMessage(`{"id":"next","name":"Next"}`)},
		Operation{Kind: "add", Collection: "elements", ID: "note", Value: json.RawMessage(`{"id":"note","type":"sticky","pageId":"next","text":"before","x":0,"y":0}`)},
	)
	ack := mustCommit(t, ctx, room.ID, owner.ID, initial)
	if ack.Replayed || ack.Seq != 1 || ack.Change == nil || len(ack.Change.Operations) != 2 ||
		ack.Change.Operations[0].Position == nil || *ack.Change.Operations[0].Position != 1 {
		t.Fatalf("unexpected initial receipt: %+v", ack)
	}
	initial.Operations[1].Value = json.RawMessage(`{"y":0e2,"x":0.0,"text":"before","pageId":"next","type":"sticky","id":"note"}`)
	replayed := mustCommit(t, ctx, room.ID, owner.ID, initial)
	if !replayed.Replayed || replayed.Seq != ack.Seq {
		t.Fatalf("retry did not replay the first acknowledgement: %+v", replayed)
	}
	if _, err := Commit(ctx, room.ID, editor.ID, initial); !hasFaultCode(err, "IDEMPOTENCY_CONFLICT") {
		t.Fatalf("receipt replay by another actor: %v", err)
	}
	initial.Operations[1].Value = json.RawMessage(`{"id":"note","type":"sticky","text":"different request"}`)
	if _, err := Commit(ctx, room.ID, owner.ID, initial); !hasFaultCode(err, "IDEMPOTENCY_CONFLICT") {
		t.Fatalf("command ID with changed payload: %v", err)
	}

	textEdit := makeCommand(1, ownerClient, Operation{
		Kind: "patch", Collection: "elements", ID: "note",
		Fields:   map[string]json.RawMessage{"text": jsonString("after")},
		Expected: map[string]json.RawMessage{"text": jsonString("before")},
	})
	move := makeCommand(1, editorClient, Operation{
		Kind: "patch", Collection: "elements", ID: "note",
		Fields: map[string]json.RawMessage{"x": json.RawMessage("80"), "y": json.RawMessage("96")},
	})
	results := make(chan error, 2)
	go func() {
		_, err := Commit(ctx, room.ID, owner.ID, textEdit)
		results <- err
	}()
	go func() {
		_, err := Commit(ctx, room.ID, editor.ID, move)
		results <- err
	}()
	for i := 0; i < 2; i++ {
		if err := <-results; err != nil {
			t.Fatalf("independent concurrent edit: %v", err)
		}
	}
	after, err := Open(ctx, room.ID, owner.ID, false)
	if err != nil || after.Seq != 3 || len(after.Document.Elements) != 1 {
		t.Fatalf("snapshot after concurrent edit: %+v, %v", after, err)
	}
	assertRecordField(t, after.Document.Elements[0], "text", `"after"`)
	assertRecordField(t, after.Document.Elements[0], "x", `80`)
	assertRecordField(t, after.Document.Elements[0], "y", `96`)

	staleText := makeCommand(1, editorClient, textEdit.Operations[0])
	if _, err := Commit(ctx, room.ID, editor.ID, staleText); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("overlapping text edit: %v", err)
	}
	staleBatch := makeCommand(1, editorClient, move.Operations[0], Operation{
		Kind: "patch", Collection: "elements", ID: "note",
		Fields: map[string]json.RawMessage{"text": jsonString("without precondition")},
	})
	if _, err := Commit(ctx, room.ID, editor.ID, staleBatch); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("earlier geometry operation bypassed the text precondition: %v", err)
	}
	badBatch := makeCommand(3, ownerClient,
		Operation{Kind: "rename", Value: jsonString("must not persist")},
		Operation{Kind: "delete", Collection: "pages", ID: "next"},
	)
	if _, err := Commit(ctx, room.ID, owner.ID, badBatch); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("nonempty page deletion: %v", err)
	}
	unchanged, err := Open(ctx, room.ID, owner.ID, false)
	if err != nil || unchanged.Seq != after.Seq || unchanged.Hash != after.Hash {
		t.Fatalf("rejected batch changed document: %+v, %v", unchanged, err)
	}
	page, err := Changes(ctx, room.ID, owner.ID, snapshot.Epoch, 0, 2)
	if err != nil || len(page.Changes) != 2 || page.Changes[0].Seq != 1 || page.Changes[1].Seq != 2 || !page.HasMore || page.HeadSeq != 3 {
		t.Fatalf("bounded change page: %+v, %v", page, err)
	}
	page, err = Changes(ctx, room.ID, editor.ID, snapshot.Epoch, 2, 100)
	if err != nil || len(page.Changes) != 1 || page.Changes[0].Seq != 3 || page.HasMore || page.Permission != "edit" {
		t.Fatalf("change page continuation: %+v, %v", page, err)
	}

	var expectObject map[string]json.RawMessage
	if err := json.Unmarshal(after.Document.Elements[0], &expectObject); err != nil {
		t.Fatal(err)
	}
	deletion := makeCommand(3, ownerClient, Operation{
		Kind: "delete", Collection: "elements", ID: "note", Expected: expectObject,
	})
	mustCommit(t, ctx, room.ID, owner.ID, deletion)
	restore := Operation{Kind: "restore", Collection: "elements", ID: "note", Value: after.Document.Elements[0]}
	if _, err := Commit(ctx, room.ID, editor.ID, makeCommand(4, editorClient, restore)); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("restore by another editor: %v", err)
	}
	mustCommit(t, ctx, room.ID, owner.ID, makeCommand(4, ownerClient, restore))
	renamed, err := RenameOwned(ctx, room.ID, owner.ID, "Durable title")
	if err != nil || renamed.Seq != 6 {
		t.Fatalf("workbench rename receipt: %+v, %v", renamed, err)
	}
	if _, err := RenameOwned(ctx, room.ID, editor.ID, "Denied"); !errors.Is(err, model.ErrNotRoomOwner) {
		t.Fatalf("workbench rename by nonowner: %v", err)
	}
	if _, err := Rollback(ctx, room.ID, snapshot.Epoch, renamed.Seq); err != nil {
		t.Fatal(err)
	}
	active, err := Activate(ctx, room.ID)
	if err != nil || active.Epoch != snapshot.Epoch+1 || active.Seq != 6 || active.FloorSeq != 6 {
		t.Fatalf("re-activated document head: %+v, %v", active, err)
	}
	if _, err := Commit(ctx, room.ID, owner.ID, deletion); !hasFaultCode(err, "STALE_EPOCH") {
		t.Fatalf("command from rolled-back epoch: %v", err)
	}
}

func testDocumentUser(t *testing.T, ctx context.Context, email string) *model.User {
	t.Helper()
	user, err := model.CreateUser(ctx, email, "fixture-only", "Fixture user")
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func mustCommit(t *testing.T, ctx context.Context, boardID string, actor uuid.UUID, command Command) Ack {
	t.Helper()
	ack, err := Commit(ctx, boardID, actor, command)
	if err != nil {
		t.Fatalf("commit %+v: %v", command, err)
	}
	return ack
}

func hasFaultCode(err error, code string) bool {
	var fault *CommandFault
	return errors.As(err, &fault) && fault.Code == code
}
