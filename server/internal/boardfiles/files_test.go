package boardfiles

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"net"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/assets"
	"github.com/xiaotwu/shiori/server/internal/config"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/jobs"
	"github.com/xiaotwu/shiori/server/internal/model"
	"github.com/xiaotwu/shiori/server/internal/storage"
)

func TestPortablePackageRejectsUnsafeOrTamperedEntries(t *testing.T) {
	data := testImage(t)
	meta, err := assets.Inspect(data, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	content := document.Document{
		Name: "Round trip", DefaultPageID: "page-1",
		Pages: []json.RawMessage{json.RawMessage(`{"id":"page-1","name":"Page 1"}`)},
		Elements: []json.RawMessage{
			json.RawMessage(fmt.Sprintf(`{"type":"image","pageId":"page-1","id":"picture","assetId":"%s"}`, meta.ID)),
		},
	}
	bundle := boardPackage{
		Format: ArchiveFormat, Version: ArchiveVersion, Document: content,
		Assets: []packageAsset{{Metadata: meta, Data: data}},
	}
	for _, tc := range []struct{ format, media string }{
		{"json", "application/json"},
		{"zip", "application/zip"},
	} {
		encoded, err := encodePackage(bundle, tc.format)
		if err != nil {
			t.Fatal(err)
		}
		roundTrip, err := decodePackage(encoded, tc.media)
		if err != nil || len(roundTrip.Assets) != 1 || !bytes.Equal(roundTrip.Assets[0].Data, data) {
			t.Fatalf("%s round trip: %v", tc.format, err)
		}
	}
	tampered := bundle
	tampered.Assets = []packageAsset{{Metadata: meta, Data: testImage(t)}}
	badJSON, err := encodePackage(tampered, "json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodePackage(badJSON, "application/json"); !errors.Is(err, ErrInvalidFile) {
		t.Fatalf("tampered image was accepted: %v", err)
	}
	var badZIP bytes.Buffer
	writer := zip.NewWriter(&badZIP)
	entry, err := writer.Create("../board.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("{}")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := decodePackage(badZIP.Bytes(), "application/zip"); !errors.Is(err, ErrInvalidFile) {
		t.Fatalf("unsafe ZIP was accepted: %v", err)
	}
}

func TestSelectionExportKeepsConnectorPosition(t *testing.T) {
	board := document.Document{
		Name: "Selected flow", DefaultPageID: "first",
		Pages: []json.RawMessage{
			json.RawMessage(`{"id":"first","name":"First"}`), json.RawMessage(`{"id":"next","name":"Next"}`),
		},
		Elements: []json.RawMessage{
			json.RawMessage(`{"id":"target","type":"shape","pageId":"first","x":100,"y":200,"width":40,"height":20}`),
			json.RawMessage(`{"id":"line","type":"connector","pageId":"first","startElementId":"target","startAnchor":"right","startPoint":{"x":10,"y":20},"endPoint":{"x":200,"y":210}}`),
			json.RawMessage(`{"id":"section","type":"frame","pageId":"first","childIds":["line","target"]}`),
			json.RawMessage(`{"id":"other","type":"sticky","pageId":"next"}`),
		},
	}
	selection := ExportRequest{
		RequestID: uuid.New(), Format: "zip", Scope: "selection", PageID: "first", ElementIDs: []string{"section", "line", "line"},
	}
	if err := selection.normalize(); err != nil {
		t.Fatal(err)
	}
	content, err := scopeDocument(board, selection)
	if err != nil || len(content.Pages) != 1 || len(content.Elements) != 2 {
		t.Fatalf("selection scope differs: %+v, %v", content, err)
	}
	var line, frame renderElement
	if err := json.Unmarshal(content.Elements[0], &line); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(content.Elements[1], &frame); err != nil {
		t.Fatal(err)
	}
	if line.StartElementID != "" || line.StartPoint != (point{140, 210}) ||
		len(frame.ChildIDs) != 1 || frame.ChildIDs[0] != "line" {
		t.Fatalf("isolated selection lost layout: %+v / %+v", line, frame.ChildIDs)
	}
}

func TestPNGThemeKeepsLightInkVisible(t *testing.T) {
	snapshot := document.Snapshot{Document: document.Document{
		Name: "Themed canvas", DefaultPageID: "page-1",
		Pages: []json.RawMessage{json.RawMessage(`{"id":"page-1","name":"Page 1"}`)},
		Elements: []json.RawMessage{json.RawMessage(
			`{"id":"line","type":"drawing","pageId":"page-1","stroke":"#ececec","strokeWidth":8,"points":[{"x":10,"y":10},{"x":70,"y":10}]}`)},
	}}
	for _, fixture := range []struct {
		name       string
		background uint32
	}{{"", 0xffffff}, {"dark", 0x212121}} {
		data, err := renderPNG(context.Background(), uuid.Nil, snapshot, false, fixture.name)
		if err != nil {
			t.Fatal(err)
		}
		rendered, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		if pixel := color.NRGBAModel.Convert(rendered.At(0, 0)); pixel != rgb(fixture.background) {
			t.Fatalf("theme %q background = %v", fixture.name, pixel)
		}
		ink := 0
		for y := range rendered.Bounds().Dy() {
			for x := range rendered.Bounds().Dx() {
				if color.NRGBAModel.Convert(rendered.At(x, y)) == rgb(0xececec) {
					ink++
				}
			}
		}
		if ink < 100 {
			t.Fatalf("theme %q lost stored ink color, found %d pixels", fixture.name, ink)
		}
	}
}

func TestExportThemeIdentity(t *testing.T) {
	for _, fixture := range []struct{ format, input, normalized string }{
		{"png", "", ""}, {"png", "light", ""}, {"png", "dark", "dark"}, {"zip", "dark", ""}, {"json", "dark", ""},
	} {
		request := ExportRequest{RequestID: uuid.New(), Format: fixture.format, Theme: fixture.input}
		if err := request.normalize(); err != nil || request.Theme != fixture.normalized {
			t.Fatalf("%s theme %q normalized to %q: %v", fixture.format, fixture.input, request.Theme, err)
		}
	}
}

func TestBoardFileJobsWithPostgresAndS3(t *testing.T) {
	endpoint := config.Env("SHIORI_TEST_S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("set SHIORI_TEST_S3_ENDPOINT for the isolated local S3 fixture")
	}
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		t.Fatal("the file integration test requires an isolated loopback S3 endpoint")
	}
	ctx := fileTestDatabase(t)
	if err := storage.InitWithBucket(endpoint, "minioadmin", "minioadmin", false, "openjam"); err != nil {
		t.Fatal(err)
	}
	owner, err := model.CreateUser(ctx, "files-owner@example.invalid", "fixture-only", "File owner")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := model.CreateUser(ctx, "files-viewer@example.invalid", "fixture-only", "File viewer")
	if err != nil {
		t.Fatal(err)
	}
	room, err := model.CreateRoom(ctx, "Portable picture", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := model.InviteRoomMemberByEmail(ctx, room.ID, owner.ID, viewer.Email, model.RoomPermissionView); err != nil {
		t.Fatal(err)
	}
	initial, err := document.Open(ctx, room.ID, owner.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	imageData := testImage(t)
	meta, err := assets.Upload(ctx, room.ID, owner.ID, imageData, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := storage.DeleteFile(cleanup, "assets/v1/"+meta.ID); err != nil {
			t.Errorf("remove owned fixture image: %v", err)
		}
	})
	clientID := uuid.NewString()
	commit := func(base int64, operations ...document.Operation) {
		t.Helper()
		_, err := document.Commit(ctx, room.ID, owner.ID, document.Command{
			ProtocolVersion: document.ProtocolVersion, Epoch: initial.Epoch, BaseSeq: base,
			ClientID: clientID, CommandID: uuid.NewString(), Operations: operations,
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	commit(0,
		document.Operation{Kind: "add", Collection: "elements", ID: "image", Value: json.RawMessage(fmt.Sprintf(
			`{"type":"image","id":"image","x":0,"y":0,"width":180,"height":90,"assetId":"%s"}`, meta.ID))},
		document.Operation{Kind: "add", Collection: "elements", ID: "note", Value: json.RawMessage(
			`{"type":"sticky","id":"note","x":190,"y":0,"width":130,"height":120,"text":"Review decision","color":"blue"}`)},
	)
	captured, err := document.Open(ctx, room.ID, owner.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	zipRequest := ExportRequest{RequestID: uuid.New(), Format: "zip", Scope: "board"}
	if _, err := EnqueueExport(ctx, room.ID, viewer.ID, zipRequest); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("view role queued an export: %v", err)
	}
	export, err := EnqueueExport(ctx, room.ID, owner.ID, zipRequest)
	if err != nil {
		t.Fatal(err)
	}
	commit(captured.Seq, document.Operation{Kind: "patch", Collection: "elements", ID: "note",
		Fields: map[string]json.RawMessage{"text": json.RawMessage(`"Edited later"`)}})
	replayed, err := EnqueueExport(ctx, room.ID, owner.ID, zipRequest)
	if err != nil || replayed.ID != export.ID {
		t.Fatalf("duplicate export: %+v %v", replayed, err)
	}
	completeFileJob(t, ctx, KindExport, export.ID)
	output, err := jobs.GetArtifact(ctx, export.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := decodePackage(output.Data, output.ContentType)
	if err != nil || bundle.Source.Seq != captured.Seq || bundle.Source.Hash != captured.Hash ||
		len(bundle.Assets) != 1 || !bytes.Equal(bundle.Assets[0].Data, imageData) ||
		!strings.Contains(string(bundle.Document.Elements[1]), "Review decision") {
		t.Fatalf("export did not capture the original board: %v", err)
	}
	if _, err := jobs.GetArtifact(ctx, export.ID, viewer.ID); !errors.Is(err, jobs.ErrNotFound) {
		t.Fatalf("another actor could read the export artifact: %v", err)
	}
	importID := uuid.New()
	imported, err := EnqueueImport(ctx, owner.ID, importID, output.Data, output.ContentType)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := EnqueueImport(ctx, owner.ID, importID, output.Data, output.ContentType)
	if err != nil || repeated.ID != imported.ID {
		t.Fatalf("duplicate import: %+v %v", repeated, err)
	}
	if _, err := EnqueueImport(ctx, owner.ID, importID, []byte("{}"), "application/json"); !errors.Is(err, jobs.ErrConflict) {
		t.Fatalf("different bytes reused the import request: %v", err)
	}
	result := completeFileJob(t, ctx, KindImport, imported.ID)
	var copied document.VersionBoardState
	if err := json.Unmarshal(result.Result, &copied); err != nil || copied.BoardID == "" || copied.BoardID == room.ID ||
		copied.Hash != captured.Hash {
		t.Fatalf("portable copy differs from captured board: %+v %v", copied, err)
	}
	var boardCount int
	if err := db.Pool().QueryRow(ctx, "SELECT count(*) FROM rooms WHERE owner_id = $1", owner.ID).Scan(&boardCount); err != nil || boardCount != 2 {
		t.Fatalf("expected one new board, got %d: %v", boardCount, err)
	}
	if _, _, err := assets.Get(ctx, copied.BoardID, viewer.ID, meta.ID); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("asset access was inherited into the private import: %v", err)
	}
	_, imageReader, err := assets.Get(ctx, copied.BoardID, owner.ID, meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	copiedImage, err := io.ReadAll(imageReader)
	_ = imageReader.Close()
	if err != nil || !bytes.Equal(copiedImage, imageData) {
		t.Fatalf("imported asset differs: %v", err)
	}
	thumb, err := GetThumbnail(ctx, room.ID, viewer.ID, "")
	if err != nil || !thumb.Pending {
		t.Fatalf("viewer could not queue thumbnail: %+v %v", thumb, err)
	}
	thumbnailJob, err := jobs.Claim(ctx, []string{KindThumbnail}, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	finishFileJob(t, ctx, thumbnailJob)
	thumb, err = GetThumbnail(ctx, room.ID, viewer.ID, "")
	if err != nil || thumb.Pending {
		t.Fatalf("ready thumbnail was unavailable: %v", err)
	}
	rendered, err := png.Decode(bytes.NewReader(thumb.Artifact.Data))
	if err != nil || rendered.Bounds().Size() != image.Pt(thumbnailWidth, thumbnailHeight) {
		t.Fatalf("invalid thumbnail dimensions: %v", err)
	}
	magenta := 0
	for y := range rendered.Bounds().Dy() {
		for x := range rendered.Bounds().Dx() {
			r, g, b, _ := rendered.At(x, y).RGBA()
			if r > 60000 && g < 3000 && b > 40000 {
				magenta++
			}
		}
	}
	if magenta < 500 {
		t.Fatalf("the private raster did not render, found %d image pixels", magenta)
	}
	darkThumb, err := GetThumbnail(ctx, room.ID, viewer.ID, "dark")
	if err != nil || !darkThumb.Pending {
		t.Fatalf("dark thumbnail reused light artifact: %+v %v", darkThumb, err)
	}
	darkJob, err := jobs.Claim(ctx, []string{KindThumbnail}, 30*time.Second)
	if err != nil || darkJob.ID == thumbnailJob.ID {
		t.Fatalf("dark thumbnail did not get a distinct job: %v", err)
	}
	finishFileJob(t, ctx, darkJob)
	darkThumb, err = GetThumbnail(ctx, room.ID, viewer.ID, "dark")
	if err != nil || darkThumb.Pending {
		t.Fatalf("ready dark thumbnail was unavailable: %v", err)
	}
	dark, err := png.Decode(bytes.NewReader(darkThumb.Artifact.Data))
	if err != nil || color.NRGBAModel.Convert(dark.At(0, 0)) != rgb(0x212121) {
		t.Fatalf("dark thumbnail has incorrect background: %v", err)
	}
	if err := model.RemoveRoomMember(ctx, room.ID, owner.ID, viewer.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := GetThumbnail(ctx, room.ID, viewer.ID, ""); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("revoked user read the thumbnail: %v", err)
	}
}

func testImage(t *testing.T) []byte {
	t.Helper()
	// Unique content avoids sharing cleanup keys with another test run.
	id := uuid.New()
	img := image.NewRGBA(image.Rect(0, 0, len(id)*2, 16))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.RGBA{R: 255, B: 214, A: 255}), image.Point{}, draw.Src)
	for x, value := range id {
		img.SetRGBA(x, 0, color.RGBA{R: value, G: 80, A: 255})
	}
	var output bytes.Buffer
	if err := png.Encode(&output, img); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func completeFileJob(t *testing.T, ctx context.Context, kind string, id uuid.UUID) jobs.Job {
	t.Helper()
	lease, err := jobs.Claim(ctx, []string{kind}, 30*time.Second)
	if err != nil || lease.ID != id {
		t.Fatalf("unexpected claimed file job: %v %v", lease.ID, err)
	}
	return finishFileJob(t, ctx, lease)
}

func finishFileJob(t *testing.T, ctx context.Context, lease jobs.Lease) jobs.Job {
	t.Helper()
	outcome, err := Handlers()[lease.Kind](ctx, lease)
	if err != nil {
		t.Fatal(err)
	}
	job, err := jobs.Complete(ctx, lease, outcome)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := jobs.Complete(ctx, lease, outcome); !errors.Is(err, jobs.ErrLeaseLost) {
		t.Fatalf("a completed lease was accepted again: %v", err)
	}
	return job
}

func fileTestDatabase(t *testing.T) context.Context {
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
	schema := "shiori_file_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := pgx.Identifier{schema}.Sanitize()
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA IF EXISTS "+quoted+" CASCADE"); err != nil {
			t.Errorf("drop owned fixture schema: %v", err)
		}
		_ = admin.Close(cleanup)
	})
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
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
		t.Fatalf("unexpected fixture search_path %q, %v", actual, err)
	}
	if err := db.MigrateContext(ctx); err != nil {
		t.Fatal(err)
	}
	return ctx
}
