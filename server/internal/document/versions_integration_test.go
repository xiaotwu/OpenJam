package document

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestBoardVersionRestoreWithPostgres(t *testing.T) {
	ctx := documentTestDatabase(t)
	owner := testDocumentUser(t, ctx, "versions-owner@example.invalid")
	editor := testDocumentUser(t, ctx, "versions-editor@example.invalid")
	viewer := testDocumentUser(t, ctx, "versions-viewer@example.invalid")
	room, err := model.CreateRoom(ctx, "Versions fixture", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range []struct {
		user       *model.User
		permission model.RoomPermission
	}{{editor, model.RoomPermissionEdit}, {viewer, model.RoomPermissionView}} {
		if _, err := model.InviteRoomMemberByEmail(ctx, room.ID, owner.ID, member.user.Email, member.permission); err != nil {
			t.Fatal(err)
		}
	}
	snapshot := func() Snapshot {
		t.Helper()
		value, err := Open(ctx, room.ID, editor.ID, true)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	start := snapshot()
	clientID := uuid.NewString()
	command := func(seq int64, operations ...Operation) Command {
		return Command{ProtocolVersion: ProtocolVersion, Epoch: start.Epoch, BaseSeq: seq, ClientID: clientID,
			CommandID: uuid.NewString(), Operations: operations}
	}
	first := mustCommit(t, ctx, room.ID, editor.ID, command(0,
		Operation{Kind: "add", Collection: "elements", ID: "note",
			Value: json.RawMessage(`{"id":"note","type":"sticky","text":"saved","x":15,"y":35}`)},
	))
	saved := snapshot()
	named, err := NameVersion(ctx, room.ID, editor.ID, "Ready for review", VersionPosition{saved.Epoch, saved.Seq})
	if err != nil || named.Hash != saved.Hash || named.Author != editor.DisplayName || named.Kind != versionNamed {
		t.Fatalf("named version: %+v, %v", named, err)
	}
	if _, err := ListVersions(ctx, room.ID, viewer.ID, nil, 20); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("viewer read version history: %v", err)
	}
	preview, err := PreviewVersion(ctx, room.ID, editor.ID, named.ID)
	if err != nil || preview.Version.ID != named.ID || len(preview.Document.Elements) != 1 {
		t.Fatalf("preview: %+v, %v", preview, err)
	}
	assertRecordField(t, preview.Document.Elements[0], "text", `"saved"`)
	list, err := ListVersions(ctx, room.ID, owner.ID, nil, 1)
	if err != nil || len(list.Versions) != 1 || list.Versions[0].ID != named.ID || list.NextCursor == nil {
		t.Fatalf("first history page: %+v, %v", list, err)
	}
	next, err := ListVersions(ctx, room.ID, owner.ID, list.NextCursor, 1)
	if err != nil || len(next.Versions) != 1 || next.Versions[0].Kind != versionCheckpoint {
		t.Fatalf("second history page: %+v, %v", next, err)
	}
	edit := command(first.Seq, Operation{Kind: "patch", Collection: "elements", ID: "note",
		Fields: map[string]json.RawMessage{"text": jsonString("newer edit")}})
	mustCommit(t, ctx, room.ID, editor.ID, edit)
	latest := snapshot()
	position := VersionPosition{latest.Epoch, latest.Seq}
	requestID := uuid.New()
	if _, err := RestoreVersion(ctx, room.ID, editor.ID, named.ID, requestID, position); !errors.Is(err, model.ErrNotRoomOwner) {
		t.Fatalf("editor restored a version: %v", err)
	}
	if _, err := RestoreVersion(ctx, room.ID, owner.ID, named.ID, requestID, VersionPosition{saved.Epoch, saved.Seq}); !hasFaultCode(err, "STALE_VERSION_HEAD") {
		t.Fatalf("restore accepted old head: %v", err)
	}

	type outcome struct {
		result VersionRestore
		err    error
	}
	receipts := make(chan outcome, 2)
	for i := 0; i < 2; i++ {
		go func() {
			result, err := RestoreVersion(ctx, room.ID, owner.ID, named.ID, requestID, position)
			receipts <- outcome{result, err}
		}()
	}
	a, b := <-receipts, <-receipts
	if a.err != nil || b.err != nil || a.result.Replayed == b.result.Replayed ||
		a.result.BeforeVersionID != b.result.BeforeVersionID || a.result.VersionID != b.result.VersionID ||
		a.result.Epoch != latest.Epoch+1 || a.result.Seq != latest.Seq+1 || a.result.Hash != saved.Hash {
		t.Fatalf("restore requests diverged: %+v, %+v", a, b)
	}
	if got := snapshot(); got.Hash != saved.Hash || got.Seq != a.result.Seq || got.Permission != "edit" {
		t.Fatalf("restored document or membership changed: %+v", got)
	}
	before, err := PreviewVersion(ctx, room.ID, owner.ID, a.result.BeforeVersionID)
	if err != nil || before.Version.Kind != versionBeforeRestore || before.Version.Hash != latest.Hash {
		t.Fatalf("recovery checkpoint: %+v, %v", before, err)
	}
	if _, err := Changes(ctx, room.ID, editor.ID, start.Epoch, first.Seq, 20); !hasFaultCode(err, "RESYNC_REQUIRED") {
		t.Fatalf("old changes cursor was accepted: %v", err)
	}
	if _, err := Commit(ctx, room.ID, editor.ID, edit); !hasFaultCode(err, "STALE_EPOCH") {
		t.Fatalf("old edit replay was accepted: %v", err)
	}
	if report, err := Inspect(ctx, room.ID); err != nil || report.LegacyArchiveEpoch != start.Epoch || report.Epoch != a.result.Epoch {
		t.Fatalf("legacy archive inspection after restore: %+v, %v", report, err)
	}
	if _, err := RestoreVersion(ctx, room.ID, owner.ID, named.ID, requestID, VersionPosition{a.result.Epoch, a.result.Seq}); !hasFaultCode(err, "IDEMPOTENCY_CONFLICT") {
		t.Fatalf("restore request ID was reused with another position: %v", err)
	}

	recovered, err := RestoreVersion(ctx, room.ID, owner.ID, before.Version.ID, uuid.New(), VersionPosition{a.result.Epoch, a.result.Seq})
	if err != nil || recovered.Hash != latest.Hash || recovered.Epoch != a.result.Epoch+1 {
		t.Fatalf("restoring recovery checkpoint: %+v, %v", recovered, err)
	}
	copied, err := CopyVersion(ctx, room.ID, editor.ID, named.ID, "Version copy")
	if err != nil || copied.BoardID == room.ID {
		t.Fatalf("version copy: %+v, %v", copied, err)
	}
	copySnapshot, err := Open(ctx, copied.BoardID, editor.ID, false)
	if err != nil || copySnapshot.Permission != "owner" || copySnapshot.Document.Name != "Version copy" || len(copySnapshot.Document.Elements) != 1 {
		t.Fatalf("open copy: %+v, %v", copySnapshot, err)
	}
	assertRecordField(t, copySnapshot.Document.Elements[0], "text", `"saved"`)
	if _, err := Open(ctx, copied.BoardID, owner.ID, false); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("copy inherited board sharing: %v", err)
	}
}

func TestAutomaticBoardVersionWithPostgres(t *testing.T) {
	ctx := documentTestDatabase(t)
	owner := testDocumentUser(t, ctx, "checkpoint-owner@example.invalid")
	editor := testDocumentUser(t, ctx, "checkpoint-editor@example.invalid")
	room, err := model.CreateRoom(ctx, "Checkpoint fixture", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := model.InviteRoomMemberByEmail(ctx, room.ID, owner.ID, editor.Email, model.RoomPermissionEdit); err != nil {
		t.Fatal(err)
	}
	start, err := Open(ctx, room.ID, owner.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	ownerClient, editorClient := uuid.NewString(), uuid.NewString()
	for i := 1; i <= checkpointInterval; i++ {
		actor, client := owner.ID, ownerClient
		if i%2 == 0 {
			actor, client = editor.ID, editorClient
		}
		mustCommit(t, ctx, room.ID, actor, Command{
			ProtocolVersion: ProtocolVersion, Epoch: start.Epoch, BaseSeq: int64(i - 1), ClientID: client, CommandID: uuid.NewString(),
			Operations: []Operation{{Kind: "rename", Value: jsonString(fmt.Sprintf("Revision %d", i))}},
		})
	}
	versions, err := ListVersions(ctx, room.ID, owner.ID, nil, 20)
	if err != nil || len(versions.Versions) != 2 {
		t.Fatalf("automatic checkpoint history: %+v, %v", versions, err)
	}
	checkpoint := versions.Versions[0]
	if checkpoint.Seq != checkpointInterval || checkpoint.Kind != versionCheckpoint || len(checkpoint.Participants) != 2 {
		t.Fatalf("automatic checkpoint: %+v", checkpoint)
	}
	if _, err := PreviewVersion(ctx, room.ID, owner.ID, checkpoint.ID); err != nil {
		t.Fatalf("automatic checkpoint integrity: %v", err)
	}
}
