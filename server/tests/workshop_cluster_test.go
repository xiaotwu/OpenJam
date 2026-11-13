package tests

import (
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestWorkshopCluster(t *testing.T) {
	if os.Getenv("OPENJAM_CLUSTER_WORKSHOP") != "1" {
		t.Skip("requires two isolated local Workshop API replicas")
	}
	a, b, dsn := os.Getenv("OPENJAM_CLUSTER_PRIMARY"), os.Getenv("OPENJAM_CLUSTER_SECONDARY"), os.Getenv("OPENJAM_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 8 * time.Second}
	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
	owner, _ := registerClusterUser(t, client, a, tag+" Owner")
	reader, readerEmail := registerClusterUser(t, client, b, tag+" Reader")
	observer, observerEmail := registerClusterUser(t, client, b, "Same Team Observer")
	outsider, _ := registerClusterUser(t, client, a, "Other Team Owner")

	const v2 = "/api/v2"
	const workshop = v2 + "/workshop"
	memberID := clusterJSON[struct{ User model.User }](t, client, b, reader, "GET", "/api/me", nil, 200).User.ID
	addTeam := func(token, name string) model.Organization {
		t.Helper()
		return clusterJSON[model.Organization](t, client, a, token, "POST", v2+"/organizations", map[string]string{"name": name}, 201)
	}
	team := addTeam(owner, "Fixture Team")
	other := addTeam(outsider, "Other Fixture Team")
	teamPath := v2 + "/teams/" + team.ID.String()
	invite := func(token, email string) {
		t.Helper()
		credential := clusterJSON[model.TeamInvitation](t, client, a, owner, "POST", teamPath+"/invitations",
			map[string]string{"email": email, "role": "member"}, 201).Token
		clusterJSON[map[string]any](t, client, b, token, "POST", teamPath+"/invitations/accept", map[string]string{"token": credential}, 200)
	}
	invite(reader, readerEmail)
	invite(observer, observerEmail)

	addProject := func(team model.Organization, name string) model.Project {
		t.Helper()
		directory := clusterJSON[model.Directory](t, client, a, owner, "GET", v2+"/directory", nil, 200)
		for _, space := range directory.Workspaces {
			if space.OrganizationID == team.ID && space.IsDefault {
				return clusterJSON[model.Project](t, client, a, owner, "POST", v2+"/workspaces/"+space.ID.String()+"/projects",
					map[string]string{"name": name}, 201)
			}
		}
		t.Fatal("missing Team default workspace")
		return model.Project{}
	}
	project := addProject(team, tag+" Project")
	privateProject := addProject(team, "Private Destination")
	projectPath := v2 + "/projects/" + project.ID.String()
	grant := projectPath + "/members/" + memberID.String()
	addBoard := func(project model.Project, name string) model.DirectoryBoard {
		t.Helper()
		return clusterJSON[model.DirectoryBoard](t, client, a, owner, "POST", v2+"/projects/"+project.ID.String()+"/boards", map[string]string{"name": name}, 201)
	}
	board := addBoard(project, tag+" Board")
	target := addBoard(project, "Visible Destination")
	private := addBoard(privateProject, "Private Board")
	boardPath := v2 + "/boards/" + board.ID
	snapshot := clusterJSON[document.Snapshot](t, client, a, owner, "GET", boardPath+"/snapshot", nil, 200)
	element := map[string]any{
		"id": "search-note", "type": "sticky", "text": tag + " 初始计划 /board/" + target.ID + " /board/" + private.ID,
		"pageId": snapshot.Document.DefaultPageID, "x": 100, "y": 100, "width": 240, "height": 180, "color": "#fef3c7",
		"zIndex": 1, "rotation": 0, "opacity": 1,
	}
	clusterJSON[document.Ack](t, client, a, owner, "POST", boardPath+"/commands", clusterCommand(uuid.NewString(), snapshot.Epoch, snapshot.Seq,
		map[string]any{"kind": "add", "collection": "elements", "id": "search-note", "value": element}), 200)

	search := func(base, token, scope, query string, status int) []model.SearchResult {
		t.Helper()
		params := url.Values{"q": {query}}
		if scope != "" {
			params.Set("team", scope)
		}
		return clusterJSON[struct{ Results []model.SearchResult }](t, client, base, token, "GET", workshop+"/search?"+params.Encode(), nil, status).Results
	}
	graph := func(base, token string, status int) model.TeamGraph {
		t.Helper()
		return clusterJSON[model.TeamGraph](t, client, base, token, "GET", workshop+"/teams/"+team.ID.String()+"/graph", nil, status)
	}
	hasHit := func(results []model.SearchResult, kind, id string) bool {
		return slices.ContainsFunc(results, func(hit model.SearchResult) bool { return hit.Kind == kind && hit.ID == id })
	}
	hasEdge := func(result model.TeamGraph, kind, from, to string) bool {
		return slices.Contains(result.Edges, model.TeamGraphEdge{From: from, To: to, Kind: kind})
	}
	hasNode := func(result model.TeamGraph, id string) bool {
		return slices.ContainsFunc(result.Nodes, func(node model.TeamGraphNode) bool { return node.ID == id })
	}

	search(b, outsider, team.ID.String(), tag, 404)
	graph(b, outsider, 404)
	if hits := search(b, outsider, "", tag, 200); len(hits) != 0 {
		t.Fatalf("cross-Team search leaked entries: %+v", hits)
	}
	if hits := search(a, outsider, other.ID.String(), tag, 200); len(hits) != 0 {
		t.Fatalf("search inside another Team leaked entries: %+v", hits)
	}
	if hits := search(b, reader, team.ID.String(), tag, 200); len(hits) != 2 || !hasHit(hits, "member", memberID.String()) {
		t.Fatalf("Team member could discover resources before Project access: %+v", hits)
	}
	clusterJSON[map[string]any](t, client, a, owner, "PUT", grant, map[string]string{"role": "view"}, 200)
	directory := clusterJSON[model.Directory](t, client, b, reader, "GET", v2+"/directory", nil, 200)
	if !slices.ContainsFunc(directory.Projects, func(item model.Project) bool {
		return item.ID == project.ID && item.PeopleCount == 2 && len(item.People) == 2 && item.People[0].IsOwner && item.People[1].UserID == memberID
	}) {
		t.Fatal("Project owner and participant projection differs from effective access")
	}

	results := search(b, reader, team.ID.String(), tag, 200)
	for kind, id := range map[string]string{"project": project.ID.String(), "member": memberID.String(), "file": board.ID, "content": board.ID} {
		if !hasHit(results, kind, id) {
			t.Fatalf("missing %s result: %+v", kind, results)
		}
	}
	if !slices.ContainsFunc(results, func(hit model.SearchResult) bool {
		return hit.Kind == "content" && hit.URL == "/board/"+board.ID+"?element=search-note&page="+snapshot.Document.DefaultPageID
	}) {
		t.Fatalf("content did not link to the source element: %+v", results)
	}
	if hits := search(b, reader, team.ID.String(), "初始", 200); !hasHit(hits, "content", board.ID) {
		t.Fatalf("Chinese substring did not match canvas text: %+v", hits)
	}
	view := graph(b, reader, 200)
	if !hasEdge(view, "participates", "member:"+memberID.String(), "project:"+project.ID.String()) ||
		!hasEdge(view, "contains", "project:"+project.ID.String(), "resource:"+board.ID) ||
		!hasEdge(view, "references", "resource:"+board.ID, "resource:"+target.ID) || hasNode(view, "resource:"+private.ID) {
		t.Fatalf("incorrect or unauthorized relationships: %+v", view)
	}
	if !hasEdge(graph(b, owner, 200), "references", "resource:"+board.ID, "resource:"+private.ID) {
		t.Fatal("the Team owner could not see the allowed reference")
	}
	clusterJSON[map[string]any](t, client, a, owner, "PUT", boardPath+"/archive", map[string]bool{"archived": true}, 200)
	if hits := search(b, owner, team.ID.String(), tag+" Board", 200); !slices.ContainsFunc(hits, func(hit model.SearchResult) bool {
		return hit.Kind == "file" && hit.ID == board.ID && strings.Contains(hit.Context, "Archive")
	}) {
		t.Fatalf("authorized search could not find an archived file: %+v", hits)
	}
	if hasNode(graph(b, owner, 200), "resource:"+board.ID) {
		t.Fatal("archived board appeared on the active relationship map")
	}
	clusterJSON[map[string]any](t, client, a, owner, "PUT", boardPath+"/archive", map[string]bool{"archived": false}, 200)
	t.Log("all four search categories, CJK substrings, source links, archived files, and visible graph edges verified across replicas")

	current := clusterJSON[document.Snapshot](t, client, b, owner, "GET", boardPath+"/snapshot", nil, 200)
	clusterJSON[document.Ack](t, client, b, owner, "POST", boardPath+"/commands", clusterCommand(uuid.NewString(), current.Epoch, current.Seq,
		map[string]any{"kind": "patch", "collection": "elements", "id": "search-note", "fields": map[string]any{"text": tag + " 发布清单"}}), 200)
	if hits := search(a, reader, team.ID.String(), "发布清单", 200); !hasHit(hits, "content", board.ID) {
		t.Fatalf("the second replica did not see the committed body: %+v", hits)
	}
	if hits := search(a, reader, team.ID.String(), "初始", 200); len(hits) != 0 {
		t.Fatalf("search returned stale text after replacement: %+v", hits)
	}
	if hasEdge(graph(a, reader, 200), "references", "resource:"+board.ID, "resource:"+target.ID) {
		t.Fatal("graph retained a deleted reference")
	}
	current = clusterJSON[document.Snapshot](t, client, b, owner, "GET", boardPath+"/snapshot", nil, 200)
	clusterJSON[document.Ack](t, client, a, owner, "POST", boardPath+"/commands", clusterCommand(uuid.NewString(), current.Epoch, current.Seq,
		map[string]any{"kind": "delete", "collection": "elements", "id": "search-note"}), 200)
	if hits := search(b, reader, team.ID.String(), "发布清单", 200); len(hits) != 0 {
		t.Fatalf("search returned deleted text: %+v", hits)
	}

	legacy := clusterJSON[struct{ ID string }](t, client, a, owner, "POST", "/api/rooms", map[string]string{"name": "Legacy search fixture"}, 200)
	clusterJSON[map[string]any](t, client, a, owner, "POST", "/api/rooms/"+legacy.ID+"/save", map[string]any{
		"name": "Legacy search fixture", "pages": []map[string]any{{"id": "legacy-page", "name": "Legacy"}},
		"elements": []map[string]any{{"id": "legacy-text", "type": "text", "pageId": "legacy-page", "text": "旧版索引 fixture"}},
	}, 200)
	if hits := search(b, owner, "", "旧版索引", 200); !hasHit(hits, "content", legacy.ID) {
		t.Fatalf("legacy board body did not index: %+v", hits)
	}
	clusterJSON[document.Snapshot](t, client, b, owner, "GET", v2+"/boards/"+legacy.ID+"/snapshot", nil, 200)
	if hits := search(a, owner, "", "旧版索引", 200); len(hits) != 1 || hits[0].ElementID != "legacy-text" {
		t.Fatalf("activation did not replace the legacy index exactly once: %+v", hits)
	}
	t.Log("edit, deleted text, removed reference, legacy save and conversion verified across replicas")

	inbox := func(base, token string) model.WorkshopInbox {
		t.Helper()
		return clusterJSON[model.WorkshopInbox](t, client, base, token, "GET", workshop+"/inbox", nil, 200)
	}
	start := func(subject string, recipient *uuid.UUID) uuid.UUID {
		t.Helper()
		id := uuid.New()
		value := model.NewWorkshopThread{ID: id, TeamID: team.ID, RecipientID: recipient, Subject: subject, Body: subject + " message"}
		clusterJSON[map[string]any](t, client, a, owner, "POST", workshop+"/threads", value, 201)
		clusterJSON[map[string]any](t, client, b, owner, "POST", workshop+"/threads", value, 201)
		return id
	}
	direct := start("Private conversation", &memberID)
	discussion := start("Team discussion", nil)
	hasThread := func(data model.WorkshopInbox, id uuid.UUID) bool {
		return slices.ContainsFunc(data.Threads, func(thread model.ThreadSummary) bool { return thread.ID == id })
	}
	threadPath := workshop + "/threads/" + direct.String()
	if state := inbox(b, reader); state.Unread != 2 || !hasThread(state, direct) || !hasThread(state, discussion) {
		t.Fatalf("Inbox did not include received threads: %+v", state)
	}
	if state := inbox(b, owner); state.Unread != 0 || !hasThread(state, direct) {
		t.Fatalf("Inbox did not include sent threads: %+v", state)
	}
	if state := inbox(b, observer); hasThread(state, direct) || !hasThread(state, discussion) {
		t.Fatalf("same-Team member could see a direct conversation or missed the team discussion: %+v", state)
	}
	clusterJSON[map[string]any](t, client, b, observer, "GET", threadPath, nil, 404)
	thread := clusterJSON[model.WorkshopThread](t, client, b, reader, "GET", threadPath, nil, 200)
	if len(thread.Messages) != 1 {
		t.Fatalf("retried start produced duplicate messages: %+v", thread.Messages)
	}
	clusterJSON[map[string]any](t, client, b, reader, "PUT", threadPath+"/state", map[string]any{
		"pinned": true, "readThrough": thread.Messages[0].Sequence,
	}, 200)
	if state := inbox(a, reader); state.Unread != 1 || len(state.Threads) != 2 || state.Threads[0].ID != direct || !state.Threads[0].Pinned {
		t.Fatalf("read state or pinned order was not replicated: %+v", state)
	}
	clusterJSON[map[string]any](t, client, b, reader, "POST", threadPath+"/replies", map[string]any{"id": uuid.New(), "body": "Received"}, 201)
	if thread := clusterJSON[model.WorkshopThread](t, client, a, owner, "GET", threadPath, nil, 200); len(thread.Messages) != 2 || thread.Messages[1].Body != "Received" {
		t.Fatalf("reply was not replicated: %+v", thread)
	}

	recentPath := workshop + "/recents"
	recents := func(base, token string) []model.RecentResource {
		t.Helper()
		return clusterJSON[struct{ Items []model.RecentResource }](t, client, base, token, "GET", recentPath, nil, 200).Items
	}
	clusterJSON[map[string]any](t, client, a, reader, "PUT", recentPath+"/"+board.ID, nil, 200)
	if items := recents(b, reader); len(items) != 1 || items[0].ID != board.ID {
		t.Fatalf("recent file did not appear across replicas: %+v", items)
	}

	startTime := time.Now().UTC().Truncate(time.Minute)
	agendaRoute := workshop + "/agenda"
	window := url.Values{"from": {startTime.Add(-time.Hour).Format(time.RFC3339)}, "to": {startTime.Add(time.Hour).Format(time.RFC3339)}}
	agenda := func(base, token string) []model.AgendaItem {
		t.Helper()
		return clusterJSON[struct{ Items []model.AgendaItem }](t, client, base, token, "GET", agendaRoute+"?"+window.Encode(), nil, 200).Items
	}
	task := uuid.New()
	taskDraft := model.AgendaDraft{ProjectID: &project.ID, Kind: "task", Title: "Release task", StartsAt: startTime, EndsAt: startTime}
	clusterJSON[map[string]any](t, client, a, owner, "PUT", agendaRoute+"/"+task.String(), taskDraft, 200)
	if items := agenda(b, reader); len(items) != 1 || items[0].ID != task || items[0].Editable {
		t.Fatalf("Project task did not respect the viewer role: %+v", items)
	}
	if items := agenda(b, observer); len(items) != 0 {
		t.Fatalf("Project task disclosed to another Team member: %+v", items)
	}
	taskDraft.Revision = 1
	taskDraft.Completed = true
	clusterJSON[map[string]any](t, client, b, reader, "PUT", agendaRoute+"/"+task.String(), taskDraft, 403)
	clusterJSON[map[string]any](t, client, b, owner, "PUT", agendaRoute+"/"+task.String(), taskDraft, 200)
	clusterJSON[map[string]any](t, client, a, owner, "PUT", agendaRoute+"/"+task.String(), taskDraft, 200)
	stale := taskDraft
	stale.Notes = "Stale edit"
	clusterJSON[map[string]any](t, client, a, owner, "PUT", agendaRoute+"/"+task.String(), stale, 409)
	if items := agenda(a, owner); len(items) != 1 || !items[0].Completed || items[0].Revision != 2 {
		t.Fatalf("optimistic task revision did not preserve the committed update: %+v", items)
	}
	mention := uuid.NewString()
	clusterJSON[map[string]any](t, client, a, owner, "POST", boardPath+"/review/threads", map[string]any{
		"requestId": mention, "body": "Please review the source", "mentionUserIds": []string{memberID.String()},
		"anchor": map[string]any{"pageId": snapshot.Document.DefaultPageID},
	}, 200, 201)
	notice := inbox(b, reader)
	if len(notice.Mentions) != 1 || !notice.Mentions[0].Unread || notice.Mentions[0].URL != "/board/"+board.ID+"?thread="+mention {
		t.Fatalf("board mention did not appear with a link to its source: %+v", notice)
	}
	clusterJSON[map[string]any](t, client, b, reader, "PUT", boardPath+"/review/notifications/"+mention+"/read", nil, 200)
	if state := inbox(a, reader); len(state.Mentions) != 1 || state.Mentions[0].Unread || state.Unread != notice.Unread-1 {
		t.Fatalf("reading the board mention did not update the Inbox count: %+v", state)
	}
	t.Log("Team and private Inbox, pin, unread, reply, board mentions, Calendar scope and revisions, and recent files verified")

	current = clusterJSON[document.Snapshot](t, client, a, owner, "GET", boardPath+"/snapshot", nil, 200)
	element["id"] = "revoke-note"
	element["text"] = tag + " revoke fixture"
	clusterJSON[document.Ack](t, client, a, owner, "POST", boardPath+"/commands", clusterCommand(uuid.NewString(), current.Epoch, current.Seq,
		map[string]any{"kind": "add", "collection": "elements", "id": "revoke-note", "value": element}), 200)
	if hits := search(b, reader, "", tag, 200); !hasHit(hits, "content", board.ID) {
		t.Fatal("test requires a visible body immediately before Project revocation")
	}
	clusterJSON[map[string]any](t, client, a, owner, "DELETE", grant, nil, 200)
	if hits := search(b, reader, "", tag, 200); hasHit(hits, "project", project.ID.String()) || hasHit(hits, "file", board.ID) || hasHit(hits, "content", board.ID) {
		t.Fatalf("revoked Project appeared in global search: %+v", hits)
	}
	if view := graph(b, reader, 200); hasNode(view, "project:"+project.ID.String()) || hasNode(view, "resource:"+board.ID) {
		t.Fatalf("graph kept a revoked Project: %+v", view)
	}
	if len(recents(b, reader)) != 0 || len(agenda(b, reader)) != 0 || len(inbox(b, reader).Mentions) != 0 {
		t.Fatal("Project revocation did not hide its task, recent board, and mentions")
	}
	clusterJSON[map[string]any](t, client, a, owner, "DELETE", teamPath+"/members/"+memberID.String(), nil, 200)
	search(b, reader, team.ID.String(), tag, 404)
	graph(b, reader, 404)
	clusterJSON[map[string]any](t, client, b, reader, "GET", threadPath, nil, 404)
	if state := inbox(b, reader); state.Unread != 0 || hasThread(state, direct) || hasThread(state, discussion) {
		t.Fatalf("Inbox disclosed revoked Team activity: %+v", state)
	}
	if hits := search(b, reader, "", tag, 200); len(hits) != 0 {
		t.Fatalf("global discovery retained offboarded Team entries: %+v", hits)
	}
	clusterJSON[map[string]any](t, client, b, owner, "DELETE", agendaRoute+"/"+task.String()+"?revision=2", nil, 200)
	if items := agenda(a, owner); len(items) != 0 {
		t.Fatalf("Calendar retained deleted task: %+v", items)
	}
	t.Log("Project revocation and Team offboarding immediately hid search, graph, agenda, recents and conversations on the other replica")
}
