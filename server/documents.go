package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/xiaotwu/shiori/server/internal/document"
)

func validateDocumentArguments(args []string) error {
	const usage = "usage: shiori-server documents inspect|migrate BOARD_ID, rollback BOARD_ID EPOCH SEQ, or export-legacy BOARD_ID EPOCH"
	if len(args) < 2 || strings.TrimSpace(args[1]) == "" || utf8.RuneCountInString(args[1]) > 36 {
		return fmt.Errorf("%s", usage)
	}
	var count int
	switch args[0] {
	case "inspect", "migrate":
		count = 2
	case "export-legacy":
		count = 3
	case "rollback":
		count = 4
	default:
		return fmt.Errorf("%s", usage)
	}
	if len(args) != count {
		return fmt.Errorf("%s", usage)
	}
	if len(args) >= 3 {
		epoch, err := strconv.ParseInt(args[2], 10, 64)
		if err != nil || epoch < 1 {
			return fmt.Errorf("document epoch must be a positive integer")
		}
	}
	if len(args) == 4 {
		seq, err := strconv.ParseInt(args[3], 10, 64)
		if err != nil || seq < 0 {
			return fmt.Errorf("document sequence must be a nonnegative integer")
		}
	}
	return nil
}

func runDocumentCommand(ctx context.Context, args []string, output io.Writer) error {
	if err := validateDocumentArguments(args); err != nil {
		return err
	}
	boardID := args[1]
	var report document.MigrationReport
	var err error
	switch args[0] {
	case "inspect":
		report, err = document.Inspect(ctx, boardID)
	case "migrate":
		report, err = document.Activate(ctx, boardID)
	case "rollback":
		epoch, _ := strconv.ParseInt(args[2], 10, 64)
		seq, _ := strconv.ParseInt(args[3], 10, 64)
		report, err = document.Rollback(ctx, boardID, epoch, seq)
	case "export-legacy":
		epoch, _ := strconv.ParseInt(args[2], 10, 64)
		return document.WriteLegacyArchive(ctx, boardID, epoch, output)
	}
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}
