package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/document"
)

const (
	Kind = "agent_run"

	newPage         = "new-page"
	currentPage     = "current-page"
	maxSelected     = 12
	maxContextItem  = 1200
	maxContextRunes = 6000
	maxGeometry     = 10000
	maxCoordinate   = 10_000_000
)

type StartInput struct {
	RequestID    uuid.UUID `json:"requestId"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	Workflow     string    `json:"workflow"`
	Prompt       string    `json:"prompt"`
	SelectedIDs  []string  `json:"selectedIds,omitempty"`
	CloudConsent bool      `json:"cloudConsent"`
	Placement    string    `json:"placement"`
	PageID       string    `json:"pageId,omitempty"`
}

type point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type sourceDependency struct {
	ID     string `json:"id"`
	Digest string `json:"digest"`
}

type runBasis struct {
	PolicyID       uuid.UUID          `json:"policyId"`
	PolicyRevision int64              `json:"policyRevision"`
	Epoch          int64              `json:"epoch"`
	Placement      string             `json:"placement"`
	PageID         string             `json:"pageId"`
	Origin         point              `json:"origin"`
	Sources        []sourceDependency `json:"sources"`
	CloudConsent   bool               `json:"cloudConsent"`
}

type jobInput struct {
	Basis    runBasis `json:"basis"`
	Provider string   `json:"provider"`
	Model    string   `json:"model"`
	Workflow string   `json:"workflow"`
	Prompt   string   `json:"prompt"`
	Answer   string   `json:"answer,omitempty"`
}

type contextRecord struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

func normalizeStart(input *StartInput) error {
	input.Prompt = strings.TrimSpace(input.Prompt)
	if input.RequestID == uuid.Nil || !validText(input.Prompt, 4000, false) ||
		len(input.SelectedIDs) > maxSelected || !modelPattern.MatchString(input.Model) ||
		(input.Provider != "openai" && input.Provider != "ollama" && input.Provider != "mock" && input.Provider != "external") {
		return invalid("Provide a request ID, a configured model, and a prompt of 1–4000 characters.")
	}
	switch input.Workflow {
	case "organize":
		if len(input.SelectedIDs) == 0 {
			return invalid("Select at least one textual object to organize.")
		}
	case "workshop", "flowchart":
	default:
		return invalid("Choose a supported workflow.")
	}
	switch input.Placement {
	case "", newPage:
		input.Placement, input.PageID = newPage, ""
	case currentPage:
		if !validID(input.PageID) {
			return invalid("Choose the target page.")
		}
	default:
		return invalid("Choose a supported placement.")
	}
	ids := slices.Clone(input.SelectedIDs)
	slices.Sort(ids)
	for i, id := range ids {
		if !validID(id) || (i > 0 && ids[i-1] == id) {
			return invalid("Selected object IDs must be valid and unique.")
		}
	}
	input.SelectedIDs = ids
	return nil
}

func validText(value string, maximum int, optional bool) bool {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > maximum ||
		(!optional && strings.TrimSpace(value) == "") {
		return false
	}
	return !strings.ContainsFunc(value, func(r rune) bool {
		return unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t'
	})
}

func validID(id string) bool {
	return len(id) <= 1024 && strings.TrimSpace(id) != "" && utf8.ValidString(id) && !strings.ContainsRune(id, 0)
}

func captureBasis(ctx context.Context, tx pgx.Tx, config Config, boardID string, head document.FileSnapshot, input StartInput, id uuid.UUID) (runBasis, error) {
	policy, err := currentPolicy(ctx, tx, config, boardID, input.Provider, input.Model, len(input.SelectedIDs), input.CloudConsent)
	if err != nil {
		return runBasis{}, err
	}
	_, dependencies, err := loadSources(ctx, tx, boardID, input.SelectedIDs)
	if err != nil {
		return runBasis{}, err
	}
	basis := runBasis{
		PolicyID: policy.ID, PolicyRevision: policy.Revision, Epoch: head.Epoch,
		Placement: input.Placement, PageID: stableID(id, "page"), Origin: point{X: 80, Y: 80},
		Sources: dependencies, CloudConsent: input.CloudConsent,
	}
	if input.Placement == currentPage {
		basis.PageID = input.PageID
		if err := requirePage(ctx, tx, boardID, basis.PageID); err != nil {
			return runBasis{}, err
		}
		rects, err := pageGeometry(ctx, tx, boardID, basis.PageID)
		if err != nil {
			return runBasis{}, err
		}
		for _, rect := range rects {
			basis.Origin.X = max(basis.Origin.X, rect.X+rect.Width+96)
		}
		if basis.Origin.X > maxCoordinate {
			return runBasis{}, conflict("TARGET_OUT_OF_RANGE", "Choose a new page for this draft.")
		}
	}
	return basis, nil
}

func currentPolicy(ctx context.Context, tx pgx.Tx, config Config, boardID, provider, model string, selected int, consent bool) (policy, error) {
	scope, err := boardPolicyScope(ctx, tx, boardID)
	if err != nil {
		return policy{}, err
	}
	value, err := readPolicy(ctx, tx, scope, true)
	if err != nil {
		return policy{}, err
	}
	choice, configured := config.choice(provider, model)
	if !configured || !value.Enabled || value.Provider != provider || value.Model != model {
		return policy{}, errDisabled
	}
	if choice.Cloud && !consent {
		return policy{}, errConsent
	}
	if choice.Cloud && selected > 0 && !value.AllowBoardContext {
		return policy{}, errContextPolicy
	}
	return value, nil
}

func verifyBasis(ctx context.Context, tx pgx.Tx, config Config, boardID string, head document.FileSnapshot, basis runBasis, provider, model string) ([]contextRecord, error) {
	if head.Epoch != basis.Epoch {
		return nil, conflict("STALE_EPOCH", "The board was restored. Generate a new draft from its current version.")
	}
	value, err := currentPolicy(ctx, tx, config, boardID, provider, model, len(basis.Sources), basis.CloudConsent)
	if err != nil {
		return nil, err
	}
	if value.ID != basis.PolicyID || value.Revision != basis.PolicyRevision {
		return nil, conflict("POLICY_CHANGED", "The AI policy changed. Start a new run.")
	}
	if basis.Placement == currentPage {
		if err := requirePage(ctx, tx, boardID, basis.PageID); err != nil {
			return nil, err
		}
	}
	ids := make([]string, 0, len(basis.Sources))
	for _, source := range basis.Sources {
		ids = append(ids, source.ID)
	}
	records, dependencies, err := loadSources(ctx, tx, boardID, ids)
	var inputFault *Fault
	if err != nil && !errors.As(err, &inputFault) {
		return nil, err
	}
	if err != nil || !slices.Equal(dependencies, basis.Sources) {
		return nil, conflict("STALE_SOURCES", "A selected object changed or was removed. Generate a new draft.")
	}
	return records, nil
}

func loadSources(ctx context.Context, tx pgx.Tx, boardID string, ids []string) ([]contextRecord, []sourceDependency, error) {
	records := make([]contextRecord, 0, len(ids))
	deps := make([]sourceDependency, 0, len(ids))
	if len(ids) == 0 {
		return records, deps, nil
	}
	rows, err := tx.Query(ctx, `SELECT e.id, e.data->>'type', left(e.data->>'text', $3)
		FROM board_elements e
		JOIN board_pages p ON p.board_id = e.board_id AND p.id = e.page_id AND NOT p.deleted
		WHERE e.board_id = $1 AND e.id = ANY($2::text[]) AND NOT e.deleted
		AND e.data->>'type' IN ('sticky', 'text', 'shape')
		AND jsonb_typeof(e.data->'text') = 'string'`, boardID, ids, maxContextItem+1)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	type textSource struct{ text, kind string }
	found := make(map[string]textSource, len(ids))
	for rows.Next() {
		var id, kind, value string
		if err := rows.Scan(&id, &kind, &value); err != nil {
			return nil, nil, err
		}
		found[id] = textSource{text: value, kind: kind}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	total := 0
	for _, id := range ids {
		value, exists := found[id]
		if !exists || !validText(value.text, maxContextItem, false) {
			return nil, nil, invalid("Select only text, labeled shapes, or sticky notes with 1–1200 characters each.")
		}
		total += utf8.RuneCountInString(value.text)
		if total > maxContextRunes {
			return nil, nil, invalid("Select at most 6000 characters of board text in one run.")
		}
		digest := sha256.Sum256([]byte(value.kind + "\x00" + value.text))
		deps = append(deps, sourceDependency{ID: id, Digest: hex.EncodeToString(digest[:])})
		records = append(records, contextRecord{ID: id, Text: value.text})
	}
	return records, deps, nil
}

func requirePage(ctx context.Context, tx pgx.Tx, boardID, pageID string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM board_pages
		WHERE board_id = $1 AND id = $2 AND NOT deleted)`, boardID, pageID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return conflict("TARGET_PAGE_MISSING", "The target page is no longer available.")
	}
	return nil
}

type box struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

func (b box) intersects(other box) bool {
	return b.X < other.X+other.Width && other.X < b.X+b.Width &&
		b.Y < other.Y+other.Height && other.Y < b.Y+b.Height
}

func pageGeometry(ctx context.Context, tx pgx.Tx, boardID, pageID string) ([]box, error) {
	rows, err := tx.Query(ctx, `SELECT coalesce(left(data->>'x', 64), ''), coalesce(left(data->>'y', 64), ''),
		coalesce(left(data->>'width', 64), ''), coalesce(left(data->>'height', 64), '')
		FROM (
			SELECT data FROM board_elements WHERE board_id = $1 AND page_id = $2 AND NOT deleted
			UNION ALL SELECT data FROM board_stamps WHERE board_id = $1 AND page_id = $2 AND NOT deleted
		) AS geometry LIMIT $3`, boardID, pageID, maxGeometry+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var boxes []box
	count := 0
	for rows.Next() {
		count++
		if count > maxGeometry {
			return nil, &Fault{http.StatusUnprocessableEntity, "TARGET_TOO_LARGE", "Choose a new page for a draft on a very large board."}
		}
		var x, y, width, height string
		if err := rows.Scan(&x, &y, &width, &height); err != nil {
			return nil, err
		}
		px, xOK := coordinate(x)
		py, yOK := coordinate(y)
		if !xOK || !yOK {
			continue
		}
		w, _ := coordinate(width)
		h, _ := coordinate(height)
		boxes = append(boxes, box{X: px, Y: py, Width: max(1, w), Height: max(1, h)})
	}
	return boxes, rows.Err()
}

func coordinate(raw string) (float64, bool) {
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || math.Abs(n) > maxCoordinate {
		return 0, false
	}
	return n, true
}
