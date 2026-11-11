package assets

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"strings"

	"golang.org/x/image/riff"
	"golang.org/x/image/vp8"
	"golang.org/x/image/vp8l"
	_ "golang.org/x/image/webp"
)

const (
	MaxImageBytes = 8 * 1024 * 1024
	maxImageSide  = 8192
	maxPixels     = 16 * 1024 * 1024
)

var (
	ErrInvalidImage     = errors.New("unsupported or invalid raster image")
	ErrTooLarge         = errors.New("image exceeds the byte or pixel limit")
	ErrInvalidReference = errors.New("invalid image asset reference")
)

type Metadata struct {
	ID       string `json:"id"`
	MIMEType string `json:"mimeType"`
	Size     int64  `json:"size"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

func Inspect(data []byte, contentType string) (Metadata, error) {
	config, mediaType, err := inspectImageConfig(data, contentType)
	if err != nil {
		return Metadata{}, err
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return Metadata{}, ErrInvalidImage
	}
	hash := sha256.Sum256(data)
	return Metadata{
		ID: hex.EncodeToString(hash[:]), MIMEType: mediaType, Size: int64(len(data)),
		Width: config.Width, Height: config.Height,
	}, nil
}

func inspectImageConfig(data []byte, contentType string) (image.Config, string, error) {
	if len(data) > MaxImageBytes {
		return image.Config{}, "", ErrTooLarge
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return image.Config{}, "", ErrInvalidImage
	}
	if config.Width < 1 || config.Height < 1 || config.Width > maxImageSide ||
		config.Height > maxImageSide || config.Width*config.Height > maxPixels {
		return image.Config{}, "", ErrTooLarge
	}
	mediaType := "image/" + format
	switch format {
	case "png":
		if !staticPNG(data) {
			return image.Config{}, "", ErrInvalidImage
		}
	case "gif":
		if !staticGIF(data) {
			return image.Config{}, "", ErrInvalidImage
		}
	case "webp":
		if !staticWebP(data, config) {
			return image.Config{}, "", ErrInvalidImage
		}
	case "jpeg":
	default:
		return image.Config{}, "", ErrInvalidImage
	}
	if contentType != "" {
		declared, _, err := mime.ParseMediaType(contentType)
		if err != nil || (declared != mediaType && declared != "application/octet-stream") {
			return image.Config{}, "", ErrInvalidImage
		}
	}
	return config, mediaType, nil
}

// Animation frames can multiply the decoded memory required for an image.
// OpenJam accepts one raster frame per upload.
func staticPNG(data []byte) bool {
	for offset := 8; offset+12 <= len(data); {
		length := int64(binary.BigEndian.Uint32(data[offset : offset+4]))
		if length > int64(len(data)-offset-12) {
			return false
		}
		switch string(data[offset+4 : offset+8]) {
		case "acTL", "fcTL", "fdAT":
			return false
		case "IEND":
			return true
		}
		offset += 12 + int(length)
	}
	return false
}

func staticGIF(data []byte) bool {
	if len(data) < 13 {
		return false
	}
	offset := 13 + gifColorTableSize(data[10])
	seenImage := false
	for offset < len(data) {
		marker := data[offset]
		offset++
		switch marker {
		case 0x3b:
			return seenImage
		case 0x21:
			offset++ // Extension label before its sub-blocks.
		case 0x2c:
			if seenImage || offset+9 > len(data) {
				return false
			}
			seenImage = true
			offset += 10 + gifColorTableSize(data[offset+8]) // Descriptor, palette and LZW code size.
		default:
			return false
		}
		for {
			if offset >= len(data) {
				return false
			}
			length := int(data[offset])
			offset += 1 + length
			if length == 0 {
				break
			}
		}
	}
	return false
}

func gifColorTableSize(flags byte) int {
	if flags&0x80 == 0 {
		return 0
	}
	return 3 * (2 << (flags & 7))
}

func staticWebP(data []byte, config image.Config) bool {
	form, reader, err := riff.NewReader(bytes.NewReader(data))
	if err != nil || string(form[:]) != "WEBP" {
		return false
	}
	seenFrame, seenExtended := false, false
	for {
		id, size, chunk, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return seenFrame
		}
		if err != nil || size > uint32(len(data)) {
			return false
		}
		switch string(id[:]) {
		case "ANIM", "ANMF":
			return false
		case "VP8X":
			var flags [1]byte
			if seenExtended || seenFrame || size != 10 {
				return false
			}
			if _, err := io.ReadFull(chunk, flags[:]); err != nil || flags[0]&0x02 != 0 {
				return false
			}
			seenExtended = true
		case "VP8 ":
			decoder := vp8.NewDecoder()
			decoder.Init(chunk, int(size))
			header, err := decoder.DecodeFrameHeader()
			if seenFrame || err != nil || !header.KeyFrame || header.Width != config.Width || header.Height != config.Height {
				return false
			}
			seenFrame = true
		case "VP8L":
			frame, err := vp8l.DecodeConfig(chunk)
			if seenFrame || err != nil || frame.Width != config.Width || frame.Height != config.Height {
				return false
			}
			seenFrame = true
		}
	}
}

// ParseLegacyDataURI only reads inline raster bytes, never a URL.
func ParseLegacyDataURI(src string) ([]byte, error) {
	header, encoded, ok := strings.Cut(src, ",")
	if !ok || !strings.HasPrefix(header, "data:image/") || !strings.HasSuffix(header, ";base64") {
		return nil, ErrInvalidImage
	}
	if len(encoded) > base64.StdEncoding.EncodedLen(MaxImageBytes) {
		return nil, ErrTooLarge
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, ErrInvalidImage
	}
	mediaType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	if _, _, err := inspectImageConfig(data, mediaType); err != nil {
		return nil, err
	}
	return data, nil
}

func ValidID(id string) bool {
	if len(id) != sha256.Size*2 {
		return false
	}
	for _, c := range id {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}
