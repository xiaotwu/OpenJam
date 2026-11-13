package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/document"
	"github.com/xiaotwu/shiori/server/internal/jobs"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestAgentDraftAppliesOnceAndUsesDocumentUndo(t *testing.T) {
	ctx := agentTestDatabase(t)
	owner, board := agentFixture(t, ctx)
	editor := agentUser(t, ctx, "agent-editor")
	if _, err := model.InviteRoomMemberByEmail(ctx, board, owner, "agent-editor@example.invalid", model.RoomPermissionEdit); err != nil {
		t.Fatal(err)
	}
	provider, requests := testBridge(t)
	config := Config{endpoint: provider.URL, token: "fixture-only", client: provider.Client(),
		choices: []Choice{{Provider: "mock", Model: "deterministic-v1"}}}
	snapshot, err := document.Open(ctx, board, owner, false)
	if err != nil {
		t.Fatal(err)
	}
	page := snapshot.Document.DefaultPageID
	seedText(t, ctx, board, owner, page, "selected", "Only selected text")
	seedText(t, ctx, board, owner, page, "private", "Outside the request")
	input := StartInput{RequestID: uuid.New(), Provider: "mock", Model: "deterministic-v1", Workflow: "workshop",
		Prompt: "clarify the team workshop", Placement: newPage, SelectedIDs: []string{"selected"}}
	if _, err := Start(ctx, config, board, owner, input); DescribeError(err).Code != "AI_DISABLED" {
		t.Fatalf("AI default: %v", err)
	}
	settings := SettingsInput{Enabled: true, Provider: input.Provider, Model: input.Model}
	if _, err := SetBoardSettings(ctx, config, board, editor.ID, settings); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("editor managed policy: %v", err)
	}
	if saved, err := SetBoardSettings(ctx, config, board, owner, settings); err != nil || !saved.Enabled {
		t.Fatalf("enable mock: %+v, %v", saved, err)
	}
	initial, err := Start(ctx, config, board, owner, input)
	if err != nil || initial.Status != jobs.StatusQueued {
		t.Fatalf("start: %+v, %v", initial, err)
	}
	if again, err := Start(ctx, config, board, owner, input); err != nil || again.ID != initial.ID {
		t.Fatalf("start replay: %+v, %v", again, err)
	}
	mismatch := input
	mismatch.Prompt = "A different prompt"
	if _, err := Start(ctx, config, board, owner, mismatch); !errors.Is(err, jobs.ErrConflict) {
		t.Fatalf("mutated request replay: %v", err)
	}
	if _, err := Get(ctx, board, editor.ID, initial.ID); !errors.Is(err, jobs.ErrNotFound) {
		t.Fatalf("another editor read private run: %v", err)
	}
	runAgentAttempt(t, ctx, config)
	waiting, err := Get(ctx, board, owner, initial.ID)
	if err != nil || waiting.Status != jobs.StatusAwaitingInput || waiting.Result == nil ||
		waiting.Result.Proposal.Question == "" || waiting.Result.Preview != nil {
		t.Fatalf("awaiting input: %+v, %v", waiting, err)
	}
	request := <-requests
	if len(request.Context) != 1 || request.Context[0].ID != "selected" || request.Context[0].Text != "Only selected text" ||
		request.Answer != "" {
		t.Fatalf("scoped provider input: %+v", request)
	}
	answer := AnswerInput{Revision: waiting.Revision, Answer: "Select a release owner"}
	if resumed, err := Answer(ctx, config, board, owner, initial.ID, answer); err != nil || resumed.Status != jobs.StatusQueued {
		t.Fatalf("answer: %+v, %v", resumed, err)
	}
	if _, err := Answer(ctx, config, board, owner, initial.ID, answer); !errors.Is(err, jobs.ErrConflict) {
		t.Fatalf("answer CAS: %v", err)
	}
	runAgentAttempt(t, ctx, config)
	ready, err := Get(ctx, board, owner, initial.ID)
	if err != nil || ready.Status != jobs.StatusSucceeded || ready.Result == nil || ready.Result.Preview == nil {
		t.Fatalf("preview: %+v, %v", ready, err)
	}
	if after := <-requests; after.Answer != answer.Answer || len(after.Context) != 1 {
		t.Fatalf("clarification bridge: %+v", after)
	}
	raw, err := json.Marshal(ready)
	if err != nil || strings.Contains(string(raw), "\"basis\"") || strings.Contains(string(raw), "\"payload\"") ||
		ready.Conversation == nil || ready.Conversation.Prompt != input.Prompt || ready.Conversation.Answer != answer.Answer {
		t.Fatalf("unexpected initiator conversation projection: %v", err)
	}
	before, err := document.Open(ctx, board, owner, false)
	if err != nil || len(before.Document.Pages) != 1 || len(before.Document.Elements) != 2 || before.Seq != 2 {
		t.Fatalf("preview changed the board: %+v, %v", before, err)
	}
	seedText(t, ctx, board, editor.ID, page, "concurrent", "Independent edit")
	apply := ApplyInput{Revision: ready.Revision, ClientID: uuid.New()}
	type applied struct {
		value Application
		err   error
	}
	ch := make(chan applied, 2)
	for range 2 {
		go func() {
			value, err := Apply(ctx, config, board, owner, initial.ID, apply)
			ch <- applied{value, err}
		}()
	}
	a, b := <-ch, <-ch
	if a.err != nil || b.err != nil || a.value.Ack.Seq != 4 || b.value.Ack.Seq != 4 ||
		a.value.Ack.Replayed == b.value.Ack.Replayed || a.value.PageID != b.value.PageID ||
		a.value.Ack.Change == nil || b.value.Ack.Change == nil {
		t.Fatalf("concurrent apply: %+v / %+v", a, b)
	}
	appliedRun, err := Get(ctx, board, owner, initial.ID)
	if err != nil || appliedRun.Applied == nil || appliedRun.Revision <= ready.Revision {
		t.Fatalf("read application receipt: %+v, %v", appliedRun, err)
	}
	if _, err := Apply(ctx, config, board, owner, initial.ID, ApplyInput{ready.Revision, uuid.New()}); DescribeError(err).Code != "RUN_ALREADY_APPLIED" {
		t.Fatalf("other client replay: %v", err)
	}
	final, err := document.Open(ctx, board, owner, false)
	if err != nil || final.Seq != 4 || len(final.Document.Pages) != 2 || len(final.Document.Elements) <= 3 {
		t.Fatalf("applied board: %+v, %v", final, err)
	}
	var inverse []document.Operation
	for i := len(a.value.Ack.Change.Operations) - 1; i >= 0; i-- {
		op := a.value.Ack.Change.Operations[i]
		inverse = append(inverse, document.Operation{Kind: "delete", Collection: op.Collection, ID: op.ID})
	}
	if _, err := document.Commit(ctx, board, owner, document.Command{
		ProtocolVersion: document.ProtocolVersion, Epoch: final.Epoch, BaseSeq: final.Seq,
		ClientID: apply.ClientID.String(), CommandID: uuid.NewString(), DependsOn: initial.ID.String(), Operations: inverse,
	}); err != nil {
		t.Fatalf("regular document undo of applied draft: %v", err)
	}
	undone, err := document.Open(ctx, board, editor.ID, false)
	if err != nil || undone.Seq != 5 || len(undone.Document.Pages) != 1 || len(undone.Document.Elements) != 3 {
		t.Fatalf("undone board: %+v, %v", undone, err)
	}
	history, err := List(ctx, board, owner)
	if err != nil || len(history) != 1 || history[0].Applied == nil || history[0].Result != nil ||
		history[0].Provider != "mock" || history[0].Workflow != "workshop" {
		t.Fatalf("run list: %+v, %v", history, err)
	}
}

func TestAgentCloudConsentPolicyAndStaleSources(t *testing.T) {
	ctx := agentTestDatabase(t)
	owner := agentUser(t, ctx, "agent-owner")
	team, err := model.CreateOrganization(ctx, owner.ID, "Agent fixture team")
	if err != nil {
		t.Fatal(err)
	}
	var project uuid.UUID
	if err := db.Pool().QueryRow(ctx, `SELECT p.id FROM projects p JOIN workspaces w ON p.workspace_id = w.id
		WHERE w.organization_id = $1`, team.ID).Scan(&project); err != nil {
		t.Fatal(err)
	}
	room, err := model.CreateProjectBoard(ctx, owner.ID, project, "Agent fixture board")
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := document.Open(ctx, room.ID, owner.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	page := snapshot.Document.DefaultPageID
	seedText(t, ctx, room.ID, owner.ID, page, "source", "Selected source")
	provider, requests := testBridge(t)
	config := Config{endpoint: provider.URL, token: "fixture-only", client: provider.Client(),
		choices: []Choice{{Provider: "openai", Model: "fixture-cloud", Cloud: true}}}
	set := SettingsInput{Enabled: true, Provider: "openai", Model: "fixture-cloud"}
	if _, err := SetOrganizationSettings(ctx, config, team.ID, owner.ID, set); err != nil {
		t.Fatal(err)
	}
	current, err := ReadSettings(ctx, config, room.ID, owner.ID)
	if err != nil || !current.Enabled || current.OrganizationID == nil || *current.OrganizationID != team.ID || current.AllowBoardContext {
		t.Fatalf("mapped organization settings: %+v, %v", current, err)
	}
	input := StartInput{RequestID: uuid.New(), Provider: "openai", Model: "fixture-cloud", Workflow: "workshop",
		Prompt: "Create an action workshop", SelectedIDs: []string{"source"}, Placement: currentPage, PageID: page}
	if _, err := Start(ctx, config, room.ID, owner.ID, input); DescribeError(err).Code != "CLOUD_CONSENT_REQUIRED" {
		t.Fatalf("cloud without consent: %v", err)
	}
	input.CloudConsent = true
	if _, err := Start(ctx, config, room.ID, owner.ID, input); DescribeError(err).Code != "CLOUD_CONTEXT_DISABLED" {
		t.Fatalf("cloud selection without policy: %v", err)
	}
	set.AllowBoardContext = true
	if _, err := SetOrganizationSettings(ctx, config, team.ID, owner.ID, set); err != nil {
		t.Fatal(err)
	}
	queued, err := Start(ctx, config, room.ID, owner.ID, input)
	if err != nil || queued.MaxAttempts != 1 {
		t.Fatalf("queue cloud run: %+v, %v", queued, err)
	}
	editText(t, ctx, room.ID, owner.ID, "source", "Changed before inference")
	lease, err := jobs.Claim(ctx, []string{Kind}, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, err = Handlers(config)[Kind](ctx, lease)
	rejected, rejectErr := jobs.Reject(ctx, lease, err)
	if err == nil || rejectErr != nil || rejected.ErrorCode != "STALE_SOURCES" || rejected.Status != jobs.StatusFailed || len(requests) != 0 {
		t.Fatalf("pre-provider stale check: %+v, %v, %v", rejected, err, rejectErr)
	}
	input.RequestID = uuid.New()
	queued, err = Start(ctx, config, room.ID, owner.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	runAgentAttempt(t, ctx, config)
	if request := <-requests; len(request.Context) != 1 || request.Context[0].Text != "Changed before inference" {
		t.Fatalf("cloud selection: %+v", request)
	}
	ready, err := Get(ctx, room.ID, owner.ID, queued.ID)
	if err != nil || ready.Result == nil || ready.Result.Preview == nil {
		t.Fatalf("cloud preview: %+v, %v", ready, err)
	}
	editText(t, ctx, room.ID, owner.ID, "source", "Changed before apply")
	if _, err := Apply(ctx, config, room.ID, owner.ID, queued.ID, ApplyInput{ready.Revision, uuid.New()}); DescribeError(err).Code != "STALE_SOURCES" {
		t.Fatalf("stale draft applied: %v", err)
	}
	editText(t, ctx, room.ID, owner.ID, "source", "Changed before inference")
	set.Enabled = false
	if _, err := SetOrganizationSettings(ctx, config, team.ID, owner.ID, set); err != nil {
		t.Fatal(err)
	}
	set.Enabled = true
	if _, err := SetOrganizationSettings(ctx, config, team.ID, owner.ID, set); err != nil {
		t.Fatal(err)
	}
	if _, err := Apply(ctx, config, room.ID, owner.ID, queued.ID, ApplyInput{ready.Revision, uuid.New()}); DescribeError(err).Code != "POLICY_CHANGED" {
		t.Fatalf("old policy draft applied: %v", err)
	}

	input.RequestID, input.SelectedIDs = uuid.New(), nil
	abandoned, err := Start(ctx, config, room.ID, owner.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if paused, err := Pause(ctx, room.ID, owner.ID, abandoned.ID); err != nil || paused.Status != jobs.StatusPaused {
		t.Fatalf("queued cloud call did not pause: %+v, %v", paused, err)
	}
	if _, err := Resume(ctx, config, room.ID, owner.ID, abandoned.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := jobs.Claim(ctx, []string{Kind}, time.Second); err != nil {
		t.Fatal(err)
	}
	if _, err := Pause(ctx, room.ID, owner.ID, abandoned.ID); DescribeError(err).Code != "CLOUD_RUN_IN_PROGRESS" {
		t.Fatalf("an in-flight cloud call was paused: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE jobs SET lease_until = clock_timestamp() WHERE id = $1`, abandoned.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := jobs.Claim(ctx, []string{Kind}, time.Second); !errors.Is(err, jobs.ErrNoWork) {
		t.Fatalf("an interrupted cloud call was reclaimed automatically: %v", err)
	}
	if err := jobs.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if interrupted, err := Get(ctx, room.ID, owner.ID, abandoned.ID); err != nil ||
		interrupted.Status != jobs.StatusFailed || interrupted.ErrorCode != "PROVIDER_OUTCOME_UNKNOWN" {
		t.Fatalf("ambiguous cloud lease outcome: %+v, %v", interrupted, err)
	}
	input.RequestID = uuid.New()
	if _, err := Start(ctx, config, room.ID, owner.ID, input); err != nil {
		t.Fatal(err)
	}
	runAgentAttempt(t, ctx, config)
	if promptOnly := <-requests; promptOnly.Context == nil || len(promptOnly.Context) != 0 {
		t.Fatalf("prompt-only run must use an empty bridge context array: %+v", promptOnly)
	}
}

func TestAgentCurrentPlacementAndRestorationFences(t *testing.T) {
	ctx := agentTestDatabase(t)
	owner, board := agentFixture(t, ctx)
	provider, requests := testBridge(t)
	config := Config{endpoint: provider.URL, token: "fixture-only", client: provider.Client(),
		choices: []Choice{{Provider: "mock", Model: "deterministic-v1"}}}
	if _, err := SetBoardSettings(ctx, config, board, owner, SettingsInput{
		Enabled: true, Provider: "mock", Model: "deterministic-v1",
	}); err != nil {
		t.Fatal(err)
	}
	base, err := document.Open(ctx, board, owner, false)
	if err != nil {
		t.Fatal(err)
	}
	version, err := document.NameVersion(ctx, board, owner, "Before the draft",
		document.VersionPosition{ExpectedEpoch: base.Epoch, ExpectedSeq: base.Seq})
	if err != nil {
		t.Fatal(err)
	}
	input := StartInput{RequestID: uuid.New(), Provider: "mock", Model: "deterministic-v1", Workflow: "workshop",
		Prompt: "Build a release workshop", Placement: currentPage, PageID: base.Document.DefaultPageID}
	queued, err := Start(ctx, config, board, owner, input)
	if err != nil {
		t.Fatal(err)
	}
	runAgentAttempt(t, ctx, config)
	<-requests
	ready, err := Get(ctx, board, owner, queued.ID)
	if err != nil || ready.Result == nil || ready.Result.Preview == nil || ready.Result.Preview.PageID != input.PageID {
		t.Fatalf("current-page draft: %+v, %v", ready, err)
	}
	seedText(t, ctx, board, owner, input.PageID, "overlap", "Object in the proposed area")
	if _, err := Apply(ctx, config, board, owner, queued.ID, ApplyInput{ready.Revision, uuid.New()}); DescribeError(err).Code != "TARGET_OCCUPIED" {
		t.Fatalf("overlapping draft applied: %v", err)
	}
	diverged, err := document.Open(ctx, board, owner, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := document.RestoreVersion(ctx, board, owner, version.ID, uuid.New(),
		document.VersionPosition{ExpectedEpoch: diverged.Epoch, ExpectedSeq: diverged.Seq}); err != nil {
		t.Fatal(err)
	}
	if _, err := Apply(ctx, config, board, owner, queued.ID, ApplyInput{ready.Revision, uuid.New()}); DescribeError(err).Code != "STALE_EPOCH" {
		t.Fatalf("draft applied after board restore: %v", err)
	}
	input.RequestID = uuid.New()
	queued, err = Start(ctx, config, board, owner, input)
	if err != nil {
		t.Fatal(err)
	}
	runAgentAttempt(t, ctx, config)
	<-requests
	ready, err = Get(ctx, board, owner, queued.ID)
	if err != nil {
		t.Fatal(err)
	}
	applied, err := Apply(ctx, config, board, owner, queued.ID, ApplyInput{ready.Revision, uuid.New()})
	if err != nil || applied.PageID != input.PageID {
		t.Fatalf("apply on current page: %+v, %v", applied, err)
	}
	final, err := document.Open(ctx, board, owner, false)
	if err != nil || len(final.Document.Pages) != 1 || len(final.Document.Elements) == 0 {
		t.Fatalf("applied current page: %+v, %v", final, err)
	}
}

func testBridge(t *testing.T) (*httptest.Server, <-chan bridgeRequest) {
	t.Helper()
	requests := make(chan bridgeRequest, 10)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer fixture-only" {
			t.Error("bridge request lacked authentication")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var request bridgeRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("bridge request JSON: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		requests <- request
		proposal := Proposal{Title: "Release workshop", Summary: "Plan the release",
			Groups: []Group{}, Nodes: []Node{}, Edges: []Edge{}}
		if strings.HasPrefix(request.Prompt, "clarify") && request.Answer == "" {
			proposal.Question = "What decision should the team make?"
		} else {
			proposal.Groups = []Group{{Title: "Next steps", Items: []string{"Assign an owner", "Agree on a deadline"}}}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(bridgeResponse{Proposal: proposal}); err != nil {
			t.Errorf("write bridge response: %v", err)
		}
	}))
	t.Cleanup(server.Close)
	return server, requests
}

func runAgentAttempt(t *testing.T, ctx context.Context, config Config) {
	t.Helper()
	lease, err := jobs.Claim(ctx, []string{Kind}, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := Handlers(config)[Kind](ctx, lease)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := jobs.Complete(ctx, lease, outcome); err != nil {
		t.Fatal(err)
	}
}

func seedText(t *testing.T, ctx context.Context, board string, actor uuid.UUID, page, id, value string) {
	t.Helper()
	data, err := json.Marshal(map[string]any{"id": id, "pageId": page, "type": "sticky", "text": value, "x": 20, "y": 20, "width": 140, "height": 100})
	if err != nil {
		t.Fatal(err)
	}
	agentCommit(t, ctx, board, actor, document.Operation{Kind: "add", Collection: "elements", ID: id, Value: data})
}

func editText(t *testing.T, ctx context.Context, board string, actor uuid.UUID, id, value string) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	agentCommit(t, ctx, board, actor, document.Operation{Kind: "patch", Collection: "elements", ID: id,
		Fields: map[string]json.RawMessage{"text": data}})
}

func agentCommit(t *testing.T, ctx context.Context, board string, actor uuid.UUID, operation document.Operation) {
	t.Helper()
	snapshot, err := document.Open(ctx, board, actor, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := document.Commit(ctx, board, actor, document.Command{
		ProtocolVersion: document.ProtocolVersion, Epoch: snapshot.Epoch, BaseSeq: snapshot.Seq,
		ClientID: uuid.NewString(), CommandID: uuid.NewString(), Operations: []document.Operation{operation},
	}); err != nil {
		t.Fatal(err)
	}
}

func agentUser(t *testing.T, ctx context.Context, id string) *model.User {
	t.Helper()
	user, err := model.CreateUser(ctx, id+"@example.invalid", "fixture-only", "Agent fixture")
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func agentFixture(t *testing.T, ctx context.Context) (uuid.UUID, string) {
	t.Helper()
	owner := agentUser(t, ctx, "agent-owner")
	room, err := model.CreateRoom(ctx, "Agent fixture", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := document.Open(ctx, room.ID, owner.ID, true); err != nil {
		t.Fatal(err)
	}
	return owner.ID, room.ID
}

func agentTestDatabase(t *testing.T) context.Context {
	t.Helper()
	dsn := os.Getenv("OPENJAM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set OPENJAM_TEST_DATABASE_URL to run the PostgreSQL integration test")
	}
	isolated, err := url.Parse(dsn)
	if err != nil || (isolated.Scheme != "postgres" && isolated.Scheme != "postgresql") {
		t.Fatal("OPENJAM_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "openjam_agent_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	query := isolated.Query()
	query.Set("search_path", schema)
	isolated.RawQuery = query.Encode()
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
