package slideformat

import (
	"encoding/xml"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/xiaotwu/shiori/server/internal/assets"
)

type dimensions struct {
	X int64 `xml:"cx,attr"`
	Y int64 `xml:"cy,attr"`
}

type offset struct {
	X int64 `xml:"x,attr"`
	Y int64 `xml:"y,attr"`
}

type transform struct {
	Rotation int64      `xml:"rot,attr"`
	Offset   offset     `xml:"off"`
	Size     dimensions `xml:"ext"`
}

func (t transform) box() (Box, bool) {
	if t.Size.X <= 0 || t.Size.Y <= 0 {
		return Box{}, false
	}
	return Box{
		X: float64(t.Offset.X) / emuPerPixel, Y: float64(t.Offset.Y) / emuPerPixel,
		Width: max(1, float64(t.Size.X)/emuPerPixel), Height: max(1, float64(t.Size.Y)/emuPerPixel),
		Rotation: float64(t.Rotation%(360*60000)) / 60000,
	}, true
}

type fillXML struct {
	RGB    string
	Scheme string
}

func (fill *fillXML) UnmarshalXML(decoder *xml.Decoder, start xml.StartElement) error {
	var content struct {
		RGB struct {
			Value string `xml:"val,attr"`
		} `xml:"srgbClr"`
		Scheme struct {
			Value string `xml:"val,attr"`
		} `xml:"schemeClr"`
	}
	if err := decoder.DecodeElement(&content, &start); err != nil {
		return err
	}
	fill.RGB, fill.Scheme = content.RGB.Value, content.Scheme.Value
	return nil
}

func (fill fillXML) color() string {
	if color := "#" + strings.ToLower(fill.RGB); Color(color) {
		return color
	}
	switch fill.Scheme {
	case "lt1", "bg1":
		return "#ffffff"
	case "dk1", "tx1":
		return "#202124"
	}
	return ""
}

type textStyle struct {
	Size   int     `xml:"sz,attr"`
	Bold   string  `xml:"b,attr"`
	Italic string  `xml:"i,attr"`
	Fill   fillXML `xml:"solidFill"`
	Font   struct {
		Face string `xml:"typeface,attr"`
	} `xml:"latin"`
}

type textPart struct {
	XMLName xml.Name
	Style   textStyle `xml:"rPr"`
	Text    string    `xml:"t"`
}

type paragraph struct {
	Props struct {
		Align   string    `xml:"algn,attr"`
		Default textStyle `xml:"defRPr"`
	} `xml:"pPr"`
	Parts []textPart `xml:",any"`
}

type placeholder struct {
	Kind  string `xml:"type,attr"`
	Index string `xml:"idx,attr"`
}

type drawing struct {
	XMLName xml.Name
	TextBox *struct {
		Paragraphs []paragraph `xml:"p"`
	} `xml:"txBody"`
	Place    *placeholder `xml:"nvSpPr>nvPr>ph"`
	PicPlace *placeholder `xml:"nvPicPr>nvPr>ph"`
	Caption  struct {
		Description string `xml:"descr,attr"`
	} `xml:"nvPicPr>cNvPr"`
	Transform transform `xml:"spPr>xfrm"`
	Picture   struct {
		Blip struct {
			Embed string `xml:"embed,attr"`
		} `xml:"blip"`
		Crop *struct {
			Left   int `xml:"l,attr"`
			Top    int `xml:"t,attr"`
			Right  int `xml:"r,attr"`
			Bottom int `xml:"b,attr"`
		} `xml:"srcRect"`
	} `xml:"blipFill"`
}

type canvasXML struct {
	XMLName xml.Name
	Shared  struct {
		Name       string  `xml:"name,attr"`
		Background fillXML `xml:"bg>bgPr>solidFill"`
		Tree       struct {
			Items []drawing `xml:",any"`
		} `xml:"spTree"`
	} `xml:"cSld"`
}

type placement struct {
	placeholder
	Box
}

type importer struct {
	parts           slidePackage
	deck            Deck
	layouts         map[string][]placement
	mediaIDs        map[string]string
	mediaSize       int
	ignoredPictures int
	ignoredObjects  int
}

func ReadPPTX(data []byte) (Deck, error) {
	parts, err := openPackage(data)
	if err != nil {
		return Deck{}, err
	}
	roots, err := parts.relationships("")
	if err != nil {
		return Deck{}, err
	}
	presentation := relatedPart(roots, "", "officeDocument")
	var types contentTypes
	if err := parts.xml("[Content_Types].xml", &types); err != nil {
		return Deck{}, err
	}
	if presentation == "" || !slices.ContainsFunc(types.Overrides, func(item contentOverride) bool {
		return item.Part == "/"+presentation && item.Type == presentationType
	}) {
		return Deck{}, fmt.Errorf("%w: choose a PowerPoint .pptx file", ErrInvalid)
	}
	var structure struct {
		XMLName xml.Name   `xml:"presentation"`
		Size    dimensions `xml:"sldSz"`
		Slides  []struct {
			// The unqualified id is numeric. The qualified id names a relationship.
			Link       string `xml:"http://schemas.openxmlformats.org/officeDocument/2006/relationships id,attr"`
			StrictLink string `xml:"http://purl.oclc.org/ooxml/officeDocument/relationships id,attr"`
		} `xml:"sldIdLst>sldId"`
	}
	if err := parts.xml(presentation, &structure); err != nil {
		return Deck{}, err
	}
	if len(structure.Slides) == 0 || len(structure.Slides) > MaxSlides {
		return Deck{}, fmt.Errorf("%w: up to %d slides", ErrLimit, MaxSlides)
	}
	frame := BlankSlide().Frame
	if structure.Size.X != 0 || structure.Size.Y != 0 {
		frame.Width = int(math.Round(float64(structure.Size.X) / emuPerPixel))
		frame.Height = int(math.Round(float64(structure.Size.Y) / emuPerPixel))
	}
	if err := CheckFrame("Slide", frame); err != nil {
		return Deck{}, err
	}
	rels, err := parts.relationships(presentation)
	if err != nil {
		return Deck{}, err
	}
	reader := importer{parts: parts, deck: Deck{Media: make(map[string]Media)},
		layouts: make(map[string][]placement), mediaIDs: make(map[string]string)}
	visited := make(map[string]bool)
	for i, entry := range structure.Slides {
		link := entry.Link
		if link == "" {
			link = entry.StrictLink
		}
		rel := rels[link]
		part, valid := relationPath(presentation, rel)
		if !valid || !strings.HasSuffix(rel.Type, "/slide") || visited[part] {
			return Deck{}, ErrInvalid
		}
		visited[part] = true
		slide, err := reader.slide(part, frame)
		if err != nil {
			return Deck{}, fmt.Errorf("Slide %d: %w", i+1, err)
		}
		reader.deck.Slides = append(reader.deck.Slides, slide)
	}
	if err := CheckDeck(reader.deck.Slides); err != nil {
		return Deck{}, err
	}
	if reader.ignoredPictures > 0 {
		reader.deck.Warnings = append(reader.deck.Warnings, fmt.Sprintf("%d linked or unsupported pictures were skipped. Embedded PNG and JPEG pictures are supported.", reader.ignoredPictures))
	}
	if reader.ignoredObjects > 0 {
		reader.deck.Warnings = append(reader.deck.Warnings, fmt.Sprintf("%d objects such as shapes, groups, charts or tables were skipped.", reader.ignoredObjects))
	}
	return reader.deck, nil
}

func (r *importer) slide(part string, frame Frame) (Slide, error) {
	var content canvasXML
	if err := r.parts.xml(part, &content); err != nil {
		return Slide{}, err
	}
	if content.XMLName.Local != "sld" {
		return Slide{}, ErrInvalid
	}
	rels, err := r.parts.relationships(part)
	if err != nil {
		return Slide{}, err
	}
	layout, err := r.placements(relatedPart(rels, part, "slideLayout"))
	if err != nil {
		return Slide{}, err
	}
	name := shortName(content.Shared.Name, 120)
	if name == "" {
		name = "Slide"
	}
	if bg := content.Shared.Background.color(); bg != "" {
		frame.Background = bg
	}
	slide := Slide{Name: name, Frame: frame}
	for _, shape := range content.Shared.Tree.Items {
		var item Object
		switch shape.XMLName.Local {
		case "sp":
			if shape.TextBox == nil {
				r.ignoredObjects++
				continue
			}
			item = shape.readText(frame, layout)
			if item.Text == "" {
				continue
			}
		case "pic":
			picture, ok, err := r.picture(shape, part, rels, layout, frame)
			if err != nil {
				return Slide{}, err
			}
			if !ok {
				r.ignoredPictures++
				continue
			}
			item = picture
		case "graphicFrame", "grpSp", "cxnSp", "contentPart", "AlternateContent":
			r.ignoredObjects++
			continue
		default:
			continue
		}
		if err := CheckObject(item); err != nil {
			return Slide{}, err
		}
		if len(slide.Objects) >= MaxSlideObjects {
			return Slide{}, fmt.Errorf("%w: up to %d objects on each slide", ErrLimit, MaxSlideObjects)
		}
		slide.Objects = append(slide.Objects, item)
	}
	return slide, nil
}

func (r *importer) placements(layout string) ([]placement, error) {
	if layout == "" {
		return nil, nil
	}
	if values, ok := r.layouts[layout]; ok {
		return values, nil
	}
	values, err := r.placeholderBoxes(layout, "sldLayout")
	if err != nil {
		return nil, err
	}
	rels, err := r.parts.relationships(layout)
	if err != nil {
		return nil, err
	}
	if master := relatedPart(rels, layout, "slideMaster"); master != "" {
		masterBoxes, ok := r.layouts[master]
		if !ok {
			masterBoxes, err = r.placeholderBoxes(master, "sldMaster")
			if err != nil {
				return nil, err
			}
			r.layouts[master] = masterBoxes
		}
		values = append(values, masterBoxes...)
	}
	r.layouts[layout] = values
	return values, nil
}

func (r *importer) placeholderBoxes(part, kind string) ([]placement, error) {
	var content canvasXML
	if err := r.parts.xml(part, &content); err != nil {
		return nil, err
	}
	if content.XMLName.Local != kind {
		return nil, ErrInvalid
	}
	var values []placement
	for _, shape := range content.Shared.Tree.Items {
		ph := shape.Place
		if shape.XMLName.Local == "pic" {
			ph = shape.PicPlace
		}
		if box, ok := shape.Transform.box(); ok && ph != nil {
			values = append(values, placement{placeholder: *ph, Box: box})
		}
	}
	return values, nil
}

func (shape drawing) position(layout []placement, ph *placeholder, frame Frame) Box {
	if box, ok := shape.Transform.box(); ok {
		return box
	}
	w, h := float64(frame.Width), float64(frame.Height)
	fallback := Box{X: w * .07, Y: h * .2, Width: w * .86, Height: h * .55}
	if ph == nil {
		return fallback
	}
	for _, value := range layout {
		if (ph.Index != "" && ph.Index == value.Index) ||
			(ph.Index == "" && ph.Kind != "" && ph.Kind == value.Kind) {
			return value.Box
		}
	}
	if ph.Kind == "title" || ph.Kind == "ctrTitle" {
		fallback.Y, fallback.Height = h*.08, h*.19
	}
	return fallback
}

func (shape drawing) readText(frame Frame, layout []placement) Object {
	item := Object{Type: "text", Box: shape.position(layout, shape.Place, frame), FontFamily: DefaultFont,
		FontSize: 27, FontWeight: "normal", FontStyle: "normal", TextAlign: "left", Color: "#202124"}
	if shape.Place != nil && (shape.Place.Kind == "title" || shape.Place.Kind == "ctrTitle") {
		item.FontSize, item.FontWeight = 48, "bold"
		if shape.Place.Kind == "ctrTitle" {
			item.TextAlign = "center"
		}
	}
	var lines []string
	styleFound := false
	for _, paragraph := range shape.TextBox.Paragraphs {
		var line strings.Builder
		for _, part := range paragraph.Parts {
			switch part.XMLName.Local {
			case "r", "fld":
				if !styleFound && part.Text != "" {
					item.applyTextStyle(paragraph.Props.Default)
					item.applyTextStyle(part.Style)
					switch paragraph.Props.Align {
					case "l":
						item.TextAlign = "left"
					case "ctr":
						item.TextAlign = "center"
					case "r":
						item.TextAlign = "right"
					}
					styleFound = true
				}
				line.WriteString(part.Text)
			case "br":
				line.WriteByte('\n')
			}
		}
		lines = append(lines, line.String())
	}
	item.Text = strings.Join(lines, "\n")
	if strings.TrimSpace(item.Text) == "" {
		item.Text = ""
	}
	return item
}

func (item *Object) applyTextStyle(style textStyle) {
	if style.Size > 0 {
		item.FontSize = max(6, min(400, float64(style.Size)/75))
	}
	switch style.Bold {
	case "true", "1":
		item.FontWeight = "bold"
	case "false", "0":
		item.FontWeight = "normal"
	}
	switch style.Italic {
	case "true", "1":
		item.FontStyle = "italic"
	case "false", "0":
		item.FontStyle = "normal"
	}
	if color := style.Fill.color(); color != "" {
		item.Color = color
	}
	if font := style.Font.Face; ValidFont(font) {
		item.FontFamily = font
	}
}

func (r *importer) picture(shape drawing, part string, rels map[string]relationship, layout []placement, frame Frame) (Object, bool, error) {
	relation := rels[shape.Picture.Blip.Embed]
	source, local := relationPath(part, relation)
	if !local || !strings.HasSuffix(relation.Type, "/image") {
		return Object{}, false, nil
	}
	id, seen := r.mediaIDs[source]
	if !seen {
		data, err := r.parts.data(source, assets.MaxImageBytes)
		if err != nil {
			return Object{}, false, err
		}
		meta, err := assets.Inspect(data, "")
		if errors.Is(err, assets.ErrTooLarge) {
			return Object{}, false, fmt.Errorf("%w: embedded images must fit the 8 MiB and pixel limits", ErrLimit)
		}
		_, supported := MediaExtension(meta.MIMEType)
		if err != nil || !supported {
			r.mediaIDs[source] = ""
			return Object{}, false, nil
		}
		id = meta.ID
		r.mediaIDs[source] = id
		if _, exists := r.deck.Media[id]; !exists {
			r.mediaSize += len(data)
			if len(r.deck.Media) >= MaxImages || r.mediaSize > MaxMediaBytes {
				return Object{}, false, fmt.Errorf("%w: up to %d images and 24 MiB of media", ErrLimit, MaxImages)
			}
			r.deck.Media[id] = Media{Metadata: meta, Data: data}
		}
	}
	if id == "" {
		return Object{}, false, nil
	}
	meta := r.deck.Media[id].Metadata
	object := Object{Type: "image", Box: shape.position(layout, shape.PicPlace, frame), AssetID: id,
		OriginalWidth: meta.Width, OriginalHeight: meta.Height, Caption: shortName(shape.Caption.Description, 255)}
	if rect := shape.Picture.Crop; rect != nil {
		crop := Crop{Left: rect.Left, Top: rect.Top, Right: rect.Right, Bottom: rect.Bottom}
		if crop != (Crop{}) && crop.valid() {
			object.Crop = &crop
		}
	}
	return object, true, nil
}

func shortName(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) > limit {
		characters := []rune(value)
		value = strings.TrimSpace(string(characters[:min(limit, len(characters))]))
	}
	return value
}
