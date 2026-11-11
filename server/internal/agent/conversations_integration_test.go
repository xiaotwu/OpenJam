package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/jobs"
	"github.com/project-wb/server/internal/model"
)

func TestAgentPauseFencesAttemptAndResumesSameRun(t *testing.T) {
	ctx := agentTestDatabase(t)
	owner, board := agentFixture(t, ctx)
	config := conversationFixture(t, ctx, board, owner)
	input := conversationInput("Create a workshop for the next release")
	run, err := Start(ctx, config, board, owner, input)
	if err != nil {
		t.Fatal(err)
	}
	paused, err := Pause(ctx, board, owner, run.ID)
	if err != nil || paused.Status != jobs.StatusPaused || paused.Revision <= run.Revision {
		t.Fatalf("pause queued run: %+v, %v", paused, err)
	}
	if duplicate, err := Pause(ctx, board, owner, run.ID); err != nil || duplicate.Revision != paused.Revision {
		t.Fatalf("pause replay: %+v, %v", duplicate, err)
	}
	if _, err := jobs.Claim(ctx, []string{Kind}, time.Second); !errors.Is(err, jobs.ErrNoWork) {
		t.Fatalf("a paused job could be claimed: %v", err)
	}
	if resumed, err := Resume(ctx, config, board, owner, run.ID); err != nil ||
		resumed.Status != jobs.StatusQueued || resumed.ID != run.ID || !resumed.InputExpiresAt.Equal(run.InputExpiresAt) {
		t.Fatalf("resume queued job: %+v, %v", resumed, err)
	}
	first, err := jobs.Claim(ctx, []string{Kind}, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	paused, err = Pause(ctx, board, owner, run.ID)
	if err != nil || paused.Status != jobs.StatusPaused || paused.Attempt != 0 {
		t.Fatalf("pause running local job: %+v, %v", paused, err)
	}
	if err := jobs.Renew(ctx, first.ID, first.Token, time.Second); !errors.Is(err, jobs.ErrLeaseLost) {
		t.Fatalf("paused worker could renew: %v", err)
	}
	if _, err := Resume(ctx, config, board, owner, run.ID); err != nil {
		t.Fatal(err)
	}
	lease, err := jobs.Claim(ctx, []string{Kind}, 5*time.Second)
	if err != nil || lease.ID != run.ID || lease.Token == first.Token || lease.Attempt != 1 {
		t.Fatalf("resumed lease: %+v, %v", lease, err)
	}
	if _, err := jobs.Complete(ctx, first, jobs.Outcome{}); !errors.Is(err, jobs.ErrLeaseLost) {
		t.Fatalf("old worker published after resume: %v", err)
	}
	if replay, err := Resume(ctx, config, board, owner, run.ID); err != nil || replay.Revision != lease.Revision {
		t.Fatalf("resume replay while running: %+v, %v", replay, err)
	}
	outcome, err := Handlers(config)[Kind](ctx, lease)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := jobs.Complete(ctx, lease, outcome); err != nil {
		t.Fatal(err)
	}
	if complete, err := Resume(ctx, config, board, owner, run.ID); err != nil ||
		complete.Status != jobs.StatusSucceeded || complete.Result == nil || complete.Conversation == nil || complete.Conversation.Prompt != input.Prompt {
		t.Fatalf("resume replay after completion: %+v, %v", complete, err)
	}

	input.RequestID = uuid.New()
	other, err := Start(ctx, config, board, owner, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Pause(ctx, board, owner, other.ID); err != nil {
		t.Fatal(err)
	}
	if cancelled, err := Cancel(ctx, board, owner, other.ID); err != nil || cancelled.Status != jobs.StatusCancelled {
		t.Fatalf("cancel paused job: %+v, %v", cancelled, err)
	}
	if _, err := Resume(ctx, config, board, owner, other.ID); !errors.Is(err, jobs.ErrConflict) {
		t.Fatalf("cancelled job resumed: %v", err)
	}
	input.RequestID = uuid.New()
	expiring, err := Start(ctx, config, board, owner, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Pause(ctx, board, owner, expiring.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE jobs SET input_expires_at = clock_timestamp() WHERE id = $1`, expiring.ID); err != nil {
		t.Fatal(err)
	}
	if err := jobs.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if expired, err := Get(ctx, board, owner, expiring.ID); err != nil || expired.Status != jobs.StatusExpired {
		t.Fatalf("paused job did not expire: %+v, %v", expired, err)
	}
}

func TestAgentShareIsFrozenAndRestrictedToBoardMembers(t *testing.T) {
	ctx := agentTestDatabase(t)
	owner, board := agentFixture(t, ctx)
	config := conversationFixture(t, ctx, board, owner)
	viewer := agentUser(t, ctx, "agent-share-viewer")
	linked := agentUser(t, ctx, "agent-link-viewer")
	if _, err := model.InviteRoomMemberByEmail(ctx, board, owner, viewer.Email, model.RoomPermissionView); err != nil {
		t.Fatal(err)
	}
	_, link, err := model.CreateBoardShareLink(ctx, board, owner, model.RoomPermissionView, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := model.RedeemBoardShareLink(ctx, board, linked.ID, link); err != nil {
		t.Fatal(err)
	}
	run, err := Start(ctx, config, board, owner, conversationInput("clarify the release scope"))
	if err != nil || run.Shared || run.Conversation == nil {
		t.Fatalf("private by default: %+v, %v", run, err)
	}
	if _, err := GetShared(ctx, board, viewer.ID, run.ID); !errors.Is(err, jobs.ErrNotFound) {
		t.Fatalf("unpublished conversation exposed: %v", err)
	}
	if _, err := SetShared(ctx, board, owner, run.ID, true); DescribeError(err).Code != "CONVERSATION_NOT_SHAREABLE" {
		t.Fatalf("queued conversation published: %v", err)
	}
	runAgentAttempt(t, ctx, config)
	published, err := SetShared(ctx, board, owner, run.ID, true)
	if err != nil || !published.Shared || published.Status != jobs.StatusAwaitingInput {
		t.Fatalf("publish question: %+v, %v", published, err)
	}
	frozen, err := GetShared(ctx, board, viewer.ID, run.ID)
	if err != nil || frozen.Result == nil || frozen.Result.Proposal.Question == "" || frozen.Conversation.Answer != "" {
		t.Fatalf("shared clarification: %+v, %v", frozen, err)
	}
	if _, err := GetShared(ctx, board, linked.ID, run.ID); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("link-only viewer read the conversation: %v", err)
	}
	if _, err := Get(ctx, board, viewer.ID, run.ID); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("viewer read initiator's run: %v", err)
	}
	answer := "Private clarification until the author republishes"
	updated, err := Answer(ctx, config, board, owner, run.ID, AnswerInput{Revision: published.Revision, Answer: answer})
	if err != nil || updated.Conversation == nil || updated.Conversation.Answer != answer || !updated.Shared {
		t.Fatalf("record private answer: %+v, %v", updated, err)
	}
	runAgentAttempt(t, ctx, config)
	repeated, err := SetShared(ctx, board, owner, run.ID, true)
	if err != nil || !repeated.Shared {
		t.Fatalf("repeat publication: %+v, %v", repeated, err)
	}
	stillFrozen, err := GetShared(ctx, board, viewer.ID, run.ID)
	if err != nil || stillFrozen.Revision != frozen.Revision || stillFrozen.Conversation.Answer != "" {
		t.Fatalf("future clarification answer leaked: %+v, %v", stillFrozen, err)
	}
	if off, err := SetShared(ctx, board, owner, run.ID, false); err != nil || off.Shared {
		t.Fatalf("unshare: %+v, %v", off, err)
	}
	if _, err := GetShared(ctx, board, viewer.ID, run.ID); !errors.Is(err, jobs.ErrNotFound) {
		t.Fatalf("revoked snapshot accessible: %v", err)
	}
	if _, err := SetShared(ctx, board, owner, run.ID, true); err != nil {
		t.Fatal(err)
	}
	newSnapshot, err := GetShared(ctx, board, viewer.ID, run.ID)
	if err != nil || newSnapshot.Conversation.Answer != answer || newSnapshot.Status != jobs.StatusSucceeded {
		t.Fatalf("republished finished transcript: %+v, %v", newSnapshot, err)
	}
	raw, err := json.Marshal(newSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"operations", "preview", "pageId", "applied", "clientId", "commandId", "requestId", "basis"} {
		if strings.Contains(string(raw), "\""+key+"\":") {
			t.Fatalf("shared payload contained %s: %s", key, raw)
		}
	}
	if err := model.RemoveRoomMember(ctx, board, owner, viewer.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := GetShared(ctx, board, viewer.ID, run.ID); !errors.Is(err, model.ErrRoomAccessDenied) {
		t.Fatalf("revoked member read published snapshot: %v", err)
	}
}

func TestAgentShareOmitsModelTextForSelectedSourcesAndExpires(t *testing.T) {
	ctx := agentTestDatabase(t)
	owner, board := agentFixture(t, ctx)
	config := conversationFixture(t, ctx, board, owner)
	initial, err := document.Open(ctx, board, owner, false)
	if err != nil {
		t.Fatal(err)
	}
	seedText(t, ctx, board, owner, initial.Document.DefaultPageID, "selected", "Private source excerpt")
	input := conversationInput("Generate a workshop from the selected note")
	input.SelectedIDs = []string{"selected"}
	run, err := Start(ctx, config, board, owner, input)
	if err != nil {
		t.Fatal(err)
	}
	runAgentAttempt(t, ctx, config)
	if _, err := SetShared(ctx, board, owner, run.ID, true); err != nil {
		t.Fatal(err)
	}
	shared, err := GetShared(ctx, board, owner, run.ID)
	if err != nil || shared.Result != nil || shared.Conversation.Prompt != input.Prompt {
		t.Fatalf("selected-source projection: %+v, %v", shared, err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE agent_conversations SET expires_at = clock_timestamp() WHERE job_id = $1`, run.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := GetShared(ctx, board, owner, run.ID); !errors.Is(err, jobs.ErrNotFound) {
		t.Fatalf("expired share was visible: %v", err)
	}
	if err := SweepConversations(ctx); err != nil {
		t.Fatal(err)
	}
	var retained bool
	if err := db.Pool().QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agent_conversations WHERE job_id = $1)`, run.ID).
		Scan(&retained); err != nil || retained {
		t.Fatalf("expired conversation remained after maintenance: %v, %v", retained, err)
	}
}

func conversationFixture(t *testing.T, ctx context.Context, board string, actor uuid.UUID) Config {
	t.Helper()
	provider, _ := testBridge(t)
	config := Config{endpoint: provider.URL, token: "fixture-only", client: provider.Client(),
		choices: []Choice{{Provider: "mock", Model: "deterministic-v1"}}}
	if _, err := SetBoardSettings(ctx, config, board, actor, SettingsInput{
		Enabled: true, Provider: "mock", Model: "deterministic-v1",
	}); err != nil {
		t.Fatal(err)
	}
	return config
}

func conversationInput(prompt string) StartInput {
	return StartInput{RequestID: uuid.New(), Provider: "mock", Model: "deterministic-v1", Workflow: "workshop", Prompt: prompt}
}
