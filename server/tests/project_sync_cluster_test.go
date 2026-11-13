package tests

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/assets"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestProjectSyncCluster(t *testing.T) {
	if os.Getenv("OPENJAM_CLUSTER_PROJECT_SYNC") != "1" {
		t.Skip("requires two isolated Shiori API replicas with shared storage")
	}
	a, b, dsn := os.Getenv("OPENJAM_CLUSTER_PRIMARY"), os.Getenv("OPENJAM_CLUSTER_SECONDARY"), os.Getenv("OPENJAM_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 10 * time.Second}
	personalOwner, personalEmail := registerClusterUser(t, client, a, "Personal project owner")
	teamOwner, _ := registerClusterUser(t, client, b, "Team owner")
	outsider, _ := registerClusterUser(t, client, b, "Other Team")
	const api = "/api/v2"
	directory := func(base, token string) model.Directory {
		t.Helper()
		return clusterJSON[model.Directory](t, client, base, token, "GET", api+"/directory", nil, 200)
	}
	team := clusterJSON[model.Organization](t, client, b, teamOwner, "POST", api+"/organizations", map[string]string{"name": "Studio"}, 201)
	teamPath := api + "/teams/" + team.ID.String()
	invitation := clusterJSON[model.TeamInvitation](t, client, b, teamOwner, "POST", teamPath+"/invitations",
		map[string]string{"email": personalEmail, "role": "member"}, 201)
	clusterJSON[map[string]any](t, client, a, personalOwner, "POST", teamPath+"/invitations/accept",
		map[string]string{"token": invitation.Token}, 200)
	actor := clusterJSON[struct{ User model.User }](t, client, a, personalOwner, "GET", "/api/me", nil, 200).User.ID
	dir := directory(a, personalOwner)
	workspaceIndex := slices.IndexFunc(dir.Workspaces, func(w model.Workspace) bool { return w.OrganizationID == team.ID })
	if workspaceIndex < 0 {
		t.Fatal("expected a Team workspace")
	}
	draftsIndex := slices.IndexFunc(dir.Projects, func(p model.Project) bool {
		return p.IsDefault && p.WorkspaceID != dir.Workspaces[workspaceIndex].ID
	})
	if draftsIndex < 0 {
		t.Fatal("expected personal Drafts")
	}
	personal := dir.Projects[draftsIndex].ID
	projectPath := func(id uuid.UUID) string { return api + "/projects/" + id.String() }
	filePath := func(id string) string { return api + "/boards/" + id }
	create := func(project uuid.UUID, resource, name string) string {
		t.Helper()
		return clusterJSON[model.DirectoryBoard](t, client, a, personalOwner, "POST", projectPath(project)+"/"+resource,
			map[string]string{"name": name}, 201).ID
	}
	filesIn := func(base, token string, project uuid.UUID) map[string]model.DirectoryBoard {
		t.Helper()
		d := directory(base, token)
		result := make(map[string]model.DirectoryBoard)
		for _, list := range [][]model.DirectoryBoard{d.Boards, d.Docs, d.Sheets, d.Slides} {
			for _, item := range list {
				if item.ProjectID != nil && *item.ProjectID == project {
					result[item.Name] = item
				}
			}
		}
		return result
	}
	open := func(base, token, id string) document.Snapshot {
		t.Helper()
		return clusterJSON[document.Snapshot](t, client, base, token, "GET", filePath(id)+"/snapshot", nil, 200)
	}
	edit := func(base, token, id string, op func(document.Snapshot) map[string]any) document.Ack {
		t.Helper()
		head := open(base, token, id)
		return clusterJSON[document.Ack](t, client, base, token, "POST", filePath(id)+"/commands",
			clusterCommand(uuid.NewString(), head.Epoch, head.Seq, op(head)), 200)
	}
	docText := func(before, after string) func(document.Snapshot) map[string]any {
		return func(head document.Snapshot) map[string]any {
			return map[string]any{"kind": "patch", "collection": "pages", "id": head.Document.DefaultPageID,
				"expected": map[string]string{"text": before}, "fields": map[string]string{"text": after}}
		}
	}
	checkMatch := func(x, y document.Snapshot) {
		t.Helper()
		if x.BoardID == y.BoardID || x.Hash != y.Hash || x.ResourceKind != y.ResourceKind {
			t.Fatalf("expected distinct copies of the same %s content: %s %s", x.ResourceKind, x.Hash, y.Hash)
		}
	}

	legacy := clusterJSON[model.Room](t, client, a, personalOwner, "POST", "/api/rooms", map[string]string{"name": "Legacy Board"}, 200)
	clusterJSON[map[string]any](t, client, a, personalOwner, "POST", "/api/rooms/"+legacy.ID+"/save", map[string]any{
		"name": legacy.Name, "elements": []map[string]any{{"id": "old-text", "type": "text", "x": 1, "y": 2, "text": "Original legacy data"}},
	}, 200)
	board := create(personal, "boards", "Roadmap")
	doc := create(personal, "docs", "Brief")
	book := create(personal, "sheets", "Budget")
	slides := create(personal, "slides", "Review")
	edit(a, personalOwner, doc, docText("", "Original project brief"))
	picture := image.NewRGBA(image.Rect(0, 0, 16, 16))
	picture.Set(3, 7, color.RGBA{R: 68, G: 119, B: 208, A: 255})
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, picture); err != nil {
		t.Fatal(err)
	}
	upload := fileClusterRequest(client, a, personalOwner, "POST", filePath(board)+"/assets", pngData.Bytes(), map[string]string{"Content-Type": "image/png"})
	var asset assets.Metadata
	if upload.err != nil || upload.status != 201 || json.Unmarshal(upload.body, &asset) != nil {
		t.Fatalf("private PNG upload: %d %s %v", upload.status, upload.body, upload.err)
	}
	edit(a, personalOwner, board, func(head document.Snapshot) map[string]any {
		return map[string]any{"kind": "add", "collection": "elements", "id": "photo", "value": map[string]any{
			"id": "photo", "pageId": head.Document.DefaultPageID, "type": "image", "assetId": asset.ID, "src": "",
			"x": 2, "y": 4, "width": 16, "height": 16, "rotation": 0, "opacity": 1, "zIndex": 1,
			"originalWidth": 16, "originalHeight": 16, "objectFit": "contain",
		}}
	})
	importRoute := projectPath(personal) + "/import"
	linkedInput := document.ProjectImport{RequestID: uuid.New(), WorkspaceID: dir.Workspaces[workspaceIndex].ID, Name: "Linked Review", Mode: "linked"}
	linked := clusterJSON[document.ProjectAction](t, client, a, personalOwner, "POST", importRoute, linkedInput, 201).ProjectID
	if replay := clusterJSON[document.ProjectAction](t, client, b, personalOwner, "POST", importRoute, linkedInput, 201); replay.ProjectID != linked || replay.Files != 5 {
		t.Fatalf("import replay differs across replicas: %+v", replay)
	}
	independent := clusterJSON[document.ProjectAction](t, client, b, personalOwner, "POST", importRoute,
		document.ProjectImport{RequestID: uuid.New(), WorkspaceID: linkedInput.WorkspaceID, Name: "Independent Review", Mode: "independent"}, 201).ProjectID
	linkedFiles := filesIn(b, teamOwner, linked)
	isolated := filesIn(a, teamOwner, independent)
	if len(linkedFiles) != 5 || len(isolated) != 5 {
		t.Fatalf("both branches should include all four file types and legacy Drafts: %d %d", len(linkedFiles), len(isolated))
	}
	for name, id := range map[string]string{"Brief": doc, "Budget": book, "Review": slides, "Roadmap": board, "Legacy Board": legacy.ID} {
		checkMatch(open(a, personalOwner, id), open(b, teamOwner, linkedFiles[name].ID))
	}
	assetPath := func(id string) string { return filePath(id) + "/assets/" + asset.ID }
	checkImage := func(token, id string) {
		t.Helper()
		read := fileClusterRequest(client, b, token, "GET", assetPath(id), nil, nil)
		if read.err != nil || read.status != 200 || !bytes.Equal(read.body, pngData.Bytes()) {
			t.Fatalf("private image not preserved: %d %v", read.status, read.err)
		}
	}
	checkImage(teamOwner, linkedFiles["Roadmap"].ID)
	clusterJSON[map[string]any](t, client, b, outsider, "GET", filePath(linkedFiles["Brief"].ID)+"/snapshot", nil, 403)
	links := func(base, token string, id uuid.UUID) []document.ProjectLink {
		t.Helper()
		return clusterJSON[struct{ Links []document.ProjectLink }](t, client, base, token, "GET", projectPath(id)+"/sync", nil, 200).Links
	}
	if got := links(b, personalOwner, personal); len(got) != 1 || got[0].ProjectID != linked ||
		len(links(a, teamOwner, linked)) != 0 || len(links(b, personalOwner, independent)) != 0 {
		t.Fatal("branch links do not respect mode and access on both sides")
	}
	t.Log("initial import copied Board, Doc, Sheet, Slides, legacy Drafts and private assets, with independent file IDs")

	syncRoute := projectPath(personal) + "/sync/" + linked.String()
	preview := func() document.ProjectSyncPreview {
		t.Helper()
		return clusterJSON[document.ProjectSyncPreview](t, client, b, personalOwner, "GET", syncRoute, nil, 200)
	}
	if len(preview().Changes) != 0 {
		t.Fatal("freshly imported copies should match")
	}
	beforeIsolated := open(b, teamOwner, isolated["Brief"].ID).Hash
	edit(a, personalOwner, doc, docText("Original project brief", "First personal edit"))
	edit(a, personalOwner, board, func(head document.Snapshot) map[string]any {
		return map[string]any{"kind": "add", "collection": "elements", "id": "new-note", "value": map[string]any{
			"id": "new-note", "pageId": head.Document.DefaultPageID, "type": "text", "x": 12, "y": 10, "text": "Release scope",
		}}
	})
	edit(b, teamOwner, linkedFiles["Budget"].ID, func(head document.Snapshot) map[string]any {
		tab := head.Document.DefaultPageID
		return map[string]any{"kind": "setCell", "collection": "elements", "id": tab + ":A1",
			"value":    map[string]string{"pageId": tab, "address": "A1", "input": "731", "valueType": "number"},
			"expected": map[string]string{"input": "", "valueType": ""}}
	})
	rename := func(name string) func(document.Snapshot) map[string]any {
		return func(head document.Snapshot) map[string]any {
			return map[string]any{"kind": "rename", "value": name, "expected": map[string]string{"name": head.Document.Name}}
		}
	}
	edit(a, personalOwner, slides, rename("Personal Slides"))
	edit(b, teamOwner, linkedFiles["Review"].ID, rename("Team Slides"))
	initial := preview()
	var conflict uuid.UUID
	counts := map[string]int{}
	for _, change := range initial.Changes {
		counts[change.State]++
		if change.State == "conflict" && change.Kind == "slides" {
			conflict = change.Key
		}
	}
	if counts["outgoing"] != 2 || counts["incoming"] != 1 || counts["conflict"] != 1 || conflict == uuid.Nil {
		t.Fatalf("unexpected preview: %+v", initial)
	}
	edit(a, personalOwner, doc, docText("First personal edit", "Reviewed scope across replicas"))
	stale := document.ProjectSyncRequest{RequestID: uuid.New(), Token: initial.Token, Direction: "push"}
	if err := clusterJSON[struct{ Code string }](t, client, a, personalOwner, "POST", syncRoute, stale, 409); err.Code != "STALE_PROJECT" {
		t.Fatalf("stale batch failed for the wrong reason: %+v", err)
	}
	if open(b, teamOwner, linkedFiles["Brief"].ID).Hash != beforeIsolated {
		t.Fatal("stale batch wrote a partial update")
	}
	watch := clusterSocket(t, b, teamOwner, "/ws/v2")
	head := open(b, teamOwner, linkedFiles["Brief"].ID)
	writeSocket(t, watch, "subscribe", map[string]any{"boardId": head.BoardID, "epoch": head.Epoch, "afterSeq": head.Seq})
	readSocket(t, watch, "subscribed")
	push := document.ProjectSyncRequest{RequestID: uuid.New(), Token: preview().Token, Direction: "push", Name: "Milestone A"}
	pushed := clusterJSON[document.ProjectAction](t, client, a, personalOwner, "POST", syncRoute, push, 200)
	readSocket(t, watch, "document_changed")
	if pushed.Files != 2 || pushed.VersionID == nil {
		t.Fatalf("push did not commit both clean files: %+v", pushed)
	}
	if replay := clusterJSON[document.ProjectAction](t, client, b, personalOwner, "POST", syncRoute, push, 200); replay.VersionID == nil || *replay.VersionID != *pushed.VersionID {
		t.Fatal("push replay created another commit")
	}
	checkMatch(open(a, personalOwner, doc), open(b, teamOwner, linkedFiles["Brief"].ID))
	checkMatch(open(a, personalOwner, board), open(b, teamOwner, linkedFiles["Roadmap"].ID))
	if open(b, teamOwner, isolated["Brief"].ID).Hash != beforeIsolated || open(b, teamOwner, linkedFiles["Review"].ID).Document.Name != "Team Slides" {
		t.Fatal("push overwrote an independent copy or unresolved conflict")
	}
	pull := document.ProjectSyncRequest{RequestID: uuid.New(), Token: preview().Token, Direction: "pull", Resolve: []uuid.UUID{conflict}}
	if result := clusterJSON[document.ProjectAction](t, client, b, personalOwner, "POST", syncRoute, pull, 200); result.Files != 2 {
		t.Fatalf("pull did not apply the sheet and chosen slide: %+v", result)
	}
	checkMatch(open(a, personalOwner, book), open(b, teamOwner, linkedFiles["Budget"].ID))
	checkMatch(open(a, personalOwner, slides), open(b, teamOwner, linkedFiles["Review"].ID))
	if len(preview().Changes) != 0 {
		t.Fatal("both sides should be up to date")
	}
	newPersonal := create(personal, "docs", "New Checklist")
	newPush := document.ProjectSyncRequest{RequestID: uuid.New(), Token: preview().Token, Direction: "push"}
	clusterJSON[document.ProjectAction](t, client, a, personalOwner, "POST", syncRoute, newPush, 200)
	teamChecklist := filesIn(b, teamOwner, linked)["New Checklist"]
	checkMatch(open(a, personalOwner, newPersonal), open(b, teamOwner, teamChecklist.ID))
	clusterJSON[map[string]any](t, client, a, personalOwner, "DELETE", "/api/rooms/"+newPersonal, nil, 200)
	reverse := projectPath(linked) + "/sync/" + personal.String()
	removal := clusterJSON[document.ProjectSyncPreview](t, client, b, personalOwner, "GET", reverse, nil, 200)
	if len(removal.Changes) != 1 || removal.Changes[0].State != "incoming" || removal.Changes[0].Linked != nil {
		t.Fatalf("Team-side preview did not show the removed source file: %+v", removal)
	}
	clusterJSON[document.ProjectAction](t, client, b, personalOwner, "POST", reverse,
		document.ProjectSyncRequest{RequestID: uuid.New(), Token: removal.Token, Direction: "pull"}, 200)
	if archived := filesIn(a, teamOwner, linked)["New Checklist"]; archived.ID != teamChecklist.ID ||
		archived.ArchivedAt == nil || len(preview().Changes) != 0 {
		t.Fatal("sync removal should archive the existing copy and settle the change")
	}
	t.Log("batched push and pull, cross-instance editor refresh, conflict resolution, stale rejection and replay verified")

	history := projectPath(linked) + "/versions"
	saved := clusterJSON[document.ProjectAction](t, client, b, teamOwner, "POST", history,
		document.ProjectVersionRequest{RequestID: uuid.New(), Name: "Before archive"}, 201)
	if saved.VersionID == nil {
		t.Fatal("snapshot missing")
	}
	deleteID := linkedFiles["Roadmap"].ID
	clusterJSON[map[string]any](t, client, b, teamOwner, "DELETE", "/api/rooms/"+deleteID, nil, 200)
	newID := create(linked, "docs", "Later Notes")
	restoring := history + "/" + saved.VersionID.String() + "/restore"
	restorePreview := clusterJSON[document.ProjectRestorePreview](t, client, a, teamOwner, "GET", restoring, nil, 200)
	if len(restorePreview.Changes) != 2 || !slices.ContainsFunc(restorePreview.Changes, func(item document.ProjectRestoreChange) bool {
		return item.Name == "Roadmap" && item.Action == "recreate"
	}) {
		t.Fatalf("restore preview omitted missing or later files: %+v", restorePreview)
	}
	restored := clusterJSON[document.ProjectAction](t, client, a, teamOwner, "POST", restoring,
		document.ProjectRestoreRequest{RequestID: uuid.New(), Token: restorePreview.Token}, 200)
	after := filesIn(b, teamOwner, linked)
	if restored.Files != 2 || after["Roadmap"].ID == deleteID || after["Later Notes"].ID != newID || after["Later Notes"].ArchivedAt == nil {
		t.Fatalf("restore did not recreate the removed file and archive the later file: %+v", restored)
	}
	checkImage(teamOwner, after["Roadmap"].ID)
	versions := clusterJSON[document.ProjectVersionList](t, client, b, teamOwner, "GET", history, nil, 200)
	if !slices.ContainsFunc(versions.Versions, func(v document.ProjectVersion) bool { return v.Kind == "before_restore" }) {
		t.Fatal("restore did not retain the previous project state")
	}

	memberPath := projectPath(linked) + "/members/" + actor.String()
	clusterJSON[map[string]any](t, client, b, teamOwner, "DELETE", memberPath, nil, 200)
	clusterJSON[map[string]any](t, client, a, personalOwner, "GET", history, nil, 404)
	clusterJSON[map[string]any](t, client, a, personalOwner, "GET", syncRoute, nil, 404)
	clusterJSON[map[string]any](t, client, a, personalOwner, "POST", syncRoute, push, 404)
	if len(links(a, personalOwner, personal)) != 0 {
		t.Fatal("revoked branch still listed")
	}
	clusterJSON[map[string]any](t, client, b, teamOwner, "PUT", memberPath, map[string]string{"role": "manager"}, 200)
	clusterJSON[map[string]any](t, client, a, teamOwner, "DELETE", teamPath+"/members/"+actor.String(), nil, 200)
	clusterJSON[map[string]any](t, client, b, personalOwner, "POST", importRoute, linkedInput, 404)
	clusterJSON[map[string]any](t, client, b, personalOwner, "GET", filePath(after["Roadmap"].ID)+"/snapshot", nil, 403)
	if len(links(b, personalOwner, personal)) != 0 || !strings.Contains(string(open(b, personalOwner, doc).Document.Pages[0]), "Reviewed scope") {
		t.Fatal("offboarding should remove the link while preserving the personal project")
	}
	if owned := filesIn(a, teamOwner, linked); len(owned) != 7 {
		t.Fatalf("the Team lost files after offboarding the importer: %d", len(owned))
	}
	t.Log("project restore, saved images, project revocation and Team offboarding verified")
}
