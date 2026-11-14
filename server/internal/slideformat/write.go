package slideformat

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode"
)

const (
	xmlNamespaces = ` xmlns:p="` + presentationNS + `" xmlns:a="` + drawingNS + `" xmlns:r="` + officeRelNS + `"`
	blankGroup    = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`
	masterColors  = `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`
)

func WritePPTX(slides []Slide, media map[string]Media) ([]byte, error) {
	if err := CheckDeck(slides); err != nil {
		return nil, err
	}
	var output bytes.Buffer
	archive := zip.NewWriter(&output)
	add := func(name string, data []byte) error {
		file, err := archive.Create(name)
		if err != nil {
			return err
		}
		_, err = file.Write(data)
		return err
	}
	addXML := func(name, value string) error { return add(name, []byte(xml.Header+value)) }
	addValue := func(name string, value any) error {
		data, err := xml.Marshal(value)
		if err != nil {
			return err
		}
		return addXML(name, string(data))
	}
	addRels := func(name string, values ...relationship) error {
		return addValue(name, relationshipFile{XMLNS: packageRelNS, Items: values})
	}

	paths, err := writeMedia(slides, media, add)
	if err != nil {
		return nil, err
	}
	presentationRels := []relationship{rel("rIdMaster", "slideMaster", "slideMasters/slideMaster1.xml")}
	types := contentTypes{
		XMLNS: contentNS,
		Defaults: []contentDefault{
			{Extension: "xml", Type: "application/xml"},
			{Extension: "rels", Type: "application/vnd.openxmlformats-package.relationships+xml"},
			{Extension: "png", Type: "image/png"},
			{Extension: "jpeg", Type: "image/jpeg"},
		},
		Overrides: []contentOverride{
			{Part: "/ppt/presentation.xml", Type: presentationType},
			presentationOverride("slideMasters/slideMaster1.xml", "slideMaster"),
			presentationOverride("slideLayouts/slideLayout1.xml", "slideLayout"),
			{Part: "/ppt/theme/theme1.xml", Type: "application/vnd.openxmlformats-officedocument.theme+xml"},
		},
	}
	var list strings.Builder
	for i, slide := range slides {
		number := strconv.Itoa(i + 1)
		relationID := "rId" + number
		file := "slides/slide" + number + ".xml"
		presentationRels = append(presentationRels, rel(relationID, "slide", file))
		types.Overrides = append(types.Overrides, presentationOverride(file, "slide"))
		fmt.Fprintf(&list, `<p:sldId id="%d" r:id="%s"/>`, i+256, relationID)
		content, relations := writeSlide(slide, paths)
		if err := addXML("ppt/"+file, content); err != nil {
			return nil, err
		}
		if err := addRels("ppt/slides/_rels/slide"+number+".xml.rels", relations...); err != nil {
			return nil, err
		}
	}
	frame := slides[0].Frame
	presentation := `<p:presentation` + xmlNamespaces + `><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>` +
		`<p:sldIdLst>` + list.String() + `</p:sldIdLst>` +
		fmt.Sprintf(`<p:sldSz cx="%d" cy="%d"/><p:notesSz cx="%d" cy="%d"/></p:presentation>`,
			frame.Width*emuPerPixel, frame.Height*emuPerPixel, 720*emuPerPixel, 960*emuPerPixel)
	for _, part := range []struct {
		name  string
		value string
	}{
		{"ppt/presentation.xml", presentation},
		{"ppt/slideMasters/slideMaster1.xml", slideMasterXML()},
		{"ppt/slideLayouts/slideLayout1.xml", slideLayoutXML()},
		{"ppt/theme/theme1.xml", themeXML()},
	} {
		if err := addXML(part.name, part.value); err != nil {
			return nil, err
		}
	}
	if err := addValue("[Content_Types].xml", types); err != nil {
		return nil, err
	}
	for _, entry := range []struct {
		name  string
		items []relationship
	}{
		{"_rels/.rels", []relationship{rel("rId1", "officeDocument", "ppt/presentation.xml")}},
		{"ppt/_rels/presentation.xml.rels", presentationRels},
		{"ppt/slideMasters/_rels/slideMaster1.xml.rels", []relationship{
			rel("rIdLayout", "slideLayout", "../slideLayouts/slideLayout1.xml"), rel("rIdTheme", "theme", "../theme/theme1.xml"),
		}},
		{"ppt/slideLayouts/_rels/slideLayout1.xml.rels", []relationship{rel("rIdMaster", "slideMaster", "../slideMasters/slideMaster1.xml")}},
	} {
		if err := addRels(entry.name, entry.items...); err != nil {
			return nil, err
		}
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	if output.Len() > MaxUploadBytes {
		return nil, ErrLimit
	}
	return output.Bytes(), nil
}

func writeMedia(slides []Slide, media map[string]Media, add func(string, []byte) error) (map[string]string, error) {
	required := make(map[string]bool)
	for _, slide := range slides {
		for _, item := range slide.Objects {
			if item.Type == "image" {
				required[item.AssetID] = true
			}
		}
	}
	ids := make([]string, 0, len(required))
	for id := range required {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	paths := make(map[string]string, len(ids))
	var total int
	for i, id := range ids {
		asset := media[id]
		extension, ok := MediaExtension(asset.Metadata.MIMEType)
		if !ok || asset.Metadata.ID != id || int64(len(asset.Data)) != asset.Metadata.Size || len(asset.Data) == 0 {
			return nil, fmt.Errorf("%w: a referenced picture is unavailable", ErrInvalid)
		}
		total += len(asset.Data)
		if total > MaxMediaBytes {
			return nil, ErrLimit
		}
		path := "media/image" + strconv.Itoa(i+1) + "." + extension
		if err := add("ppt/"+path, asset.Data); err != nil {
			return nil, err
		}
		paths[id] = "../" + path
	}
	return paths, nil
}

func rel(id, kind, target string) relationship {
	return relationship{ID: id, Type: officeRelNS + "/" + kind, Target: target}
}

func presentationOverride(path, kind string) contentOverride {
	return contentOverride{Part: "/ppt/" + path, Type: "application/vnd.openxmlformats-officedocument.presentationml." + kind + "+xml"}
}

func escape(value string) string {
	var text strings.Builder
	_ = xml.EscapeText(&text, []byte(value))
	return text.String()
}

func emu(value float64) int64 { return int64(math.Round(value * emuPerPixel)) }

func (box Box) xml() string {
	rotation := int(math.Round(box.Rotation * 60000))
	return fmt.Sprintf(`<a:xfrm rot="%d"><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>`,
		rotation, emu(box.X), emu(box.Y), emu(box.Width), emu(box.Height))
}

func writeSlide(slide Slide, paths map[string]string) (string, []relationship) {
	var text strings.Builder
	text.WriteString(`<p:sld` + xmlNamespaces + `><p:cSld name="` + escape(slide.Name) + `">`)
	text.WriteString(`<p:bg><p:bgPr><a:solidFill><a:srgbClr val="` + slide.Background[1:] + `"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`)
	text.WriteString(`<p:spTree>` + blankGroup)
	relations := []relationship{rel("rIdLayout", "slideLayout", "../slideLayouts/slideLayout1.xml")}
	imageLinks := make(map[string]string)
	for i, item := range slide.Objects {
		if item.Type == "text" {
			writeTextBox(&text, i+2, item)
			continue
		}
		link := imageLinks[item.AssetID]
		if link == "" {
			link = "rIdImage" + strconv.Itoa(len(imageLinks)+1)
			imageLinks[item.AssetID] = link
			relations = append(relations, rel(link, "image", paths[item.AssetID]))
		}
		writePicture(&text, i+2, link, item)
	}
	text.WriteString(`</p:spTree></p:cSld>` + masterColors + `</p:sld>`)
	return text.String(), relations
}

func writeTextBox(text *strings.Builder, index int, item Object) {
	fmt.Fprintf(text, `<p:sp><p:nvSpPr><p:cNvPr id="%d" name="Text %d"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>`, index, index-1)
	text.WriteString(item.Box.xml() + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>`)
	text.WriteString(`<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>`)
	align := map[string]string{"left": "l", "center": "ctr", "right": "r"}[item.TextAlign]
	font := strings.TrimSuffix(item.FontFamily, " Variable")
	if item.FontFamily == DefaultFont {
		// Arial keeps a default text box sans-serif on Office installs that
		// do not have the bundled web font.
		font = "Arial"
	}
	size := int(math.Round(item.FontSize * 75))
	normalized := strings.ReplaceAll(strings.ReplaceAll(item.Text, "\r\n", "\n"), "\r", "\n")
	for _, line := range strings.Split(normalized, "\n") {
		language, eastAsian := exportTextLanguage(line)
		format := fmt.Sprintf(`<a:rPr lang="%s" sz="%d" b="%t" i="%t"><a:solidFill><a:srgbClr val="%s"/></a:solidFill><a:latin typeface="%s"/>`,
			language, size, item.FontWeight == "bold", item.FontStyle == "italic", item.Color[1:], escape(font))
		if eastAsian != "" {
			format += `<a:ea typeface="` + escape(eastAsian) + `"/>`
		}
		fmt.Fprintf(text, `<a:p><a:pPr algn="%s"><a:lnSpc><a:spcPct val="114000"/></a:lnSpc></a:pPr><a:r>%s</a:rPr><a:t>%s</a:t></a:r><a:endParaRPr lang="%s" sz="%d"/></a:p>`,
			align, format, escape(line), language, size)
	}
	text.WriteString(`</p:txBody></p:sp>`)
}

func exportTextLanguage(text string) (string, string) {
	var han, kana, hangul bool
	for _, r := range text {
		han = han || unicode.Is(unicode.Han, r)
		kana = kana || unicode.In(r, unicode.Hiragana, unicode.Katakana)
		hangul = hangul || unicode.Is(unicode.Hangul, r)
	}
	switch {
	case kana:
		return "ja-JP", "Yu Gothic"
	case hangul:
		return "ko-KR", "Malgun Gothic"
	case han:
		return "zh-CN", "Microsoft YaHei"
	default:
		return "en-US", ""
	}
}

func writePicture(text *strings.Builder, index int, link string, item Object) {
	fmt.Fprintf(text, `<p:pic><p:nvPicPr><p:cNvPr id="%d" name="Picture %d" descr="%s"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="%s"/>`,
		index, index-1, escape(item.Caption), link)
	if item.Crop != nil {
		fmt.Fprintf(text, `<a:srcRect l="%d" t="%d" r="%d" b="%d"/>`, item.Crop.Left, item.Crop.Top, item.Crop.Right, item.Crop.Bottom)
	}
	text.WriteString(`<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>` + item.Box.xml() +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`)
}

func slideMasterXML() string {
	return `<p:sldMaster` + xmlNamespaces + `><p:cSld><p:spTree>` + blankGroup + `</p:spTree></p:cSld>` +
		`<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
		`<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
}

func slideLayoutXML() string {
	return `<p:sldLayout` + xmlNamespaces + ` type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>` +
		blankGroup + `</p:spTree></p:cSld>` + masterColors + `</p:sldLayout>`
}

func themeXML() string {
	var colors strings.Builder
	for _, color := range []struct{ key, hex string }{
		{"dk1", "202124"}, {"lt1", "FFFFFF"}, {"dk2", "303134"}, {"lt2", "F4F5F6"},
		{"accent1", "2E5984"}, {"accent2", "546F58"}, {"accent3", "A56B51"}, {"accent4", "746692"},
		{"accent5", "426E76"}, {"accent6", "958146"}, {"hlink", "215E9B"}, {"folHlink", "594780"},
	} {
		fmt.Fprintf(&colors, `<a:%s><a:srgbClr val="%s"/></a:%s>`, color.key, color.hex, color.key)
	}
	fill := `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`
	font := `<a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/>`
	return `<a:theme xmlns:a="` + drawingNS + `" name="Shiori"><a:themeElements><a:clrScheme name="Shiori">` +
		colors.String() + `</a:clrScheme><a:fontScheme name="Shiori"><a:majorFont>` + font +
		`</a:majorFont><a:minorFont>` + font + `</a:minorFont></a:fontScheme><a:fmtScheme name="Shiori"><a:fillStyleLst>` +
		strings.Repeat(fill, 3) + `</a:fillStyleLst><a:lnStyleLst>` +
		strings.Repeat(`<a:ln w="12700">`+fill+`<a:prstDash val="solid"/></a:ln>`, 3) +
		`</a:lnStyleLst><a:effectStyleLst>` + strings.Repeat(`<a:effectStyle><a:effectLst/></a:effectStyle>`, 3) +
		`</a:effectStyleLst><a:bgFillStyleLst>` + strings.Repeat(fill, 3) +
		`</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
}
