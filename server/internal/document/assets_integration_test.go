package document

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/assets"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/model"
	"github.com/xiaotwu/shiori/server/internal/storage"
)

func TestDocumentImageReferencesWithPostgres(t *testing.T) {
	ctx := documentTestDatabase(t)
	owner := testDocumentUser(t, ctx, "image-owner@example.invalid")
	viewer := testDocumentUser(t, ctx, "image-viewer@example.invalid")
	room, err := model.CreateRoom(ctx, "Private image fixture", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := model.CreateRoom(ctx, "Other board", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE rooms SET board_data = $2 WHERE id = $1`, room.ID,
		`{"elements":[{"id":"legacy","type":"image","src":"data:image/png;base64,AA=="}]}`); err != nil {
		t.Fatal(err)
	}
	first, err := Open(ctx, room.ID, owner.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	other, err := Open(ctx, foreign.ID, owner.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("a", 64)
	unused := strings.Repeat("b", 64)
	meta := func(id string) assets.Metadata {
		return assets.Metadata{ID: id, Size: 10, MIMEType: "image/png", Width: 1, Height: 1}
	}
	if err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO asset_blobs (id, mime_type, size_bytes, width, height, ready)
			SELECT unnest($1::text[]), 'image/png', 10, 1, 1, TRUE`, []string{digest, unused})
		if err != nil {
			return err
		}
		return assets.Grant(ctx, tx, room.ID, []assets.Metadata{meta(digest), meta(unused)})
	}); err != nil {
		t.Fatal(err)
	}
	addImage := func(snapshot Snapshot, id, field, value string) Command {
		return Command{ProtocolVersion: ProtocolVersion, Epoch: snapshot.Epoch, BaseSeq: snapshot.Seq,
			ClientID: uuid.NewString(), CommandID: uuid.NewString(), Operations: []Operation{
				{Kind: "add", Collection: "elements", ID: id, Value: json.RawMessage(`{"id":"` + id + `","type":"image","` + field + `":"` + value + `"}`)},
			}}
	}
	if _, err := Commit(ctx, foreign.ID, owner.ID, addImage(other, "stolen", "assetId", digest)); !hasFaultCode(err, "CONFLICT") {
		t.Fatalf("foreign board reference accepted: %v", err)
	}
	if _, err := Commit(ctx, room.ID, owner.ID, addImage(first, "external", "src", "https://example.invalid/pixel.png")); !hasFaultCode(err, "INVALID_COMMAND") {
		t.Fatalf("new legacy source accepted: %v", err)
	}
	valid := mustCommit(t, ctx, room.ID, owner.ID, addImage(first, "asset", "assetId", digest))
	assertRecordField(t, valid.Change.Operations[0].Value, "assetId", `"`+digest+`"`)
	current, err := Open(ctx, room.ID, owner.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	legacy := mustCommit(t, ctx, room.ID, owner.ID, addImage(current, "legacy-copy", "src", "data:image/png;base64,AA=="))
	position := VersionPosition{ExpectedEpoch: current.Epoch, ExpectedSeq: legacy.Seq}
	version, err := NameVersion(ctx, room.ID, owner.ID, "With images", position)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CopyCurrent(ctx, room.ID, viewer.ID, "Unauthorized copy"); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("private board copied by outsider: %v", err)
	}
	copyVersion, err := CopyVersion(ctx, room.ID, owner.ID, version.ID, "Version copy")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := model.InviteRoomMemberByEmail(ctx, room.ID, owner.ID, viewer.Email, model.RoomPermissionView); err != nil {
		t.Fatal(err)
	}
	copyCurrent, err := CopyCurrent(ctx, room.ID, viewer.ID, "Private board copy")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{copyVersion.BoardID, copyCurrent.BoardID} {
		var refs []string
		err := db.Pool().QueryRow(ctx, `SELECT array_agg(asset_id ORDER BY asset_id) FROM board_assets WHERE board_id = $1`, id).Scan(&refs)
		if err != nil || len(refs) != 1 || refs[0] != digest {
			t.Fatalf("copied associations = %v, %v", refs, err)
		}
	}
	if _, err := Open(ctx, copyCurrent.BoardID, owner.ID, false); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("copy inherited source board access: %v", err)
	}
}

func TestPrivateImagesWithPostgresAndS3(t *testing.T) {
	endpoint := os.Getenv("OPENJAM_TEST_S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("set OPENJAM_TEST_S3_ENDPOINT to a disposable loopback S3 server")
	}
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		t.Fatal("OPENJAM_TEST_S3_ENDPOINT must be a loopback address with a port")
	}
	ctx := documentTestDatabase(t)
	if err := storage.InitWithBucket(endpoint, os.Getenv("OPENJAM_TEST_S3_ACCESS_KEY"), os.Getenv("OPENJAM_TEST_S3_SECRET_KEY"), false, os.Getenv("OPENJAM_TEST_S3_BUCKET")); err != nil {
		t.Fatal(err)
	}
	owner := testDocumentUser(t, ctx, "private-image-owner@example.invalid")
	viewer := testDocumentUser(t, ctx, "private-image-viewer@example.invalid")
	room, err := model.CreateRoom(ctx, "Scoped assets", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := model.InviteRoomMemberByEmail(ctx, room.ID, owner.ID, viewer.Email, model.RoomPermissionView); err != nil {
		t.Fatal(err)
	}
	fixture := func() ([]byte, assets.Metadata) {
		t.Helper()
		seed := uuid.New()
		pixel := image.NewRGBA(image.Rect(0, 0, len(seed), 1))
		for x, b := range seed {
			pixel.Set(x, 0, color.RGBA{R: b, A: 255})
		}
		var output bytes.Buffer
		if err := png.Encode(&output, pixel); err != nil {
			t.Fatal(err)
		}
		meta, err := assets.Inspect(output.Bytes(), "image/png")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := storage.DeleteFile(cleanupCtx, "assets/v1/"+meta.ID); err != nil {
				t.Errorf("remove owned S3 fixture: %v", err)
			}
		})
		return output.Bytes(), meta
	}
	data, want := fixture()
	if _, err := assets.Upload(ctx, room.ID, viewer.ID, data, "image/png"); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("viewer uploaded an image: %v", err)
	}
	results := make(chan error, 2)
	for range 2 {
		go func() {
			actual, err := assets.Upload(ctx, room.ID, owner.ID, data, "image/png")
			if err == nil && actual != want {
				err = errors.New("concurrent upload returned different metadata")
			}
			results <- err
		}()
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	assertImage := func(actor uuid.UUID, meta assets.Metadata, data []byte) {
		t.Helper()
		actual, reader, err := assets.Get(ctx, room.ID, actor, meta.ID)
		if err != nil {
			t.Fatal(err)
		}
		defer reader.Close()
		if _, err := reader.Seek(4, io.SeekStart); err != nil {
			t.Fatal(err)
		}
		read, err := io.ReadAll(reader)
		if err != nil || !bytes.Equal(data[4:], read) || actual != meta {
			t.Fatalf("read private image range = %d bytes, %+v, %v", len(read), actual, err)
		}
	}
	assertImage(viewer.ID, want, data)
	if err := model.RemoveRoomMember(ctx, room.ID, owner.ID, viewer.ID); err != nil {
		t.Fatal(err)
	}
	if _, reader, err := assets.Get(ctx, room.ID, viewer.ID, want.ID); !errors.Is(err, model.ErrRoomAccessDenied) {
		if reader != nil {
			_ = reader.Close()
		}
		t.Fatalf("revoked viewer downloaded a private image: %v", err)
	}
	stagedData, staged := fixture()
	if err := assets.Stage(ctx, staged, stagedData); err != nil {
		t.Fatal(err)
	}
	if _, _, err := assets.Get(ctx, room.ID, owner.ID, staged.ID); !errors.Is(err, assets.ErrNotFound) {
		t.Fatalf("unlinked object downloaded: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE asset_blobs SET staged_at = NOW() - interval '25 hours'`); err != nil {
		t.Fatal(err)
	}
	if count, err := assets.Sweep(ctx, 5); err != nil || count != 1 {
		t.Fatalf("swept %d objects, err %v", count, err)
	}
	if reader, _, err := storage.OpenFile(ctx, "assets/v1/"+staged.ID); !errors.Is(err, storage.ErrObjectNotFound) {
		if reader != nil {
			_ = reader.Close()
		}
		t.Fatalf("unlinked image object survived its sweep: %v", err)
	}
	assertImage(owner.ID, want, data)
}
