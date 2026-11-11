package tests

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/slideformat"
)

func TestSlidesCluster(t *testing.T) {
	if os.Getenv("OPENJAM_CLUSTER_SLIDES") != "1" {
		t.Skip("requires two isolated local OpenJam API replicas")
	}
	a, b, dsn := os.Getenv("OPENJAM_CLUSTER_PRIMARY"), os.Getenv("OPENJAM_CLUSTER_SECONDARY"), os.Getenv("OPENJAM_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 10 * time.Second}
	owner, _ := registerClusterUser(t, client, a, "Presentation owner")
	editor, editorEmail := registerClusterUser(t, client, b, "Slide editor")
	viewer, viewerEmail := registerClusterUser(t, client, b, "Slide viewer")
	outsider, _ := registerClusterUser(t, client, a, "Outside team")
	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	const api = "/api/v2"
	const workshop = api + "/workshop"
	directory := func(base, token string) model.Directory {
		t.Helper()
		return clusterJSON[model.Directory](t, client, base, token, "GET", api+"/directory", nil, 200)
	}
	open := func(base, token, id string, status int) document.Snapshot {
		t.Helper()
		return clusterJSON[document.Snapshot](t, client, base, token, "GET", api+"/boards/"+id+"/snapshot", nil, status)
	}
	create := func(base, token string, project uuid.UUID, name string, status int) model.DirectoryBoard {
		t.Helper()
		return clusterJSON[model.DirectoryBoard](t, client, base, token, "POST", api+"/projects/"+project.String()+"/slides",
			map[string]string{"name": name}, status)
	}
	find := func(base, token, query, team string, status int) []model.SearchResult {
		t.Helper()
		params := url.Values{"q": {query}}
		if team != "" {
			params.Set("team", team)
		}
		return clusterJSON[struct{ Results []model.SearchResult }](t, client, base, token, "GET",
			workshop+"/search?"+params.Encode(), nil, status).Results
	}

	personal := create(a, owner, directory(a, owner).Projects[0].ID, tag+" Personal Slides", 201)
	if opened := open(b, owner, personal.ID, 200); opened.ResourceKind != "slides" || len(opened.Document.Pages) != 1 || opened.Permission != "owner" {
		t.Fatalf("invalid personal presentation: %+v", opened)
	}
	open(b, editor, personal.ID, 403)
	team := clusterJSON[model.Organization](t, client, a, owner, "POST", api+"/organizations", map[string]string{"name": "Slides Team"}, 201)
	other := clusterJSON[model.Organization](t, client, b, outsider, "POST", api+"/organizations", map[string]string{"name": "Unrelated Team"}, 201)
	dir := directory(b, owner)
	workspace := slices.IndexFunc(dir.Workspaces, func(item model.Workspace) bool { return item.OrganizationID == team.ID })
	if workspace < 0 {
		t.Fatal("team workspace not found")
	}
	project := clusterJSON[model.Project](t, client, a, owner, "POST", api+"/workspaces/"+dir.Workspaces[workspace].ID.String()+"/projects",
		map[string]string{"name": "Studio Plan"}, 201)
	teamPath, projectPath := api+"/teams/"+team.ID.String(), api+"/projects/"+project.ID.String()
	grant := func(token, email, role string) uuid.UUID {
		t.Helper()
		person := clusterJSON[struct{ User model.User }](t, client, b, token, "GET", "/api/me", nil, 200).User.ID
		invitation := clusterJSON[model.TeamInvitation](t, client, a, owner, "POST", teamPath+"/invitations",
			map[string]string{"email": email, "role": "member"}, 201)
		clusterJSON[map[string]any](t, client, b, token, "POST", teamPath+"/invitations/accept", map[string]string{"token": invitation.Token}, 200)
		clusterJSON[map[string]any](t, client, a, owner, "PUT", projectPath+"/members/"+person.String(), map[string]string{"role": role}, 200)
		return person
	}
	editorID := grant(editor, editorEmail, "edit")
	grant(viewer, viewerEmail, "view")
	if created := create(b, editor, project.ID, "Team Presentation", 201); created.Permission != "edit" ||
		created.ProjectID == nil || *created.ProjectID != project.ID {
		t.Fatalf("team presentation has incorrect ownership: %+v", created)
	}
	create(b, viewer, project.ID, "Denied", 404)
	board := clusterJSON[model.DirectoryBoard](t, client, a, owner, "POST", projectPath+"/boards", map[string]string{"name": "Studio Roadmap"}, 201)

	original := "发布计划" + tag
	changed := "更新计划" + tag
	var pngData bytes.Buffer
	imageFixture := image.NewRGBA(image.Rect(0, 0, 64, 48))
	imageFixture.Set(13, 11, color.RGBA{R: 65, G: 105, B: 177, A: 255})
	if err := png.Encode(&pngData, imageFixture); err != nil {
		t.Fatal(err)
	}
	imageMeta, err := assets.Inspect(pngData.Bytes(), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	textBox := func(value string) slideformat.Object {
		return slideformat.Object{Type: "text", Text: value, Box: slideformat.Box{X: 65, Y: 70, Width: 510, Height: 180},
			FontFamily: "Arial", FontSize: 42, FontWeight: "bold", FontStyle: "normal", Color: "#20323f", TextAlign: "left"}
	}
	first, second := slideformat.BlankSlide(), slideformat.BlankSlide()
	first.Objects = []slideformat.Object{textBox("Studio Roadmap /board/" + board.ID)}
	second.Objects = []slideformat.Object{textBox(original), {
		Type: "image", Box: slideformat.Box{X: 650, Y: 75, Width: 448, Height: 336},
		AssetID: imageMeta.ID, OriginalWidth: imageMeta.Width, OriginalHeight: imageMeta.Height, Caption: "Studio artwork",
	}}
	pptx, err := slideformat.WritePPTX([]slideformat.Slide{first, second}, map[string]slideformat.Media{
		imageMeta.ID: {Metadata: imageMeta, Data: pngData.Bytes()},
	})
	if err != nil {
		t.Fatal(err)
	}
	upload := func(base, token, name string, data []byte, status int) model.DirectoryBoard {
		t.Helper()
		response := fileClusterRequest(client, base, token, "POST", projectPath+"/slides/import?"+(url.Values{"name": {name}}).Encode(), data,
			map[string]string{"Content-Type": "application/octet-stream"})
		if response.err != nil || response.status != status {
			t.Fatalf("PPTX import: %d %s %v", response.status, response.body, response.err)
		}
		var item model.DirectoryBoard
		if status == 201 && json.Unmarshal(response.body, &item) != nil {
			t.Fatalf("invalid presentation import response: %s", response.body)
		}
		return item
	}
	deck := upload(a, owner, tag+" Studio Review", pptx, 201)
	upload(b, viewer, "Denied", pptx, 404)
	upload(b, owner, "Malformed", []byte("invalid"), 400)
	if listed := directory(b, editor); !slices.ContainsFunc(listed.Slides, func(item model.DirectoryBoard) bool { return item.ID == deck.ID }) ||
		slices.ContainsFunc(listed.Boards, func(item model.DirectoryBoard) bool { return item.ID == deck.ID }) {
		t.Fatalf("presentation listed under the wrong resource type")
	}
	base := open(b, editor, deck.ID, 200)
	if base.ResourceKind != "slides" || base.Permission != "edit" || len(base.Document.Pages) != 2 || len(base.Document.Elements) != 3 {
		t.Fatalf("invalid imported presentation snapshot: %+v", base)
	}
	var page struct{ ID string }
	if err := json.Unmarshal(base.Document.Pages[1], &page); err != nil || page.ID == "" {
		t.Fatalf("invalid slide page: %v", err)
	}
	var firstText, secondText, picture struct {
		ID string
		X  float64
	}
	for i, item := range []*struct {
		ID string
		X  float64
	}{&firstText, &secondText, &picture} {
		if err := json.Unmarshal(base.Document.Elements[i], item); err != nil || item.ID == "" {
			t.Fatalf("invalid slide object: %v", err)
		}
	}
	browserPath := "/slides/" + deck.ID
	deckPath := api + "/boards/" + deck.ID
	imagePath := deckPath + "/assets/" + imageMeta.ID
	exportPath := api + "/slides/" + deck.ID + "/export"
	asset := fileClusterRequest(client, b, viewer, "GET", imagePath, nil, nil)
	if asset.err != nil || asset.status != 200 || !bytes.Equal(asset.body, pngData.Bytes()) {
		t.Fatalf("authorized embedded image was not available on the other replica: %d %v", asset.status, asset.err)
	}
	if denied := fileClusterRequest(client, b, outsider, "GET", imagePath, nil, nil); denied.err != nil || denied.status != 403 {
		t.Fatalf("another Team could read the embedded image: %d %v", denied.status, denied.err)
	}
	source := browserPath + "?slide=" + page.ID
	hasSource := func(hits []model.SearchResult, ordinal string) bool {
		return slices.ContainsFunc(hits, func(hit model.SearchResult) bool {
			return hit.Kind == "content" && hit.ResourceKind == "slides" && hit.URL == source && strings.HasSuffix(hit.Context, ordinal)
		})
	}
	if !hasSource(find(b, viewer, original, team.ID.String(), 200), "Slide 2") ||
		len(find(b, outsider, original, other.ID.String(), 200)) != 0 {
		t.Fatal("presentation search did not anchor the right slide or isolate teams")
	}
	find(a, outsider, original, team.ID.String(), 404)
	graphPath := workshop + "/teams/" + team.ID.String() + "/graph"
	roadmap := open(a, owner, board.ID, 200)
	linked := map[string]any{"id": "slides-reference", "pageId": roadmap.Document.DefaultPageID, "type": "text", "x": 1, "y": 2, "text": "See " + source}
	clusterJSON[document.Ack](t, client, a, owner, "POST", api+"/boards/"+board.ID+"/commands",
		clusterCommand(uuid.NewString(), roadmap.Epoch, roadmap.Seq, map[string]any{
			"kind": "add", "collection": "elements", "id": "slides-reference", "value": linked,
		}), 200)
	graph := clusterJSON[model.TeamGraph](t, client, b, editor, "GET", graphPath, nil, 200)
	for _, edge := range []model.TeamGraphEdge{
		{From: "resource:" + deck.ID, To: "resource:" + board.ID, Kind: "references"},
		{From: "resource:" + board.ID, To: "resource:" + deck.ID, Kind: "references"},
	} {
		if !slices.Contains(graph.Edges, edge) {
			t.Fatalf("missing presentation graph reference: %+v", edge)
		}
	}
	t.Log("verified personal and Team creation, PNG import and protected access, stable slide links, Team isolation and graph references")

	version := clusterJSON[document.VersionSummary](t, client, a, owner, "POST", deckPath+"/versions",
		map[string]any{"name": "Opening review", "expectedEpoch": base.Epoch, "expectedSeq": base.Seq}, 201)
	socket := clusterSocket(t, b, editor, "/ws/v2")
	writeSocket(t, socket, "subscribe", map[string]any{"boardId": deck.ID, "epoch": base.Epoch, "afterSeq": base.Seq})
	readSocket(t, socket, "subscribed")
	update := func(id, field string, previous, next any) map[string]any {
		return map[string]any{"kind": "patch", "collection": "elements", "id": id,
			"fields": map[string]any{field: next}, "expected": map[string]any{field: previous}}
	}
	left := clusterCommand(uuid.NewString(), base.Epoch, base.Seq, update(secondText.ID, "text", original, changed))
	right := clusterCommand(uuid.NewString(), base.Epoch, base.Seq, update(picture.ID, "x", picture.X, picture.X+60))
	clusterJSON[map[string]any](t, client, b, viewer, "POST", deckPath+"/commands", left, 403)
	for _, result := range concurrentCommands(t, client, deckPath, a, owner, left, b, editor, right) {
		if result.status != 200 {
			t.Fatalf("concurrent slide edits: %d %s", result.status, result.body)
		}
	}
	readSocket(t, socket, "document_changed")
	current := open(b, editor, deck.ID, 200)
	if current.Seq != base.Seq+2 || current.Hash != open(a, owner, deck.ID, 200).Hash {
		t.Fatal("replicas disagree after independent text and picture edits")
	}
	stale := clusterCommand(uuid.NewString(), base.Epoch, base.Seq, update(secondText.ID, "text", original, "stale overwrite"))
	clusterJSON[map[string]any](t, client, b, editor, "POST", deckPath+"/commands", stale, 409)
	if len(find(b, editor, original, "", 200)) != 0 || !hasSource(find(b, editor, changed, "", 200), "Slide 2") {
		t.Fatal("the live search index did not replace the changed slide text")
	}
	third := uuid.NewString()
	added := clusterJSON[document.Ack](t, client, b, editor, "POST", deckPath+"/commands", clusterCommand(uuid.NewString(), current.Epoch, current.Seq,
		map[string]any{"kind": "add", "collection": "pages", "id": third, "value": map[string]any{
			"id": third, "name": "Wrap-up", "slidePage": true, "width": 1280, "height": 720, "background": "#ffffff",
		}}), 200)
	reordered := clusterJSON[document.Ack](t, client, a, owner, "POST", deckPath+"/commands", clusterCommand(uuid.NewString(), added.Epoch, added.Seq,
		map[string]any{"kind": "reorder", "collection": "pages", "id": page.ID, "position": 0,
			"expected": map[string]any{"order": []string{current.Document.DefaultPageID, page.ID, third}},
		}), 200)
	if !hasSource(find(b, viewer, changed, team.ID.String(), 200), "Slide 1") {
		t.Fatal("reorder changed the deep link or left its ordinal stale")
	}
	output := fileClusterRequest(client, b, viewer, "GET", exportPath, nil, nil)
	exported, err := slideformat.ReadPPTX(output.body)
	if output.err != nil || output.status != 200 || err != nil || len(exported.Slides) != 3 ||
		len(exported.Slides[0].Objects) != 2 || exported.Slides[0].Objects[0].Text != changed ||
		exported.Slides[0].Objects[1].X != picture.X+60 || !bytes.Equal(exported.Media[imageMeta.ID].Data, pngData.Bytes()) {
		t.Fatalf("PPTX export lost the order, edited text, or image: %d %v %v", output.status, output.err, err)
	}
	roundTrip := upload(b, editor, "PowerPoint Round Trip", output.body, 201)
	if snapshot := open(a, owner, roundTrip.ID, 200); len(snapshot.Document.Pages) != 3 || snapshot.ResourceKind != "slides" {
		t.Fatalf("PPTX round trip: %+v", snapshot)
	}
	copied := clusterJSON[document.VersionBoardState](t, client, a, owner, "POST", deckPath+"/versions/"+version.ID.String()+"/copy",
		map[string]string{"name": "Copied review"}, 201)
	if result := fileClusterRequest(client, b, owner, "GET", api+"/boards/"+copied.BoardID+"/assets/"+imageMeta.ID, nil, nil); result.err != nil ||
		result.status != 200 || !bytes.Equal(result.body, pngData.Bytes()) {
		t.Fatal("copy of a version lost its private image")
	}
	restored := clusterJSON[document.VersionRestore](t, client, a, owner, "POST", deckPath+"/versions/"+version.ID.String()+"/restore",
		map[string]any{"requestId": uuid.NewString(), "expectedEpoch": reordered.Epoch, "expectedSeq": reordered.Seq}, 200)
	if !hasSource(find(b, editor, original, team.ID.String(), 200), "Slide 2") {
		t.Fatal("restoring a version did not restore its text index and slide position")
	}
	t.Log("verified independent live text/image edits, same-field conflict, slide reorder, PPTX round trip and version restore/copy")

	recentPath := workshop + "/recents"
	clusterJSON[map[string]any](t, client, b, editor, "PUT", recentPath+"/"+deck.ID, nil, 200)
	recents := func() []model.RecentResource {
		t.Helper()
		return clusterJSON[struct{ Items []model.RecentResource }](t, client, b, editor, "GET", recentPath, nil, 200).Items
	}
	if items := recents(); len(items) != 1 || items[0].URL != browserPath {
		t.Fatalf("presentation missing in Recents: %+v", items)
	}
	live := clusterSocket(t, b, editor, "/ws/v2")
	writeSocket(t, live, "subscribe", map[string]any{"boardId": deck.ID, "epoch": restored.Epoch, "afterSeq": restored.Seq})
	readSocket(t, live, "subscribed")
	clusterJSON[map[string]any](t, client, a, owner, "DELETE", projectPath+"/members/"+editorID.String(), nil, 200)
	if err := live.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for {
		_, _, err := live.ReadMessage()
		if err == nil {
			continue
		}
		if timeout, ok := err.(interface{ Timeout() bool }); ok && timeout.Timeout() {
			t.Fatal("revoked presentation subscription remained open")
		}
		break
	}
	open(b, editor, deck.ID, 403)
	clusterJSON[map[string]any](t, client, b, editor, "POST", deckPath+"/commands", left, 403)
	clusterJSON[map[string]any](t, client, b, editor, "GET", deckPath+"/versions", nil, 403)
	for _, path := range []string{imagePath, exportPath} {
		if denied := fileClusterRequest(client, b, editor, "GET", path, nil, nil); denied.err != nil || denied.status != 403 {
			t.Fatalf("revocation did not block a protected file: %d %v", denied.status, denied.err)
		}
	}
	after := clusterJSON[model.TeamGraph](t, client, b, editor, "GET", graphPath, nil, 200)
	if len(find(b, editor, original, team.ID.String(), 200)) != 0 || len(recents()) != 0 ||
		slices.ContainsFunc(after.Nodes, func(node model.TeamGraphNode) bool { return node.ID == "resource:"+deck.ID }) {
		t.Fatal("a revoked presentation stayed discoverable")
	}
	t.Log("verified cross-replica revocation closes live access and removes export, image, history, search, graph and Recents access")
}
