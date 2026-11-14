package docformat

import (
	"errors"
	"net/url"
	"strings"
	"unicode/utf8"
)

const (
	MaxUploadBytes = 4 * 1024 * 1024
	MaxBlockBytes  = 16000
	MaxBlocks      = 400
	MaxBodyBytes   = 1024 * 1024
	DefaultFont    = "IBM Plex Sans Variable"
)

var (
	ErrInvalidFile = errors.New("Use a valid UTF-8 Markdown or DOCX file.")
	ErrTooLarge    = errors.New("Docs support up to 400 blocks and 1 MiB of text. Each block can contain up to 16,000 UTF-8 bytes.")
)

var fontNames = map[string]string{
	DefaultFont:        "IBM Plex Sans",
	"Inter Variable":   "Inter",
	"DM Sans Variable": "DM Sans",
	"Roboto Variable":  "Roboto",
	"Lora Variable":    "Lora",
	"Space Mono":       "Space Mono",
	"Geist Variable":   "Geist",
}

type Block struct {
	Text       string `json:"text"`
	FontFamily string `json:"fontFamily"`
}

func ValidFont(family string) bool { return fontNames[family] != "" }

func importedFont(name string) string {
	for family, label := range fontNames {
		if strings.EqualFold(name, label) || strings.EqualFold(name, family) {
			return family
		}
	}
	return DefaultFont
}

func CheckBlocks(blocks []Block) error {
	if len(blocks) > MaxBlocks {
		return ErrTooLarge
	}
	total := 0
	for _, block := range blocks {
		if len(block.Text) > MaxBlockBytes {
			return ErrTooLarge
		}
		if !ValidFont(block.FontFamily) || !utf8.ValidString(block.Text) || strings.ContainsRune(block.Text, 0) {
			return ErrInvalidFile
		}
		total += len(block.Text)
	}
	if total > MaxBodyBytes {
		return ErrTooLarge
	}
	return nil
}

func ReadMarkdown(data []byte) ([]Block, error) {
	if !utf8.Valid(data) {
		return nil, ErrInvalidFile
	}
	source := strings.TrimPrefix(string(data), "\ufeff")
	source = strings.ReplaceAll(strings.ReplaceAll(source, "\r\n", "\n"), "\r", "\n")
	var blocks []Block
	var current []string
	var fence byte
	var width int
	flush := func() {
		if len(current) > 0 {
			blocks = append(blocks, Block{Text: strings.Join(current, "\n"), FontFamily: DefaultFont})
			current = nil
		}
	}
	for _, line := range strings.Split(strings.TrimSuffix(source, "\n"), "\n") {
		trimmed := strings.TrimLeft(line, " ")
		if len(line)-len(trimmed) <= 3 && len(trimmed) >= 3 && (trimmed[0] == '`' || trimmed[0] == '~') {
			char := trimmed[0]
			run := len(trimmed) - len(strings.TrimLeft(trimmed, string(char)))
			if fence == 0 && run >= 3 && (char == '~' || !strings.ContainsRune(trimmed[run:], '`')) {
				fence, width = char, run
			} else if char == fence && run >= width && strings.TrimSpace(trimmed[run:]) == "" {
				fence = 0
			}
		}
		if fence == 0 && strings.TrimSpace(line) == "" {
			flush()
		} else {
			current = append(current, line)
		}
		if len(blocks) > MaxBlocks {
			return nil, ErrTooLarge
		}
	}
	flush()
	return blocks, CheckBlocks(blocks)
}

func WriteMarkdown(blocks []Block) []byte {
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if strings.TrimSpace(block.Text) != "" {
			parts = append(parts, block.Text)
		}
	}
	if len(parts) == 0 {
		return nil
	}
	return []byte(strings.Join(parts, "\n\n") + "\n")
}

func safeLink(destination string) string {
	if strings.ContainsAny(destination, "\r\n\t\\") {
		return ""
	}
	value, err := url.Parse(destination)
	if err != nil || value.User != nil {
		return ""
	}
	if ((value.Scheme == "https" || value.Scheme == "http") && value.Host != "") ||
		(value.Scheme == "mailto" && value.Opaque != "") ||
		(value.Scheme == "" && value.Host == "" &&
			(strings.HasPrefix(value.Path, "/doc/") || strings.HasPrefix(value.Path, "/sheet/") ||
				strings.HasPrefix(value.Path, "/slides/") || strings.HasPrefix(value.Path, "/board/") || strings.HasPrefix(value.Path, "/room/"))) {
		return value.String()
	}
	return ""
}

func fencedCode(text string) string {
	width, run := 3, 0
	for _, character := range text {
		if character == '`' {
			run++
			width = max(width, run+1)
		} else {
			run = 0
		}
	}
	fence := strings.Repeat("`", width)
	return fence + "\n" + strings.TrimSuffix(text, "\n") + "\n" + fence
}
