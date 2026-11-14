package sheetformat

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/url"
	"path"
	"slices"
	"strconv"
	"strings"
)

const (
	maxExpandedBook = 16 << 20
	mainNS          = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
	relationshipNS  = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	packageNS       = "http://schemas.openxmlformats.org/package/2006/relationships"
	contentTypeNS   = "http://schemas.openxmlformats.org/package/2006/content-types"
	workbookType    = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
	worksheetType   = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
)

type xlsxPackage map[string]*zip.File

type relationship struct {
	ID     string `xml:"Id,attr"`
	Type   string `xml:"Type,attr"`
	Target string `xml:"Target,attr"`
	Mode   string `xml:"TargetMode,attr,omitempty"`
}

type relationshipFile struct {
	XMLName xml.Name       `xml:"Relationships"`
	XMLNS   string         `xml:"xmlns,attr,omitempty"`
	Entries []relationship `xml:"Relationship"`
}

type contentOverride struct {
	Part string `xml:"PartName,attr"`
	Type string `xml:"ContentType,attr"`
}

type contentDefault struct {
	Extension string `xml:"Extension,attr"`
	Type      string `xml:"ContentType,attr"`
}

type contentTypes struct {
	XMLName   xml.Name          `xml:"Types"`
	XMLNS     string            `xml:"xmlns,attr,omitempty"`
	Defaults  []contentDefault  `xml:"Default"`
	Overrides []contentOverride `xml:"Override"`
}

func openXLSX(data []byte) (xlsxPackage, error) {
	if len(data) > MaxUploadBytes {
		return nil, ErrLimit
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, ErrInvalid
	}
	if len(archive.File) > 256 {
		return nil, ErrLimit
	}
	files := make(xlsxPackage)
	var size uint64
	for _, entry := range archive.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		if entry.UncompressedSize64 > maxExpandedBook-size {
			return nil, ErrLimit
		}
		if !validPart(entry.Name) || files[entry.Name] != nil {
			return nil, ErrInvalid
		}
		size += entry.UncompressedSize64
		files[entry.Name] = entry
	}
	return files, nil
}

func validPart(name string) bool {
	return name != "." && name != ".." && name == path.Clean(name) && !strings.HasPrefix(name, "../") &&
		!strings.HasPrefix(name, "/") && !strings.ContainsRune(name, '\\')
}

func (files xlsxPackage) read(name string, parse func(*xml.Decoder) error) error {
	part := files[name]
	if part == nil {
		return ErrInvalid
	}
	reader, err := part.Open()
	if err != nil {
		return ErrInvalid
	}
	defer reader.Close()
	decoder := xml.NewDecoder(io.LimitReader(reader, int64(part.UncompressedSize64)+1))
	if err := parse(decoder); err != nil {
		if errors.Is(err, ErrLimit) || errors.Is(err, ErrInvalid) {
			return err
		}
		return fmt.Errorf("%w: unreadable workbook XML", ErrInvalid)
	}
	// Drain the part so the ZIP reader validates its declared size and checksum.
	if _, err := io.Copy(io.Discard, reader); err != nil {
		return ErrInvalid
	}
	return nil
}

func (files xlsxPackage) relations(part string) ([]relationship, error) {
	name := "_rels/.rels"
	if part != "" {
		name = path.Join(path.Dir(part), "_rels", path.Base(part)+".rels")
	}
	var rels relationshipFile
	err := files.read(name, func(decoder *xml.Decoder) error { return decoder.Decode(&rels) })
	return rels.Entries, err
}

func relationPart(base string, rel relationship) (string, error) {
	target, err := url.Parse(rel.Target)
	if err != nil || rel.Mode != "" && rel.Mode != "Internal" || target.IsAbs() || target.Host != "" ||
		target.Path == "" || target.RawQuery != "" || target.Fragment != "" {
		return "", ErrInvalid
	}
	name := strings.TrimPrefix(target.Path, "/")
	if !strings.HasPrefix(target.Path, "/") {
		name = path.Join(path.Dir(base), name)
	}
	if !validPart(name) {
		return "", ErrInvalid
	}
	return name, nil
}

func ReadXLSX(data []byte) ([]Tab, error) {
	files, err := openXLSX(data)
	if err != nil {
		return nil, err
	}
	rels, err := files.relations("")
	if err != nil {
		return nil, err
	}
	var workbookPart string
	for _, rel := range rels {
		if strings.HasSuffix(rel.Type, "/officeDocument") {
			workbookPart, err = relationPart("", rel)
			break
		}
	}
	if err != nil || workbookPart == "" {
		return nil, ErrInvalid
	}
	var types contentTypes
	err = files.read("[Content_Types].xml", func(decoder *xml.Decoder) error { return decoder.Decode(&types) })
	if err != nil || !slices.ContainsFunc(types.Overrides, func(entry contentOverride) bool {
		return entry.Part == "/"+workbookPart && entry.Type == workbookType
	}) {
		return nil, fmt.Errorf("%w: choose an XLSX workbook", ErrInvalid)
	}
	var workbook struct {
		XMLName xml.Name `xml:"workbook"`
		Sheets  []struct {
			Name string `xml:"name,attr"`
			Rel  string `xml:"id,attr"`
		} `xml:"sheets>sheet"`
	}
	err = files.read(workbookPart, func(decoder *xml.Decoder) error { return decoder.Decode(&workbook) })
	if err != nil {
		return nil, err
	}
	if len(workbook.Sheets) == 0 || len(workbook.Sheets) > MaxTabs {
		return nil, fmt.Errorf("%w: up to %d worksheets", ErrLimit, MaxTabs)
	}
	rels, err = files.relations(workbookPart)
	if err != nil {
		return nil, err
	}
	worksheets := make(map[string]string)
	var sharedPart string
	for _, rel := range rels {
		switch {
		case strings.HasSuffix(rel.Type, "/worksheet"):
			part, err := relationPart(workbookPart, rel)
			if err != nil || rel.ID == "" || worksheets[rel.ID] != "" {
				return nil, ErrInvalid
			}
			worksheets[rel.ID] = part
		case strings.HasSuffix(rel.Type, "/sharedStrings"):
			part, err := relationPart(workbookPart, rel)
			if err != nil || sharedPart != "" {
				return nil, ErrInvalid
			}
			sharedPart = part
		}
	}
	var shared []string
	if sharedPart != "" {
		shared, err = readSharedStrings(files, sharedPart)
		if err != nil {
			return nil, err
		}
	}
	tabs := make([]Tab, 0, len(workbook.Sheets))
	cells := 0
	for _, entry := range workbook.Sheets {
		part, exists := worksheets[entry.Rel]
		if !exists {
			return nil, fmt.Errorf("%w: only standard worksheets can be imported", ErrInvalid)
		}
		tab := Tab{Name: entry.Name, Cells: make(map[Address]Value)}
		err := files.read(part, func(decoder *xml.Decoder) error {
			return readWorksheet(decoder, &tab, shared, MaxCells-cells)
		})
		if err != nil {
			return nil, fmt.Errorf("%s: %w", entry.Name, err)
		}
		cells += len(tab.Cells)
		tabs = append(tabs, tab)
	}
	return tabs, CheckBook(tabs)
}

type richText struct {
	Text string   `xml:"t"`
	Runs []string `xml:"r>t"`
}

func (r richText) value() string {
	return r.Text + strings.Join(r.Runs, "")
}

func readSharedStrings(files xlsxPackage, part string) ([]string, error) {
	var shared []string
	err := files.read(part, func(decoder *xml.Decoder) error {
		for {
			token, err := decoder.Token()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return err
			}
			if node, ok := token.(xml.StartElement); ok && node.Name.Local == "si" {
				var text richText
				if err := decoder.DecodeElement(&text, &node); err != nil {
					return err
				}
				if len(shared) >= 50000 {
					return ErrLimit
				}
				shared = append(shared, text.value())
			}
		}
	})
	return shared, err
}

type cellXML struct {
	Address string   `xml:"r,attr"`
	Type    string   `xml:"t,attr"`
	Value   string   `xml:"v"`
	Inline  richText `xml:"is"`
	Formula *struct {
		Type   string `xml:"t,attr"`
		Shared string `xml:"si,attr"`
		Text   string `xml:",chardata"`
	} `xml:"f"`
}

type sharedFormula struct {
	address Address
	input   string
}

func readWorksheet(decoder *xml.Decoder, tab *Tab, shared []string, limit int) error {
	masters := make(map[string]sharedFormula)
	followers := make(map[Address]string)
	row, col := 0, 0
	var inData, sawData, inRow bool
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		switch node := token.(type) {
		case xml.EndElement:
			switch node.Name.Local {
			case "sheetData":
				inData = false
			case "row":
				inRow = false
			}
		case xml.StartElement:
			switch node.Name.Local {
			case "sheetData":
				inData, sawData = true, true
			case "row":
				if !inData {
					continue
				}
				inRow = true
				row, col = row+1, 0
				for _, attr := range node.Attr {
					if attr.Name.Local == "r" {
						row, err = strconv.Atoi(attr.Value)
						if err != nil || row < 1 || row > 1048576 {
							return ErrInvalid
						}
					}
				}
			case "c":
				if !inData || !inRow {
					continue
				}
				var cell cellXML
				if err := decoder.DecodeElement(&cell, &node); err != nil {
					return err
				}
				address := Address{Row: row, Col: col + 1}
				valid := address.Valid()
				if cell.Address != "" {
					address, valid = ParseAddress(cell.Address)
				}
				col = address.Col
				if cell.Formula == nil && cell.Value == "" && cell.Inline.value() == "" {
					continue
				}
				if !valid {
					return fmt.Errorf("%w: worksheet cells must fit in A1:AZ1000", ErrLimit)
				}
				if _, exists := tab.Cells[address]; exists {
					return ErrInvalid
				}
				if _, exists := followers[address]; exists {
					return ErrInvalid
				}
				if len(tab.Cells)+len(followers) >= limit {
					return ErrLimit
				}
				if cell.Formula != nil && cell.Formula.Type == "shared" {
					if cell.Formula.Shared == "" {
						return ErrInvalid
					}
					if cell.Formula.Text == "" {
						followers[address] = cell.Formula.Shared
						continue
					}
					masters[cell.Formula.Shared] = sharedFormula{address: address, input: "=" + cell.Formula.Text}
				}
				value, err := cell.value(shared)
				if err != nil {
					return err
				}
				if value.Kind != "" {
					tab.Cells[address] = value
				}
			}
		}
	}
	if !sawData {
		return ErrInvalid
	}
	for address, group := range followers {
		master, exists := masters[group]
		if !exists {
			return ErrInvalid
		}
		input, supported := OffsetSharedFormula(master.input, address.Row-master.address.Row, address.Col-master.address.Col)
		if !supported {
			return fmt.Errorf("%w: unsupported shared formula at %s", ErrInvalid, address)
		}
		tab.Cells[address] = Value{Input: input, Kind: "formula"}
	}
	return nil
}

func (c cellXML) value(shared []string) (Value, error) {
	if c.Formula != nil && c.Formula.Text != "" {
		return Value{Input: "=" + strings.TrimPrefix(c.Formula.Text, "="), Kind: "formula"}, nil
	}
	switch c.Type {
	case "s":
		index, err := strconv.Atoi(c.Value)
		if err != nil || index < 0 || index >= len(shared) {
			return Value{}, ErrInvalid
		}
		c.Value = shared[index]
	case "inlineStr":
		c.Value = c.Inline.value()
	case "b":
		switch c.Value {
		case "0", "false":
			return Value{Input: "FALSE", Kind: "boolean"}, nil
		case "1", "true":
			return Value{Input: "TRUE", Kind: "boolean"}, nil
		default:
			return Value{}, ErrInvalid
		}
	case "e":
		value := Value{Input: c.Value, Kind: "error"}
		if CheckValue(value) == nil {
			return value, nil
		}
	case "", "n":
		if _, ok := Number(c.Value); ok {
			return Value{Input: c.Value, Kind: "number"}, nil
		}
	}
	if c.Value == "" {
		return Value{}, nil
	}
	return Value{Input: c.Value, Kind: "text"}, nil
}
