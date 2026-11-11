package tests

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/project-wb/server/internal/docformat"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/model"
)

func TestDocsCluster(t *testing.T) {
	if os.Getenv("OPENJAM_CLUSTER_DOCS") != "1" {
		t.Skip("requires two isolated local OpenJam API replicas")
	}
	a, b, dsn := os.Getenv("OPENJAM_CLUSTER_PRIMARY"), os.Getenv("OPENJAM_CLUSTER_SECONDARY"), os.Getenv("OPENJAM_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 8 * time.Second}
	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
	owner, _ := registerClusterUser(t, client, a, "Docs owner")
	editor, editorEmail := registerClusterUser(t, client, b, "Docs editor")
	viewer, viewerEmail := registerClusterUser(t, client, b, "Docs viewer")
	outsider, _ := registerClusterUser(t, client, a, "Another Team")

	const v2 = "/api/v2"
	const workshop = v2 + "/workshop"
	directory := func(base, token string) model.Directory {
		t.Helper()
		return clusterJSON[model.Directory](t, client, base, token, "GET", v2+"/directory", nil, 200)
	}
	create := func(base, token string, project uuid.UUID, name string, status int) model.DirectoryBoard {
		t.Helper()
		return clusterJSON[model.DirectoryBoard](t, client, base, token, "POST", v2+"/projects/"+project.String()+"/docs",
			map[string]string{"name": name}, status)
	}
	personal := directory(a, owner).Projects[0].ID
	personalDoc := create(a, owner, personal, tag+" Private Notes", 201)
	if personalDoc.Kind != "doc" || personalDoc.Permission != "owner" {
		t.Fatalf("personal document: %+v", personalDoc)
	}
	clusterJSON[map[string]any](t, client, b, editor, "GET", v2+"/boards/"+personalDoc.ID+"/snapshot", nil, 403)

	team := clusterJSON[model.Organization](t, client, a, owner, "POST", v2+"/organizations", map[string]string{"name": "Docs Team"}, 201)
	other := clusterJSON[model.Organization](t, client, b, outsider, "POST", v2+"/organizations", map[string]string{"name": "Isolated Team"}, 201)
	dir := directory(b, owner)
	workspaceIndex := slices.IndexFunc(dir.Workspaces, func(item model.Workspace) bool { return item.OrganizationID == team.ID })
	if workspaceIndex < 0 {
		t.Fatal("Team workspace missing")
	}
	project := clusterJSON[model.Project](t, client, a, owner, "POST", v2+"/workspaces/"+dir.Workspaces[workspaceIndex].ID.String()+"/projects",
		map[string]string{"name": "Release Project"}, 201)
	projectPath := v2 + "/projects/" + project.ID.String()
	teamPath := v2 + "/teams/" + team.ID.String()
	member := func(token, email, role string) uuid.UUID {
		t.Helper()
		person := clusterJSON[struct{ User model.User }](t, client, b, token, "GET", "/api/me", nil, 200).User.ID
		invite := clusterJSON[model.TeamInvitation](t, client, a, owner, "POST", teamPath+"/invitations",
			map[string]string{"email": email, "role": "member"}, 201)
		clusterJSON[map[string]any](t, client, b, token, "POST", teamPath+"/invitations/accept", map[string]string{"token": invite.Token}, 200)
		clusterJSON[map[string]any](t, client, a, owner, "PUT", projectPath+"/members/"+person.String(),
			map[string]string{"role": role}, 200)
		return person
	}
	editorID := member(editor, editorEmail, "edit")
	viewerID := member(viewer, viewerEmail, "view")
	blank := create(b, editor, project.ID, "Shared Scratchpad", 201)
	if blank.Permission != "edit" || blank.ProjectID == nil || *blank.ProjectID != project.ID {
		t.Fatalf("Team editor created an incorrectly owned document: %+v", blank)
	}
	create(b, viewer, project.ID, "Denied", 404)
	create(b, outsider, project.ID, "Denied", 404)
	board := clusterJSON[model.DirectoryBoard](t, client, a, owner, "POST", projectPath+"/boards", map[string]string{"name": "Launch Board"}, 201)

	upload := func(base, token, name, format string, data []byte, status int) model.DirectoryBoard {
		t.Helper()
		params := url.Values{"name": {name}, "format": {format}}
		response := fileClusterRequest(client, base, token, "POST", projectPath+"/docs/import?"+params.Encode(), data,
			map[string]string{"Content-Type": "application/octet-stream"})
		if response.err != nil || response.status != status {
			t.Fatalf("%s import: %d %s %v", format, response.status, response.body, response.err)
		}
		var item model.DirectoryBoard
		if status == 201 && json.Unmarshal(response.body, &item) != nil {
			t.Fatalf("unexpected import response: %s", response.body)
		}
		return item
	}
	original := "Original " + tag + " 初始 /board/" + board.ID
	originalSecond := "Release checklist **owners**"
	doc := upload(a, owner, tag+" Release Plan", "md", []byte(original+"\n\n"+originalSecond+"\n"), 201)
	upload(b, viewer, "Denied import", "md", []byte("x"), 404)
	upload(b, owner, "Invalid import", "docx", []byte("x"), 400)
	docPath := v2 + "/boards/" + doc.ID
	open := func(base, token, id string, status int) document.Snapshot {
		t.Helper()
		return clusterJSON[document.Snapshot](t, client, base, token, "GET", v2+"/boards/"+id+"/snapshot", nil, status)
	}
	base := open(b, editor, doc.ID, 200)
	if base.ResourceKind != "doc" || base.Permission != "edit" || len(base.Document.Pages) != 2 || len(base.Document.Elements) != 0 {
		t.Fatalf("imported snapshot: %+v", base)
	}
	if read := open(a, viewer, doc.ID, 200); read.Permission != "view" || read.Hash != base.Hash {
		t.Fatal("viewer did not see the same document snapshot")
	}
	docPage := func(raw json.RawMessage) (page struct {
		ID, Text, FontFamily string
	}) {
		t.Helper()
		if err := json.Unmarshal(raw, &page); err != nil || page.ID == "" {
			t.Fatalf("invalid block: %s %v", raw, err)
		}
		return page
	}
	first, second := docPage(base.Document.Pages[0]), docPage(base.Document.Pages[1])
	find := func(baseURL, token, query, scope string, status int) []model.SearchResult {
		t.Helper()
		values := url.Values{"q": {query}}
		if scope != "" {
			values.Set("team", scope)
		}
		return clusterJSON[struct{ Results []model.SearchResult }](t, client, baseURL, token, "GET",
			workshop+"/search?"+values.Encode(), nil, status).Results
	}
	hasContent := func(hits []model.SearchResult, item, block string) bool {
		return slices.ContainsFunc(hits, func(hit model.SearchResult) bool {
			return hit.ID == item && hit.ResourceKind == "doc" && hit.Kind == "content" && hit.URL == "/doc/"+item+"?block="+block
		})
	}
	if hits := find(b, editor, "初始", team.ID.String(), 200); !hasContent(hits, doc.ID, first.ID) {
		t.Fatalf("missing Doc source anchor: %+v", hits)
	}
	if hits := find(b, editor, tag+" Release Plan", team.ID.String(), 200); !slices.ContainsFunc(hits, func(hit model.SearchResult) bool {
		return hit.Kind == "file" && hit.ResourceKind == "doc" && hit.URL == "/doc/"+doc.ID
	}) {
		t.Fatalf("missing Doc file result: %+v", hits)
	}
	if hits := find(b, outsider, tag, other.ID.String(), 200); len(hits) != 0 {
		t.Fatalf("other Team saw a private Doc: %+v", hits)
	}
	find(a, outsider, tag, team.ID.String(), 404)
	if listed := directory(b, editor); !slices.ContainsFunc(listed.Docs, func(item model.DirectoryBoard) bool { return item.ID == doc.ID }) ||
		slices.ContainsFunc(listed.Boards, func(item model.DirectoryBoard) bool { return item.ID == doc.ID }) {
		t.Fatalf("Doc appeared in the wrong project collection: %+v", listed)
	}

	boardSnap := open(a, owner, board.ID, 200)
	linked := map[string]any{"id": "doc-ref", "pageId": boardSnap.Document.DefaultPageID, "type": "sticky", "x": 1, "y": 2,
		"width": 210, "height": 120, "color": "yellow", "fontSize": 16, "zIndex": 1, "rotation": 0, "opacity": 1,
		"text": "See /doc/" + doc.ID}
	clusterJSON[document.Ack](t, client, a, owner, "POST", v2+"/boards/"+board.ID+"/commands",
		clusterCommand(uuid.NewString(), boardSnap.Epoch, boardSnap.Seq, map[string]any{"kind": "add", "collection": "elements", "id": "doc-ref", "value": linked}), 200)
	graphPath := workshop + "/teams/" + team.ID.String() + "/graph"
	graph := clusterJSON[model.TeamGraph](t, client, b, editor, "GET", graphPath, nil, 200)
	if !slices.Contains(graph.Edges, model.TeamGraphEdge{From: "resource:" + doc.ID, To: "resource:" + board.ID, Kind: "references"}) ||
		!slices.Contains(graph.Edges, model.TeamGraphEdge{From: "resource:" + board.ID, To: "resource:" + doc.ID, Kind: "references"}) ||
		!slices.ContainsFunc(graph.Nodes, func(node model.TeamGraphNode) bool {
			return node.ID == "resource:"+doc.ID && node.URL == "/doc/"+doc.ID
		}) {
		t.Fatalf("missing Board and Doc reference edges: %+v", graph)
	}
	t.Log("verified private and Team creation, project roles, Markdown import, directory, anchored search and two-way references")

	version := clusterJSON[document.VersionSummary](t, client, a, owner, "POST", docPath+"/versions",
		map[string]any{"name": "Review checkpoint", "expectedEpoch": base.Epoch, "expectedSeq": base.Seq}, 201)
	editorSocket := clusterSocket(t, b, editor, "/ws/v2")
	writeSocket(t, editorSocket, "subscribe", map[string]any{"boardId": doc.ID, "epoch": base.Epoch, "afterSeq": base.Seq})
	readSocket(t, editorSocket, "subscribed")
	edit := func(id, before, after string) map[string]any {
		return map[string]any{"kind": "patch", "collection": "pages", "id": id,
			"fields": map[string]string{"text": after}, "expected": map[string]string{"text": before}}
	}
	newText := "Updated " + tag + " 发布"
	newSecond := "Editor confirmed **owners**"
	left := clusterCommand(uuid.NewString(), base.Epoch, base.Seq, edit(first.ID, first.Text, newText))
	right := clusterCommand(uuid.NewString(), base.Epoch, base.Seq, edit(second.ID, second.Text, newSecond))
	clusterJSON[map[string]any](t, client, b, viewer, "POST", docPath+"/commands", right, 403)
	for _, response := range concurrentCommands(t, client, docPath, a, owner, left, b, editor, right) {
		if response.status != 200 {
			t.Fatalf("simultaneous Doc blocks: %d %s", response.status, response.body)
		}
	}
	readSocket(t, editorSocket, "document_changed")
	current := open(b, editor, doc.ID, 200)
	if current.Seq != base.Seq+2 || docPage(current.Document.Pages[0]).Text != newText || docPage(current.Document.Pages[1]).Text != newSecond ||
		open(a, owner, doc.ID, 200).Hash != current.Hash {
		t.Fatalf("replicas lost a concurrent edit: %+v", current)
	}
	stale := clusterCommand(uuid.NewString(), base.Epoch, base.Seq, edit(first.ID, first.Text, "stale overwrite"))
	clusterJSON[map[string]any](t, client, b, editor, "POST", docPath+"/commands", stale, 409)
	if hits := find(b, viewer, "初始", "", 200); len(hits) != 0 {
		t.Fatalf("index returned previous content: %+v", hits)
	}
	if hits := find(a, editor, "发布", team.ID.String(), 200); !hasContent(hits, doc.ID, first.ID) {
		t.Fatalf("second replica did not index saved text: %+v", hits)
	}

	exportPath := v2 + "/docs/" + doc.ID + "/export"
	exported := fileClusterRequest(client, b, editor, "GET", exportPath+"?format=md", nil, nil)
	if exported.err != nil || exported.status != 200 || !strings.Contains(string(exported.body), newText) {
		t.Fatalf("Markdown export: %d %s %v", exported.status, exported.body, exported.err)
	}
	word := fileClusterRequest(client, a, viewer, "GET", exportPath+"?format=docx", nil, nil)
	blocks, err := docformat.ReadDOCX(word.body, a)
	if word.err != nil || word.status != 200 || err != nil || len(blocks) != 2 || !strings.Contains(blocks[1].Text, "**owners**") {
		t.Fatalf("Word export: status %d, %v %v %+v", word.status, word.err, err, blocks)
	}
	wordCopy := upload(b, editor, "Word Round Trip", "docx", word.body, 201)
	if snap := open(a, owner, wordCopy.ID, 200); snap.ResourceKind != "doc" || docPage(snap.Document.Pages[0]).Text != newText {
		t.Fatalf("Word import did not preserve the exported Doc: %+v", snap)
	}
	copied := clusterJSON[document.VersionBoardState](t, client, a, owner, "POST", docPath+"/versions/"+version.ID.String()+"/copy",
		map[string]string{"name": "Copied Doc"}, 201)
	if snapshot := open(b, owner, copied.BoardID, 200); snapshot.ResourceKind != "doc" || docPage(snapshot.Document.Pages[0]).Text != original {
		t.Fatalf("version copy became a board or lost data: %+v", snapshot)
	}
	restored := clusterJSON[document.VersionRestore](t, client, a, owner, "POST", docPath+"/versions/"+version.ID.String()+"/restore",
		map[string]any{"requestId": uuid.NewString(), "expectedEpoch": current.Epoch, "expectedSeq": current.Seq}, 200)
	if hits := find(b, editor, "初始", team.ID.String(), 200); !hasContent(hits, doc.ID, first.ID) {
		t.Fatalf("restore did not replace the search index: %+v", hits)
	}
	t.Log("verified simultaneous block edits and live wake-up, same-block conflict, indexed updates, format round trip, and restored version")

	recent := workshop + "/recents"
	clusterJSON[map[string]any](t, client, b, editor, "PUT", recent+"/"+doc.ID, nil, 200)
	recentItems := func(token string) []model.RecentResource {
		t.Helper()
		return clusterJSON[struct{ Items []model.RecentResource }](t, client, a, token, "GET", recent, nil, 200).Items
	}
	if list := recentItems(editor); len(list) != 1 || list[0].URL != "/doc/"+doc.ID {
		t.Fatalf("Recents pointed to the wrong file: %+v", list)
	}
	mention := uuid.NewString()
	clusterJSON[map[string]any](t, client, b, owner, "POST", docPath+"/review/threads", map[string]any{
		"requestId": mention, "body": "Review the draft", "mentionUserIds": []string{editorID.String()},
		"anchor": map[string]any{"pageId": first.ID},
	}, 200, 201)
	inbox := clusterJSON[model.WorkshopInbox](t, client, a, editor, "GET", workshop+"/inbox", nil, 200)
	if len(inbox.Mentions) != 1 || inbox.Mentions[0].URL != "/doc/"+doc.ID+"?thread="+mention {
		t.Fatalf("Doc mention did not link to its review: %+v", inbox.Mentions)
	}
	live := clusterSocket(t, b, editor, "/ws/v2")
	writeSocket(t, live, "subscribe", map[string]any{"boardId": doc.ID, "epoch": restored.Epoch, "afterSeq": restored.Seq})
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
			t.Fatal("revoked Doc subscription remained open")
		}
		break
	}
	open(b, editor, doc.ID, 403)
	clusterJSON[map[string]any](t, client, b, editor, "GET", docPath+"/versions", nil, 403)
	clusterJSON[map[string]any](t, client, b, editor, "POST", docPath+"/commands", left, 403)
	if result := fileClusterRequest(client, b, editor, "GET", exportPath+"?format=docx", nil, nil); result.err != nil || result.status != 403 {
		t.Fatalf("revoked export: %d %v", result.status, result.err)
	}
	if hits := find(b, editor, "初始", team.ID.String(), 200); len(hits) != 0 || len(recentItems(editor)) != 0 {
		t.Fatalf("revoked Doc stayed visible in search or Recents: %+v", hits)
	}
	revokedGraph := clusterJSON[model.TeamGraph](t, client, b, editor, "GET", graphPath, nil, 200)
	if slices.ContainsFunc(revokedGraph.Nodes, func(node model.TeamGraphNode) bool { return node.ID == "resource:"+doc.ID }) {
		t.Fatalf("revoked Doc stayed on the graph: %+v", revokedGraph)
	}
	clusterJSON[map[string]any](t, client, a, owner, "DELETE", teamPath+"/members/"+viewerID.String(), nil, 200)
	find(b, viewer, tag, team.ID.String(), 404)
	open(b, viewer, doc.ID, 403)
	if active := open(a, owner, doc.ID, 200); active.Hash != restored.Hash {
		t.Fatal("offboarding changed the Team's Doc")
	}
	t.Log("verified cross-replica revocation of Doc socket, reads, edits, history, export, search, graph and Recents")
}
