package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/model"
)

const (
	AgentProfileRequestLimit = 336 << 10
	maxProfileImageBytes     = 240 << 10
	profileFrameSize         = 48
	profilePetColumns        = 6
	profilePetRows           = 4
	attributionPageSize      = 120
)

type Profile struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Glyph    string `json:"glyph,omitempty"`
	ImagePNG []byte `json:"imagePng,omitempty"`
}

func ReadProfile(ctx context.Context, actor uuid.UUID) (Profile, error) {
	return readProfile(ctx, db.Pool(), actor)
}

func readProfile(ctx context.Context, query queryRow, actor uuid.UUID) (Profile, error) {
	var profile Profile
	err := query.QueryRow(ctx, `SELECT name, kind, glyph, image_png FROM agent_profiles WHERE user_id = $1`, actor).Scan(
		&profile.Name, &profile.Kind, &profile.Glyph, &profile.ImagePNG,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{Kind: "ring"}, nil
	}
	return profile, err
}

func SaveProfile(ctx context.Context, actor uuid.UUID, profile Profile) (Profile, error) {
	profile.Name = strings.TrimSpace(profile.Name)
	if !utf8.ValidString(profile.Name) || utf8.RuneCountInString(profile.Name) > 48 ||
		strings.ContainsFunc(profile.Name, func(r rune) bool { return unicode.IsControl(r) || unicode.In(r, unicode.Cf) }) {
		return Profile{}, invalid("Use a character name with up to 48 visible characters.")
	}
	if err := normalizeProfileAppearance(&profile); err != nil {
		return Profile{}, err
	}
	_, err := db.Pool().Exec(ctx, `INSERT INTO agent_profiles (user_id, name, kind, glyph, image_png)
		VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id) DO UPDATE SET
		name = excluded.name, kind = excluded.kind, glyph = excluded.glyph, image_png = excluded.image_png`,
		actor, profile.Name, profile.Kind, profile.Glyph, profile.ImagePNG,
	)
	return profile, err
}

func normalizeProfileAppearance(profile *Profile) error {
	switch profile.Kind {
	case "ring":
		if profile.Glyph == "" && len(profile.ImagePNG) == 0 {
			profile.ImagePNG = nil
			return nil
		}
	case "glyph":
		if len(profile.ImagePNG) == 0 {
			switch profile.Glyph {
			case "orbit", "diamond", "dot", "sparkle":
				profile.ImagePNG = nil
				return nil
			}
		}
	case "image", "pet":
		if profile.Glyph != "" || len(profile.ImagePNG) == 0 || len(profile.ImagePNG) > maxProfileImageBytes {
			break
		}
		width, height := profileFrameSize, profileFrameSize
		if profile.Kind == "pet" {
			width, height = width*profilePetColumns, height*profilePetRows
		}
		cfg, err := png.DecodeConfig(bytes.NewReader(profile.ImagePNG))
		if err != nil || cfg.Width != width || cfg.Height != height {
			break
		}
		source, err := png.Decode(bytes.NewReader(profile.ImagePNG))
		if err != nil {
			break
		}
		raster := image.NewNRGBA(image.Rect(0, 0, width, height))
		for y := range height {
			for x := range width {
				raster.Set(x, y, source.At(x, y))
			}
		}
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, raster); err != nil || encoded.Len() > maxProfileImageBytes {
			break
		}
		profile.ImagePNG = encoded.Bytes()
		return nil
	}
	return invalid("Choose a supported character shape or upload valid character artwork.")
}

type Attribution struct {
	ElementID string    `json:"elementId"`
	RunID     uuid.UUID `json:"runId"`
	ActorID   uuid.UUID `json:"actorId"`
	ActorName string    `json:"actorName"`
	AgentName string    `json:"agentName,omitempty"`
	Glyph     string    `json:"glyph,omitempty"`
}

type AttributionPage struct {
	Entries []Attribution `json:"entries"`
	Next    string        `json:"next,omitempty"`
}

func ReadAttributions(ctx context.Context, boardID string, actor uuid.UUID, page, after string) (AttributionPage, error) {
	if !validID(page) || (after != "" && !validID(after)) {
		return AttributionPage{}, invalid("Use a valid page and attribution cursor.")
	}
	result := AttributionPage{Entries: []Attribution{}}
	err := readTx(ctx, func(tx pgx.Tx) error {
		if _, err := model.QueryRoomAccess(ctx, tx, boardID, actor); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT a.element_id, a.run_id, a.actor_id, a.actor_name, a.agent_name, a.glyph
			FROM board_agent_attributions a
			JOIN board_elements e ON e.board_id = a.board_id AND e.id = a.element_id
			WHERE a.board_id = $1 AND e.page_id = $2 AND NOT e.deleted AND a.element_id > $3
			AND e.data->>'createdBy' = a.actor_id::text AND e.data->>'createdAt' = a.created_at_ms::text
			ORDER BY a.element_id LIMIT $4`, boardID, page, after, attributionPageSize+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var entry Attribution
			if err := rows.Scan(&entry.ElementID, &entry.RunID, &entry.ActorID, &entry.ActorName, &entry.AgentName, &entry.Glyph); err != nil {
				return err
			}
			result.Entries = append(result.Entries, entry)
		}
		if len(result.Entries) > attributionPageSize {
			result.Entries = result.Entries[:attributionPageSize]
			result.Next = result.Entries[len(result.Entries)-1].ElementID
		}
		return rows.Err()
	})
	return result, err
}

func recordAttributions(ctx context.Context, tx pgx.Tx, boardID string, actor, runID uuid.UUID, ack document.Ack) error {
	if ack.Change == nil {
		return conflict("DRAFT_EXPIRED", "The original draft edit is unavailable.")
	}
	var name, agentName, glyph string
	err := tx.QueryRow(ctx, `SELECT u.display_name, coalesce(p.name, ''), coalesce(p.glyph, '')
		FROM users u LEFT JOIN agent_profiles p ON p.user_id = u.id WHERE u.id = $1`, actor).Scan(&name, &agentName, &glyph)
	if err != nil {
		return err
	}
	for _, operation := range ack.Change.Operations {
		if operation.Collection != "elements" || operation.Kind != "upsert" {
			continue
		}
		var value struct {
			CreatedAt int64 `json:"createdAt"`
		}
		if err := json.Unmarshal(operation.Value, &value); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO board_agent_attributions
			(board_id, element_id, run_id, actor_id, actor_name, agent_name, glyph, created_at_ms)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			boardID, operation.ID, runID, actor, name, agentName, glyph, value.CreatedAt)
		if err != nil {
			return err
		}
	}
	return nil
}
