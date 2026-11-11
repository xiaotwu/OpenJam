package boardfiles

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"io"
	"math"
	"strings"

	"github.com/google/uuid"
	"github.com/project-wb/server/internal/assets"
	xd "golang.org/x/image/draw"
)

var stickyPalette = map[string][2]uint32{
	"yellow": {0xfef3c7, 0x92400e},
	"orange": {0xffedd5, 0x9a3412},
	"pink":   {0xfce7f3, 0x9d174d},
	"purple": {0xede9fe, 0x5b21b6},
	"blue":   {0xdbeafe, 0x1e40af},
	"green":  {0xd1fae5, 0x065f46},
	"gray":   {0xf3f4f6, 0x374151},
}

func (el renderElement) frameTitleVisible() bool {
	return el.ShowName == nil || *el.ShowName
}

func (r *renderer) paintElement(ctx context.Context, dst *image.RGBA, boardID string, actor uuid.UUID, el renderElement,
	p point, width, height, scale, opacity float64,
) error {
	size := el.FontSize
	if size <= 0 {
		size = 16
	}
	pad := 8 * scale
	switch el.Type {
	case "sticky":
		palette, ok := stickyPalette[el.Color]
		if !ok {
			palette = stickyPalette["yellow"]
		}
		bg, text := withOpacity(rgb(palette[0]), opacity), withOpacity(rgb(palette[1]), opacity)
		switch el.StickyShape {
		case "circle":
			paintPolygon(dst, shapePoints("ellipse", p, width, height), bg)
		case "rounded":
			paintPolygon(dst, roundedBox(p, width, height, 14*scale), bg)
		default:
			paintRect(dst, p, width, height, bg)
			fold := min(width, height) * 0.14
			paintPolygon(dst, []point{{p.X + width - fold, p.Y}, {p.X + width, p.Y}, {p.X + width, p.Y + fold}},
				withOpacity(rgb(0xffffff), 0.5*opacity))
		}
		r.text(dst, el.Text, p.X+pad, p.Y+pad, width-2*pad, height-2*pad, size*scale, el.TextAlign, text)
	case "shape":
		points := shapePoints(el.ShapeType, p, width, height)
		paintPolygon(dst, points, paintColor(el.Fill, rgb(0xffffff), opacity))
		paintStroke(dst, points, min(max(el.StrokeWidth, 0), 128)*scale, paintColor(el.Stroke, rgb(0x374151), opacity), true)
		r.text(dst, el.Text, p.X+pad, p.Y+pad, width-2*pad, height-2*pad, size*scale, "middle", withOpacity(rgb(0x1f2937), opacity))
	case "text":
		paintRect(dst, p, width, height, paintColor(el.BackgroundColor, color.NRGBA{}, opacity))
		r.text(dst, el.Text, p.X, p.Y, width, height, size*scale, el.TextAlign, paintColor(el.Color, rgb(r.palette.ink), opacity))
	case "frame":
		paintRect(dst, p, width, height, paintColor(el.BackgroundColor, rgb(r.palette.frame), opacity))
		paintStroke(dst, box(p.X, p.Y, width, height), 1.5*scale, withOpacity(rgb(r.palette.frameBorder), opacity), true)
	case "image":
		if err := paintImage(ctx, dst, boardID, actor, el, p, width, height, opacity); err != nil {
			if !errors.Is(err, ErrExternalImage) && !errors.Is(err, ErrInvalidFile) {
				return err
			}
			paintRect(dst, p, width, height, withOpacity(rgb(r.palette.heading), opacity))
			r.text(dst, "Image unavailable", p.X+pad, p.Y+pad, width-2*pad, height-2*pad, 13*scale, "middle", rgb(r.palette.annotation))
		}
	case "widget":
		r.paintWidget(dst, el, p, width, height, scale, opacity)
	}
	return nil
}

func paintImage(ctx context.Context, dst *image.RGBA, boardID string, actor uuid.UUID, el renderElement, p point,
	width, height, opacity float64,
) error {
	var data []byte
	if el.AssetID != "" {
		meta, body, err := assets.Get(ctx, boardID, actor, el.AssetID)
		if err != nil {
			return err
		}
		defer body.Close()
		data, err = io.ReadAll(io.LimitReader(body, meta.Size+1))
		if err != nil || int64(len(data)) != meta.Size {
			return assets.ErrUnavailable
		}
	} else {
		var err error
		data, err = parseLegacyImage(el.Src)
		if err != nil {
			return err
		}
	}
	picture, err := decodeRaster(data)
	if err != nil {
		return fmt.Errorf("%w: could not decode image", ErrInvalidFile)
	}
	src := picture.Bounds()
	if src.Empty() {
		return ErrInvalidFile
	}
	sourceRatio := float64(src.Dx()) / float64(src.Dy())
	targetRatio := width / height
	switch strings.ToLower(el.ObjectFit) {
	case "fill":
	case "cover":
		if sourceRatio > targetRatio {
			margin := max(0, int((float64(src.Dx())-float64(src.Dy())*targetRatio)/2))
			src.Min.X += margin
			src.Max.X -= margin
		} else {
			margin := max(0, int((float64(src.Dy())-float64(src.Dx())/targetRatio)/2))
			src.Min.Y += margin
			src.Max.Y -= margin
		}
	default:
		factor := min(width/float64(src.Dx()), height/float64(src.Dy()))
		newW, newH := float64(src.Dx())*factor, float64(src.Dy())*factor
		p.X += (width - newW) / 2
		p.Y += (height - newH) / 2
		width, height = newW, newH
	}
	area := image.Rect(int(math.Round(p.X)), int(math.Round(p.Y)), int(math.Round(p.X+width)), int(math.Round(p.Y+height)))
	opts := &xd.Options{SrcMask: image.NewUniform(color.Alpha{A: uint8(opacity * 255)})}
	xd.ApproxBiLinear.Scale(dst, area, picture, src, draw.Over, opts)
	return nil
}
