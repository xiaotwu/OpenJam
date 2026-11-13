package docformat

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const (
	xmlDeclaration = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
	officeRelNS    = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	packageRelNS   = "http://schemas.openxmlformats.org/package/2006/relationships"
)

// Preserve the code style IDs that older importers recognize.
var markdownForWord = goldmark.New(goldmark.WithExtensions(extension.GFM))

type wordList struct {
	id, level, start int
	ordered          bool
}

type wordWriter struct {
	origin string
	body   strings.Builder
	links  []string
	lists  []wordList
}

func WriteDOCX(blocks []Block, origin string) ([]byte, error) {
	if err := CheckBlocks(blocks); err != nil {
		return nil, err
	}
	output := wordWriter{origin: origin}
	output.body.WriteString(xmlDeclaration + `<w:document xmlns:w="` + wordNS + `" xmlns:r="` + officeRelNS + `"><w:body>`)
	if len(blocks) == 0 {
		output.body.WriteString("<w:p/>")
	}
	for _, block := range blocks {
		var rendered bytes.Buffer
		if err := markdownForWord.Convert([]byte(block.Text), &rendered); err != nil {
			return nil, err
		}
		tree, err := html.ParseFragment(&rendered, &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div})
		if err != nil {
			return nil, err
		}
		if len(tree) == 0 {
			output.body.WriteString("<w:p/>")
		}
		for _, node := range tree {
			output.writeBlock(node, fontNames[block.FontFamily], "", 0)
			if output.body.Len() > maxXMLPartBytes-1024 {
				return nil, ErrTooLarge
			}
		}
	}
	output.body.WriteString(`<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`)
	return writeWordPackage(output)
}

func (output *wordWriter) writeBlock(node *html.Node, font, style string, depth int) {
	if node.Type == html.TextNode {
		if strings.TrimSpace(node.Data) != "" {
			output.paragraph([]wordRun{{Text: node.Data}}, font, style, wordList{})
		}
		return
	}
	if node.Type != html.ElementNode || depth > 40 {
		return
	}
	switch node.Data {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		output.paragraph(inlineRuns(node), font, "Heading"+node.Data[1:], wordList{})
	case "p":
		output.paragraph(inlineRuns(node), font, style, wordList{})
	case "pre":
		output.paragraph([]wordRun{{Text: strings.TrimSuffix(plainText(node), "\n")}}, font, "OpenJamCode", wordList{})
	case "blockquote":
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			output.writeBlock(child, font, "Quote", depth+1)
		}
	case "ol", "ul":
		output.writeList(node, font, 0)
	case "table":
		output.tableRows(node, font)
	case "hr":
		output.paragraph([]wordRun{{Text: "—"}}, font, style, wordList{})
	default:
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			output.writeBlock(child, font, style, depth+1)
		}
	}
}

func (output *wordWriter) writeList(node *html.Node, font string, level int) {
	if level > 8 {
		output.paragraph(inlineRuns(node), font, "", wordList{})
		return
	}
	start, _ := strconv.Atoi(attribute(node, "start"))
	list := wordList{id: len(output.lists) + 1, level: level, start: max(start, 1), ordered: node.Data == "ol"}
	output.lists = append(output.lists, list)
	for item := node.FirstChild; item != nil; item = item.NextSibling {
		if item.Data != "li" {
			continue
		}
		var runs []wordRun
		for child := item.FirstChild; child != nil; child = child.NextSibling {
			if child.Type == html.ElementNode && (child.Data == "ol" || child.Data == "ul") {
				continue
			}
			appendInline(child, wordRun{}, &runs)
		}
		output.paragraph(runs, font, "", list)
		for child := item.FirstChild; child != nil; child = child.NextSibling {
			if child.Type == html.ElementNode && (child.Data == "ol" || child.Data == "ul") {
				output.writeList(child, font, level+1)
			}
		}
	}
}

func (output *wordWriter) tableRows(node *html.Node, font string) {
	if node.Data == "tr" {
		var runs []wordRun
		for cell := node.FirstChild; cell != nil; cell = cell.NextSibling {
			if cell.Data != "td" && cell.Data != "th" {
				continue
			}
			if len(runs) > 0 {
				runs = append(runs, wordRun{Text: "\t"})
			}
			runs = append(runs, inlineRuns(cell)...)
		}
		output.paragraph(runs, font, "", wordList{})
		return
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		output.tableRows(child, font)
	}
}

func attribute(node *html.Node, key string) string {
	for _, attr := range node.Attr {
		if attr.Key == key {
			return attr.Val
		}
	}
	return ""
}

func plainText(node *html.Node) string {
	var text strings.Builder
	for _, run := range inlineRuns(node) {
		text.WriteString(run.Text)
	}
	return text.String()
}

func inlineRuns(node *html.Node) []wordRun {
	var runs []wordRun
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		appendInline(child, wordRun{}, &runs)
	}
	return runs
}

func appendInline(node *html.Node, state wordRun, runs *[]wordRun) {
	if node.Type == html.TextNode {
		state.Text = node.Data
		*runs = append(*runs, state)
		return
	}
	if node.Type != html.ElementNode {
		return
	}
	switch node.Data {
	case "strong", "b":
		state.Bold = true
	case "em", "i":
		state.Italic = true
	case "code":
		state.Code = true
	case "a":
		state.Link = safeLink(attribute(node, "href"))
	case "br":
		state.Text = "\n"
		*runs = append(*runs, state)
		return
	case "img":
		state.Text = attribute(node, "alt")
		*runs = append(*runs, state)
		return
	case "input":
		return
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		appendInline(child, state, runs)
	}
	if node.Data == "p" && node.NextSibling != nil {
		*runs = append(*runs, wordRun{Text: "\n"})
	}
}

func (output *wordWriter) paragraph(runs []wordRun, font, style string, list wordList) {
	xmlOut := &output.body
	xmlOut.WriteString("<w:p>")
	if style != "" || list.id > 0 {
		xmlOut.WriteString("<w:pPr>")
		if style != "" {
			fmt.Fprintf(xmlOut, `<w:pStyle w:val="%s"/>`, style)
		}
		if list.id > 0 {
			fmt.Fprintf(xmlOut, `<w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%d"/></w:numPr>`, list.level, list.id)
		}
		xmlOut.WriteString("</w:pPr>")
	}
	for _, run := range runs {
		if run.Text == "" {
			continue
		}
		if strings.HasPrefix(run.Link, "/") {
			if output.origin == "" {
				run.Text += " (" + run.Link + ")"
				run.Link = ""
			} else {
				run.Link = output.origin + run.Link
			}
		}
		if run.Link != "" {
			output.links = append(output.links, run.Link)
			fmt.Fprintf(xmlOut, `<w:hyperlink r:id="link%d">`, len(output.links))
		}
		xmlOut.WriteString("<w:r><w:rPr>")
		if run.Code {
			xmlOut.WriteString(`<w:rStyle w:val="OpenJamCodeChar"/>`)
		}
		if font != "" {
			fmt.Fprintf(xmlOut, `<w:rFonts w:ascii="%s" w:hAnsi="%s" w:cs="%s"/>`, font, font, font)
		}
		if run.Bold {
			xmlOut.WriteString("<w:b/>")
		}
		if run.Italic {
			xmlOut.WriteString("<w:i/>")
		}
		if run.Link != "" {
			xmlOut.WriteString(`<w:u w:val="single"/>`)
		}
		xmlOut.WriteString("</w:rPr>")
		writeRunText(xmlOut, run.Text)
		xmlOut.WriteString("</w:r>")
		if run.Link != "" {
			xmlOut.WriteString("</w:hyperlink>")
		}
	}
	xmlOut.WriteString("</w:p>")
}

func writeRunText(output *strings.Builder, value string) {
	for i, line := range strings.Split(value, "\n") {
		if i != 0 {
			output.WriteString("<w:br/>")
		}
		for j, part := range strings.Split(line, "\t") {
			if j != 0 {
				output.WriteString("<w:tab/>")
			}
			if part != "" {
				output.WriteString(`<w:t xml:space="preserve">`)
				_ = xml.EscapeText(output, []byte(part))
				output.WriteString("</w:t>")
			}
		}
	}
}

func wordStyles() string {
	var output strings.Builder
	output.WriteString(xmlDeclaration + `<w:styles xmlns:w="` + wordNS + `"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>`)
	for level := 1; level <= 6; level++ {
		fmt.Fprintf(&output, `<w:style w:type="paragraph" w:styleId="Heading%d"><w:name w:val="heading %d"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="%d"/></w:pPr><w:rPr><w:b/><w:sz w:val="%d"/></w:rPr></w:style>`, level, level, level-1, 38-2*level)
	}
	output.WriteString(`<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="400"/></w:pPr><w:rPr><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="OpenJamCode"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:fill="F3F3F3"/><w:ind w:left="240" w:right="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="OpenJamCodeChar"><w:name w:val="Inline Code"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:style></w:styles>`)
	return output.String()
}

func wordNumberingXML(lists []wordList) string {
	var output strings.Builder
	output.WriteString(xmlDeclaration + `<w:numbering xmlns:w="` + wordNS + `">`)
	for abstractID := 0; abstractID < 2; abstractID++ {
		fmt.Fprintf(&output, `<w:abstractNum w:abstractNumId="%d"><w:multiLevelType w:val="multilevel"/>`, abstractID)
		for level := 0; level <= 8; level++ {
			format, label := "bullet", "•"
			if abstractID == 1 {
				format, label = "decimal", fmt.Sprintf("%%%d.", level+1)
			}
			fmt.Fprintf(&output, `<w:lvl w:ilvl="%d"><w:start w:val="1"/><w:numFmt w:val="%s"/><w:lvlText w:val="%s"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="%d" w:hanging="300"/></w:pPr></w:lvl>`, level, format, label, 660+level*380)
		}
		output.WriteString("</w:abstractNum>")
	}
	for _, list := range lists {
		abstractID := 0
		if list.ordered {
			abstractID = 1
		}
		fmt.Fprintf(&output, `<w:num w:numId="%d"><w:abstractNumId w:val="%d"/><w:lvlOverride w:ilvl="%d"><w:startOverride w:val="%d"/></w:lvlOverride></w:num>`, list.id, abstractID, list.level, list.start)
	}
	output.WriteString("</w:numbering>")
	return output.String()
}

func writeWordPackage(output wordWriter) ([]byte, error) {
	var relations strings.Builder
	relations.WriteString(xmlDeclaration + `<Relationships xmlns="` + packageRelNS + `"><Relationship Id="styles" Type="` + officeRelNS + `/styles" Target="styles.xml"/><Relationship Id="numbering" Type="` + officeRelNS + `/numbering" Target="numbering.xml"/>`)
	for index, target := range output.links {
		fmt.Fprintf(&relations, `<Relationship Id="link%d" Type="%s/hyperlink" TargetMode="External" Target="`, index+1, officeRelNS)
		_ = xml.EscapeText(&relations, []byte(target))
		relations.WriteString(`"/>`)
	}
	relations.WriteString("</Relationships>")
	if relations.Len() > maxXMLPartBytes {
		return nil, ErrTooLarge
	}

	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	for _, part := range []struct{ name, data string }{
		{"[Content_Types].xml", xmlDeclaration + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`},
		{"_rels/.rels", xmlDeclaration + `<Relationships xmlns="` + packageRelNS + `"><Relationship Id="document" Type="` + officeRelNS + `/officeDocument" Target="word/document.xml"/></Relationships>`},
		{"word/document.xml", output.body.String()},
		{"word/styles.xml", wordStyles()},
		{"word/numbering.xml", wordNumberingXML(output.lists)},
		{"word/_rels/document.xml.rels", relations.String()},
	} {
		partWriter, err := archive.Create(part.name)
		if err != nil {
			return nil, err
		}
		if _, err := partWriter.Write([]byte(part.data)); err != nil {
			return nil, err
		}
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
