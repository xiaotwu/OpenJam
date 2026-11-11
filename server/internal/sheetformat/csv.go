package sheetformat

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strings"
)

func ReadCSV(data []byte) ([]Tab, error) {
	if len(data) > MaxUploadBytes {
		return nil, ErrLimit
	}
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	reader := csv.NewReader(bytes.NewReader(data))
	reader.FieldsPerRecord = -1
	tab := Tab{Name: "Sheet1", Cells: make(map[Address]Value)}
	row, nextLine, offset := 0, 1, int64(0)
	for {
		fields, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("%w: use a UTF-8, comma-separated CSV file", ErrInvalid)
		}
		line, _ := reader.FieldPos(0)
		row += line - nextLine + 1
		end := reader.InputOffset()
		nextLine += bytes.Count(data[offset:end], []byte{'\n'})
		offset = end
		if row > MaxRows || len(fields) > MaxColumns {
			return nil, fmt.Errorf("%w: CSV data must fit in A1:AZ1000", ErrLimit)
		}
		for i, field := range fields {
			if field == "" {
				continue
			}
			value := Literal(field)
			if err := CheckValue(value); err != nil {
				return nil, err
			}
			tab.Cells[Address{Row: row, Col: i + 1}] = value
			if len(tab.Cells) > MaxCells {
				return nil, ErrLimit
			}
		}
	}
	tabs := []Tab{tab}
	return tabs, CheckBook(tabs)
}

func WriteCSV(tab Tab, computed map[Address]Result) ([]byte, error) {
	var output bytes.Buffer
	output.WriteString("\xef\xbb\xbf")
	writer := csv.NewWriter(&output)
	lastRow, lastCol := 0, 0
	for address := range tab.Cells {
		lastRow, lastCol = max(lastRow, address.Row), max(lastCol, address.Col)
	}
	for row := 1; row <= lastRow; row++ {
		fields := make([]string, lastCol)
		for col := 1; col <= lastCol; col++ {
			address := Address{Row: row, Col: col}
			value := tab.Cells[address]
			if value.Kind == "formula" {
				result := computed[address]
				value = Value{Input: result.Display, Kind: result.Kind}
			}
			// CSV has no cell types. Neutralize text that desktop spreadsheet
			// programs might interpret as an active formula on open.
			trimmed := strings.TrimSpace(value.Input)
			if value.Kind == "text" && (strings.HasPrefix(value.Input, "\t") || strings.HasPrefix(value.Input, "\r") ||
				strings.HasPrefix(value.Input, "\n") || trimmed != "" && strings.ContainsRune("=+-@＝＋－＠", []rune(trimmed)[0])) {
				value.Input = "'" + value.Input
			}
			fields[col-1] = value.Input
		}
		if err := writer.Write(fields); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	return output.Bytes(), writer.Error()
}
