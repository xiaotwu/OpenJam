package document

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/config"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestDocumentMigrationWithPostgres(t *testing.T) {
	ctx := documentTestDatabase(t)
	owner, err := model.CreateUser(ctx, "document-owner@example.invalid", "fixture-only", "Fixture owner")
	if err != nil {
		t.Fatal(err)
	}
	room, err := model.CreateRoomWithID(ctx, "document-migration-fixture", "Persisted title", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	malformed := json.RawMessage(`{"pages":[{"id":"duplicate"},{"id":"duplicate"}]}`)
	if _, err := db.Pool().Exec(ctx, `UPDATE rooms SET board_data = $2 WHERE id = $1`, room.ID, malformed); err != nil {
		t.Fatal(err)
	}
	blocked, err := Inspect(ctx, room.ID)
	if err != nil || blocked.Mode != "unmigrated" || !strings.Contains(blocked.MigrationIssue, "duplicate ID") {
		t.Fatalf("ambiguous migration preflight = %+v, %v", blocked, err)
	}
	if _, err := Activate(ctx, room.ID); !errors.Is(err, ErrMigrationBlocked) {
		t.Fatalf("ambiguous migration = %v", err)
	}
	var rawPreserved bool
	if err := db.Pool().QueryRow(ctx, `
		SELECT board_data = $2::jsonb AND NOT EXISTS (SELECT 1 FROM board_heads WHERE board_id = rooms.id)
		FROM rooms WHERE id = $1
	`, room.ID, malformed).Scan(&rawPreserved); err != nil || !rawPreserved {
		t.Fatalf("ambiguous migration changed its source = %t, %v", rawPreserved, err)
	}
	raw := json.RawMessage(`{"name":"stale","elements":[{"id":"kept","type":"text","text":"saved"}],"extension":{"keep":true}}`)
	if _, err := db.Pool().Exec(ctx, `UPDATE rooms SET board_data = $2 WHERE id = $1`, room.ID, raw); err != nil {
		t.Fatal(err)
	}
	legacyOp := &model.Operation{
		RoomID: room.ID, UserID: owner.ID, OpID: "unproven-tail", OpType: model.OpTypeDelete,
		Payload: map[string]string{"elementId": "kept"},
	}
	if err := model.SaveOperation(ctx, legacyOp); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(ctx, room.ID, uuid.New(), true); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("uninvited Open = %v", err)
	}
	inspection, err := Inspect(ctx, room.ID)
	if err != nil || inspection.Mode != "unmigrated" || inspection.LiveLegacyOps != 1 ||
		inspection.PageCount != 1 || inspection.ElementCount != 1 || inspection.MigrationIssue != "" {
		t.Fatalf("pre-migration inspection = %+v, %v", inspection, err)
	}

	snapshot, err := Open(ctx, room.ID, owner.ID, true)
	if err != nil || snapshot.Epoch != 1 || snapshot.Seq != 0 || len(snapshot.Document.Elements) != 1 ||
		snapshot.Document.Name != room.Name || snapshot.Permission != "owner" || len(snapshot.Hash) != 64 {
		t.Fatalf("activation = %+v, %v", snapshot, err)
	}
	if err := model.SaveOperation(ctx, legacyOp); !LegacyWriteFenced(err) {
		t.Fatalf("legacy write after activation = %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE rooms SET board_data = board_data WHERE id = $1`, room.ID); !LegacyWriteFenced(err) {
		t.Fatalf("legacy snapshot write after activation = %v", err)
	}
	if _, err := model.UpdateRoom(ctx, room.ID, "legacy title", owner.ID); !LegacyWriteFenced(err) {
		t.Fatalf("legacy title write after activation = %v", err)
	}
	var archive bytes.Buffer
	if err := WriteLegacyArchive(ctx, room.ID, 1, &archive); err != nil {
		t.Fatal(err)
	}
	var exported struct {
		OperationCount int               `json:"operationCount"`
		Operations     []json.RawMessage `json:"operations"`
		BoardData      json.RawMessage   `json:"boardData"`
	}
	if err := json.Unmarshal(archive.Bytes(), &exported); err != nil || exported.OperationCount != 1 || len(exported.Operations) != 1 {
		t.Fatalf("archive = %q, %v", archive.Bytes(), err)
	}
	assertRecordField(t, exported.Operations[0], "op_id", `"unproven-tail"`)
	assertRecordField(t, exported.BoardData, "name", `"stale"`)

	if _, err := Rollback(ctx, room.ID, snapshot.Epoch, snapshot.Seq+1); !errors.Is(err, ErrStaleRollback) {
		t.Fatalf("stale rollback = %v", err)
	}
	report, err := Rollback(ctx, room.ID, snapshot.Epoch, snapshot.Seq)
	if err != nil || report.Mode != modeLegacy || report.Hash != snapshot.Hash {
		t.Fatalf("rollback = %+v, %v", report, err)
	}
	if _, err := Open(ctx, room.ID, owner.ID, true); !errors.Is(err, ErrLegacyMode) {
		t.Fatalf("rolled-back board auto-reactivated: %v", err)
	}
	legacy, err := model.LoadBoardData(ctx, room.ID)
	if err != nil || legacy.Name != room.Name || legacy.CurrentPageId != "page-1" {
		t.Fatalf("legacy readback = %+v, %v", legacy, err)
	}
	if operations, err := model.GetOperationsByRoom(ctx, room.ID); err != nil || len(operations) != 0 {
		t.Fatalf("legacy operation replay after rollback = %+v, %v", operations, err)
	}
	report, err = Activate(ctx, room.ID)
	if err != nil || report.Epoch != 2 || report.Seq != snapshot.Seq || report.Hash != snapshot.Hash {
		t.Fatalf("reactivation = %+v, %v", report, err)
	}
}

func documentTestDatabase(t *testing.T) context.Context {
	t.Helper()
	dsn := config.Env("SHIORI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SHIORI_TEST_DATABASE_URL to run the PostgreSQL integration test")
	}
	isolated, err := url.Parse(dsn)
	if err != nil || (isolated.Scheme != "postgres" && isolated.Scheme != "postgresql") {
		t.Fatal("SHIORI_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "shiori_document_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	schemaSQL := pgx.Identifier{schema}.Sanitize()
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, dropErr := admin.Exec(cleanupCtx, "DROP SCHEMA IF EXISTS "+schemaSQL+" CASCADE")
		if dropErr != nil {
			t.Errorf("drop owned test schema: %v", dropErr)
		}
		_ = admin.Close(cleanupCtx)
	})
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schemaSQL); err != nil {
		t.Fatal(err)
	}
	params := isolated.Query()
	params.Set("search_path", schema)
	isolated.RawQuery = params.Encode()
	if err := db.InitContext(ctx, isolated.String()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	var actual string
	if err := db.Pool().QueryRow(ctx, "SHOW search_path").Scan(&actual); err != nil || actual != schema {
		t.Fatalf("test database search_path = %q, %v", actual, err)
	}
	if err := db.MigrateContext(ctx); err != nil {
		t.Fatal(err)
	}
	return ctx
}
