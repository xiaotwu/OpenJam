package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/assets"
	"github.com/xiaotwu/shiori/server/internal/config"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/jobs"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestTeamsCluster(t *testing.T) {
	if config.Env("SHIORI_CLUSTER_TEAMS") != "1" {
		t.Skip("requires an isolated two-replica cluster with Redis, object storage and a file worker")
	}
	a, b, dsn := config.Env("SHIORI_CLUSTER_PRIMARY"), config.Env("SHIORI_CLUSTER_SECONDARY"), config.Env("SHIORI_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := db.InitContext(ctx, dsn); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	client := &http.Client{Timeout: 8 * time.Second}
	owner, _ := registerClusterUser(t, client, a, "Team owner")
	admin, adminEmail := registerClusterUser(t, client, a, "Team admin")
	editor, editorEmail := registerClusterUser(t, client, b, "Team editor")
	outsider, _ := registerClusterUser(t, client, b, "External viewer")
	editorID := clusterJSON[struct{ User model.User }](t, client, b, editor, "GET", "/api/me", nil, 200).User.ID

	const v2 = "/api/v2"
	dir := func(base, token string) model.Directory {
		return clusterJSON[model.Directory](t, client, base, token, "GET", v2+"/directory", nil, 200)
	}
	createProject := func(directory model.Directory, organizationID uuid.UUID, name string) model.Project {
		index := slices.IndexFunc(directory.Workspaces, func(w model.Workspace) bool { return w.OrganizationID == organizationID && w.IsDefault })
		if index < 0 {
			t.Fatal("missing default workspace")
		}
		path := v2 + "/workspaces/" + directory.Workspaces[index].ID.String() + "/projects"
		return clusterJSON[model.Project](t, client, a, owner, "POST", path, map[string]string{"name": name}, 201)
	}

	personal := dir(a, owner)
	if len(personal.Organizations) != 1 || personal.Organizations[0].Kind != "personal" {
		t.Fatalf("personal work area: %+v", personal)
	}
	personalProject := createProject(personal, personal.Organizations[0].ID, "Personal project")
	team := clusterJSON[model.Organization](t, client, a, owner, "POST", v2+"/organizations", map[string]string{"name": "Fixture team"}, 201)
	project := createProject(dir(a, owner), team.ID, "Private team project")
	teamPath := v2 + "/teams/" + team.ID.String()
	projectPath := v2 + "/projects/" + project.ID.String()
	editorPath := projectPath + "/members/" + editorID.String()
	invite := func(email, role string) model.TeamInvitation {
		return clusterJSON[model.TeamInvitation](t, client, a, owner, "POST", teamPath+"/invitations",
			map[string]string{"email": email, "role": role}, 201)
	}
	accept := func(token, credential string, status int) {
		clusterJSON[map[string]any](t, client, b, token, "POST", teamPath+"/invitations/accept",
			map[string]string{"token": credential}, status)
	}
	adminInvite := invite(adminEmail, "admin")
	accept(admin, adminInvite.Token, 200)
	expired := invite(editorEmail, "member")
	if _, err := db.Pool().Exec(ctx, `
		UPDATE team_invitations SET expires_at = statement_timestamp() - INTERVAL '1 minute'
		WHERE organization_id = $1 AND email = $2
	`, team.ID, editorEmail); err != nil {
		t.Fatal(err)
	}
	accept(editor, expired.Token, 404)
	editorInvite := invite(editorEmail, "member")
	accept(outsider, editorInvite.Token, 404)
	accept(editor, editorInvite.Token, 200)
	accept(editor, editorInvite.Token, 200)
	clusterJSON[map[string]any](t, client, b, outsider, "GET", teamPath+"/members", nil, 404)
	members := clusterJSON[[]model.TeamMember](t, client, b, editor, "GET", teamPath+"/members", nil, 200)
	if len(members) != 3 || members[0].Role != "owner" || members[0].Email != "" {
		t.Fatalf("Team roster is inconsistent: %+v", members)
	}
	for _, token := range []string{editor, admin} {
		directory := dir(b, token)
		if !slices.ContainsFunc(directory.Organizations, func(o model.Organization) bool { return o.ID == team.ID }) ||
			slices.ContainsFunc(directory.Projects, func(p model.Project) bool { return p.ID == project.ID || p.ID == personalProject.ID }) {
			t.Fatalf("Team membership exposed private projects: %+v", directory)
		}
		clusterJSON[map[string]any](t, client, b, token, "PUT", editorPath, map[string]string{"role": "manager"}, 404)
	}
	clusterJSON[map[string]any](t, client, b, admin, "POST", teamPath+"/invitations",
		map[string]string{"email": "additional-admin@example.invalid", "role": "admin"}, 403)

	memberProject := clusterJSON[model.Project](t, client, b, editor, "POST",
		v2+"/workspaces/"+project.WorkspaceID.String()+"/projects", map[string]string{"name": "Created by a Team member"}, 201)
	if memberProject.Role != "manager" {
		t.Fatalf("creator role was %q, want manager", memberProject.Role)
	}
	if !slices.ContainsFunc(dir(a, owner).Projects, func(p model.Project) bool { return p.ID == memberProject.ID }) {
		t.Fatal("Team owner could not see the member-created Project")
	}

	clusterJSON[map[string]any](t, client, a, owner, "PUT", editorPath, map[string]string{"role": "view"}, 200)
	clusterJSON[map[string]any](t, client, b, editor, "POST", projectPath+"/boards", map[string]string{"name": "Denied board"}, 404)
	clusterJSON[map[string]any](t, client, a, owner, "PUT", editorPath, map[string]string{"role": "edit"}, 200)
	board := clusterJSON[model.DirectoryBoard](t, client, b, editor, "POST", projectPath+"/boards", map[string]string{"name": "Team review"}, 201)
	if board.Permission != "edit" || board.OwnerID != editorID || board.ProjectID == nil || *board.ProjectID != project.ID {
		t.Fatalf("unexpected Team board attribution or effective permission: %+v", board)
	}
	boardPath := v2 + "/boards/" + board.ID
	snapshot := clusterJSON[document.Snapshot](t, client, b, editor, "GET", boardPath+"/snapshot", nil, 200)
	manager := clusterJSON[document.Snapshot](t, client, a, owner, "GET", boardPath+"/snapshot", nil, 200)
	if manager.Permission != "owner" || snapshot.Permission != "edit" || manager.Hash != snapshot.Hash {
		t.Fatalf("replicas disagree on content or inherited role: %q %q", manager.Permission, snapshot.Permission)
	}
	clusterJSON[map[string]any](t, client, b, editor, "DELETE", "/api/rooms/"+board.ID, nil, 403)
	clusterJSON[map[string]any](t, client, b, outsider, "GET", boardPath+"/snapshot", nil, 403)

	clusterJSON[map[string]any](t, client, a, owner, "PUT", editorPath, map[string]string{"role": "manager"}, 200)
	clusterJSON[[]model.ProjectMember](t, client, b, editor, "GET", projectPath+"/members", nil, 200)
	clusterJSON[map[string]any](t, client, b, editor, "GET", boardPath+"/sharing", nil, 200)
	clusterJSON[map[string]any](t, client, b, editor, "POST", teamPath+"/invitations",
		map[string]string{"email": "manager-cannot-invite@example.invalid", "role": "member"}, 403)

	clusterJSON[map[string]any](t, client, a, owner, "PUT", editorPath, map[string]string{"role": "comment"}, 200)
	clusterJSON[map[string]any](t, client, b, editor, "POST", boardPath+"/review/threads", map[string]any{
		"requestId": uuid.NewString(), "body": "Review from a Project Commenter",
		"anchor": map[string]any{"pageId": snapshot.Document.DefaultPageID},
	}, 201, 200)
	clusterJSON[map[string]any](t, client, b, editor, "POST", boardPath+"/commands",
		clusterCommand(uuid.NewString(), snapshot.Epoch, snapshot.Seq, map[string]any{"kind": "rename", "value": "Denied change"}), 403)
	clusterJSON[map[string]any](t, client, a, owner, "PUT", editorPath, map[string]string{"role": "edit"}, 200)

	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	upload := fileClusterRequest(client, b, editor, "POST", boardPath+"/assets", encoded.Bytes(), map[string]string{"Content-Type": "image/png"})
	var asset assets.Metadata
	if upload.err != nil || upload.status != 201 {
		t.Fatalf("upload team asset: %d %s %v", upload.status, upload.body, upload.err)
	}
	if err := json.Unmarshal(upload.body, &asset); err != nil || asset.ID == "" {
		t.Fatalf("invalid Team asset: %+v %v", asset, err)
	}
	assetPath := boardPath + "/assets/" + asset.ID
	imageValue := map[string]any{"id": "team-image", "type": "image", "assetId": asset.ID, "src": "",
		"pageId": snapshot.Document.DefaultPageID, "x": 1, "y": 1, "width": 16, "height": 16,
		"zIndex": 1, "rotation": 0, "opacity": 1, "originalWidth": 16, "originalHeight": 16, "objectFit": "contain"}
	commit := clusterCommand(uuid.NewString(), snapshot.Epoch, snapshot.Seq,
		map[string]any{"kind": "add", "collection": "elements", "id": "team-image", "value": imageValue})
	clusterJSON[document.Ack](t, client, b, editor, "POST", boardPath+"/commands", commit, 200)
	committed := clusterJSON[document.Snapshot](t, client, a, owner, "GET", boardPath+"/snapshot", nil, 200)
	clusterJSON[map[string]any](t, client, b, editor, "GET", boardPath+"/versions", nil, 200)
	export := clusterJSON[jobs.Job](t, client, b, editor, "POST", boardPath+"/files/export",
		map[string]string{"requestId": uuid.NewString(), "format": "zip", "scope": "board"}, 202)
	jobPath := v2 + "/jobs/" + export.ID.String()
	waitFileJob(t, client, a, editor, jobPath)
	if result := fileClusterRequest(client, b, editor, "GET", jobPath+"/artifact", nil, nil); result.err != nil || result.status != 200 {
		t.Fatalf("export download before revocation: %d %v", result.status, result.err)
	}

	// A board-specific grant continues after a Project grant is removed.
	clusterJSON[map[string]any](t, client, a, owner, "POST", "/api/rooms/"+board.ID+"/invites",
		map[string]string{"email": editorEmail, "permission": "view"}, 200, 201)
	clusterJSON[map[string]any](t, client, a, owner, "DELETE", editorPath, nil, 200)
	shared := clusterJSON[document.Snapshot](t, client, b, editor, "GET", boardPath+"/snapshot", nil, 200)
	if shared.Permission != "view" || shared.Hash != committed.Hash {
		t.Fatalf("independent board grant was not preserved: %q", shared.Permission)
	}
	if found := dir(b, editor); !slices.ContainsFunc(found.Boards, func(item model.DirectoryBoard) bool {
		return item.ID == board.ID && item.ProjectID == nil && item.Permission == "view"
	}) {
		t.Fatal("direct grant did not appear as Shared with me")
	}
	clusterJSON[map[string]any](t, client, a, owner, "PUT", editorPath, map[string]string{"role": "edit"}, 200)
	socket := clusterSocket(t, b, editor, "/ws/v2")
	writeSocket(t, socket, "subscribe", map[string]any{"boardId": board.ID, "epoch": committed.Epoch, "afterSeq": committed.Seq})
	readSocket(t, socket, "subscribed")
	clusterJSON[map[string]any](t, client, a, owner, "DELETE", teamPath+"/members/"+editorID.String(), nil, 200)
	if err := socket.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for {
		_, _, err := socket.ReadMessage()
		if err == nil {
			continue
		}
		if timeout, ok := err.(interface{ Timeout() bool }); ok && timeout.Timeout() {
			t.Fatal("the remote subscription remained open after offboarding")
		}
		break
	}
	clusterJSON[map[string]any](t, client, b, editor, "GET", boardPath+"/snapshot", nil, 403)
	clusterJSON[map[string]any](t, client, b, editor, "POST", boardPath+"/commands", commit, 403)
	clusterJSON[map[string]any](t, client, b, editor, "GET", boardPath+"/versions", nil, 403)
	clusterJSON[map[string]any](t, client, b, editor, "DELETE", "/api/rooms/"+board.ID, nil, 403)
	for _, path := range []string{assetPath, jobPath + "/artifact"} {
		result := fileClusterRequest(client, b, editor, "GET", path, nil, nil)
		if result.err != nil || (result.status != 403 && result.status != 404) {
			t.Fatalf("revoked access to %s: %d %v", path, result.status, result.err)
		}
	}
	accept(editor, editorInvite.Token, 404)
	afterRemoval := dir(b, editor)
	if slices.ContainsFunc(afterRemoval.Organizations, func(o model.Organization) bool { return o.ID == team.ID }) ||
		!slices.ContainsFunc(afterRemoval.Organizations, func(o model.Organization) bool { return o.Kind == "personal" }) ||
		slices.ContainsFunc(afterRemoval.Boards, func(b model.DirectoryBoard) bool { return b.ID == board.ID }) {
		t.Fatal("offboarding did not isolate the Team from the personal directory")
	}
	accept(editor, invite(editorEmail, "member").Token, 200)
	clusterJSON[map[string]any](t, client, b, editor, "GET", boardPath+"/snapshot", nil, 403)
	if !slices.ContainsFunc(dir(a, owner).Projects, func(p model.Project) bool { return p.ID == memberProject.ID }) {
		t.Fatal("a departing Team member's Project was lost")
	}
	after := clusterJSON[document.Snapshot](t, client, a, owner, "GET", boardPath+"/snapshot", nil, 200)
	if after.Hash != committed.Hash || after.Seq != committed.Seq {
		t.Fatal("offboarding changed the Team board or its version")
	}
	t.Log("verified Team roster, private Projects, named invitations, direct-share fallback, and cross-replica revocation of board, WebSocket, asset, history and export access")
}
