package tests

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/agent"
	"github.com/xiaotwu/shiori/server/internal/config"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/jobs"
)

func TestAgentCluster(t *testing.T) {
	if config.Env("SHIORI_CLUSTER_AGENT") != "1" {
		t.Skip("requires an isolated two-replica cluster with a worker and the deterministic agent")
	}
	a, b, dsn := config.Env("SHIORI_CLUSTER_PRIMARY"), config.Env("SHIORI_CLUSTER_SECONDARY"), config.Env("SHIORI_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 10 * time.Second}
	owner, _ := registerClusterUser(t, client, a, "Agent fixture owner")
	editor, editorEmail := registerClusterUser(t, client, b, "Agent fixture editor")
	const profilePath = "/api/v2/me/agent-profile"
	profile := agent.Profile{Name: "Studio guide", Kind: "glyph", Glyph: "orbit"}
	clusterJSON[agent.Profile](t, client, a, owner, "PUT", profilePath, profile, 200)
	if found := clusterJSON[agent.Profile](t, client, b, owner, "GET", profilePath, nil, 200); !reflect.DeepEqual(found, profile) {
		t.Fatalf("character profile did not converge: %+v", found)
	}
	if found := clusterJSON[agent.Profile](t, client, b, editor, "GET", profilePath, nil, 200); found.Kind != "ring" || found.Name != "" {
		t.Fatalf("editor saw the owner's character profile: %+v", found)
	}
	room := clusterJSON[struct{ ID string }](t, client, a, owner, "POST", "/api/rooms",
		map[string]string{"name": "Agent workshop fixture"}, 200)
	board := "/api/v2/boards/" + room.ID
	initial := clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	invite := clusterJSON[struct{ Token string }](t, client, a, owner, "POST", board+"/sharing/invitations",
		map[string]any{"email": editorEmail, "permission": "edit", "expiresInDays": 1}, 201)
	clusterJSON[map[string]any](t, client, b, editor, "POST", board+"/sharing/invitations/accept",
		map[string]string{"token": invite.Token}, 200)

	settingsPath := board + "/agent/settings"
	settings := clusterJSON[agent.Settings](t, client, a, owner, "GET", settingsPath, nil, 200)
	if settings.Enabled || !settings.CanConfigure {
		t.Fatalf("new board agent settings: %+v", settings)
	}
	optIn := agent.SettingsInput{Enabled: true, Provider: "mock", Model: "deterministic-v1"}
	clusterJSON[document.Failure](t, client, b, editor, "PUT", settingsPath, optIn, 403)
	configured := clusterJSON[agent.Settings](t, client, b, owner, "PUT", settingsPath, optIn, 200)
	if !configured.Enabled || configured.Provider != optIn.Provider || configured.Model != optIn.Model {
		t.Fatalf("configure the deterministic model: %+v", configured)
	}
	const selectedText = "Assign an action owner"
	const unselectedText = "Confidential note outside the selected context"
	note := func(id, text string) map[string]any {
		return map[string]any{"kind": "add", "collection": "elements", "id": id,
			"value": map[string]any{"id": id, "pageId": initial.Document.DefaultPageID, "type": "sticky",
				"text": text, "x": 20, "y": 25, "width": 160, "height": 120}}
	}
	seed := clusterCommand(uuid.NewString(), initial.Epoch, initial.Seq, note("selected", selectedText))
	seed["operations"] = []any{note("selected", selectedText), note("outside", unselectedText)}
	clusterJSON[document.Ack](t, client, a, owner, "POST", board+"/commands", seed, 200)
	before := clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	if len(before.Document.Elements) != 2 || before.Seq != initial.Seq+1 {
		t.Fatalf("agent fixture was not committed: %+v", before)
	}
	request := agent.StartInput{
		RequestID: uuid.New(), Provider: "mock", Model: "deterministic-v1", Workflow: "organize",
		Prompt: "Organize these notes for the next team workshop", SelectedIDs: []string{"selected"}, Placement: "new-page",
	}
	runsPath := board + "/agent-runs"
	started := acrossFileReplicas(a, b, func(base string) clusterResponse {
		return clusterRequest(client, base, owner, "POST", runsPath, request)
	})
	leftRun := decodeAgentCluster[agent.Run](t, started[0], 202)
	rightRun := decodeAgentCluster[agent.Run](t, started[1], 202)
	if leftRun.ID == uuid.Nil || leftRun.ID != rightRun.ID {
		t.Fatalf("duplicate enqueue created different runs: %s / %s", leftRun.ID, rightRun.ID)
	}
	runPath := runsPath + "/" + leftRun.ID.String()
	clusterJSON[document.Failure](t, client, b, editor, "GET", runPath, nil, 404)
	ready := readAgentPreviewSSE(t, b, owner, runPath, leftRun.ID)
	if ready.Result == nil || ready.Result.Preview == nil || ready.Result.Preview.PageID == "" {
		t.Fatalf("agent run published without a preview: %+v", ready)
	}
	proposal, err := json.Marshal(ready.Result.Proposal)
	if err != nil || !strings.Contains(string(proposal), selectedText) || strings.Contains(string(proposal), unselectedText) {
		t.Fatalf("proposal did not respect the selected text scope: %s %v", proposal, err)
	}
	previewA := clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	previewB := clusterJSON[document.Snapshot](t, client, b, editor, "GET", board+"/snapshot", nil, 200)
	assertAgentSnapshot(t, previewA, previewB, before.Seq)
	if previewA.Hash != before.Hash {
		t.Fatal("draft preview changed the board")
	}

	clusterJSON[document.Failure](t, client, b, editor, "GET", runPath+"/shared", nil, 404)
	published := clusterJSON[agent.Run](t, client, a, owner, "PUT", runPath+"/share", map[string]bool{"shared": true}, 200)
	shared := clusterJSON[agent.SharedRun](t, client, b, editor, "GET", runPath+"/shared", nil, 200)
	if !published.Shared || !shared.Shared || shared.Conversation.Prompt != request.Prompt || shared.Result != nil {
		t.Fatalf("shared selected-source transcript was not private by projection: %+v", shared)
	}
	clusterJSON[document.Failure](t, client, b, editor, "PUT", runPath+"/share", map[string]bool{"shared": false}, 404)

	apply := agent.ApplyInput{Revision: published.Revision, ClientID: uuid.New()}
	responses := acrossFileReplicas(a, b, func(base string) clusterResponse {
		return clusterRequest(client, base, owner, "POST", runPath+"/apply", apply)
	})
	left := decodeAgentCluster[agent.Application](t, responses[0], 200)
	right := decodeAgentCluster[agent.Application](t, responses[1], 200)
	if left.PageID != ready.Result.Preview.PageID || right.PageID != left.PageID ||
		left.Ack.ClientID != apply.ClientID.String() || right.Ack.ClientID != left.Ack.ClientID ||
		left.Ack.CommandID != leftRun.ID.String() || right.Ack.CommandID != left.Ack.CommandID ||
		left.Ack.Seq != before.Seq+1 || right.Ack.Seq != left.Ack.Seq || left.Ack.Replayed == right.Ack.Replayed ||
		left.Ack.Change == nil || right.Ack.Change == nil ||
		!reflect.DeepEqual(agentChangeValue(t, left.Ack.Change), agentChangeValue(t, right.Ack.Change)) {
		t.Fatalf("apply receipts diverged: %+v / %+v", left, right)
	}
	afterA := clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	afterB := clusterJSON[document.Snapshot](t, client, b, editor, "GET", board+"/snapshot", nil, 200)
	assertAgentSnapshot(t, afterA, afterB, left.Ack.Seq)
	if afterA.Hash == before.Hash || len(afterA.Document.Pages) != len(before.Document.Pages)+1 ||
		len(afterA.Document.Elements) <= len(before.Document.Elements) {
		t.Fatalf("applied draft was not materialized: %+v", afterA)
	}
	t.Logf("run %s applied once at epoch %d sequence %d with SHA-256 %s on both replicas",
		leftRun.ID, afterA.Epoch, afterA.Seq, afterA.Hash)
	attributionPath := board + "/agent-attributions?page=" + left.PageID
	marksA := clusterJSON[agent.AttributionPage](t, client, a, owner, "GET", attributionPath, nil, 200)
	marksB := clusterJSON[agent.AttributionPage](t, client, b, editor, "GET", attributionPath, nil, 200)
	if len(marksA.Entries) != len(afterA.Document.Elements)-len(before.Document.Elements) || !reflect.DeepEqual(marksA, marksB) {
		t.Fatalf("attribution coverage or replica agreement failed: %+v / %+v", marksA, marksB)
	}
	for _, mark := range marksA.Entries {
		if mark.RunID != leftRun.ID || mark.ActorName != "Agent fixture owner" || mark.AgentName != profile.Name || mark.Glyph != profile.Glyph {
			t.Fatalf("unexpected board object attribution: %+v", mark)
		}
	}

	undo := document.Command{ProtocolVersion: document.ProtocolVersion, Epoch: afterA.Epoch, BaseSeq: afterA.Seq,
		ClientID: left.Ack.ClientID, CommandID: uuid.NewString(), DependsOn: left.Ack.CommandID}
	for i := len(left.Ack.Change.Operations) - 1; i >= 0; i-- {
		delta := left.Ack.Change.Operations[i]
		var expected map[string]json.RawMessage
		if delta.Kind != "upsert" {
			t.Fatalf("draft applied an unexpected mutation: %+v", delta)
		}
		if err := json.Unmarshal(delta.Value, &expected); err != nil || len(expected) == 0 {
			t.Fatalf("expected canonical object for undo: %s %v", delta.Value, err)
		}
		undo.Operations = append(undo.Operations, document.Operation{
			Kind: "delete", Collection: delta.Collection, ID: delta.ID, Expected: expected,
		})
	}
	undoAck := clusterJSON[document.Ack](t, client, b, owner, "POST", board+"/commands", undo, 200)
	if undoAck.Seq != left.Ack.Seq+1 {
		t.Fatalf("undo did not commit one command: %+v", undoAck)
	}
	undoneA := clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	undoneB := clusterJSON[document.Snapshot](t, client, b, editor, "GET", board+"/snapshot", nil, 200)
	assertAgentSnapshot(t, undoneA, undoneB, undoAck.Seq)
	if undoneA.Hash != before.Hash || !reflect.DeepEqual(undoneA.Document, before.Document) {
		t.Fatalf("guarded undo did not restore the original document: %+v", undoneA)
	}
	t.Logf("guarded undo restored SHA-256 %s on both replicas at sequence %d", undoneA.Hash, undoneA.Seq)
	if marks := clusterJSON[agent.AttributionPage](t, client, a, editor, "GET", attributionPath, nil, 200); len(marks.Entries) != 0 {
		t.Fatalf("undo kept live badges for deleted objects: %+v", marks)
	}
	stillShared := clusterJSON[agent.SharedRun](t, client, a, editor, "GET", runPath+"/shared", nil, 200)
	if stillShared.Revision != shared.Revision || stillShared.Result != nil {
		t.Fatalf("private application changed the published snapshot: %+v", stillShared)
	}
	clusterJSON[agent.Run](t, client, b, owner, "PUT", runPath+"/share", map[string]bool{"shared": false}, 200)
	clusterJSON[document.Failure](t, client, a, editor, "GET", runPath+"/shared", nil, 404)
	t.Log("board members read the immutable shared transcript across replicas until the creator revoked it")
}

func TestExternalAgentCluster(t *testing.T) {
	if config.Env("SHIORI_CLUSTER_EXTERNAL") != "1" {
		t.Skip("requires the isolated TLS connector fixture on both replicas")
	}
	a, b, dsn := config.Env("SHIORI_CLUSTER_PRIMARY"), config.Env("SHIORI_CLUSTER_SECONDARY"), config.Env("SHIORI_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 10 * time.Second}
	owner, _ := registerClusterUser(t, client, a, "Connector fixture owner")
	room := clusterJSON[struct{ ID string }](t, client, a, owner, "POST", "/api/rooms",
		map[string]string{"name": "External connector fixture"}, 200)
	board := "/api/v2/boards/" + room.ID
	runs := board + "/agent-runs"
	settings := board + "/agent/settings"
	clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	clusterJSON[agent.Settings](t, client, a, owner, "PUT", settings,
		agent.SettingsInput{Enabled: true, Provider: "external", Model: "fixture-v1"}, 200)
	other := clusterJSON[agent.Settings](t, client, b, owner, "GET", settings, nil, 200)
	found := false
	for _, choice := range other.Choices {
		found = found || (choice.Provider == "external" && choice.Model == "fixture-v1" && choice.Cloud && choice.Label == "Connector fixture")
	}
	if !found {
		t.Fatal("the second replica did not advertise the configured connector")
	}

	request := agent.StartInput{RequestID: uuid.New(), Provider: "external", Model: "fixture-v1",
		Workflow: "flowchart", Prompt: "Draw a release review sequence", Placement: "new-page"}
	denied := clusterJSON[document.Failure](t, client, b, owner, "POST", runs, request, 403)
	if denied.Code != "CLOUD_CONSENT_REQUIRED" {
		t.Fatalf("expected per-run external consent, got %+v", denied)
	}
	request.CloudConsent = true
	started := clusterJSON[agent.Run](t, client, a, owner, "POST", runs, request, 202)
	path := runs + "/" + started.ID.String()
	ready := readAgentPreviewSSE(t, b, owner, path, started.ID)
	if ready.Attempt != 1 || ready.Result == nil || ready.Result.Preview == nil || ready.Result.ExternalReply == nil ||
		ready.Result.ExternalReply.Source != "Connector fixture" ||
		!strings.Contains(ready.Result.ExternalReply.Markdown, "## External connector receipt") {
		t.Fatalf("external fixture did not return the validated proposal and Markdown: %+v", ready)
	}
	latest := clusterJSON[agent.Run](t, client, a, owner, "GET", path, nil, 200)
	if !reflect.DeepEqual(ready.Result, latest.Result) {
		t.Fatal("connector result differs across replicas")
	}
	t.Logf("TLS connector run %s returned a typed proposal and source-labeled Markdown after explicit consent", ready.ID)
}

func decodeAgentCluster[T any](t *testing.T, result clusterResponse, status int) T {
	t.Helper()
	var decoded T
	if result.err != nil || result.status != status {
		t.Fatalf("agent HTTP result %d, want %d: %s %v", result.status, status, result.body, result.err)
	}
	if err := json.Unmarshal(result.body, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func assertAgentSnapshot(t *testing.T, a, b document.Snapshot, seq int64) {
	t.Helper()
	if a.Seq != seq || b.Seq != seq || a.Epoch != b.Epoch || a.Hash == "" || a.Hash != b.Hash ||
		!reflect.DeepEqual(a.Document, b.Document) {
		t.Fatalf("replica snapshots diverged: %+v / %+v", a, b)
	}
}

func agentChangeValue(t *testing.T, change *document.Change) any {
	t.Helper()
	raw, err := json.Marshal(change)
	if err != nil {
		t.Fatal(err)
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func readAgentPreviewSSE(t *testing.T, base, token, path string, runID uuid.UUID) agent.Run {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", base)
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Last-Event-ID", "0")
	req.AddCookie(&http.Cookie{Name: "wb_session", Value: token})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("agent state stream returned HTTP %d and %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), jobs.MaxResultBytes+(32<<10))
	var event, eventID, data string
	var prior int64
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "id: "):
			eventID = strings.TrimPrefix(line, "id: ")
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		case line == "" && event == "state":
			var run agent.Run
			revision, err := strconv.ParseInt(eventID, 10, 64)
			if err != nil || json.Unmarshal([]byte(data), &run) != nil ||
				run.ID != runID || revision <= prior || revision != run.Revision {
				t.Fatalf("invalid agent state event for %s at revision %s", runID, eventID)
			}
			prior = revision
			if run.Status == jobs.StatusSucceeded {
				return run
			}
			if run.Status != jobs.StatusRunning && run.Status != jobs.StatusQueued {
				t.Fatalf("agent stopped in %s (%s)", run.Status, run.ErrorCode)
			}
			event, eventID, data = "", "", ""
		}
	}
	t.Fatalf("agent state stream ended before a preview: %v", scanner.Err())
	return agent.Run{}
}
