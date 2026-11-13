package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/model"
)

const (
	maxOperations   = 256
	maxChangeBytes  = 32 * 1024 * 1024
	maxSafeSequence = 1<<53 - 1
)

type Command struct {
	ProtocolVersion int         `json:"protocolVersion"`
	Epoch           int64       `json:"epoch"`
	BaseSeq         int64       `json:"baseSeq"`
	ClientID        string      `json:"clientId"`
	CommandID       string      `json:"commandId"`
	DependsOn       string      `json:"dependsOn,omitempty"`
	Operations      []Operation `json:"operations"`
}

type Operation struct {
	Kind       string                     `json:"kind"`
	Collection string                     `json:"collection,omitempty"`
	ID         string                     `json:"id,omitempty"`
	Value      json.RawMessage            `json:"value,omitempty"`
	Fields     map[string]json.RawMessage `json:"fields,omitempty"`
	Expected   map[string]json.RawMessage `json:"expected,omitempty"`
	Unset      []string                   `json:"unset,omitempty"`
	Position   *int64                     `json:"position,omitempty"`
}

type Delta struct {
	Kind       string          `json:"kind"`
	Collection string          `json:"collection,omitempty"`
	ID         string          `json:"id,omitempty"`
	Value      json.RawMessage `json:"value,omitempty"`
	Position   *int64          `json:"position,omitempty"`
}

type Change struct {
	Seq           int64   `json:"seq"`
	Epoch         int64   `json:"epoch"`
	ActorID       string  `json:"actorId,omitempty"`
	ClientID      string  `json:"clientId"`
	CommandID     string  `json:"commandId"`
	Operations    []Delta `json:"operations"`
	DefaultPageID string  `json:"defaultPageId,omitempty"`
}

type Ack struct {
	BoardID   string  `json:"boardId"`
	Epoch     int64   `json:"epoch"`
	Seq       int64   `json:"seq"`
	ClientID  string  `json:"clientId"`
	CommandID string  `json:"commandId"`
	Replayed  bool    `json:"replayed"`
	Change    *Change `json:"change,omitempty"`
}

type CommandFault struct {
	Code    string
	Message string
	Details map[string]any
}

func (e *CommandFault) Error() string { return e.Message }

func invalidCommand(message string) error {
	return &CommandFault{Code: "INVALID_COMMAND", Message: message}
}

func cursorFault(code, message string, head Head) error {
	return &CommandFault{
		Code: code, Message: message,
		Details: map[string]any{"epoch": head.Epoch, "headSeq": head.Seq, "floorSeq": head.FloorSeq},
	}
}

type commitState struct {
	room      lockedRoom
	head      Head
	actor     uuid.UUID
	clientID  string
	baseSeq   int64
	seq       int64
	nameDirty bool
	relations map[string]bool
}

// Commit takes the rooms lock shared by cutover, ACL mutations, and all writers.
// Its acknowledgement becomes observable only after the transaction commits.
func Commit(ctx context.Context, boardID string, actor uuid.UUID, command Command) (Ack, error) {
	return commitCommand(ctx, boardID, actor, command, false)
}

// RenameOwned connects the existing workbench endpoint to the same durable
// command path while keeping that endpoint's owner-only permission rule.
func RenameOwned(ctx context.Context, boardID string, actor uuid.UUID, name string) (Ack, error) {
	snapshot, err := Open(ctx, boardID, actor, false)
	if err != nil {
		return Ack{}, err
	}
	if snapshot.Permission != "owner" {
		return Ack{}, model.ErrNotRoomOwner
	}
	return commitCommand(ctx, boardID, actor, Command{
		ProtocolVersion: ProtocolVersion, Epoch: snapshot.Epoch, BaseSeq: snapshot.Seq,
		ClientID: uuid.NewString(), CommandID: uuid.NewString(),
		Operations: []Operation{{
			Kind: "rename", Value: jsonString(name),
			Expected: map[string]json.RawMessage{"name": jsonString(snapshot.Document.Name)},
		}},
	}, true)
}

func commitCommand(ctx context.Context, boardID string, actor uuid.UUID, command Command, requireOwner bool) (Ack, error) {
	digest, err := validateEnvelope(command)
	if err != nil {
		return Ack{}, err
	}
	var result Ack
	err = pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		var err error
		result, err = commitCommandTx(ctx, tx, boardID, actor, command, digest, requireOwner)
		return err
	})
	if err != nil {
		return Ack{}, err
	}
	return result, nil
}

// CommitTx adds a command and its receipt to the caller's board transaction.
// Callers must publish the acknowledgement only after the transaction commits.
func CommitTx(ctx context.Context, tx pgx.Tx, boardID string, actor uuid.UUID, command Command) (Ack, error) {
	digest, err := validateEnvelope(command)
	if err != nil {
		return Ack{}, err
	}
	return commitCommandTx(ctx, tx, boardID, actor, command, digest, false)
}

func commitCommandTx(ctx context.Context, tx pgx.Tx, boardID string, actor uuid.UUID, command Command, digest [32]byte, requireOwner bool) (Ack, error) {
	room, err := lockRoom(ctx, tx, boardID)
	if err != nil {
		return Ack{}, err
	}
	access, err := model.QueryRoomAccess(ctx, tx, boardID, actor)
	if err != nil {
		return Ack{}, err
	}
	if requireOwner && !access.IsOwner {
		return Ack{}, model.ErrNotRoomOwner
	}
	if !access.IsOwner && !model.RoomPermissionAllowsEdit(access.Permission) {
		return Ack{}, model.ErrRoomAccessDenied
	}
	head, err := activeHead(ctx, tx, boardID)
	if err != nil {
		return Ack{}, err
	}
	if command.Epoch != head.Epoch {
		return Ack{}, cursorFault("STALE_EPOCH", "Board generation changed. Review local edits before replaying.", head)
	}
	ack, found, err := readReceipt(ctx, tx, boardID, actor, command, digest)
	if err != nil || found {
		return ack, err
	}
	if command.BaseSeq < head.FloorSeq || command.BaseSeq > head.Seq {
		return Ack{}, cursorFault("RESYNC_REQUIRED", "The command's base sequence is outside the current replay window.", head)
	}
	if command.DependsOn != "" {
		var applied bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM board_command_receipts
				WHERE board_id = $1 AND client_id = $2 AND command_id = $3 AND actor_id = $4 AND epoch = $5)
		`, boardID, command.ClientID, command.DependsOn, actor, head.Epoch).Scan(&applied); err != nil {
			return Ack{}, err
		}
		if !applied {
			return Ack{}, &CommandFault{Code: "HISTORY_DEPENDENCY", Message: "The edit this action would undo or redo was not committed."}
		}
	}
	state := commitState{
		room: room, head: head, actor: actor, clientID: command.ClientID,
		baseSeq: command.BaseSeq, seq: head.Seq + 1,
	}
	return applyAndRecord(ctx, tx, &state, command, digest)
}

func validateEnvelope(command Command) ([32]byte, error) {
	if command.ProtocolVersion != ProtocolVersion || command.Epoch <= 0 || command.Epoch > maxSafeSequence ||
		command.BaseSeq < 0 || command.BaseSeq > maxSafeSequence {
		return [32]byte{}, invalidCommand("Invalid protocol version, epoch, or base sequence.")
	}
	ids := []string{command.ClientID, command.CommandID}
	if command.DependsOn != "" {
		if command.DependsOn == command.CommandID {
			return [32]byte{}, invalidCommand("A command cannot depend on itself.")
		}
		ids = append(ids, command.DependsOn)
	}
	for _, id := range ids {
		parsed, err := uuid.Parse(id)
		if err != nil || parsed == uuid.Nil || parsed.String() != id {
			return [32]byte{}, invalidCommand("Client and command IDs must be canonical UUIDs.")
		}
	}
	if len(command.Operations) == 0 || len(command.Operations) > maxOperations {
		return [32]byte{}, invalidCommand("A command must contain between 1 and 256 operations.")
	}
	encoded, err := json.Marshal(command)
	if err != nil {
		return [32]byte{}, invalidCommand("Command payload is invalid.")
	}
	if len(encoded) > MaxCommandBytes {
		return [32]byte{}, &CommandFault{Code: "COMMAND_TOO_LARGE", Message: "Command payload exceeds the size limit."}
	}
	canonical, err := canonicalJSON(encoded)
	if err != nil {
		return [32]byte{}, invalidCommand("Command contains unsupported JSON values.")
	}
	return sha256.Sum256(canonical), nil
}

func readReceipt(ctx context.Context, tx pgx.Tx, boardID string, actor uuid.UUID, command Command, digest [32]byte) (Ack, bool, error) {
	var recordedActor uuid.UUID
	var epoch, seq int64
	var recordedDigest []byte
	err := tx.QueryRow(ctx, `
		SELECT actor_id, epoch, seq, digest FROM board_command_receipts
		WHERE board_id = $1 AND client_id = $2 AND command_id = $3
	`, boardID, command.ClientID, command.CommandID).Scan(&recordedActor, &epoch, &seq, &recordedDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return Ack{}, false, nil
	}
	if err != nil {
		return Ack{}, false, err
	}
	if recordedActor != actor || !bytes.Equal(digest[:], recordedDigest) {
		return Ack{}, false, &CommandFault{Code: "IDEMPOTENCY_CONFLICT", Message: "This command ID was already committed with different contents."}
	}
	ack := Ack{
		BoardID: boardID, Epoch: epoch, Seq: seq, ClientID: command.ClientID,
		CommandID: command.CommandID, Replayed: true,
	}
	var data []byte
	err = tx.QueryRow(ctx, `SELECT payload FROM board_changes WHERE board_id = $1 AND seq = $2`, boardID, seq).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return ack, true, nil
	}
	if err != nil {
		return Ack{}, false, err
	}
	var change Change
	if err := json.Unmarshal(data, &change); err != nil {
		return Ack{}, false, err
	}
	ack.Change = &change
	return ack, true, nil
}

func applyAndRecord(ctx context.Context, tx pgx.Tx, state *commitState, command Command, digest [32]byte) (Ack, error) {
	initialDefault := state.head.DefaultPageID
	change := Change{
		Seq: state.seq, Epoch: state.head.Epoch, ActorID: state.actor.String(), ClientID: command.ClientID,
		CommandID: command.CommandID, Operations: make([]Delta, 0, len(command.Operations)),
	}
	for _, operation := range command.Operations {
		delta, err := applyOperation(ctx, tx, state, operation)
		if err != nil {
			return Ack{}, err
		}
		if delta.Kind != "" {
			change.Operations = append(change.Operations, delta)
		}
		if err := trackRelationships(state, operation, delta); err != nil {
			return Ack{}, err
		}
	}
	if state.room.Kind == model.ResourceDoc {
		if err := checkDocSize(ctx, tx, state.room.ID); err != nil {
			return Ack{}, err
		}
	}
	if state.room.Kind == model.ResourceSheet {
		calculated, err := refreshSheet(ctx, tx, state.room.ID)
		if err != nil {
			return Ack{}, err
		}
		change.Operations = append(change.Operations, calculated...)
	}
	if state.room.Kind == model.ResourceSlides {
		if err := checkSlideSize(ctx, tx, state.room.ID); err != nil {
			return Ack{}, err
		}
	}
	if err := checkRelationships(ctx, tx, state); err != nil {
		return Ack{}, err
	}
	if state.head.DefaultPageID != initialDefault {
		change.DefaultPageID = state.head.DefaultPageID
	}
	payload, err := json.Marshal(change)
	if err != nil {
		return Ack{}, err
	}
	if len(payload) > maxChangeBytes {
		return Ack{}, &CommandFault{Code: "COMMAND_TOO_LARGE", Message: "The resulting change is too large. Submit a smaller batch."}
	}
	if err := writeCommit(ctx, tx, state, command, digest, payload); err != nil {
		return Ack{}, err
	}
	return Ack{
		BoardID: state.room.ID, Epoch: change.Epoch, Seq: change.Seq,
		ClientID: change.ClientID, CommandID: change.CommandID, Change: &change,
	}, nil
}

func writeCommit(ctx context.Context, tx pgx.Tx, state *commitState, command Command, digest [32]byte, payload []byte) error {
	if state.nameDirty {
		if _, err := tx.Exec(ctx, `SELECT set_config('openjam.document_v2_write', 'on', true)`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE rooms SET name = $2, updated_at = clock_timestamp() WHERE id = $1`, state.room.ID, state.room.Name); err != nil {
			return err
		}
	} else if _, err := tx.Exec(ctx, `UPDATE rooms SET updated_at = clock_timestamp() WHERE id = $1`, state.room.ID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE board_heads SET head_seq = $2, default_page_id = $3 WHERE board_id = $1
	`, state.room.ID, state.seq, state.head.DefaultPageID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_changes (board_id, seq, epoch, payload, payload_bytes)
		VALUES ($1, $2, $3, $4, $5)
	`, state.room.ID, state.seq, state.head.Epoch, payload, len(payload)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_command_receipts (board_id, actor_id, client_id, command_id, epoch, seq, digest)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, state.room.ID, state.actor, command.ClientID, command.CommandID, state.head.Epoch, state.seq, digest[:]); err != nil {
		return err
	}
	return maybeCheckpointVersion(ctx, tx, state)
}
