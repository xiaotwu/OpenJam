package tests

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/slideformat"
)

func TestProjectArchiveIndependentInstances(t *testing.T) {
	if os.Getenv("OPENJAM_PROJECT_ARCHIVE_TEST") != "1" {
		t.Skip("requires two disposable OpenJam instances with independent stores")
	}
	a, b := os.Getenv("OPENJAM_ARCHIVE_A"), os.Getenv("OPENJAM_ARCHIVE_B")
	checkArchiveTestInstances(t, a, b)
	client := &http.Client{Timeout: 25 * time.Second}
	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	const api = "/api/v2"
	projectPath := func(id uuid.UUID) string { return api + "/projects/" + id.String() }
	filePath := func(id string) string { return api + "/boards/" + id }

	type person struct {
		token, email string
		id           uuid.UUID
	}
	register := func(base, label string) person {
		t.Helper()
		token, email := registerClusterUser(t, client, base, label)
		id := clusterJSON[struct{ User model.User }](t, client, base, token, "GET", "/api/me", nil, 200).User.ID
		return person{token, email, id}
	}
	directory := func(base string, user person) model.Directory {
		t.Helper()
		return clusterJSON[model.Directory](t, client, base, user.token, "GET", api+"/directory", nil, 200)
	}
	workspace := func(base string, user person, organization uuid.UUID) uuid.UUID {
		t.Helper()
		for _, w := range directory(base, user).Workspaces {
			if w.OrganizationID == organization && w.IsDefault {
				return w.ID
			}
		}
		t.Fatal("missing default workspace")
		return uuid.Nil
	}
	newTeam := func(base string, owner person, name string) model.Organization {
		t.Helper()
		return clusterJSON[model.Organization](t, client, base, owner.token, "POST", api+"/organizations", map[string]string{"name": name}, 201)
	}
	enroll := func(base string, owner person, team uuid.UUID, member person) {
		t.Helper()
		path := api + "/teams/" + team.String() + "/invitations"
		invitation := clusterJSON[model.TeamInvitation](t, client, base, owner.token, "POST", path,
			map[string]string{"email": member.email, "role": "member"}, 201)
		clusterJSON[map[string]any](t, client, base, member.token, "POST", path+"/accept", map[string]string{"token": invitation.Token}, 200)
	}
	open := func(base string, user person, id string, status int) document.Snapshot {
		t.Helper()
		return clusterJSON[document.Snapshot](t, client, base, user.token, "GET", filePath(id)+"/snapshot", nil, status)
	}
	edit := func(base string, user person, id string, op func(document.Snapshot) map[string]any) {
		t.Helper()
		head := open(base, user, id, 200)
		clusterJSON[document.Ack](t, client, base, user.token, "POST", filePath(id)+"/commands",
			clusterCommand(uuid.NewString(), head.Epoch, head.Seq, op(head)), 200)
	}
	status := func(response clusterResponse, expected int) []byte {
		t.Helper()
		if response.err != nil || response.status != expected {
			t.Fatalf("expected %d, got %d: %.500s %v", expected, response.status, response.body, response.err)
		}
		return response.body
	}
	version := func(base string, user person, id, name string) document.VersionSummary {
		t.Helper()
		head := open(base, user, id, 200)
		return clusterJSON[document.VersionSummary](t, client, base, user.token, "POST", filePath(id)+"/versions",
			map[string]any{"name": name, "expectedEpoch": head.Epoch, "expectedSeq": head.Seq}, 201)
	}
	readProject := func(base string, user person, id uuid.UUID) map[string]model.DirectoryBoard {
		t.Helper()
		dir := directory(base, user)
		result := map[string]model.DirectoryBoard{}
		for _, list := range [][]model.DirectoryBoard{dir.Boards, dir.Docs, dir.Sheets, dir.Slides} {
			for _, item := range list {
				if item.ProjectID != nil && *item.ProjectID == id {
					result[item.Name] = item
				}
			}
		}
		return result
	}
	source := register(a, "Archive Source Owner")
	sourceEditor := register(a, "Archive Source Editor")
	sourceViewer := register(a, "Archive Source Viewer")
	teamA := newTeam(a, source, "Source Studio "+tag)
	sourceProject := clusterJSON[model.Project](t, client, a, source.token, "POST", api+"/workspaces/"+workspace(a, source, teamA.ID).String()+"/projects",
		map[string]string{"name": "Portable Studio " + tag}, 201)
	for _, grant := range []struct {
		person
		role string
	}{{sourceEditor, "edit"}, {sourceViewer, "view"}} {
		enroll(a, source, teamA.ID, grant.person)
		clusterJSON[map[string]any](t, client, a, source.token, "PUT", projectPath(sourceProject.ID)+"/members/"+grant.id.String(),
			map[string]string{"role": grant.role}, 200)
	}
	create := func(collection, name string) string {
		t.Helper()
		return clusterJSON[model.DirectoryBoard](t, client, a, source.token, "POST", projectPath(sourceProject.ID)+"/"+collection,
			map[string]string{"name": name}, 201).ID
	}
	board, doc, sheet, removed := create("boards", "Roadmap"), create("docs", "Brief"), create("sheets", "Budget"), create("boards", "Deleted Art")
	external := clusterJSON[model.Room](t, client, a, source.token, "POST", "/api/rooms", map[string]string{"name": "Unrelated Board"}, 200).ID
	type picture struct {
		meta assets.Metadata
		data []byte
	}
	pngImage := func(tint uint8) picture {
		t.Helper()
		img := image.NewRGBA(image.Rect(0, 0, 24, 18))
		img.Set(5, 7, color.RGBA{R: tint, G: 120, B: 200, A: 255})
		var buffer bytes.Buffer
		if err := png.Encode(&buffer, img); err != nil {
			t.Fatal(err)
		}
		meta, err := assets.Inspect(buffer.Bytes(), "image/png")
		if err != nil {
			t.Fatal(err)
		}
		return picture{meta, buffer.Bytes()}
	}
	liveImage, priorImage, deletedImage := pngImage(71), pngImage(141), pngImage(201)
	addImage := func(room, id string, picture picture) {
		t.Helper()
		status(fileClusterRequest(client, a, source.token, "POST", filePath(room)+"/assets", picture.data, map[string]string{"Content-Type": "image/png"}), 201)
		edit(a, source, room, func(head document.Snapshot) map[string]any {
			return map[string]any{"kind": "add", "collection": "elements", "id": id, "value": map[string]any{
				"id": id, "pageId": head.Document.DefaultPageID, "type": "image", "assetId": picture.meta.ID,
				"x": 20, "y": 20, "width": 24, "height": 18, "originalWidth": 24, "originalHeight": 18, "opacity": 1,
			}}
		})
	}
	addImage(board, "current-art", liveImage)
	addImage(board, "early-art", priorImage)
	addImage(removed, "deleted-art", deletedImage)
	earlyBoard := version(a, source, board, "Board with early art")
	edit(a, source, board, func(document.Snapshot) map[string]any {
		return map[string]any{"kind": "delete", "collection": "elements", "id": "early-art"}
	})

	setCell := func(address, input, kind string) {
		t.Helper()
		edit(a, source, sheet, func(head document.Snapshot) map[string]any {
			tab := head.Document.DefaultPageID
			return map[string]any{"kind": "setCell", "collection": "elements", "id": tab + ":" + address,
				"value":    map[string]string{"pageId": tab, "address": address, "input": input, "valueType": kind},
				"expected": map[string]string{"input": "", "valueType": ""}}
		})
	}
	setCell("A1", "41", "number")
	setCell("B1", "=A1+1", "formula")
	setCell("C1", "/board/"+board+"?page="+open(a, source, board, 200).Document.DefaultPageID, "text")
	setCell("D1", "=C1", "formula")
	version(a, source, sheet, "Budget baseline")

	first, second := slideformat.BlankSlide(), slideformat.BlankSlide()
	first.Name, second.Name = "Agenda", "Decision"
	second.Objects = []slideformat.Object{
		{Type: "text", Text: "Approve the plan", Box: slideformat.Box{X: 40, Y: 40, Width: 320, Height: 100},
			FontFamily: "Arial", FontSize: 32, FontWeight: "normal", FontStyle: "normal", Color: "#20323f", TextAlign: "left"},
		{Type: "image", Box: slideformat.Box{X: 650, Y: 75, Width: 240, Height: 180}, AssetID: liveImage.meta.ID,
			OriginalWidth: liveImage.meta.Width, OriginalHeight: liveImage.meta.Height, Caption: "Same art, one archive blob"},
	}
	pptx, err := slideformat.WritePPTX([]slideformat.Slide{first, second},
		map[string]slideformat.Media{liveImage.meta.ID: {Metadata: liveImage.meta, Data: liveImage.data}})
	if err != nil {
		t.Fatal(err)
	}
	var slides model.DirectoryBoard
	pptxRoute := projectPath(sourceProject.ID) + "/slides/import?name=Review"
	if err := json.Unmarshal(status(fileClusterRequest(client, a, source.token, "POST", pptxRoute, pptx,
		map[string]string{"Content-Type": "application/octet-stream"}), 201), &slides); err != nil {
		t.Fatal(err)
	}

	slidesHead := open(a, source, slides.ID, 200)
	var secondPage struct{ ID string }
	if err := json.Unmarshal(slidesHead.Document.Pages[1], &secondPage); err != nil {
		t.Fatal(err)
	}
	boardPage := open(a, source, board, 200).Document.DefaultPageID
	tab := open(a, source, sheet, 200).Document.DefaultPageID
	credential := clusterJSON[struct{ Token string }](t, client, a, source.token, "POST", filePath(board)+"/sharing/links",
		map[string]any{"permission": "view", "expiresInDays": 1}, 201).Token
	bodyLinks := "\n\n[Roadmap](" + a + "/room/" + board + "?page=" + boardPage + "#share=" + credential + ")\n" +
		"[Budget](/sheet/" + sheet + "?sheet=" + tab + "&cell=B1#target)\n" +
		"[Decision](/slides/" + slides.ID + "?slide=" + secondPage.ID + ")\n" +
		"[Source only](/board/" + external + ")\n" +
		"[Other site](https://example.test/board/" + board + ")"
	patchDoc := func(before, after string) func(document.Snapshot) map[string]any {
		return func(head document.Snapshot) map[string]any {
			return map[string]any{"kind": "patch", "collection": "pages", "id": head.Document.DefaultPageID,
				"expected": map[string]string{"text": before}, "fields": map[string]string{"text": after}}
		}
	}
	oldBody, newBody := "Planning baseline"+bodyLinks, "Archive acceptance "+tag+bodyLinks
	edit(a, sourceEditor, doc, patchDoc("", oldBody))
	earlyDoc := version(a, sourceEditor, doc, "Brief before review")
	projectVersion := clusterJSON[document.ProjectAction](t, client, a, source.token, "POST", projectPath(sourceProject.ID)+"/versions",
		document.ProjectVersionRequest{RequestID: uuid.New(), Name: "Studio before cleanup"}, 201)
	if projectVersion.VersionID == nil {
		t.Fatal("source project version is missing")
	}
	clusterJSON[map[string]any](t, client, a, source.token, "DELETE", "/api/rooms/"+removed, nil, 200)
	edit(a, source, doc, patchDoc(oldBody, newBody))
	version(a, source, doc, "Brief reviewed")
	clusterJSON[map[string]any](t, client, a, source.token, "PUT", filePath(slides.ID)+"/archive", map[string]bool{"archived": true}, 200)
	sourceVersions := clusterJSON[document.ProjectVersionList](t, client, a, source.token, "GET", projectPath(sourceProject.ID)+"/versions", nil, 200)
	sourceFiles := readProject(a, source, sourceProject.ID)
	if len(sourceFiles) != 4 {
		t.Fatal("expected four current files")
	}
	exportPath := projectPath(sourceProject.ID) + "/archive?origin=" + url.QueryEscape(a)
	status(fileClusterRequest(client, a, sourceEditor.token, "GET", exportPath, nil, nil), 403)
	status(fileClusterRequest(client, a, "", "GET", exportPath, nil, nil), 401)
	raw := status(fileClusterRequest(client, a, source.token, "GET", exportPath, nil, nil), 200)
	contents, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range contents.File {
		entry, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(io.LimitReader(entry, document.PortableDocumentLimit+1))
		entry.Close()
		if err != nil || bytes.Contains(data, []byte(credential)) || bytes.Contains(data, []byte(sourceEditor.email)) {
			t.Fatalf("ZIP retained a share credential or source email in %s", file.Name)
		}
	}
	t.Log("A exported one project ZIP with four file types, deduplicated current and historical images, and no source link credentials")

	targetOwner := register(b, "Archive Target Owner")
	restorer := register(b, "Archive Target Restorer")
	mapped := register(b, "Archive Target Editor")
	unmapped := register(b, "Archive Source Viewer") // Same display name on purpose.
	outsider := register(b, "Archive Outsider")
	teamB := newTeam(b, targetOwner, "Destination Studio "+tag)
	for _, user := range []person{restorer, mapped, unmapped} {
		enroll(b, targetOwner, teamB.ID, user)
	}
	inspect := status(fileClusterRequest(client, b, restorer.token, "POST", api+"/project-archives/inspect", raw,
		map[string]string{"Content-Type": "application/zip"}), 200)
	var info document.ProjectArchiveInfo
	if json.Unmarshal(inspect, &info) != nil || info.Files != 4 || info.Images != 3 || info.ProjectVersions != 1 ||
		info.FileVersions < 8 || len(info.Members) != 3 {
		t.Fatalf("unexpected archive inspection: %s", inspect)
	}
	workspaceB := workspace(b, targetOwner, teamB.ID)
	restorePath := api + "/workspaces/" + workspaceB.String() + "/project-archives"
	restore := func(user person, route string, data []byte, input document.ProjectArchiveRestore, expected int) model.Project {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		options, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		if err := writer.WriteField("options", string(options)); err != nil {
			t.Fatal(err)
		}
		part, err := writer.CreateFormFile("archive", "fixture.openjam-project.zip")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(data); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		data = status(fileClusterRequest(client, b, user.token, "POST", route, body.Bytes(), map[string]string{"Content-Type": writer.FormDataContentType()}), expected)
		var project model.Project
		if expected == 201 && json.Unmarshal(data, &project) != nil {
			t.Fatalf("invalid restore response: %s", data)
		}
		return project
	}
	input := document.ProjectArchiveRestore{RequestID: uuid.New(), Name: "Restored Studio " + tag,
		Mappings: []document.ProjectArchiveMapping{{SourceUserID: sourceEditor.id, TargetUserID: mapped.id, Role: "edit"}}}
	restore(outsider, restorePath, raw, input, 404)
	bad := input
	bad.Mappings = []document.ProjectArchiveMapping{{SourceUserID: sourceEditor.id, TargetUserID: outsider.id, Role: "manager"}}
	restore(restorer, restorePath, raw, bad, 409)
	restore(restorer, restorePath, raw[:len(raw)/2], input, 400)
	if slices.ContainsFunc(directory(b, targetOwner).Projects, func(p model.Project) bool { return p.Name == input.Name }) {
		t.Fatal("a failed restore created a project")
	}
	restored := restore(restorer, restorePath, raw, input, 201)
	if restored.ID == uuid.Nil || restored.ID == sourceProject.ID || restored.WorkspaceID != workspaceB || restored.Role != "manager" {
		t.Fatalf("wrong restored ownership: %+v", restored)
	}
	if replay := restore(restorer, restorePath, raw, input, 201); replay.ID != restored.ID {
		t.Fatal("retry created another project")
	}
	changed := input
	changed.Name = "Different request"
	restore(restorer, restorePath, raw, changed, 409)
	files := readProject(b, targetOwner, restored.ID)
	if len(files) != 4 {
		t.Fatalf("B should have exactly four restored live files; got %d", len(files))
	}
	for name, item := range files {
		sourceFile := sourceFiles[name]
		from, to := open(a, source, sourceFile.ID, 200), open(b, targetOwner, item.ID, 200)
		if item.ID == sourceFile.ID || item.OwnerID != targetOwner.id || to.ResourceKind != from.ResourceKind ||
			to.Document.DefaultPageID != from.Document.DefaultPageID || len(to.Document.Pages) != len(from.Document.Pages) ||
			len(to.Document.Elements) != len(from.Document.Elements) {
			t.Fatalf("restored file differs structurally: %s", name)
		}
		if (item.ArchivedAt == nil) != (sourceFile.ArchivedAt == nil) ||
			(item.ArchivedAt != nil && !item.ArchivedAt.Equal(*sourceFile.ArchivedAt)) {
			t.Fatalf("archived state changed: %s", name)
		}
		if read := open(b, mapped, item.ID, 200); read.Permission != "edit" {
			t.Fatalf("incorrect mapped role: %s", read.Permission)
		}
		open(b, unmapped, item.ID, 403)
		open(b, outsider, item.ID, 403)
	}
	bBoard, bDoc, bSheet, bSlides := files["Roadmap"].ID, files["Brief"].ID, files["Budget"].ID, files["Review"].ID
	checkImage := func(user person, room string, picture picture) {
		t.Helper()
		got := status(fileClusterRequest(client, b, user.token, "GET", filePath(room)+"/assets/"+picture.meta.ID, nil, nil), 200)
		if !bytes.Equal(got, picture.data) {
			t.Fatal("restored private PNG changed")
		}
	}
	checkImage(mapped, bBoard, liveImage)
	checkImage(targetOwner, bBoard, priorImage)
	checkImage(targetOwner, bSlides, liveImage)
	status(fileClusterRequest(client, b, unmapped.token, "GET", filePath(bBoard)+"/assets/"+liveImage.meta.ID, nil, nil), 403)
	status(fileClusterRequest(client, b, "", "GET", filePath(bBoard)+"/assets/"+liveImage.meta.ID, nil, nil), 401)
	var restoredBlock struct{ Text string }
	if err := json.Unmarshal(open(b, targetOwner, bDoc, 200).Document.Pages[0], &restoredBlock); err != nil {
		t.Fatal(err)
	}
	checkLinks := func(text string) {
		t.Helper()
		for _, wanted := range []string{
			"[Roadmap](/board/" + bBoard + "?page=" + boardPage + ")",
			"[Budget](/sheet/" + bSheet + "?sheet=" + tab + "&cell=B1#target)",
			"[Decision](/slides/" + bSlides + "?slide=" + secondPage.ID + ")",
			"[Source only](" + a + "/board/" + external + ")",
			"[Other site](https://example.test/board/" + board + ")",
		} {
			if !strings.Contains(text, wanted) {
				t.Fatalf("missing rewritten link %s", wanted)
			}
		}
	}
	if !strings.HasPrefix(restoredBlock.Text, "Archive acceptance "+tag) || strings.Contains(restoredBlock.Text, credential) {
		t.Fatal("restored Doc lost its content or retained a credential")
	}
	checkLinks(restoredBlock.Text)
	book := open(b, targetOwner, bSheet, 200)
	var matchedCells int
	for _, record := range book.Document.Elements {
		var cell struct{ Address, Input, Display string }
		if err := json.Unmarshal(record, &cell); err != nil {
			t.Fatal(err)
		}
		if cell.Address == "B1" && cell.Input == "=A1+1" && cell.Display == "42" ||
			cell.Address == "C1" && cell.Input == "/board/"+bBoard+"?page="+boardPage ||
			cell.Address == "D1" && cell.Input == "=C1" && cell.Display == "/board/"+bBoard+"?page="+boardPage {
			matchedCells++
		}
	}
	if matchedCells != 3 {
		t.Fatalf("restored sheet lost its formula, linked cell, or recalculated display: %s", book.Document.Elements)
	}
	if opened := open(b, targetOwner, bSlides, 200); opened.Hash != slidesHead.Hash {
		t.Fatal("restored slide order, text, or image differs")
	}
	t.Log("B restored four new resource IDs; checked board and slide PNG bytes, sheet formulas, and resolved file, page, cell and slide links")

	readHistory := func(id, name string, original document.VersionSummary) document.VersionPreview {
		t.Helper()
		list := clusterJSON[document.VersionList](t, client, b, targetOwner.token, "GET", filePath(id)+"/versions", nil, 200)
		i := slices.IndexFunc(list.Versions, func(v document.VersionSummary) bool { return v.Name == name })
		if i < 0 {
			t.Fatalf("missing file version %s", name)
		}
		v := list.Versions[i]
		if v.ID == original.ID || v.Author != original.Author || !v.CreatedAt.Equal(original.CreatedAt) || v.Kind != original.Kind ||
			v.Epoch != original.Epoch || v.Seq != original.Seq {
			t.Fatalf("file version provenance changed: %+v vs %+v", v, original)
		}
		return clusterJSON[document.VersionPreview](t, client, b, targetOwner.token, "GET", filePath(id)+"/versions/"+v.ID.String(), nil, 200)
	}
	early := readHistory(bDoc, "Brief before review", earlyDoc)
	if err := json.Unmarshal(early.Document.Pages[0], &restoredBlock); err != nil || !strings.HasPrefix(restoredBlock.Text, "Planning baseline") {
		t.Fatal("Doc version content differs")
	}
	checkLinks(restoredBlock.Text)
	art := readHistory(bBoard, "Board with early art", earlyBoard)
	head := open(b, targetOwner, bBoard, 200)
	clusterJSON[map[string]any](t, client, b, targetOwner.token, "POST", filePath(bBoard)+"/versions/"+art.Version.ID.String()+"/restore",
		map[string]any{"requestId": uuid.NewString(), "expectedEpoch": head.Epoch, "expectedSeq": head.Seq}, 200)
	if snapshot := open(b, targetOwner, bBoard, 200); snapshot.Hash != art.Version.Hash {
		t.Fatal("file version could not actually be restored")
	}
	history := projectPath(restored.ID) + "/versions"
	versions := clusterJSON[document.ProjectVersionList](t, client, b, targetOwner.token, "GET", history, nil, 200)
	if len(versions.Versions) != 1 || versions.Versions[0].Name != "Studio before cleanup" ||
		versions.Versions[0].Author != "Archive Source Owner" || versions.Versions[0].Files != 5 ||
		!versions.Versions[0].CreatedAt.Equal(sourceVersions.Versions[0].CreatedAt) {
		t.Fatalf("project snapshot metadata differs: %+v", versions)
	}
	snapshotRestore := history + "/" + versions.Versions[0].ID.String() + "/restore"
	preview := clusterJSON[document.ProjectRestorePreview](t, client, b, targetOwner.token, "GET", snapshotRestore, nil, 200)
	clusterJSON[document.ProjectAction](t, client, b, targetOwner.token, "POST", snapshotRestore,
		document.ProjectRestoreRequest{RequestID: uuid.New(), Token: preview.Token}, 200)
	deleted := readProject(b, targetOwner, restored.ID)["Deleted Art"]
	if deleted.ID == "" || deleted.ID == removed {
		t.Fatal("project snapshot did not recreate the previously deleted board")
	}
	checkImage(targetOwner, deleted.ID, deletedImage)
	t.Log("B opened historical content and restored both a file version and a project snapshot, including a deleted board and its private image")

	personal := directory(b, targetOwner)
	personalOrg := personal.Organizations[slices.IndexFunc(personal.Organizations, func(o model.Organization) bool { return o.Kind == "personal" })]
	personalPath := api + "/workspaces/" + workspace(b, targetOwner, personalOrg.ID).String() + "/project-archives"
	input.RequestID = uuid.New()
	restore(targetOwner, personalPath, raw, input, 400)
	input.Mappings = nil
	input.Name = "Private copy " + tag
	private := restore(targetOwner, personalPath, raw, input, 201)
	privateFiles := readProject(b, targetOwner, private.ID)
	if len(privateFiles) != 4 || open(b, targetOwner, privateFiles["Brief"].ID, 200).Permission != "owner" {
		t.Fatal("personal project restore failed")
	}
	open(b, mapped, privateFiles["Brief"].ID, 403)
	search := func(user person) []model.SearchResult {
		t.Helper()
		return clusterJSON[struct{ Results []model.SearchResult }](t, client, b, user.token, "GET",
			api+"/workshop/search?"+(url.Values{"q": {"Planning baseline"}, "team": {teamB.ID.String()}}).Encode(), nil, 200).Results
	}
	if !slices.ContainsFunc(search(mapped), func(result model.SearchResult) bool { return strings.Contains(result.URL, bDoc) }) ||
		len(search(unmapped)) != 0 {
		t.Fatal("restored content search did not respect project grants")
	}
	clusterJSON[map[string]any](t, client, b, targetOwner.token, "DELETE", projectPath(restored.ID)+"/members/"+mapped.id.String(), nil, 200)
	open(b, mapped, bDoc, 403)
	if len(search(mapped)) != 0 {
		t.Fatal("revoked member retained search results")
	}
	status(fileClusterRequest(client, b, mapped.token, "GET", filePath(bBoard)+"/assets/"+liveImage.meta.ID, nil, nil), 403)
	if open(a, source, doc, 200).Document.Name != "Brief" {
		t.Fatal("the target changed the source")
	}
	t.Log("explicit Team access and revocation verified for files, images, and search; unmapped, outsider, and personal permissions remain isolated")
}

func checkArchiveTestInstances(t *testing.T, a, b string) {
	t.Helper()
	if a == b {
		t.Fatal("need two distinct loopback API instances")
	}
	parse := func(raw string) *url.URL {
		t.Helper()
		u, err := url.Parse(raw)
		if err != nil || u.Hostname() != "127.0.0.1" || u.Port() == "" {
			t.Fatal("project archive tests require explicit loopback ports")
		}
		return u
	}
	if parse(a).Port() == parse(b).Port() {
		t.Fatal("API ports must be distinct")
	}
	ds := []string{os.Getenv("OPENJAM_ARCHIVE_DB_A"), os.Getenv("OPENJAM_ARCHIVE_DB_B")}
	ports := make(map[string]bool)
	for i, label := range []string{"a", "b"} {
		u := parse(ds[i])
		if u.Path != "/openjam_archive_"+label+"_test" || ports[u.Port()] {
			t.Fatal("use two independent disposable archive test databases")
		}
		ports[u.Port()] = true
		if label == "b" && os.Getenv("OPENJAM_ARCHIVE_VERIFY_EMPTY") == "1" {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			conn, err := pgx.Connect(ctx, ds[i])
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close(context.Background())
			var rows int
			if err := conn.QueryRow(ctx, `SELECT (SELECT count(*) FROM rooms) + (SELECT count(*) FROM asset_blobs) + (SELECT count(*) FROM projects)`).Scan(&rows); err != nil || rows != 0 {
				t.Fatalf("destination was not empty: rows=%d err=%v", rows, err)
			}
			t.Log("confirmed destination B had zero projects, files, or private image records before any restore")
		}
	}
}
