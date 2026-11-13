package tests

import (
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/config"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/model"
	"github.com/xiaotwu/shiori/server/internal/sheetformat"
)

func TestSheetsCluster(t *testing.T) {
	if config.Env("SHIORI_CLUSTER_SHEETS") != "1" {
		t.Skip("requires two isolated local Shiori API replicas")
	}
	a, b, dsn := config.Env("SHIORI_CLUSTER_PRIMARY"), config.Env("SHIORI_CLUSTER_SECONDARY"), config.Env("SHIORI_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 8 * time.Second}
	owner, _ := registerClusterUser(t, client, a, "Sheets owner")
	editor, editorEmail := registerClusterUser(t, client, b, "Sheets editor")
	viewer, viewerEmail := registerClusterUser(t, client, a, "Sheets viewer")
	outsider, _ := registerClusterUser(t, client, b, "Another team")
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
		return clusterJSON[model.DirectoryBoard](t, client, base, token, "POST", api+"/projects/"+project.String()+"/sheets",
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

	personal := create(a, owner, directory(a, owner).Projects[0].ID, tag+" Personal Sheet", 201)
	if personal.Kind != "sheet" || open(b, owner, personal.ID, 200).Permission != "owner" {
		t.Fatalf("invalid personal spreadsheet: %+v", personal)
	}
	open(b, editor, personal.ID, 403)

	team := clusterJSON[model.Organization](t, client, a, owner, "POST", api+"/organizations", map[string]string{"name": "Sheets Team"}, 201)
	other := clusterJSON[model.Organization](t, client, b, outsider, "POST", api+"/organizations", map[string]string{"name": "Unrelated Team"}, 201)
	dir := directory(b, owner)
	workspace := slices.IndexFunc(dir.Workspaces, func(item model.Workspace) bool { return item.OrganizationID == team.ID })
	if workspace < 0 {
		t.Fatal("team workspace not found")
	}
	project := clusterJSON[model.Project](t, client, a, owner, "POST", api+"/workspaces/"+dir.Workspaces[workspace].ID.String()+"/projects",
		map[string]string{"name": "Planning"}, 201)
	projectPath := api + "/projects/" + project.ID.String()
	teamPath := api + "/teams/" + team.ID.String()
	grant := func(token, email, role string) uuid.UUID {
		t.Helper()
		person := clusterJSON[struct{ User model.User }](t, client, b, token, "GET", "/api/me", nil, 200).User.ID
		invite := clusterJSON[model.TeamInvitation](t, client, a, owner, "POST", teamPath+"/invitations",
			map[string]string{"email": email, "role": "member"}, 201)
		clusterJSON[map[string]any](t, client, b, token, "POST", teamPath+"/invitations/accept", map[string]string{"token": invite.Token}, 200)
		clusterJSON[map[string]any](t, client, a, owner, "PUT", projectPath+"/members/"+person.String(), map[string]string{"role": role}, 200)
		return person
	}
	editorID := grant(editor, editorEmail, "edit")
	grant(viewer, viewerEmail, "view")
	if created := create(b, editor, project.ID, "Team Estimates", 201); created.Permission != "edit" || created.ProjectID == nil || *created.ProjectID != project.ID {
		t.Fatalf("team sheet ownership: %+v", created)
	}
	create(b, viewer, project.ID, "Denied", 404)
	upload := func(base, token, name, format string, data []byte, status int) model.DirectoryBoard {
		t.Helper()
		params := url.Values{"name": {name}, "format": {format}}
		response := fileClusterRequest(client, base, token, "POST", projectPath+"/sheets/import?"+params.Encode(), data,
			map[string]string{"Content-Type": "application/octet-stream"})
		if response.err != nil || response.status != status {
			t.Fatalf("spreadsheet import: %d %s %v", response.status, response.body, response.err)
		}
		var item model.DirectoryBoard
		if status == 201 && json.Unmarshal(response.body, &item) != nil {
			t.Fatalf("invalid spreadsheet import response: %s", response.body)
		}
		return item
	}
	board := clusterJSON[model.DirectoryBoard](t, client, a, owner, "POST", projectPath+"/boards", map[string]string{"name": "Roadmap"}, 201)
	original := "原始" + tag
	book := upload(a, owner, tag+" Budget", "csv", []byte(original+",7319421,/board/"+board.ID+"\n"), 201)
	upload(b, viewer, "Denied Import", "csv", []byte("test"), 404)
	upload(b, owner, "Invalid Import", "xlsx", []byte("not a workbook"), 400)
	if listed := directory(b, editor); !slices.ContainsFunc(listed.Sheets, func(item model.DirectoryBoard) bool { return item.ID == book.ID }) ||
		slices.ContainsFunc(listed.Boards, func(item model.DirectoryBoard) bool { return item.ID == book.ID }) {
		t.Fatalf("spreadsheet directory entry missing or mistyped: %+v", listed)
	}
	base := open(b, editor, book.ID, 200)
	if base.ResourceKind != "sheet" || base.Permission != "edit" || len(base.Document.Pages) != 1 || len(base.Document.Elements) != 3 {
		t.Fatalf("invalid imported snapshot: %+v", base)
	}
	tab := base.Document.DefaultPageID
	bookPath := api + "/boards/" + book.ID
	browserPath := "/sheet/" + book.ID
	sourceURL := func(address string) string {
		return browserPath + "?" + (url.Values{"sheet": {tab}, "cell": {address}}).Encode()
	}
	hasCell := func(hits []model.SearchResult, address string) bool {
		return slices.ContainsFunc(hits, func(hit model.SearchResult) bool {
			return hit.Kind == "content" && hit.ResourceKind == "sheet" && hit.URL == sourceURL(address) &&
				strings.HasSuffix(hit.Context, "Sheet1!"+address)
		})
	}
	if hits := find(b, viewer, original, team.ID.String(), 200); !hasCell(hits, "A1") {
		t.Fatalf("cell source missing: %+v", hits)
	}
	if hits := find(a, outsider, original, other.ID.String(), 200); len(hits) != 0 {
		t.Fatalf("another Team saw a spreadsheet cell: %+v", hits)
	}
	find(a, outsider, original, team.ID.String(), 404)
	graphPath := workshop + "/teams/" + team.ID.String() + "/graph"
	graph := clusterJSON[model.TeamGraph](t, client, b, editor, "GET", graphPath, nil, 200)
	if !slices.Contains(graph.Edges, model.TeamGraphEdge{From: "resource:" + book.ID, To: "resource:" + board.ID, Kind: "references"}) ||
		!slices.ContainsFunc(graph.Nodes, func(node model.TeamGraphNode) bool { return node.URL == browserPath }) {
		t.Fatalf("spreadsheet graph reference missing: %+v", graph)
	}

	edit := func(address, input, kind, previous, previousKind string) map[string]any {
		return map[string]any{"kind": "setCell", "collection": "elements", "id": tab + ":" + address,
			"value":    map[string]string{"pageId": tab, "address": address, "input": input, "valueType": kind},
			"expected": map[string]string{"input": previous, "valueType": previousKind}}
	}
	firstFormula := edit("D1", "=B1*2", "formula", "", "")
	formulas := clusterCommand(uuid.NewString(), base.Epoch, base.Seq, firstFormula)
	formulas["operations"] = []map[string]any{firstFormula, edit("E1", "=SUM(D1,1)", "formula", "", "")}
	clusterJSON[map[string]any](t, client, b, viewer, "POST", bookPath+"/commands", formulas, 403)
	seed := clusterJSON[document.Ack](t, client, a, owner, "POST", bookPath+"/commands", formulas, 200)
	version := clusterJSON[document.VersionSummary](t, client, a, owner, "POST", bookPath+"/versions",
		map[string]any{"name": "Starting budget", "expectedEpoch": seed.Epoch, "expectedSeq": seed.Seq}, 201)
	live := clusterSocket(t, b, editor, "/ws/v2")
	writeSocket(t, live, "subscribe", map[string]any{"boardId": book.ID, "epoch": seed.Epoch, "afterSeq": seed.Seq})
	readSocket(t, live, "subscribed")
	changed := "更新" + tag
	left := clusterCommand(uuid.NewString(), seed.Epoch, seed.Seq, edit("B1", "7319941", "number", "7319421", "number"))
	right := clusterCommand(uuid.NewString(), seed.Epoch, seed.Seq, edit("A1", changed, "text", original, "text"))
	for _, result := range concurrentCommands(t, client, bookPath, a, owner, left, b, editor, right) {
		if result.status != 200 {
			t.Fatalf("concurrent worksheet edit: %d %s", result.status, result.body)
		}
	}
	readSocket(t, live, "document_changed")
	current := open(b, editor, book.ID, 200)
	if current.Seq != seed.Seq+2 || current.Hash != open(a, owner, book.ID, 200).Hash {
		t.Fatal("replicas disagree after concurrent edits")
	}
	clusterJSON[map[string]any](t, client, b, editor, "POST", bookPath+"/commands",
		clusterCommand(uuid.NewString(), seed.Epoch, seed.Seq, edit("B1", "123", "number", "7319421", "number")), 409)
	if !hasCell(find(a, editor, changed, "", 200), "A1") || !hasCell(find(b, editor, "14639883", "", 200), "E1") ||
		len(find(b, viewer, "14638843", "", 200)) != 0 || len(find(b, viewer, original, "", 200)) != 0 {
		t.Fatal("search did not atomically replace edited cells and formula results")
	}
	t.Log("verified personal and Team creation, role restrictions, simultaneous independent cells, same-cell conflict, formula recalculation and anchored search")

	exportPath := api + "/sheets/" + book.ID + "/export"
	csv := fileClusterRequest(client, b, editor, "GET", exportPath+"?format=csv&sheet="+tab, nil, nil)
	xlsx := fileClusterRequest(client, a, viewer, "GET", exportPath+"?format=xlsx", nil, nil)
	roundTrip, err := sheetformat.ReadXLSX(xlsx.body)
	if csv.err != nil || csv.status != 200 || !strings.Contains(string(csv.body), "14639882,14639883") ||
		xlsx.err != nil || xlsx.status != 200 || err != nil || len(roundTrip) != 1 ||
		roundTrip[0].Cells[sheetformat.Address{Row: 1, Col: 5}].Input != "=SUM(D1,1)" {
		t.Fatalf("CSV/XLSX export failed: %d %d %v", csv.status, xlsx.status, err)
	}
	copy := upload(b, editor, "XLSX Round Trip", "xlsx", xlsx.body, 201)
	if imported := open(a, owner, copy.ID, 200); imported.ResourceKind != "sheet" || len(imported.Document.Elements) != 5 {
		t.Fatalf("XLSX import failed: %+v", imported)
	}
	cleared := clusterJSON[document.Ack](t, client, b, editor, "POST", bookPath+"/commands",
		clusterCommand(uuid.NewString(), current.Epoch, current.Seq, edit("A1", "", "", changed, "text")), 200)
	if hits := find(a, editor, changed, "", 200); slices.ContainsFunc(hits, func(hit model.SearchResult) bool { return hit.ID == book.ID }) {
		t.Fatalf("cleared cell stayed indexed: %+v", hits)
	}
	copied := clusterJSON[document.VersionBoardState](t, client, a, owner, "POST", bookPath+"/versions/"+version.ID.String()+"/copy",
		map[string]string{"name": "Copied workbook"}, 201)
	if snapshot := open(b, owner, copied.BoardID, 200); snapshot.ResourceKind != "sheet" || len(snapshot.Document.Elements) != 5 {
		t.Fatalf("version copy lost spreadsheet data: %+v", snapshot)
	}
	restored := clusterJSON[document.VersionRestore](t, client, a, owner, "POST", bookPath+"/versions/"+version.ID.String()+"/restore",
		map[string]any{"requestId": uuid.NewString(), "expectedEpoch": cleared.Epoch, "expectedSeq": cleared.Seq}, 200)
	if !hasCell(find(b, editor, original, team.ID.String(), 200), "A1") ||
		!hasCell(find(b, editor, "14638843", team.ID.String(), 200), "E1") {
		t.Fatal("version restore did not recover the cell and formula index")
	}
	t.Log("verified graph references, CSV and XLSX round trip, clear and restore reindexing, and version copy")

	recentPath := workshop + "/recents"
	clusterJSON[map[string]any](t, client, b, editor, "PUT", recentPath+"/"+book.ID, nil, 200)
	recents := func(base string) []model.RecentResource {
		t.Helper()
		return clusterJSON[struct{ Items []model.RecentResource }](t, client, base, editor, "GET", recentPath, nil, 200).Items
	}
	if list := recents(a); len(list) != 1 || list[0].URL != browserPath {
		t.Fatalf("incorrect spreadsheet Recents link: %+v", list)
	}
	revoked := clusterSocket(t, b, editor, "/ws/v2")
	writeSocket(t, revoked, "subscribe", map[string]any{"boardId": book.ID, "epoch": restored.Epoch, "afterSeq": restored.Seq})
	readSocket(t, revoked, "subscribed")
	clusterJSON[map[string]any](t, client, a, owner, "DELETE", projectPath+"/members/"+editorID.String(), nil, 200)
	if err := revoked.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for {
		_, _, err := revoked.ReadMessage()
		if err == nil {
			continue
		}
		if timeout, ok := err.(interface{ Timeout() bool }); ok && timeout.Timeout() {
			t.Fatal("revoked spreadsheet subscription remained open")
		}
		break
	}
	open(b, editor, book.ID, 403)
	clusterJSON[map[string]any](t, client, b, editor, "POST", bookPath+"/commands", left, 403)
	clusterJSON[map[string]any](t, client, b, editor, "GET", bookPath+"/versions", nil, 403)
	if result := fileClusterRequest(client, b, editor, "GET", exportPath+"?format=xlsx", nil, nil); result.err != nil || result.status != 403 {
		t.Fatalf("revoked workbook export: %d %v", result.status, result.err)
	}
	after := clusterJSON[model.TeamGraph](t, client, b, editor, "GET", graphPath, nil, 200)
	if hits := find(b, editor, original, team.ID.String(), 200); len(hits) != 0 || len(recents(b)) != 0 ||
		slices.ContainsFunc(after.Nodes, func(node model.TeamGraphNode) bool { return node.URL == browserPath }) {
		t.Fatalf("revoked workbook remained discoverable: %+v", hits)
	}
	t.Log("verified revocation across replicas closes the socket and removes read, write, history, export, search, graph and Recents access")
}
