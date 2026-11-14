package sheetformat

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const (
	MaxRows        = 1000
	MaxColumns     = 52
	MaxTabs        = 8
	MaxCells       = 6000
	MaxFormulas    = 512
	MaxInputBytes  = 1024
	MaxBookBytes   = 1 << 20
	MaxUploadBytes = 4 << 20
)

var (
	ErrInvalid = errors.New("invalid spreadsheet")
	ErrLimit   = errors.New("spreadsheet exceeds the supported size")
	decimal    = regexp.MustCompile(`^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?$|^[+-]?\.[0-9]+(?:[eE][+-]?[0-9]+)?$`)
)

type Value struct {
	Input string `json:"input"`
	Kind  string `json:"valueType"`
}

type Tab struct {
	Name  string
	Cells map[Address]Value
}

type Address struct {
	Row int
	Col int
}

func (a Address) String() string {
	col := a.Col - 1
	if col < 26 {
		return string(rune('A'+col)) + strconv.Itoa(a.Row)
	}
	return "A" + string(rune('A'+col-26)) + strconv.Itoa(a.Row)
}

func ParseAddress(value string) (Address, bool) {
	var a Address
	i := 0
	for i < len(value) && value[i] >= 'A' && value[i] <= 'Z' && i < 2 {
		a.Col = a.Col*26 + int(value[i]-'A') + 1
		i++
	}
	if i == 0 || i == len(value) || value[i] < '1' || value[i] > '9' || len(value)-i > 4 {
		return Address{}, false
	}
	row, err := strconv.Atoi(value[i:])
	a.Row = row
	return a, err == nil && a.Valid()
}

func (a Address) Valid() bool {
	return a.Row > 0 && a.Row <= MaxRows && a.Col > 0 && a.Col <= MaxColumns
}

func ValidTabName(name string) bool {
	return name != "" && strings.TrimSpace(name) == name && len(utf16.Encode([]rune(name))) <= 31 &&
		!strings.ContainsAny(name, "[]:*?/\\\t\n\r") && !strings.HasPrefix(name, "'") &&
		!strings.HasSuffix(name, "'") && validText(name)
}

func validText(text string) bool {
	if !utf8.ValidString(text) {
		return false
	}
	for _, r := range text {
		if r < 32 && r != '\t' && r != '\n' && r != '\r' || r == 0xfffe || r == 0xffff {
			return false
		}
	}
	return true
}

func Number(text string) (float64, bool) {
	if !decimal.MatchString(text) {
		return 0, false
	}
	n, err := strconv.ParseFloat(text, 64)
	return n, err == nil && !math.IsInf(n, 0)
}

func NumberString(n float64) string {
	if n == 0 {
		return "0"
	}
	return strconv.FormatFloat(n, 'g', 15, 64)
}

func Literal(text string) Value {
	if text == "" {
		return Value{}
	}
	if _, ok := Number(text); ok {
		return Value{Input: text, Kind: "number"}
	}
	return Value{Input: text, Kind: "text"}
}

func CheckValue(value Value) error {
	if len(value.Input) > MaxInputBytes {
		return fmt.Errorf("%w: a cell can contain up to %d bytes", ErrLimit, MaxInputBytes)
	}
	if validText(value.Input) {
		switch value.Kind {
		case "":
			if value.Input == "" {
				return nil
			}
		case "text":
			if value.Input != "" {
				return nil
			}
		case "number":
			if _, ok := Number(value.Input); ok {
				return nil
			}
		case "boolean":
			if value.Input == "TRUE" || value.Input == "FALSE" {
				return nil
			}
		case "error":
			switch value.Input {
			case "#REF!", "#VALUE!", "#DIV/0!", "#NAME?", "#N/A", "#NUM!", "#NULL!":
				return nil
			}
		case "formula":
			if len(value.Input) > 1 && strings.HasPrefix(value.Input, "=") {
				return nil
			}
		}
	}
	return fmt.Errorf("%w: invalid cell value", ErrInvalid)
}

func CheckBook(tabs []Tab) error {
	if len(tabs) == 0 || len(tabs) > MaxTabs {
		return fmt.Errorf("%w: a workbook can contain up to %d worksheets", ErrLimit, MaxTabs)
	}
	var names []string
	count, formulas, size := 0, 0, 0
	for _, tab := range tabs {
		if !ValidTabName(tab.Name) {
			return fmt.Errorf("%w: invalid worksheet name", ErrInvalid)
		}
		for _, name := range names {
			if strings.EqualFold(tab.Name, name) {
				return fmt.Errorf("%w: worksheet names must be unique", ErrInvalid)
			}
		}
		names = append(names, tab.Name)
		for address, value := range tab.Cells {
			if !address.Valid() {
				return fmt.Errorf("%w: worksheet cells must fit in A1:AZ1000", ErrLimit)
			}
			if err := CheckValue(value); err != nil {
				return err
			}
			count++
			if value.Kind == "formula" {
				formulas++
			}
			size += len(value.Input)
		}
	}
	if count > MaxCells || formulas > MaxFormulas || size > MaxBookBytes {
		return fmt.Errorf("%w: up to %d filled cells, %d formulas and 1 MiB of cell text per workbook", ErrLimit, MaxCells, MaxFormulas)
	}
	return nil
}
