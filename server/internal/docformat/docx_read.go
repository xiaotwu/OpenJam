package docformat

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"path"
	"strconv"
	"strings"
)

const maxXMLPartBytes = 8 * 1024 * 1024

const (
	wordNS       = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
	strictWordNS = "http://purl.oclc.org/ooxml/wordprocessingml/main"
)

type partRelationship struct {
	ID     string `xml:"Id,attr"`
	Type   string `xml:"Type,attr"`
	Target string `xml:"Target,attr"`
	Mode   string `xml:"TargetMode,attr"`
}

type relationships struct {
	Entries []partRelationship `xml:"Relationship"`
}

type xmlValue struct {
	Value string `xml:"val,attr"`
}

type wordParagraphProps struct {
	Style   xmlValue `xml:"pStyle"`
	Outline xmlValue `xml:"outlineLvl"`
	Number  struct {
		ID    xmlValue `xml:"numId"`
		Level xmlValue `xml:"ilvl"`
	} `xml:"numPr"`
}

type wordRun struct {
	Text, Link, Font   string
	Bold, Italic, Code bool
}

type wordRunProps struct {
	Bold   *xmlValue `xml:"b"`
	Italic *xmlValue `xml:"i"`
	Style  xmlValue  `xml:"rStyle"`
	Fonts  struct {
		ASCII string `xml:"ascii,attr"`
		HAnsi string `xml:"hAnsi,attr"`
	} `xml:"rFonts"`
}

func readPart(archive *zip.Reader, name string) ([]byte, error) {
	var part *zip.File
	for _, candidate := range archive.File {
		if candidate.Name == name {
			if part != nil {
				return nil, ErrInvalidFile
			}
			part = candidate
		}
	}
	if part == nil {
		return nil, nil
	}
	if part.UncompressedSize64 > maxXMLPartBytes {
		return nil, ErrTooLarge
	}
	reader, err := part.Open()
	if err != nil {
		return nil, ErrInvalidFile
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, maxXMLPartBytes+1))
	if err != nil {
		return nil, ErrInvalidFile
	}
	if len(data) > maxXMLPartBytes {
		return nil, ErrTooLarge
	}
	return data, nil
}

func readXMLPart(archive *zip.Reader, name string, target any) error {
	if name == "" {
		return nil
	}
	data, err := readPart(archive, name)
	if err != nil || data == nil {
		return err
	}
	if xml.Unmarshal(data, target) != nil {
		return ErrInvalidFile
	}
	return nil
}

func partPath(base, target string) string {
	if target == "" || strings.ContainsAny(target, "\\?#:") {
		return ""
	}
	if strings.HasPrefix(target, "/") {
		base = ""
		target = strings.TrimPrefix(target, "/")
	}
	resolved := path.Join(base, target)
	if resolved == ".." || strings.HasPrefix(resolved, "../") {
		return ""
	}
	return resolved
}

type wordStyle struct {
	ID    string             `xml:"styleId,attr"`
	Name  xmlValue           `xml:"name"`
	Props wordParagraphProps `xml:"pPr"`
}

type numberLevel struct {
	Index  string   `xml:"ilvl,attr"`
	Format xmlValue `xml:"numFmt"`
	Start  xmlValue `xml:"start"`
}

type wordNumbering struct {
	Abstracts []struct {
		ID     string        `xml:"abstractNumId,attr"`
		Levels []numberLevel `xml:"lvl"`
	} `xml:"abstractNum"`
	Lists []struct {
		ID       string   `xml:"numId,attr"`
		Abstract xmlValue `xml:"abstractNumId"`
	} `xml:"num"`
}

type wordReader struct {
	links  map[string]string
	styles map[string]wordStyle
	lists  map[string][]numberLevel
}

func ReadDOCX(data []byte, origin string) ([]Block, error) {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(archive.File) > 2048 {
		return nil, ErrInvalidFile
	}
	contentTypes, err := readPart(archive, "[Content_Types].xml")
	if err != nil {
		return nil, err
	}
	if !bytes.Contains(contentTypes, []byte("wordprocessingml.document.main+xml")) {
		return nil, ErrInvalidFile
	}
	var root relationships
	if err := readXMLPart(archive, "_rels/.rels", &root); err != nil {
		return nil, err
	}
	var main string
	for _, relation := range root.Entries {
		if relation.Mode != "External" && strings.HasSuffix(relation.Type, "/officeDocument") {
			main = partPath("", relation.Target)
			break
		}
	}
	if main == "" {
		return nil, ErrInvalidFile
	}
	xmlBody, err := readPart(archive, main)
	if err != nil {
		return nil, err
	}
	if len(xmlBody) == 0 {
		return nil, ErrInvalidFile
	}

	var related relationships
	if err := readXMLPart(archive, path.Join(path.Dir(main), "_rels", path.Base(main)+".rels"), &related); err != nil {
		return nil, err
	}
	source := wordReader{links: map[string]string{}, styles: map[string]wordStyle{}, lists: map[string][]numberLevel{}}
	var stylesPart, numberingPart string
	for _, relation := range related.Entries {
		switch {
		case strings.HasSuffix(relation.Type, "/hyperlink"):
			target := safeLink(relation.Target)
			if origin != "" && strings.HasPrefix(target, origin+"/") {
				local := strings.TrimPrefix(target, origin)
				if safeLink(local) != "" {
					target = local
				}
			}
			source.links[relation.ID] = target
		case relation.Mode == "External":
			continue
		case stylesPart == "" && strings.HasSuffix(relation.Type, "/styles"):
			stylesPart = partPath(path.Dir(main), relation.Target)
		case numberingPart == "" && strings.HasSuffix(relation.Type, "/numbering"):
			numberingPart = partPath(path.Dir(main), relation.Target)
		}
	}
	var styles struct {
		Styles []wordStyle `xml:"style"`
	}
	if err := readXMLPart(archive, stylesPart, &styles); err != nil {
		return nil, err
	}
	for _, style := range styles.Styles {
		source.styles[style.ID] = style
	}
	var numbering wordNumbering
	if err := readXMLPart(archive, numberingPart, &numbering); err != nil {
		return nil, err
	}
	abstracts := map[string][]numberLevel{}
	for _, abstract := range numbering.Abstracts {
		abstracts[abstract.ID] = abstract.Levels
	}
	for _, list := range numbering.Lists {
		source.lists[list.ID] = abstracts[list.Abstract.Value]
	}

	blocks, err := source.readBody(xml.NewDecoder(bytes.NewReader(xmlBody)))
	if err != nil {
		if errors.Is(err, ErrTooLarge) {
			return nil, err
		}
		return nil, ErrInvalidFile
	}
	return blocks, CheckBlocks(blocks)
}

func wordElement(name xml.Name) bool {
	return name.Space == wordNS || name.Space == strictWordNS
}

func attrValue(start xml.StartElement, key string) string {
	for _, attribute := range start.Attr {
		if attribute.Name.Local == key {
			return attribute.Value
		}
	}
	return ""
}

func (source wordReader) readBody(decoder *xml.Decoder) ([]Block, error) {
	var document, inBody, sawBody bool
	var previousList string
	var blocks []Block
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) && sawBody && !inBody {
			return blocks, nil
		}
		if err != nil {
			return nil, err
		}
		switch node := token.(type) {
		case xml.StartElement:
			if !wordElement(node.Name) {
				continue
			}
			switch node.Name.Local {
			case "document":
				document = true
			case "body":
				inBody, sawBody = document, document
			case "del", "moveFrom":
				if err := decoder.Skip(); err != nil {
					return nil, err
				}
			case "p":
				if !inBody {
					continue
				}
				block, list, err := source.readParagraph(decoder, node)
				if err != nil {
					return nil, err
				}
				if block.Text == "" {
					previousList = ""
					continue
				}
				if list != "" && list == previousList && len(blocks) > 0 &&
					blocks[len(blocks)-1].FontFamily == block.FontFamily &&
					len(blocks[len(blocks)-1].Text)+len(block.Text)+1 <= MaxBlockBytes {
					blocks[len(blocks)-1].Text += "\n" + block.Text
				} else {
					blocks = append(blocks, block)
				}
				previousList = list
				if len(blocks) > MaxBlocks {
					return nil, ErrTooLarge
				}
			}
		case xml.EndElement:
			if wordElement(node.Name) && node.Name.Local == "body" {
				inBody = false
			}
		}
	}
}

func (source wordReader) readParagraph(decoder *xml.Decoder, start xml.StartElement) (Block, string, error) {
	var props wordParagraphProps
	var runs []wordRun
	var link string
	for {
		token, err := decoder.Token()
		if err != nil {
			return Block{}, "", err
		}
		switch node := token.(type) {
		case xml.StartElement:
			if !wordElement(node.Name) {
				continue
			}
			switch node.Name.Local {
			case "pPr":
				err = decoder.DecodeElement(&props, &node)
			case "r":
				var run wordRun
				run, err = readWordRun(decoder, node)
				if err == nil && run.Text != "" {
					run.Link = link
					runs = append(runs, run)
				}
			case "hyperlink":
				link = source.links[attrValue(node, "id")]
			case "del", "moveFrom":
				err = decoder.Skip()
			}
			if err != nil {
				return Block{}, "", err
			}
		case xml.EndElement:
			if node.Name == start.Name {
				return source.toBlock(props, runs)
			}
			if wordElement(node.Name) && node.Name.Local == "hyperlink" {
				link = ""
			}
		}
	}
}

func readWordRun(decoder *xml.Decoder, start xml.StartElement) (wordRun, error) {
	var text strings.Builder
	var props wordRunProps
	for {
		token, err := decoder.Token()
		if err != nil {
			return wordRun{}, err
		}
		switch node := token.(type) {
		case xml.StartElement:
			switch node.Name.Local {
			case "rPr":
				err = decoder.DecodeElement(&props, &node)
			case "t":
				var value string
				err = decoder.DecodeElement(&value, &node)
				text.WriteString(value)
			case "br", "cr":
				text.WriteByte('\n')
				err = decoder.Skip()
			case "tab":
				text.WriteByte('\t')
				err = decoder.Skip()
			default:
				err = decoder.Skip()
			}
			if err != nil {
				return wordRun{}, err
			}
		case xml.EndElement:
			if node.Name == start.Name {
				font := props.Fonts.ASCII
				if font == "" {
					font = props.Fonts.HAnsi
				}
				return wordRun{Text: text.String(), Font: font, Bold: wordEnabled(props.Bold),
					Italic: wordEnabled(props.Italic), Code: props.Style.Value == "ShioriCodeChar" || props.Style.Value == "OpenJamCodeChar"}, nil
			}
		}
	}
}

func wordEnabled(value *xmlValue) bool {
	return value != nil && value.Value != "0" && value.Value != "false" && value.Value != "off"
}

func (source wordReader) toBlock(props wordParagraphProps, runs []wordRun) (Block, string, error) {
	block := Block{FontFamily: DefaultFont}
	if len(runs) == 0 {
		return block, "", nil
	}
	for _, run := range runs {
		if run.Font != "" {
			block.FontFamily = importedFont(run.Font)
			break
		}
	}
	style := source.styles[props.Style.Value]
	heading := headingLevel(props.Style.Value, style.Name.Value, props.Outline.Value, style.Props.Outline.Value)
	switch {
	case strings.EqualFold(props.Style.Value, "ShioriCode") || strings.EqualFold(props.Style.Value, "OpenJamCode"):
		var literal strings.Builder
		for _, run := range runs {
			literal.WriteString(run.Text)
		}
		block.Text = fencedCode(literal.String())
	case heading > 0:
		block.Text = strings.Repeat("#", heading) + " " + strings.ReplaceAll(markdownRuns(runs), "\n", " ")
	case strings.Contains(strings.ToLower(props.Style.Value), "quote"):
		block.Text = "> " + strings.ReplaceAll(markdownRuns(runs), "\n", "\n> ")
	default:
		block.Text = markdownRuns(runs)
	}
	if list := props.Number.ID.Value; list != "" && list != "0" {
		level, _ := strconv.Atoi(props.Number.Level.Value)
		level = max(0, min(level, 8))
		marker := "- "
		for _, format := range source.lists[list] {
			if format.Index == strconv.Itoa(level) && format.Format.Value != "bullet" {
				marker = "1. "
				break
			}
		}
		indent := strings.Repeat(" ", 4*level)
		block.Text = indent + marker + strings.ReplaceAll(block.Text, "\n", "\n"+indent+"    ")
		return block, list, nil
	}
	return block, "", nil
}

func headingLevel(id, name string, outlines ...string) int {
	for _, value := range []string{id, name} {
		simple := strings.ToLower(strings.ReplaceAll(value, " ", ""))
		if simple == "title" {
			return 1
		}
		if level, err := strconv.Atoi(strings.TrimPrefix(simple, "heading")); strings.HasPrefix(simple, "heading") && err == nil && level >= 1 && level <= 6 {
			return level
		}
	}
	for _, outline := range outlines {
		if level, err := strconv.Atoi(outline); err == nil && level >= 0 && level < 6 {
			return level + 1
		}
	}
	return 0
}

var markdownEscape = strings.NewReplacer("\\", "\\\\", "*", "\\*", "_", "\\_", "[", "\\[", "]", "\\]",
	"`", "\\`", "<", "\\<", ">", "\\>", "#", "\\#", "~", "\\~", "|", "\\|")

func markdownRuns(runs []wordRun) string {
	var rendered strings.Builder
	for i := 0; i < len(runs); {
		span := runs[i]
		var text strings.Builder
		for ; i < len(runs); i++ {
			item := runs[i]
			if item.Bold != span.Bold || item.Italic != span.Italic || item.Code != span.Code || item.Link != span.Link {
				break
			}
			text.WriteString(item.Text)
		}
		value := text.String()
		core := strings.TrimSpace(value)
		if core == "" {
			rendered.WriteString(value)
			continue
		}
		start := strings.Index(value, core)
		rendered.WriteString(value[:start])
		formatted := markdownEscape.Replace(core)
		if span.Code && !strings.ContainsRune(core, '`') {
			formatted = "`" + core + "`"
		}
		if span.Bold {
			formatted = "**" + formatted + "**"
		}
		if span.Italic {
			formatted = "*" + formatted + "*"
		}
		if span.Link != "" {
			target := strings.NewReplacer("(", "%28", ")", "%29").Replace(span.Link)
			formatted = "[" + formatted + "](" + target + ")"
		}
		rendered.WriteString(formatted)
		rendered.WriteString(value[start+len(core):])
	}
	return rendered.String()
}
