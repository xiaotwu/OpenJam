package docformat

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestMarkdownPreservesCodeParagraphs(t *testing.T) {
	source := "\ufeff# 标题\r\n\r\nParagraph with **bold**.\r\n\r\n~~~go\r\nfirst\r\n\r\nlast\r\n~~~\r\n"
	blocks, err := ReadMarkdown([]byte(source))
	if err != nil || len(blocks) != 3 {
		t.Fatalf("Markdown blocks: %+v %v", blocks, err)
	}
	if text := string(WriteMarkdown(blocks)); text != strings.ReplaceAll(strings.TrimPrefix(source, "\ufeff"), "\r\n", "\n") {
		t.Fatalf("Markdown round trip: %q", text)
	}
	if _, err := ReadMarkdown([]byte{0xff}); !errors.Is(err, ErrInvalidFile) {
		t.Fatalf("invalid UTF-8: %v", err)
	}
	if _, err := ReadMarkdown(bytes.Repeat([]byte("x"), MaxBlockBytes+1)); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("oversized block: %v", err)
	}
}

func TestDOCXRoundTrip(t *testing.T) {
	blocks := []Block{
		{Text: "# Launch 计划", FontFamily: "Lora Variable"},
		{Text: "Check **owners** & *dates* with `inline code` in [the board](/board/5711477f-032b-4b74-8266-4550a0ec1971).", FontFamily: DefaultFont},
		{Text: "1. First\n2. Second", FontFamily: DefaultFont},
		{Text: "> Small note", FontFamily: DefaultFont},
		{Text: fencedCode("line 1\n\nline 3"), FontFamily: "Space Mono"},
	}
	const origin = "https://shiori.example"
	data, err := WriteDOCX(blocks, origin)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(archive.File) < 5 {
		t.Fatalf("DOCX package: %v", err)
	}
	for _, part := range archive.File {
		content, err := readPart(archive, part.Name)
		if err != nil {
			t.Fatal(err)
		}
		decoder := xml.NewDecoder(bytes.NewReader(content))
		for {
			_, err := decoder.Token()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				t.Fatalf("%s: %v", part.Name, err)
			}
		}
	}
	links, err := readPart(archive, "word/_rels/document.xml.rels")
	if err != nil || !bytes.Contains(links, []byte(origin+"/board/")) {
		t.Fatalf("relative Shiori link was not made absolute in Word: %v", err)
	}
	reopened, err := ReadDOCX(data, origin)
	if err != nil {
		t.Fatal(err)
	}
	markdown := string(WriteMarkdown(reopened))
	for _, wanted := range []string{"# Launch 计划", "**owners**", "*dates*", "`inline code`", "[the board](/board/5711477f-032b-4b74-8266-4550a0ec1971)", "1. First", "1. Second", "> Small note", "line 1\n\nline 3"} {
		if !strings.Contains(markdown, wanted) {
			t.Errorf("missing %q in %q", wanted, markdown)
		}
	}
	if reopened[0].FontFamily != blocks[0].FontFamily {
		t.Errorf("heading font: %q", reopened[0].FontFamily)
	}
	if _, err := ReadDOCX([]byte("text"), origin); !errors.Is(err, ErrInvalidFile) {
		t.Fatalf("invalid package: %v", err)
	}
}
