package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/jobs"
	"github.com/project-wb/server/internal/model"
)

const maxBridgeResponse = 128 << 10

type bridgeRequest struct {
	Provider string          `json:"provider"`
	Model    string          `json:"model"`
	Workflow string          `json:"workflow"`
	Prompt   string          `json:"prompt"`
	Context  []contextRecord `json:"context"`
	Answer   string          `json:"answer,omitempty"`
}

type ExternalReply struct {
	Source   string `json:"source"`
	Markdown string `json:"markdown"`
}

type bridgeResponse struct {
	Proposal      Proposal       `json:"proposal"`
	Usage         *Usage         `json:"usage,omitempty"`
	ExternalReply *ExternalReply `json:"externalReply,omitempty"`
}

func Handlers(config Config) map[string]jobs.Handler {
	return map[string]jobs.Handler{Kind: func(ctx context.Context, lease jobs.Lease) (jobs.Outcome, error) {
		var input jobInput
		if err := decodeStrict(lease.Payload, &input); err != nil {
			return jobs.Outcome{}, jobs.Fail("INVALID_AGENT_JOB")
		}
		excerpts, err := preflight(ctx, config, lease, input)
		if err != nil {
			return jobs.Outcome{}, workerError(err)
		}
		output, err := config.generate(ctx, bridgeRequest{
			Provider: input.Provider, Model: input.Model, Workflow: input.Workflow,
			Prompt: input.Prompt, Context: excerpts, Answer: input.Answer,
		})
		if err != nil {
			return jobs.Outcome{}, err
		}
		if !output.Proposal.valid(input.Workflow, input.Answer != "") {
			return jobs.Outcome{}, jobs.Fail("INVALID_MODEL_OUTPUT")
		}
		if _, err := preflight(ctx, config, lease, input); err != nil {
			return jobs.Outcome{}, workerError(err)
		}
		result := storedResult{Basis: input.Basis, PreviewResult: PreviewResult{
			Proposal: output.Proposal, Usage: output.Usage, ExternalReply: output.ExternalReply,
		}}
		wait := output.Proposal.Question != ""
		if !wait {
			preview, err := buildPreview(output.Proposal, input.Basis, lease.ID, lease.ActorID, lease.CreatedAt)
			if err != nil {
				return jobs.Outcome{}, workerError(err)
			}
			result.Preview = &preview
		}
		encoded, err := json.Marshal(result)
		if err != nil || len(encoded) > jobs.MaxResultBytes {
			return jobs.Outcome{}, jobs.Fail("INVALID_MODEL_OUTPUT")
		}
		return jobs.Outcome{Result: encoded, AwaitInput: wait}, nil
	}}
}

func preflight(ctx context.Context, config Config, lease jobs.Lease, input jobInput) ([]contextRecord, error) {
	var records []contextRecord
	err := writeTx(ctx, func(tx pgx.Tx) error {
		board, err := document.LockFileSnapshot(ctx, tx, lease.BoardID, lease.ActorID, true)
		if err != nil {
			return err
		}
		records, err = verifyBasis(ctx, tx, config, lease.BoardID, board, input.Basis, input.Provider, input.Model)
		return err
	})
	return records, err
}

func workerError(err error) error {
	var fault *Fault
	var command *document.CommandFault
	switch {
	case errors.As(err, &fault):
		return jobs.Fail(fault.Code)
	case errors.As(err, &command):
		return jobs.Fail(command.Code)
	case errors.Is(err, model.ErrRoomAccessDenied), errors.Is(err, model.ErrRoomNotFound):
		return jobs.Fail("ACCESS_DENIED")
	default:
		return err
	}
}

func (config Config) generate(ctx context.Context, input bridgeRequest) (bridgeResponse, error) {
	if config.client == nil || config.endpoint == "" {
		return bridgeResponse{}, jobs.Fail("PROVIDER_NOT_CONFIGURED")
	}
	data, err := json.Marshal(input)
	if err != nil {
		return bridgeResponse{}, jobs.Fail("INVALID_AGENT_JOB")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, config.endpoint, bytes.NewReader(data))
	if err != nil {
		return bridgeResponse{}, jobs.Fail("PROVIDER_NOT_CONFIGURED")
	}
	req.Header.Set("Authorization", "Bearer "+config.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	response, err := config.client.Do(req)
	if err != nil {
		return bridgeResponse{}, uncertainBridgeFailure(input.Provider)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBridgeResponse+1))
	if err != nil {
		return bridgeResponse{}, uncertainBridgeFailure(input.Provider)
	}
	if len(body) > maxBridgeResponse {
		return bridgeResponse{}, jobs.Fail("INVALID_MODEL_OUTPUT")
	}
	if response.StatusCode != http.StatusOK {
		return bridgeResponse{}, providerError(response.StatusCode, body)
	}
	var output bridgeResponse
	if err := decodeStrict(body, &output); err != nil || !validUsage(output.Usage) ||
		!config.validExternalReply(input, output.ExternalReply) {
		return bridgeResponse{}, jobs.Fail("INVALID_MODEL_OUTPUT")
	}
	return output, nil
}

func decodeStrict[T any](body []byte, value *T) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}

func validUsage(usage *Usage) bool {
	return usage == nil ||
		(usage.InputTokens >= 0 && usage.OutputTokens >= 0 && usage.InputTokens <= 10_000_000 && usage.OutputTokens <= 10_000_000)
}

func uncertainBridgeFailure(provider string) error {
	if isCloudProvider(provider) {
		return jobs.Fail("PROVIDER_OUTCOME_UNKNOWN")
	}
	return jobs.Retry("PROVIDER_UNAVAILABLE")
}

func (config Config) validExternalReply(input bridgeRequest, reply *ExternalReply) bool {
	if reply == nil {
		return true
	}
	choice, configured := config.choice(input.Provider, input.Model)
	return configured && input.Provider == "external" && reply.Source == choice.Label &&
		validText(reply.Source, 80, false) && validText(reply.Markdown, 4000, false)
}

func providerError(status int, body []byte) error {
	var response struct {
		Code      string `json:"code"`
		Error     string `json:"error"`
		Retryable bool   `json:"retryable"`
	}
	_ = decodeStrict(body, &response)
	switch response.Code {
	case "PROVIDER_RATE_LIMIT", "PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT":
		if response.Retryable && (status == http.StatusTooManyRequests || status >= 500) {
			return jobs.Retry(response.Code)
		}
		return jobs.Fail(response.Code)
	case "PROVIDER_OUTCOME_UNKNOWN", "PROVIDER_REFUSAL", "PROVIDER_REJECTED", "INVALID_MODEL_OUTPUT", "PROVIDER_NOT_CONFIGURED":
		return jobs.Fail(response.Code)
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return jobs.Fail("PROVIDER_NOT_CONFIGURED")
	}
	return jobs.Fail("PROVIDER_UNAVAILABLE")
}
