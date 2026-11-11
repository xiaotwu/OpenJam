package sheetformat

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"slices"
	"strconv"
	"strings"
)

type workbookEntry struct {
	Name string `xml:"name,attr"`
	ID   int    `xml:"sheetId,attr"`
	Rel  string `xml:"r:id,attr"`
}

type workbookXML struct {
	XMLName xml.Name        `xml:"workbook"`
	Main    string          `xml:"xmlns,attr"`
	Links   string          `xml:"xmlns:r,attr"`
	Sheets  []workbookEntry `xml:"sheets>sheet"`
}

type worksheetXML struct {
	XMLName xml.Name `xml:"worksheet"`
	Main    string   `xml:"xmlns,attr"`
	Rows    []rowXML `xml:"sheetData>row"`
}

type rowXML struct {
	Number int          `xml:"r,attr"`
	Cells  []cellOutput `xml:"c"`
}

type cellOutput struct {
	Address string      `xml:"r,attr"`
	Type    string      `xml:"t,attr,omitempty"`
	Formula string      `xml:"f,omitempty"`
	Value   string      `xml:"v,omitempty"`
	Inline  *inlineText `xml:"is>t,omitempty"`
}

type inlineText struct {
	Space string `xml:"xml:space,attr"`
	Value string `xml:",chardata"`
}

func WriteXLSX(tabs []Tab, computed []map[Address]Result) ([]byte, error) {
	if err := CheckBook(tabs); err != nil {
		return nil, err
	}
	var output bytes.Buffer
	archive := zip.NewWriter(&output)
	add := func(name string, part any) error {
		file, err := archive.Create(name)
		if err != nil {
			return err
		}
		if _, err := file.Write([]byte(xml.Header)); err != nil {
			return err
		}
		return xml.NewEncoder(file).Encode(part)
	}
	workbook := workbookXML{Main: mainNS, Links: relationshipNS}
	root := relationshipFile{XMLNS: packageNS, Entries: []relationship{
		{ID: "rId1", Type: relationshipNS + "/officeDocument", Target: "xl/workbook.xml"},
	}}
	rels := relationshipFile{XMLNS: packageNS}
	types := contentTypes{
		XMLNS: contentTypeNS,
		Defaults: []contentDefault{
			{Extension: "rels", Type: "application/vnd.openxmlformats-package.relationships+xml"},
			{Extension: "xml", Type: "application/xml"},
		},
		Overrides: []contentOverride{{Part: "/xl/workbook.xml", Type: workbookType}},
	}
	for i, tab := range tabs {
		id := i + 1
		target := fmt.Sprintf("worksheets/sheet%d.xml", id)
		link := "rId" + strconv.Itoa(id)
		workbook.Sheets = append(workbook.Sheets, workbookEntry{Name: tab.Name, ID: id, Rel: link})
		rels.Entries = append(rels.Entries, relationship{ID: link, Type: relationshipNS + "/worksheet", Target: target})
		types.Overrides = append(types.Overrides, contentOverride{Part: "/xl/" + target, Type: worksheetType})
		sheet := worksheetXML{Main: mainNS, Rows: outputRows(tab, computed[i])}
		if err := add("xl/"+target, sheet); err != nil {
			return nil, err
		}
	}
	for _, part := range []struct {
		name string
		data any
	}{
		{"[Content_Types].xml", types},
		{"_rels/.rels", root},
		{"xl/workbook.xml", workbook},
		{"xl/_rels/workbook.xml.rels", rels},
	} {
		if err := add(part.name, part.data); err != nil {
			return nil, err
		}
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func outputRows(tab Tab, computed map[Address]Result) []rowXML {
	addresses := make([]Address, 0, len(tab.Cells))
	for address := range tab.Cells {
		addresses = append(addresses, address)
	}
	slices.SortFunc(addresses, func(a, b Address) int {
		return (a.Row-b.Row)*MaxColumns + a.Col - b.Col
	})
	var rows []rowXML
	for _, address := range addresses {
		if len(rows) == 0 || rows[len(rows)-1].Number != address.Row {
			rows = append(rows, rowXML{Number: address.Row})
		}
		value := tab.Cells[address]
		cell := cellOutput{Address: address.String()}
		if value.Kind == "formula" {
			result := computed[address]
			if result.Live {
				cell.Formula = strings.TrimPrefix(value.Input, "=")
				value = Value{Input: result.Display, Kind: result.Kind}
			} else {
				// Unsupported input stays visible as a string in Excel. It
				// cannot become a formula Excel evaluates with wider privileges.
				value.Kind = "text"
			}
		}
		switch value.Kind {
		case "number":
			cell.Value = value.Input
		case "boolean":
			cell.Type, cell.Value = "b", "0"
			if value.Input == "TRUE" {
				cell.Value = "1"
			}
		case "error":
			cell.Type, cell.Value = "e", value.Input
		case "text":
			if cell.Formula != "" {
				cell.Type, cell.Value = "str", value.Input
			} else {
				cell.Type = "inlineStr"
				cell.Inline = &inlineText{Space: "preserve", Value: value.Input}
			}
		}
		rows[len(rows)-1].Cells = append(rows[len(rows)-1].Cells, cell)
	}
	return rows
}
