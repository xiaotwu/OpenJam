package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExternalChoiceFromDeployment(t *testing.T) {
	t.Setenv("OPENJAM_AGENT_URL", "http://agent:8091")
	t.Setenv("OPENJAM_AGENT_TOKEN", strings.Repeat("x", 32))
	t.Setenv("OPENJAM_EXTERNAL_AGENT_MODEL", "adapter/board-draft-v1")
	t.Setenv("OPENJAM_EXTERNAL_AGENT_LABEL", "  Team assistant  ")
	config, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	choice, found := config.choice("external", "adapter/board-draft-v1")
	if !found || !choice.Cloud || choice.Label != "Team assistant" {
		t.Fatalf("external choice: %+v", choice)
	}
	if _, found := config.choice("external", "browser-supplied-model"); found {
		t.Fatal("unconfigured model was made available")
	}
	t.Setenv("OPENJAM_EXTERNAL_AGENT_LABEL", "First\nSecond")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("multiline provider label was accepted")
	}
}

func TestBridgeValidatesExternalReplyBeforeExposingIt(t *testing.T) {
	for _, test := range []struct {
		name     string
		provider string
		reply    *ExternalReply
		valid    bool
	}{
		{"valid reply", "external", &ExternalReply{Source: "Team assistant", Markdown: "# Review\n\n- Confirm scope"}, true},
		{"missing reply", "external", nil, true},
		{"unexpected source", "external", &ExternalReply{Source: "Other assistant", Markdown: "Draft"}, false},
		{"long reply", "external", &ExternalReply{Source: "Team assistant", Markdown: strings.Repeat("界", 4001)}, false},
		{"other provider", "ollama", &ExternalReply{Source: "Team assistant", Markdown: "Draft"}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer internal-fixture-token" {
					http.Error(w, "unexpected credentials", http.StatusUnauthorized)
					return
				}
				_ = json.NewEncoder(w).Encode(bridgeResponse{ExternalReply: test.reply})
			}))
			t.Cleanup(bridge.Close)
			config := Config{endpoint: bridge.URL, token: "internal-fixture-token", client: bridge.Client(),
				choices: []Choice{{Provider: "external", Model: "adapter", Cloud: true, Label: "Team assistant"}}}
			result, err := config.generate(context.Background(), bridgeRequest{Provider: test.provider, Model: "adapter"})
			if !test.valid {
				if err == nil || err.Error() != "INVALID_MODEL_OUTPUT" {
					t.Fatalf("expected invalid model output, got %v", err)
				}
				return
			}
			if err != nil || (test.reply == nil) != (result.ExternalReply == nil) {
				t.Fatalf("result: %+v / %v", result, err)
			}
			if test.reply != nil && *test.reply != *result.ExternalReply {
				t.Fatalf("reply changed: %+v", result.ExternalReply)
			}
		})
	}
}
