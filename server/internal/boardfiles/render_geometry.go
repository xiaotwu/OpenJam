package boardfiles

import (
	"image"
	"image/color"
	"image/draw"
	"math"
	"strconv"
	"strings"

	"golang.org/x/image/vector"
)

func project(p, offset point, scale float64) point {
	return point{p.X*scale + offset.X, p.Y*scale + offset.Y}
}

func rgb(value uint32) color.NRGBA {
	return color.NRGBA{R: uint8(value >> 16), G: uint8(value >> 8), B: uint8(value), A: 255}
}

func withOpacity(value color.NRGBA, opacity float64) color.NRGBA {
	value.A = uint8(float64(value.A) * opacity)
	return value
}

func paintColor(value string, fallback color.NRGBA, opacity float64) color.NRGBA {
	value = strings.TrimSpace(value)
	if value == "transparent" {
		return color.NRGBA{}
	}
	if value == "white" {
		return withOpacity(rgb(0xffffff), opacity)
	}
	if value == "black" {
		return withOpacity(rgb(0), opacity)
	}
	digits, ok := strings.CutPrefix(value, "#")
	if !ok {
		return withOpacity(fallback, opacity)
	}
	if len(digits) == 3 || len(digits) == 4 {
		var doubled strings.Builder
		for _, r := range digits {
			doubled.WriteRune(r)
			doubled.WriteRune(r)
		}
		digits = doubled.String()
	}
	code, err := strconv.ParseUint(digits, 16, 32)
	if err != nil {
		return withOpacity(fallback, opacity)
	}
	switch len(digits) {
	case 6:
		fallback = rgb(uint32(code))
	case 8:
		fallback = rgb(uint32(code >> 8))
		fallback.A = uint8(code)
	}
	return withOpacity(fallback, opacity)
}

func box(x, y, w, h float64) []point {
	return []point{{x, y}, {x + w, y}, {x + w, y + h}, {x, y + h}}
}

func regularPolygon(center point, rx, ry float64, sides int, rotation float64) []point {
	points := make([]point, sides)
	for index := range points {
		angle := float64(index)*2*math.Pi/float64(sides) + rotation
		points[index] = point{center.X + rx*math.Cos(angle), center.Y + ry*math.Sin(angle)}
	}
	return points
}

func roundedBox(p point, width, height, radius float64) []point {
	radius = min(radius, min(width, height)/2)
	if radius <= 0 {
		return box(p.X, p.Y, width, height)
	}
	centers := []point{
		{p.X + width - radius, p.Y + radius},
		{p.X + width - radius, p.Y + height - radius},
		{p.X + radius, p.Y + height - radius},
		{p.X + radius, p.Y + radius},
	}
	polygon := make([]point, 0, 28)
	for index, center := range centers {
		for step := range 7 {
			angle := (float64(index-1) + float64(step)/6) * math.Pi / 2
			polygon = append(polygon, point{center.X + radius*math.Cos(angle), center.Y + radius*math.Sin(angle)})
		}
	}
	return polygon
}

func shapePoints(kind string, p point, width, height float64) []point {
	center := point{p.X + width/2, p.Y + height/2}
	switch kind {
	case "rounded-rectangle":
		return roundedBox(p, width, height, min(width, height)*0.15)
	case "circle", "ellipse":
		return regularPolygon(center, width/2, height/2, 48, 0)
	case "diamond":
		return []point{{center.X, p.Y}, {p.X + width, center.Y}, {center.X, p.Y + height}, {p.X, center.Y}}
	case "triangle":
		return []point{{center.X, p.Y}, {p.X + width, p.Y + height}, {p.X, p.Y + height}}
	case "star":
		points := regularPolygon(center, width/2, height/2, 10, -math.Pi/2)
		for i := 1; i < len(points); i += 2 {
			points[i] = point{center.X + (points[i].X-center.X)*0.45, center.Y + (points[i].Y-center.Y)*0.45}
		}
		return points
	case "hexagon":
		return regularPolygon(center, width/2, height/2, 6, 0)
	default:
		return box(p.X, p.Y, width, height)
	}
}

func paintPolygon(dst *image.RGBA, points []point, fill color.NRGBA) {
	if fill.A == 0 || len(points) < 3 {
		return
	}
	var bounds extent
	for _, p := range points {
		bounds.include(p)
	}
	region := image.Rect(int(math.Floor(bounds.minX)), int(math.Floor(bounds.minY)),
		int(math.Ceil(bounds.maxX)), int(math.Ceil(bounds.maxY))).Intersect(dst.Bounds())
	if region.Empty() {
		return
	}
	x, y := float64(region.Min.X), float64(region.Min.Y)
	raster := vector.NewRasterizer(region.Dx(), region.Dy())
	raster.MoveTo(float32(points[0].X-x), float32(points[0].Y-y))
	for _, p := range points[1:] {
		raster.LineTo(float32(p.X-x), float32(p.Y-y))
	}
	raster.ClosePath()
	raster.Draw(dst, region, image.NewUniform(fill), image.Point{})
}

func paintRect(dst *image.RGBA, p point, width, height float64, fill color.NRGBA) {
	if fill.A == 0 || width <= 0 || height <= 0 {
		return
	}
	area := image.Rect(int(math.Floor(p.X)), int(math.Floor(p.Y)),
		int(math.Ceil(p.X+width)), int(math.Ceil(p.Y+height)))
	draw.Draw(dst, area, image.NewUniform(fill), image.Point{}, draw.Over)
}

func paintLine(dst *image.RGBA, a, b point, width float64, fill color.NRGBA) {
	dx, dy := b.X-a.X, b.Y-a.Y
	length := math.Hypot(dx, dy)
	if length == 0 {
		return
	}
	r := width / (2 * length)
	off := point{-dy * r, dx * r}
	paintPolygon(dst, []point{
		{a.X + off.X, a.Y + off.Y}, {b.X + off.X, b.Y + off.Y},
		{b.X - off.X, b.Y - off.Y}, {a.X - off.X, a.Y - off.Y},
	}, fill)
}

func paintStroke(dst *image.RGBA, points []point, width float64, fill color.NRGBA, closed bool) {
	if len(points) == 0 || width <= 0 || fill.A == 0 {
		return
	}
	// Composite the geometry once so a translucent marker retains its opacity
	// where its own segments meet.
	if fill.A != 255 {
		var bounds extent
		for _, p := range points {
			bounds.include(p)
		}
		bounds.margin(width)
		region := image.Rect(int(math.Floor(bounds.minX)), int(math.Floor(bounds.minY)),
			int(math.Ceil(bounds.maxX)), int(math.Ceil(bounds.maxY))).Intersect(dst.Bounds())
		if region.Empty() {
			return
		}
		layer := image.NewRGBA(region)
		opaque := fill
		opaque.A = 255
		paintStroke(layer, points, width, opaque, closed)
		draw.DrawMask(dst, region, layer, region.Min, image.NewUniform(color.Alpha{A: fill.A}), image.Point{}, draw.Over)
		return
	}
	for index, p := range points {
		if index > 0 {
			paintLine(dst, points[index-1], p, width, fill)
		}
		paintPolygon(dst, regularPolygon(p, width/2, width/2, 10, 0), fill)
	}
	if closed && len(points) > 2 {
		paintLine(dst, points[len(points)-1], points[0], width, fill)
	}
}

func connectorPoints(el renderElement) []point {
	start, end := el.StartPoint, el.EndPoint
	switch el.Style {
	case "elbow":
		middle := (start.X + end.X) / 2
		return []point{start, {middle, start.Y}, {middle, end.Y}, end}
	case "curved":
		delta := point{end.X - start.X, end.Y - start.Y}
		control := point{(start.X+end.X)/2 - delta.Y*0.3, (start.Y+end.Y)/2 + delta.X*0.3}
		if len(el.ControlPoints) > 0 {
			control = el.ControlPoints[0]
		}
		points := make([]point, 33)
		for index := range points {
			t := float64(index) / float64(len(points)-1)
			u := 1 - t
			if len(el.ControlPoints) < 2 {
				points[index] = point{
					u*u*start.X + 2*u*t*control.X + t*t*end.X,
					u*u*start.Y + 2*u*t*control.Y + t*t*end.Y,
				}
			} else {
				c2 := el.ControlPoints[1]
				points[index] = point{
					u*u*u*start.X + 3*u*u*t*control.X + 3*u*t*t*c2.X + t*t*t*end.X,
					u*u*u*start.Y + 3*u*u*t*control.Y + 3*u*t*t*c2.Y + t*t*t*end.Y,
				}
			}
		}
		return points
	default:
		return []point{start, end}
	}
}

func (r *renderer) paintDrawing(dst *image.RGBA, el renderElement, offset point, scale, opacity float64) {
	points := make([]point, len(el.Points))
	origin := project(point{el.X, el.Y}, offset, scale)
	for index, value := range el.Points {
		points[index] = project(value, origin, scale)
	}
	stroke := paintColor(el.Stroke, rgb(r.palette.ink), opacity)
	if el.IsEraser {
		stroke = withOpacity(rgb(r.palette.background), opacity)
	}
	paintStroke(dst, points, min(max(el.StrokeWidth, 1), 128)*scale, stroke, false)
}

func (r *renderer) paintConnector(dst *image.RGBA, el renderElement, offset point, scale, opacity float64) {
	points := connectorPoints(el)
	for index, value := range points {
		points[index] = project(value, offset, scale)
	}
	stroke := paintColor(el.Stroke, rgb(r.palette.connector), opacity)
	width := min(max(el.StrokeWidth, 1), 128) * scale
	paintStroke(dst, points, width, stroke, false)
	last := len(points) - 1
	paintArrow(dst, el.StartArrow, points[1], points[0], width, stroke)
	paintArrow(dst, el.EndArrow, points[last-1], points[last], width, stroke)
}

func paintArrow(dst *image.RGBA, kind string, from, tip point, width float64, fill color.NRGBA) {
	angle := math.Atan2(tip.Y-from.Y, tip.X-from.X)
	if from == tip {
		return
	}
	w := width * 4
	switch kind {
	case "circle":
		paintPolygon(dst, regularPolygon(tip, w/2, w/2, 20, 0), fill)
	case "diamond":
		paintPolygon(dst, regularPolygon(tip, w*0.66, w*0.66, 4, angle), fill)
	case "arrow":
		back := point{tip.X - w*math.Cos(angle), tip.Y - w*math.Sin(angle)}
		off := point{-w * 0.38 * math.Sin(angle), w * 0.38 * math.Cos(angle)}
		paintPolygon(dst, []point{tip, {back.X + off.X, back.Y + off.Y}, {back.X - off.X, back.Y - off.Y}}, fill)
	}
}
