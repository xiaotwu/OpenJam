package sheetformat

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"reflect"
	"strings"
	"testing"
)

func TestCalculateWorkbook(t *testing.T) {
	tabs := []Tab{
		{Name: "April", Cells: map[Address]Value{
			{1, 1}: Literal("12"), {2, 1}: Literal("24"), {3, 1}: {Input: "0012", Kind: "text"},
			{1, 2}: {"=SUM($A$1:A3, 2^3)", "formula"},
			{2, 2}: {"=AVERAGE(A1:A2)+MIN(A1:A2)-MAX(A1:A2)", "formula"},
			{3, 2}: {"=COUNT(A1:A3)", "formula"},
			{4, 2}: {"=-2^2+50%*6", "formula"},
			{5, 2}: {"=B6", "formula"}, {6, 2}: {"=B5", "formula"},
			{7, 2}:  {"=12/0", "formula"},
			{8, 2}:  {"=WEBSERVICE(\"https://example.invalid\")", "formula"},
			{9, 2}:  {"=SUM(A1:AZ1000)", "formula"},
			{10, 2}: {"=SUM(C1:E1000)+SUM(C1:E1000)", "formula"},
		}},
		{Name: "五月 Plan", Cells: map[Address]Value{{3, 3}: {"='April'!B1+1", "formula"}}},
	}
	if err := CheckBook(tabs); err != nil {
		t.Fatal(err)
	}
	results := Calculate(tabs)
	expected := []string{"44", "6", "2", "7", errCycle, errCycle, errZero, errName, errBound, errBound}
	for index, want := range expected {
		if got := results[0][Address{index + 1, 2}].Display; got != want {
			t.Errorf("B%d got %q, want %q", index+1, got, want)
		}
	}
	if got := results[1][Address{3, 3}]; got.Display != "45" || !got.Live || got.Kind != "number" {
		t.Fatalf("cross-sheet result: %+v", got)
	}
	tabs[0].Cells[Address{1, 1}] = Literal("120")
	if got := Calculate(tabs)[1][Address{3, 3}].Display; got != "153" {
		t.Fatalf("dependency did not recalculate: %s", got)
	}
}

func TestXLSXRoundTripAndInertText(t *testing.T) {
	book := []Tab{
		{Name: "计划", Cells: map[Address]Value{
			{1, 1}: {Input: " 0012\n主题 ", Kind: "text"},
			{1, 2}: Literal("15"), {2, 2}: Literal("-20"),
			{1, 3}: {"=SUM(B1:B2)", "formula"}, {2, 3}: {"=B1<>B2", "formula"},
			{1, 4}: {"TRUE", "boolean"}, {2, 4}: {"=1/0", "formula"},
		}},
		{Name: "Overview", Cells: map[Address]Value{{1000, 52}: {"='计划'!C1", "formula"}}},
	}
	data, err := WriteXLSX(book, Calculate(book))
	if err != nil {
		t.Fatal(err)
	}
	copy, err := ReadXLSX(data)
	if err != nil {
		t.Fatal(err)
	}
	book[0].Cells[Address{2, 3}] = Value{"=B1<>B2", "text"}
	if !reflect.DeepEqual(book, copy) {
		t.Fatalf("unexpected workbook round trip: %#v", copy)
	}
}

func TestCSVPositionsAndValues(t *testing.T) {
	parsed, err := ReadCSV([]byte("\xef\xbb\xbf计划,0012,2\n\n\"note\nline\",=A1,-10\n"))
	if err != nil {
		t.Fatal(err)
	}
	cells := parsed[0].Cells
	if cells[Address{1, 2}] != (Value{"0012", "text"}) || cells[Address{3, 1}].Input != "note\nline" ||
		cells[Address{3, 2}] != (Value{"=A1", "text"}) || cells[Address{3, 3}] != (Value{"-10", "number"}) {
		t.Fatalf("incorrect imported CSV cells: %+v", cells)
	}
	cells[Address{3, 4}] = Value{"=C1+C3", "formula"}
	data, err := WriteCSV(parsed[0], Calculate(parsed)[0])
	if err != nil {
		t.Fatal(err)
	}
	rows, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))).ReadAll()
	if err != nil || len(rows) != 3 || rows[2][1] != "'=A1" || rows[2][2] != "-10" || rows[2][3] != "-8" {
		t.Fatalf("incorrect exported CSV: %q, %v", data, err)
	}
}

func TestReadSharedStringsAndCopiedFormula(t *testing.T) {
	var output bytes.Buffer
	archive := zip.NewWriter(&output)
	entries := map[string]string{
		"[Content_Types].xml": `<Types><Override PartName="/xl/workbook.xml" ContentType="` + workbookType + `"/></Types>`,
		"_rels/.rels":         `<Relationships><Relationship Id="r1" Type="` + relationshipNS + `/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		"xl/workbook.xml":     `<workbook xmlns:r="` + relationshipNS + `"><sheets><sheet name="Sheet1" sheetId="1" r:id="r2"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="r2" Type="` + relationshipNS + `/worksheet" Target="worksheets/sheet1.xml"/>` +
			`<Relationship Id="r3" Type="` + relationshipNS + `/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
		"xl/sharedStrings.xml": `<sst><si><r><t>计划</t></r><r><t xml:space="preserve"> name</t></r></si></sst>`,
		"xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c><c r="B1" t="s"><v>0</v></c>` +
			`<c r="C1"><f t="shared" si="0" ref="C1:C2">$A$1+A1</f></c></row><row r="2"><c r="A2"><v>3</v></c>` +
			`<c r="C2"><f t="shared" si="0"/></c></row></sheetData></worksheet>`,
	}
	for name, value := range entries {
		part, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	book, err := ReadXLSX(output.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if got := book[0].Cells[Address{1, 2}].Input; got != "计划 name" {
		t.Fatalf("shared text: %q", got)
	}
	if got := book[0].Cells[Address{2, 3}].Input; !strings.Contains(got, "$A$1+A2") || Calculate(book)[0][Address{2, 3}].Display != "10" {
		t.Fatalf("shifted shared formula: %q", got)
	}
}
