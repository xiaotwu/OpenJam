package boardfiles

import (
	"image"
	"image/color"
	"io"
	"os"
	"strings"
	"sync"
	"unicode"

	"github.com/xiaotwu/shiori/server/internal/config"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

type renderer struct {
	faces      map[int]font.Face
	capturedAt int64
	palette    renderPalette
}

func newRenderer(palette renderPalette) *renderer {
	return &renderer{faces: make(map[int]font.Face), palette: palette}
}

func (r *renderer) close() {
	for _, face := range r.faces {
		_ = face.Close()
	}
}

var loadFont = sync.OnceValue(func() *opentype.Font {
	paths := []string{
		config.Env("SHIORI_RENDER_FONT"),
		"/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
		"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
	}
	const limit = 32 * 1024 * 1024
	for _, path := range paths {
		if path == "" {
			continue
		}
		reader, err := os.Open(path)
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(reader, limit+1))
		reader.Close()
		if err != nil || len(data) > limit {
			continue
		}
		collection, err := opentype.ParseCollection(data)
		if err != nil {
			continue
		}
		if face, err := collection.Font(0); err == nil {
			return face
		}
	}
	fallback, _ := opentype.Parse(goregular.TTF)
	return fallback
})

func (r *renderer) face(size int) font.Face {
	if face := r.faces[size]; face != nil {
		return face
	}
	face, err := opentype.NewFace(loadFont(), &opentype.FaceOptions{
		Size: float64(size), DPI: 72, Hinting: font.HintingFull,
	})
	if err != nil {
		return nil
	}
	r.faces[size] = face
	return face
}

func (r *renderer) text(dst *image.RGBA, value string, x, y, width, height, size float64, align string, fill color.NRGBA) bool {
	if value == "" || fill.A == 0 || width < 2 || height < 2 || size < 3 {
		return false
	}
	size = min(size, 144)
	face := r.face(int(size + 0.5))
	if face == nil {
		return false
	}
	region := image.Rect(int(x), int(y), int(x+width+0.5), int(y+height+0.5)).Intersect(dst.Bounds())
	if region.Empty() {
		return false
	}
	d := font.Drawer{Dst: dst.SubImage(region).(*image.RGBA), Src: image.NewUniform(fill), Face: face}
	fontHeight := max(face.Metrics().Height.Ceil(), int(size*1.15))
	maxLines := min(256, max(1, int(height)/fontHeight))
	lines := breakLines(face, value, int(width), maxLines)
	ascent := face.Metrics().Ascent.Ceil()
	if align == "middle" {
		align = "center"
		y += max(0, (height-float64(fontHeight*len(lines)))/2)
	}
	for row, line := range lines {
		left := int(x)
		switch align {
		case "center":
			left += max(0, (int(width)-d.MeasureString(line).Ceil())/2)
		case "right":
			left += max(0, int(width)-d.MeasureString(line).Ceil())
		}
		d.Dot = fixed.P(left, int(y)+ascent+row*fontHeight)
		d.DrawString(line)
	}
	for _, ch := range value {
		if _, ok := face.GlyphAdvance(ch); ok && !unicode.IsSpace(ch) {
			return true
		}
	}
	return false
}

func breakLines(face font.Face, value string, width, maxLines int) []string {
	// No renderer needs more glyphs than the largest printable page can hold.
	const maxTextBytes = 16000
	if len(value) > maxTextBytes {
		value = value[:maxTextBytes]
	}
	remaining := []rune(strings.ReplaceAll(value, "\r", ""))
	lines := make([]string, 0, min(maxLines, 16))
	for len(remaining) > 0 && len(lines) < maxLines {
		count, lastSpace, size := 0, -1, fixed.Int26_6(0)
		for count < len(remaining) {
			ch := remaining[count]
			if ch == '\n' {
				break
			}
			advance, _ := face.GlyphAdvance(ch)
			if count > 0 && (size+advance).Ceil() > width {
				if lastSpace > 0 {
					count = lastSpace
				}
				break
			}
			if unicode.IsSpace(ch) {
				lastSpace = count
			}
			size += advance
			count++
		}
		lines = append(lines, strings.TrimRightFunc(string(remaining[:count]), unicode.IsSpace))
		remaining = remaining[count:]
		for len(remaining) > 0 && unicode.IsSpace(remaining[0]) {
			ch := remaining[0]
			remaining = remaining[1:]
			if ch == '\n' {
				break
			}
		}
	}
	return lines
}
