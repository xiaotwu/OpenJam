package slideformat

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/project-wb/server/internal/assets"
)

const (
	DefaultWidth    = 1280
	DefaultHeight   = 720
	DefaultFont     = "IBM Plex Sans Variable"
	MaxSlides       = 60
	MaxObjects      = 1200
	MaxSlideObjects = 100
	MaxTextBytes    = 16000
	MaxBodyBytes    = 1 << 20
	MaxImages       = 64
	MaxMediaBytes   = 24 << 20
	MaxUploadBytes  = 32 << 20
)

var (
	ErrInvalid   = errors.New("invalid presentation")
	ErrLimit     = errors.New("presentation exceeds the supported size")
	colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

type Frame struct {
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Background string `json:"background"`
}

type Slide struct {
	Name string
	Frame
	Objects []Object
}

type Box struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Rotation float64 `json:"rotation"`
}

// Crop is measured in thousandths of a percent, as in DrawingML.
type Crop struct {
	Left   int `json:"left"`
	Top    int `json:"top"`
	Right  int `json:"right"`
	Bottom int `json:"bottom"`
}

func (c Crop) valid() bool {
	return c.Left >= 0 && c.Right >= 0 && c.Top >= 0 && c.Bottom >= 0 &&
		c.Left < 100000 && c.Right < 100000 && c.Top < 100000 && c.Bottom < 100000 &&
		c.Left+c.Right < 100000 && c.Top+c.Bottom < 100000
}

type Object struct {
	Type string `json:"type"`
	Box
	Text       string  `json:"text,omitempty"`
	FontFamily string  `json:"fontFamily,omitempty"`
	FontSize   float64 `json:"fontSize,omitempty"`
	FontWeight string  `json:"fontWeight,omitempty"`
	FontStyle  string  `json:"fontStyle,omitempty"`
	Color      string  `json:"color,omitempty"`
	TextAlign  string  `json:"textAlign,omitempty"`

	AssetID        string `json:"assetId,omitempty"`
	OriginalWidth  int    `json:"originalWidth,omitempty"`
	OriginalHeight int    `json:"originalHeight,omitempty"`
	Caption        string `json:"caption,omitempty"`
	Crop           *Crop  `json:"crop,omitempty"`
}

type Media struct {
	Metadata assets.Metadata
	Data     []byte
}

type Deck struct {
	Slides   []Slide
	Media    map[string]Media
	Warnings []string
}

func BlankSlide() Slide {
	return Slide{Name: "Slide", Frame: Frame{Width: DefaultWidth, Height: DefaultHeight, Background: "#ffffff"}}
}

func Color(value string) bool { return colorPattern.MatchString(value) }

func ValidFont(value string) bool {
	if value == "" || len(value) > 80 || strings.TrimSpace(value) != value {
		return false
	}
	for _, r := range value {
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) && !strings.ContainsRune(" -_.+", r) {
			return false
		}
	}
	return true
}

func ValidText(value string) bool {
	if !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if (r < 32 && r != '\t' && r != '\n' && r != '\r') || r == 0xfffe || r == 0xffff {
			return false
		}
	}
	return true
}

func CheckFrame(name string, frame Frame) error {
	if !ValidText(name) || strings.TrimSpace(name) != name || name == "" || utf8.RuneCountInString(name) > 120 ||
		frame.Width < 240 || frame.Width > 3840 || frame.Height < 240 || frame.Height > 3840 ||
		!Color(frame.Background) {
		return fmt.Errorf("%w: invalid slide name, background or dimensions", ErrInvalid)
	}
	return nil
}

func finiteBetween(value, min, max float64) bool {
	return !math.IsNaN(value) && value >= min && value <= max
}

func CheckObject(item Object) error {
	if !finiteBetween(item.X, -15360, 15360) || !finiteBetween(item.Y, -15360, 15360) ||
		!finiteBetween(item.Width, 1, 15360) || !finiteBetween(item.Height, 1, 15360) ||
		!finiteBetween(item.Rotation, -360, 360) {
		return fmt.Errorf("%w: invalid object bounds", ErrInvalid)
	}
	switch item.Type {
	case "text":
		if len(item.Text) > MaxTextBytes {
			return fmt.Errorf("%w: a text box can contain up to 16,000 bytes", ErrLimit)
		}
		if ValidText(item.Text) && ValidFont(item.FontFamily) && Color(item.Color) && finiteBetween(item.FontSize, 6, 400) &&
			(item.FontWeight == "normal" || item.FontWeight == "bold") &&
			(item.FontStyle == "normal" || item.FontStyle == "italic") &&
			(item.TextAlign == "left" || item.TextAlign == "center" || item.TextAlign == "right") {
			return nil
		}
	case "image":
		if assets.ValidID(item.AssetID) && item.OriginalWidth > 0 && item.OriginalWidth <= 8192 &&
			item.OriginalHeight > 0 && item.OriginalHeight <= 8192 &&
			ValidText(item.Caption) && utf8.RuneCountInString(item.Caption) <= 255 && (item.Crop == nil || item.Crop.valid()) {
			return nil
		}
	}
	return fmt.Errorf("%w: invalid text box or image", ErrInvalid)
}

func CheckDeck(slides []Slide) error {
	if len(slides) == 0 || len(slides) > MaxSlides {
		return fmt.Errorf("%w: up to %d slides", ErrLimit, MaxSlides)
	}
	objects, text := 0, 0
	images := make(map[string]bool)
	for _, slide := range slides {
		if err := CheckFrame(slide.Name, slide.Frame); err != nil {
			return err
		}
		if slide.Width != slides[0].Width || slide.Height != slides[0].Height {
			return fmt.Errorf("%w: all slides must share the same dimensions", ErrInvalid)
		}
		if len(slide.Objects) > MaxSlideObjects {
			return fmt.Errorf("%w: up to %d objects on each slide", ErrLimit, MaxSlideObjects)
		}
		for _, item := range slide.Objects {
			if err := CheckObject(item); err != nil {
				return err
			}
			objects++
			text += len(item.Text)
			if item.Type == "image" {
				images[item.AssetID] = true
			}
		}
	}
	if objects > MaxObjects || text > MaxBodyBytes || len(images) > MaxImages {
		return fmt.Errorf("%w: up to %d objects, %d images and 1 MiB of text", ErrLimit, MaxObjects, MaxImages)
	}
	return nil
}

func MediaExtension(mime string) (string, bool) {
	switch mime {
	case "image/png":
		return "png", true
	case "image/jpeg":
		return "jpeg", true
	}
	return "", false
}
