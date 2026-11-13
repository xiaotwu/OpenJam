package document

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestEditorBatchesWithPostgres(t *testing.T) {
	ctx := documentTestDatabase(t)
	owner := testDocumentUser(t, ctx, "editor-batches-owner@example.invalid")
	peer := testDocumentUser(t, ctx, "editor-batches-peer@example.invalid")
	room, err := model.CreateRoom(ctx, "Batch fixture", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := model.InviteRoomMemberByEmail(ctx, room.ID, owner.ID, peer.Email, model.RoomPermissionEdit); err != nil {
		t.Fatal(err)
	}
	snapshot := func() Snapshot {
		s, err := Open(ctx, room.ID, owner.ID, true)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	initial := snapshot()
	ownerClient, peerClient := uuid.NewString(), uuid.NewString()
	command := func(client string, base int64, operations ...Operation) Command {
		return Command{ProtocolVersion: ProtocolVersion, Epoch: initial.Epoch, BaseSeq: base, ClientID: client, CommandID: uuid.NewString(), Operations: operations}
	}
	add := func(collection, id, raw string) Operation {
		return Operation{Kind: "add", Collection: collection, ID: id, Value: json.RawMessage(raw)}
	}
	move := func(id string) Operation {
		return Operation{Kind: "patch", Collection: "elements", ID: id, Fields: map[string]json.RawMessage{"pageId": jsonString("next")},
			Expected: map[string]json.RawMessage{"pageId": jsonString("page-1")}}
	}
	first := mustCommit(t, ctx, room.ID, owner.ID, command(ownerClient, 0,
		add("pages", "next", `{"id":"next","name":"Next"}`),
		add("pages", "review", `{"id":"review","name":"Review"}`),
		add("elements", "frame", `{"id":"frame","type":"frame","name":"Section","childIds":["note","second"]}`),
		add("elements", "wire", `{"id":"wire","type":"connector","startElementId":"note","endElementId":"second"}`),
		add("elements", "note", `{"id":"note","type":"sticky","text":"original","groupId":"group","x":1,"y":2}`),
		add("elements", "second", `{"id":"second","type":"shape","groupId":"group","x":5,"y":8}`),
		add("stamps", "stamp", `{"id":"stamp","pageId":"review","emoji":"★","x":12,"y":24}`),
	))
	before := snapshot()
	if first.Seq != 1 || before.Seq != 1 || len(before.Document.Elements) != 4 {
		t.Fatalf("initial batch = %+v", before)
	}
	if _, err := Commit(ctx, room.ID, owner.ID, command(ownerClient, first.Seq, move("note"))); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("moving one linked element was accepted: %v", err)
	}
	if after := snapshot(); after.Hash != before.Hash || after.Seq != before.Seq {
		t.Fatalf("failed move changed the board: %+v", after)
	}
	moved := mustCommit(t, ctx, room.ID, owner.ID, command(ownerClient, first.Seq, move("note"), move("wire"), move("frame"), move("second")))
	if moved.Seq != 2 || len(moved.Change.Operations) != 4 {
		t.Fatalf("group move was not one transaction: %+v", moved)
	}
	for _, record := range snapshot().Document.Elements {
		assertRecordField(t, record, "pageId", `"next"`)
	}
	position := int64(0)
	reorder := Operation{Kind: "reorder", Collection: "pages", ID: "review", Position: &position,
		Expected: map[string]json.RawMessage{"order": json.RawMessage(`["page-1","next","review"]`)}}
	setDefault := Operation{Kind: "setDefaultPage", Value: jsonString("review"), Expected: map[string]json.RawMessage{"defaultPageId": jsonString("page-1")}}
	ordered := mustCommit(t, ctx, room.ID, owner.ID, command(ownerClient, moved.Seq, reorder, setDefault))
	if ordered.Change.DefaultPageID != "review" || len(ordered.Change.Operations) != 1 || *ordered.Change.Operations[0].Position != 0 {
		t.Fatalf("reorder delta = %+v", ordered)
	}
	if _, err := Commit(ctx, room.ID, peer.ID, command(peerClient, moved.Seq, reorder)); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("stale page order accepted: %v", err)
	}
	state := snapshot()
	assertRecordField(t, state.Document.Pages[0], "id", `"review"`)
	deleted := mustCommit(t, ctx, room.ID, owner.ID, command(ownerClient, ordered.Seq,
		Operation{Kind: "delete", Collection: "stamps", ID: "stamp"}, Operation{Kind: "delete", Collection: "pages", ID: "review"}))
	if deleted.Change.DefaultPageID != "page-1" {
		t.Fatalf("default page was not updated: %+v", deleted)
	}
	undo := command(ownerClient, deleted.Seq,
		Operation{Kind: "restore", Collection: "pages", ID: "review", Value: state.Document.Pages[0], Position: &position},
		Operation{Kind: "restore", Collection: "stamps", ID: "stamp", Value: state.Document.Stamps[0]}, setDefault)
	undo.DependsOn = uuid.NewString()
	if _, err := Commit(ctx, room.ID, owner.ID, undo); !hasFaultCode(err, "HISTORY_DEPENDENCY") {
		t.Fatalf("undo without a matching receipt accepted: %v", err)
	}
	undo.DependsOn = deleted.CommandID
	wrongClient := undo
	wrongClient.ClientID = peerClient
	if _, err := Commit(ctx, room.ID, owner.ID, wrongClient); !hasFaultCode(err, "HISTORY_DEPENDENCY") {
		t.Fatalf("undo using another editor session accepted: %v", err)
	}
	restored := mustCommit(t, ctx, room.ID, owner.ID, undo)
	if final := snapshot(); restored.Seq != deleted.Seq+1 || final.Hash != state.Hash || final.Document.DefaultPageID != "review" {
		t.Fatalf("restore changed the original contents: %+v", final)
	}
}

func TestWidgetBallotsWithPostgres(t *testing.T) {
	ctx := documentTestDatabase(t)
	owner := testDocumentUser(t, ctx, "votes-owner@example.invalid")
	peer := testDocumentUser(t, ctx, "votes-peer@example.invalid")
	room, err := model.CreateRoom(ctx, "Vote fixture", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := model.InviteRoomMemberByEmail(ctx, room.ID, owner.ID, peer.Email, model.RoomPermissionEdit); err != nil {
		t.Fatal(err)
	}
	first, err := Open(ctx, room.ID, owner.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	command := func(base int64, operations ...Operation) Command {
		return Command{ProtocolVersion: ProtocolVersion, Epoch: first.Epoch, BaseSeq: base, ClientID: uuid.NewString(), CommandID: uuid.NewString(), Operations: operations}
	}
	add := func(id, raw string) Operation {
		return Operation{Kind: "add", Collection: "elements", ID: id, Value: json.RawMessage(raw)}
	}
	vote := func(id, raw string) Operation {
		return Operation{Kind: "vote", Collection: "elements", ID: id, Value: json.RawMessage(raw)}
	}
	added := mustCommit(t, ctx, room.ID, owner.ID, command(0,
		add("poll", `{"id":"poll","type":"widget","widgetType":"poll","widgetData":{"options":[{"id":"yes","text":"Yes","votes":5,"voters":["forged"]}]}}`),
		add("dots", `{"id":"dots","type":"widget","widgetType":"dot-voting","widgetData":{"maxVotesPerUser":1,"votes":[{"id":"spoof","userId":"fake"}]}}`),
	))
	var ballots map[string]json.RawMessage
	if err := json.Unmarshal(added.Change.Operations[0].Value, &ballots); err != nil {
		t.Fatal(err)
	}
	assertRecordField(t, ballots["widgetData"], "options", `[{"id":"yes","text":"Yes","voters":[],"votes":0}]`)
	cast := vote("poll", `{"action":"poll-cast","optionId":"yes"}`)
	results := make(chan error, 2)
	for _, id := range []uuid.UUID{owner.ID, peer.ID} {
		go func() {
			_, err := Commit(ctx, room.ID, id, command(added.Seq, cast))
			results <- err
		}()
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := Commit(ctx, room.ID, owner.ID, command(3, cast)); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("second poll ballot by the same actor accepted: %v", err)
	}
	dot := mustCommit(t, ctx, room.ID, owner.ID, command(3, vote("dots", `{"action":"dot-add","voteId":"owned","x":11,"y":42}`)))
	if _, err := Commit(ctx, room.ID, owner.ID, command(dot.Seq, vote("dots", `{"action":"dot-add","voteId":"extra","x":11,"y":42}`))); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("dot quota bypassed: %v", err)
	}
	if _, err := Commit(ctx, room.ID, peer.ID, command(dot.Seq, vote("dots", `{"action":"dot-remove","voteId":"owned"}`))); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("another editor removed the dot: %v", err)
	}
	if _, err := Commit(ctx, room.ID, peer.ID, command(dot.Seq,
		Operation{Kind: "patch", Collection: "elements", ID: "dots", Fields: map[string]json.RawMessage{"widgetData": json.RawMessage(`{"maxVotesPerUser":1,"votes":[]}`)}})); !hasFaultCode(err, "INVALID_COMMAND") {
		t.Fatalf("ordinary patch altered ballots: %v", err)
	}
	last := mustCommit(t, ctx, room.ID, owner.ID, command(dot.Seq, vote("dots", `{"action":"dot-clear"}`)))
	if last.Seq != 5 {
		t.Fatalf("failed votes changed the sequence: %+v", last)
	}
}
