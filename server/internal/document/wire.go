package document

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/xiaotwu/shiori/server/internal/model"
)

const MaxCommandBytes = 25 * 1024 * 1024

type Failure struct {
	Status  int            `json:"-"`
	Code    string         `json:"code"`
	Error   string         `json:"error"`
	Details map[string]any `json:"details,omitempty"`
}

func DescribeError(err error) Failure {
	var fault *CommandFault
	switch {
	case errors.Is(err, model.ErrRoomNotFound):
		return Failure{Status: http.StatusNotFound, Code: "BOARD_NOT_FOUND", Error: "Board not found"}
	case errors.Is(err, model.ErrRoomAccessDenied), errors.Is(err, model.ErrNotRoomOwner):
		return Failure{Status: http.StatusForbidden, Code: "ACCESS_DENIED", Error: "Board access denied"}
	case errors.Is(err, ErrLegacyMode):
		return Failure{Status: http.StatusConflict, Code: "LEGACY_MODE", Error: "This board is using the legacy editor"}
	case errors.Is(err, ErrMigrationBlocked):
		return Failure{Status: http.StatusConflict, Code: "MIGRATION_BLOCKED", Error: "This board needs a legacy data review before migration"}
	case errors.As(err, &fault):
		status := http.StatusConflict
		switch fault.Code {
		case "INVALID_COMMAND":
			status = http.StatusBadRequest
		case "COMMAND_TOO_LARGE":
			status = http.StatusRequestEntityTooLarge
		}
		return Failure{Status: status, Code: fault.Code, Error: fault.Error(), Details: fault.Details}
	default:
		return Failure{Status: http.StatusServiceUnavailable, Code: "DOCUMENT_UNAVAILABLE", Error: "Board document is temporarily unavailable"}
	}
}

func DecodeCommand(reader io.Reader) (Command, error) {
	var command Command
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&command); err != nil {
		return Command{}, err
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("multiple JSON values")
		}
		return Command{}, err
	}
	return command, nil
}
