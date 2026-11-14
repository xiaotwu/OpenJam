package boardfiles

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"math"
	"sort"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/document"
	xd "golang.org/x/image/draw"
	"golang.org/x/image/math/f64"
)

const (
	thumbnailWidth  = 320
	thumbnailHeight = 180
	maxRenderSide   = 4096
	maxRenderPixels = 12 * 1024 * 1024
)

type point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type renderPalette struct {
	background, ink, connector, annotation, heading, headingText uint32
	frame, frameBorder, stamp, stampFallback                     uint32
}

func renderColors(theme string) renderPalette {
	if theme == "dark" {
		return renderPalette{
			background: 0x212121, ink: 0xececec, connector: 0xb4b4b4, annotation: 0xb4b4b4,
			heading: 0x303030, headingText: 0xececec, frame: 0x2c2c2c, frameBorder: 0x626262,
			stamp: 0xd9d9ec, stampFallback: 0xa5a5b6,
		}
	}
	return renderPalette{
		background: 0xffffff, ink: 0x1f2937, connector: 0x6b7280, annotation: 0x475569,
		heading: 0xf1f5f9, headingText: 0x334155, frame: 0xf8fafc, frameBorder: 0x94a3b8,
		stamp: 0x4f46e5, stampFallback: 0x6366f1,
	}
}

type renderElement struct {
	ID, PageID, Type, Name, Text, Color, Fill, Stroke, BackgroundColor string
	ShapeType, StickyShape, TextAlign, Style, StartArrow, EndArrow     string
	StartElementID, EndElementID, StartAnchor, EndAnchor               string
	AssetID, Src, ObjectFit, WidgetType                                string
	X, Y, Width, Height, Rotation, ZIndex, FontSize, StrokeWidth       float64
	Opacity                                                            *float64
	ShowName                                                           *bool
	StartPoint, EndPoint                                               point
	Points, ControlPoints                                              []point
	ChildIDs                                                           []string
	WidgetData                                                         json.RawMessage
	IsEraser                                                           bool
}

type renderStamp struct {
	PageID, Emoji         string
	X, Y, Scale, Rotation float64
}

type scene struct {
	name     string
	elements []renderElement
	stamps   []renderStamp
	bounds   extent
}

type extent struct {
	minX, minY, maxX, maxY float64
	ready                  bool
}

func (bounds *extent) include(value point) {
	if !bounds.ready {
		*bounds = extent{value.X, value.Y, value.X, value.Y, true}
		return
	}
	bounds.minX, bounds.maxX = min(bounds.minX, value.X), max(bounds.maxX, value.X)
	bounds.minY, bounds.maxY = min(bounds.minY, value.Y), max(bounds.maxY, value.Y)
}

func (bounds *extent) margin(size float64) {
	bounds.minX -= size
	bounds.minY -= size
	bounds.maxX += size
	bounds.maxY += size
}

func (bounds extent) width() float64  { return bounds.maxX - bounds.minX }
func (bounds extent) height() float64 { return bounds.maxY - bounds.minY }

func makeScenes(content document.Document) ([]scene, error) {
	pages := make([]scene, 0, len(content.Pages))
	indices := make(map[string]int, len(content.Pages))
	byID := make(map[string]renderElement, len(content.Elements))
	for _, raw := range content.Pages {
		var page struct{ ID, Name string }
		if err := json.Unmarshal(raw, &page); err != nil {
			return nil, err
		}
		indices[page.ID] = len(pages)
		pages = append(pages, scene{name: page.Name})
	}
	for _, raw := range content.Elements {
		var element renderElement
		if err := json.Unmarshal(raw, &element); err != nil {
			return nil, err
		}
		if index, found := indices[element.PageID]; found {
			pages[index].elements = append(pages[index].elements, element)
			byID[element.ID] = element
		}
	}
	for _, raw := range content.Stamps {
		var stamp renderStamp
		if err := json.Unmarshal(raw, &stamp); err != nil {
			return nil, err
		}
		if index, found := indices[stamp.PageID]; found {
			pages[index].stamps = append(pages[index].stamps, stamp)
		}
	}
	for index := range pages {
		page := &pages[index]
		for i := range page.elements {
			element := &page.elements[i]
			if target, ok := byID[element.StartElementID]; element.Type == "connector" && ok && target.PageID == element.PageID {
				element.StartPoint = elementAnchor(target, element.StartAnchor)
			}
			if target, ok := byID[element.EndElementID]; element.Type == "connector" && ok && target.PageID == element.PageID {
				element.EndPoint = elementAnchor(target, element.EndAnchor)
			}
			if err := addRenderBounds(&page.bounds, *element); err != nil {
				return nil, err
			}
		}
		for _, stamp := range page.stamps {
			size := 24 * max(stamp.Scale, 0.1)
			if !renderableNumber(stamp.X) || !renderableNumber(stamp.Y) || !renderableNumber(size) ||
				!renderableNumber(stamp.Rotation) {
				return nil, ErrTooLarge
			}
			page.bounds.include(point{stamp.X - size, stamp.Y - size})
			page.bounds.include(point{stamp.X + size, stamp.Y + size})
		}
		if !page.bounds.ready {
			page.bounds = extent{0, 0, 240, 120, true}
		}
		page.bounds.margin(28)
		sort.SliceStable(page.elements, func(i, j int) bool { return page.elements[i].ZIndex < page.elements[j].ZIndex })
	}
	return pages, nil
}

func renderableNumber(value float64) bool {
	return math.Abs(value) <= 1e7
}

func addRenderBounds(bounds *extent, el renderElement) error {
	for _, value := range []float64{el.X, el.Y, el.Width, el.Height, el.StrokeWidth, el.Rotation, el.FontSize} {
		if !renderableNumber(value) {
			return ErrTooLarge
		}
	}
	switch el.Type {
	case "drawing", "connector":
		points := el.Points
		if el.Type == "connector" {
			points = connectorPoints(el)
		}
		if len(points) > 30000 {
			return ErrTooLarge
		}
		stroke := min(max(el.StrokeWidth, 1), 128)
		if el.Type == "connector" {
			stroke *= 9
		}
		for _, p := range points {
			if el.Type == "drawing" {
				p.X += el.X
				p.Y += el.Y
			}
			if !renderableNumber(p.X) || !renderableNumber(p.Y) {
				return ErrTooLarge
			}
			bounds.include(point{p.X - stroke, p.Y - stroke})
			bounds.include(point{p.X + stroke, p.Y + stroke})
		}
	default:
		center := point{el.X + el.Width/2, el.Y + el.Height/2}
		for _, corner := range box(el.X, el.Y, el.Width, el.Height) {
			bounds.include(rotatePoint(corner, center, el.Rotation))
		}
		if el.Type == "frame" && el.frameTitleVisible() {
			bounds.include(point{el.X, el.Y - 28})
		}
	}
	return nil
}

func elementAnchor(el renderElement, name string) point {
	p := point{el.X + el.Width/2, el.Y + el.Height/2}
	center := p
	switch name {
	case "left":
		p.X = el.X
	case "right":
		p.X = el.X + el.Width
	case "top":
		p.Y = el.Y
	case "bottom":
		p.Y = el.Y + el.Height
	}
	return rotatePoint(p, center, el.Rotation)
}

func rotatePoint(p, center point, rotation float64) point {
	angle := rotation * math.Pi / 180
	sine, cosine := math.Sincos(angle)
	x, y := p.X-center.X, p.Y-center.Y
	return point{center.X + x*cosine - y*sine, center.Y + x*sine + y*cosine}
}

func renderPNG(ctx context.Context, actor uuid.UUID, snapshot document.Snapshot, thumbnail bool, theme string) ([]byte, error) {
	pages, err := makeScenes(snapshot.Document)
	if err != nil {
		return nil, err
	}
	var width, height int
	showHeaders := len(pages) > 1
	if thumbnail {
		width, height = thumbnailWidth, thumbnailHeight
	} else {
		for _, page := range pages {
			width = max(width, int(math.Ceil(page.bounds.width())))
			height += int(math.Ceil(page.bounds.height()))
			if showHeaders {
				height += 38
			}
		}
	}
	if width <= 0 || height <= 0 || width > maxRenderSide || height > maxRenderSide || width*height > maxRenderPixels {
		return nil, ErrTooLarge
	}
	palette := renderColors(theme)
	destination := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(destination, destination.Bounds(), image.NewUniform(rgb(palette.background)), image.Point{}, draw.Src)
	renderer := newRenderer(palette)
	renderer.capturedAt = snapshot.UpdatedAt.UnixMilli()
	defer renderer.close()
	y := float64(0)
	for _, page := range pages {
		scale, x := 1.0, 0.0
		if thumbnail {
			scale = min(float64(width)/page.bounds.width(), float64(height)/page.bounds.height())
			x = (float64(width) - page.bounds.width()*scale) / 2
			y = (float64(height) - page.bounds.height()*scale) / 2
		} else if showHeaders {
			draw.Draw(destination, image.Rect(0, int(y), width, int(y)+38), image.NewUniform(rgb(palette.heading)), image.Point{}, draw.Over)
			renderer.text(destination, page.name, 20, y+7, float64(width)-40, 28, 15, "left", rgb(palette.headingText))
			y += 38
		}
		if err := renderer.scene(ctx, destination, snapshot.BoardID, actor, page, x, y, scale); err != nil {
			return nil, err
		}
		y += math.Ceil(page.bounds.height())
	}
	buf := &packageBuffer{}
	if err := (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(buf, destination); err != nil {
		return nil, fmt.Errorf("encode board PNG: %w", err)
	}
	return buf.Bytes(), nil
}

func (r *renderer) scene(ctx context.Context, dst *image.RGBA, boardID string, actor uuid.UUID, page scene, x, y, scale float64) error {
	offset := point{x - page.bounds.minX*scale, y - page.bounds.minY*scale}
	for _, el := range page.elements {
		if err := ctx.Err(); err != nil {
			return err
		}
		opacity := 1.0
		if el.Opacity != nil {
			opacity = min(max(*el.Opacity, 0), 1)
		}
		if opacity == 0 {
			continue
		}
		switch el.Type {
		case "connector":
			r.paintConnector(dst, el, offset, scale, opacity)
		case "drawing":
			r.paintDrawing(dst, el, offset, scale, opacity)
		default:
			if err := r.renderBox(ctx, dst, boardID, actor, el, offset, scale, opacity); err != nil {
				return err
			}
		}
	}
	for _, stamp := range page.stamps {
		stampSize := max(stamp.Scale, 0.1) * 32 * scale
		p := project(point{stamp.X, stamp.Y}, offset, scale)
		if !r.text(dst, stamp.Emoji, p.X-stampSize, p.Y-stampSize/2, stampSize*2, stampSize, stampSize*0.75, "center", rgb(r.palette.stamp)) {
			paintPolygon(dst, regularPolygon(p, stampSize/3, stampSize/3, 16, 0), rgb(r.palette.stampFallback))
		}
	}
	return nil
}

func (r *renderer) renderBox(ctx context.Context, dst *image.RGBA, boardID string, actor uuid.UUID, el renderElement, offset point, scale, opacity float64) error {
	p := project(point{el.X, el.Y}, offset, scale)
	width, height := el.Width*scale, el.Height*scale
	if width <= 0 || height <= 0 {
		return nil
	}
	if el.Rotation != 0 {
		if width > maxRenderSide || height > maxRenderSide || width*height > maxRenderPixels {
			return ErrTooLarge
		}
		layer := image.NewRGBA(image.Rect(0, 0, int(math.Ceil(width)), int(math.Ceil(height))))
		if err := r.paintElement(ctx, layer, boardID, actor, el, point{}, width, height, scale, opacity); err != nil {
			return err
		}
		rotateLayer(dst, layer, p, width, height, el.Rotation)
	} else if err := r.paintElement(ctx, dst, boardID, actor, el, p, width, height, scale, opacity); err != nil {
		return err
	}
	if el.Type == "frame" && el.frameTitleVisible() {
		r.text(dst, el.Name, p.X, p.Y-27*scale, width, 22*scale, 14*scale, "left", rgb(r.palette.annotation))
	}
	return nil
}

func rotateLayer(dst *image.RGBA, src image.Image, position point, width, height, rotation float64) {
	center := point{width / 2, height / 2}
	shift := rotatePoint(point{}, center, rotation)
	sine, cosine := math.Sincos(rotation * math.Pi / 180)
	matrix := f64.Aff3{cosine, -sine, position.X + shift.X, sine, cosine, position.Y + shift.Y}
	xd.BiLinear.Transform(dst, matrix, src, src.Bounds(), draw.Over, nil)
}

func decodeRaster(data []byte) (image.Image, error) {
	picture, _, err := image.Decode(bytes.NewReader(data))
	return picture, err
}
