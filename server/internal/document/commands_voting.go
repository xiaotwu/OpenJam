package document

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

type widgetBallot struct {
	Action   string   `json:"action"`
	OptionID string   `json:"optionId"`
	VoteID   string   `json:"voteId"`
	X        *float64 `json:"x"`
	Y        *float64 `json:"y"`
}

type dotBallot struct {
	ID     string `json:"id"`
	UserID string `json:"userId"`
}

func objectFields(raw json.RawMessage) (map[string]json.RawMessage, error) {
	fields := make(map[string]json.RawMessage)
	if len(raw) != 0 && !bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		if err := json.Unmarshal(raw, &fields); err != nil {
			return nil, invalidCommand("Widget data must be a JSON object.")
		}
	}
	return fields, nil
}

func validateVotingEdit(fields map[string]json.RawMessage, priorElement json.RawMessage) error {
	kind := rawString(fields["widgetType"])
	if rawString(fields["type"]) != "widget" || (kind != "poll" && kind != "dot-voting") {
		return nil
	}
	data, err := objectFields(fields["widgetData"])
	if err != nil {
		return err
	}
	prior, err := objectFields(priorElement)
	if err != nil {
		return err
	}
	previous, err := objectFields(prior["widgetData"])
	if err != nil {
		return err
	}
	if kind == "poll" {
		if err := preservePollBallots(data, previous); err != nil {
			return err
		}
	} else {
		quota, err := dotQuota(data["maxVotesPerUser"])
		if err != nil {
			return err
		}
		votes, err := dotBallots(previous["votes"])
		if err != nil {
			return err
		}
		if priorElement != nil && len(data["votes"]) != 0 && !equalJSON(data["votes"], previous["votes"]) {
			next, err := dotBallots(data["votes"])
			if err != nil || len(votes) > 0 || len(next) > 0 {
				return invalidCommand("Use a voting action to change ballots.")
			}
		}
		counts := make(map[string]int)
		for _, vote := range votes {
			counts[vote.UserID]++
			if counts[vote.UserID] > quota {
				return invalidCommand("The vote allowance cannot be lower than an existing ballot count.")
			}
		}
		data["votes"] = previous["votes"]
		if len(data["votes"]) == 0 {
			data["votes"] = json.RawMessage("[]")
		}
	}
	fields["widgetData"], err = json.Marshal(data)
	return err
}

func preservePollBallots(next, previous map[string]json.RawMessage) error {
	prior, err := pollOptions(previous["options"])
	if err != nil {
		return err
	}
	options, err := pollOptions(next["options"])
	if err != nil {
		return err
	}
	oldByID := make(map[string]map[string]json.RawMessage, len(prior))
	for _, option := range prior {
		oldByID[rawString(option["id"])] = option
	}
	for _, option := range options {
		id := rawString(option["id"])
		original := oldByID[id]
		voters, count, err := pollBallots(original)
		if err != nil {
			return err
		}
		if count > 0 && !equalJSON(option["text"], original["text"]) {
			return invalidCommand("An option with ballots cannot be renamed.")
		}
		if original != nil && (len(option["votes"]) > 0 || len(option["voters"]) > 0) {
			nextVoters, nextCount, err := pollBallots(option)
			if err != nil || nextCount != count || !slices.Equal(nextVoters, voters) {
				return invalidCommand("Use a voting action to change ballots.")
			}
		}
		if err := writePollBallots(option, voters, count); err != nil {
			return err
		}
		delete(oldByID, id)
	}
	for _, option := range oldByID {
		if _, count, err := pollBallots(option); err != nil || count > 0 {
			return invalidCommand("An option with ballots cannot be removed.")
		}
	}
	next["options"], err = json.Marshal(options)
	return err
}

func pollOptions(raw json.RawMessage) ([]map[string]json.RawMessage, error) {
	options := []map[string]json.RawMessage{}
	if len(raw) != 0 {
		if err := json.Unmarshal(raw, &options); err != nil || len(options) > 200 {
			return nil, invalidCommand("A poll can contain up to 200 options.")
		}
	}
	if options == nil {
		options = []map[string]json.RawMessage{}
	}
	seen := make(map[string]bool, len(options))
	for _, option := range options {
		id := rawString(option["id"])
		if !validEntityID(id) || seen[id] || strings.TrimSpace(rawString(option["text"])) == "" {
			return nil, invalidCommand("Poll options need unique IDs and nonempty labels.")
		}
		seen[id] = true
	}
	return options, nil
}

func pollBallots(option map[string]json.RawMessage) ([]string, int64, error) {
	voters := []string{}
	var count int64
	if raw := option["voters"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &voters); err != nil {
			return nil, 0, invalidCommand("The poll has invalid ballot data.")
		}
	}
	if raw := option["votes"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &count); err != nil || count < 0 || count >= maxSafeSequence {
			return nil, 0, invalidCommand("The poll has an invalid ballot count.")
		}
	}
	if voters == nil {
		voters = []string{}
	}
	return voters, max(count, int64(len(voters))), nil
}

func writePollBallots(option map[string]json.RawMessage, voters []string, count int64) error {
	var err error
	option["voters"], err = json.Marshal(voters)
	if err != nil {
		return err
	}
	option["votes"], err = json.Marshal(count)
	return err
}

func dotQuota(raw json.RawMessage) (int, error) {
	if len(raw) == 0 || equalJSON(raw, json.RawMessage("null")) {
		return 3, nil
	}
	var count int
	if err := json.Unmarshal(raw, &count); err != nil || count < 1 || count > 20 {
		return 0, invalidCommand("Dot voting allows between 1 and 20 votes per editor.")
	}
	return count, nil
}

func dotBallots(raw json.RawMessage) ([]dotBallot, error) {
	var votes []dotBallot
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &votes); err != nil {
			return nil, invalidCommand("The dot-voting widget has invalid ballot data.")
		}
	}
	return votes, nil
}

func voteOnWidget(ctx context.Context, tx pgx.Tx, state *commitState, operation Operation, record documentRecord) (Delta, error) {
	if len(operation.Fields) != 0 || len(operation.Expected) != 0 || len(operation.Unset) != 0 {
		return Delta{}, invalidCommand("A vote must carry one ballot action.")
	}
	var ballot widgetBallot
	decoder := json.NewDecoder(bytes.NewReader(operation.Value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&ballot); err != nil {
		return Delta{}, invalidCommand("Invalid voting action.")
	}
	fields, err := objectFields(record.data)
	if err != nil {
		return Delta{}, err
	}
	data, err := objectFields(fields["widgetData"])
	if err != nil {
		return Delta{}, err
	}
	if rawString(fields["type"]) != "widget" {
		return Delta{}, invalidCommand("This object is not a voting widget.")
	}
	switch rawString(fields["widgetType"]) {
	case "poll":
		err = castPollBallot(data, state.actor.String(), operation, ballot)
	case "dot-voting":
		err = applyDotBallot(ctx, tx, data, state, operation, ballot)
	default:
		return Delta{}, invalidCommand("This widget does not accept votes.")
	}
	if err != nil {
		return Delta{}, err
	}
	fields["widgetData"], err = json.Marshal(data)
	if err != nil {
		return Delta{}, err
	}
	encoded, err := json.Marshal(fields)
	if err != nil {
		return Delta{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE board_elements SET data = $3, revision = $4 WHERE board_id = $1 AND id = $2`,
		state.room.ID, operation.ID, encoded, state.seq); err != nil {
		return Delta{}, err
	}
	return upsertDelta(ctx, tx, state.room.ID, "board_elements", operation, encoded, record.position)
}

func castPollBallot(data map[string]json.RawMessage, actor string, operation Operation, ballot widgetBallot) error {
	if ballot.Action != "poll-cast" || !validEntityID(ballot.OptionID) || ballot.VoteID != "" || ballot.X != nil || ballot.Y != nil {
		return invalidCommand("A poll vote requires one option ID.")
	}
	options, err := pollOptions(data["options"])
	if err != nil {
		return err
	}
	var optionFound bool
	for _, option := range options {
		voters, count, err := pollBallots(option)
		if err != nil {
			return err
		}
		if slices.Contains(voters, actor) {
			return operationConflict(operation, "", "You have already voted in this poll.")
		}
		if rawString(option["id"]) == ballot.OptionID {
			if err := writePollBallots(option, append(voters, actor), count+1); err != nil {
				return err
			}
			optionFound = true
		}
	}
	if !optionFound {
		return operationConflict(operation, "", "That poll option is no longer available.")
	}
	data["options"], err = json.Marshal(options)
	return err
}

func applyDotBallot(ctx context.Context, tx pgx.Tx, data map[string]json.RawMessage, state *commitState, operation Operation, ballot widgetBallot) error {
	if ballot.OptionID != "" {
		return invalidCommand("Invalid dot-voting action.")
	}
	votes, err := dotBallots(data["votes"])
	if err != nil {
		return err
	}
	records := []json.RawMessage{}
	if len(data["votes"]) > 0 {
		if err := json.Unmarshal(data["votes"], &records); err != nil {
			return err
		}
	}
	actor := state.actor.String()
	switch ballot.Action {
	case "dot-add":
		if !validEntityID(ballot.VoteID) || ballot.X == nil || ballot.Y == nil || *ballot.X < 0 || *ballot.X > 100 || *ballot.Y < 0 || *ballot.Y > 100 {
			return invalidCommand("A dot needs an ID and a position inside the voting area.")
		}
		quota, err := dotQuota(data["maxVotesPerUser"])
		if err != nil {
			return err
		}
		var used int
		for _, vote := range votes {
			if vote.ID == ballot.VoteID {
				return operationConflict(operation, "", "This dot ID already exists.")
			}
			if vote.UserID == actor {
				used++
			}
		}
		if used >= quota {
			return operationConflict(operation, "", "You have used all your votes for this widget.")
		}
		var color string
		if err := tx.QueryRow(ctx, `SELECT avatar_color FROM users WHERE id = $1`, state.actor).Scan(&color); err != nil {
			return err
		}
		vote, err := json.Marshal(map[string]any{"id": ballot.VoteID, "userId": actor, "userColor": color, "targetId": "", "x": *ballot.X, "y": *ballot.Y})
		if err != nil {
			return err
		}
		records = append(records, vote)
	case "dot-remove", "dot-clear":
		if ballot.X != nil || ballot.Y != nil || (ballot.Action == "dot-remove" && !validEntityID(ballot.VoteID)) ||
			(ballot.Action == "dot-clear" && ballot.VoteID != "") {
			return invalidCommand("Invalid dot removal.")
		}
		kept := make([]json.RawMessage, 0, len(records))
		for index, vote := range votes {
			if ballot.Action == "dot-remove" && vote.ID == ballot.VoteID && vote.UserID != actor {
				return operationConflict(operation, "", "You can only remove your own dots.")
			}
			if vote.UserID != actor || (ballot.Action == "dot-remove" && vote.ID != ballot.VoteID) {
				kept = append(kept, records[index])
			}
		}
		records = kept
	default:
		return invalidCommand("Unknown dot-voting action.")
	}
	if records == nil {
		records = []json.RawMessage{}
	}
	data["votes"], err = json.Marshal(records)
	return err
}
