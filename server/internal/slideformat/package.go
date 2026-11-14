package slideformat

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"
)

const (
	maxExpanded      = 80 << 20
	maxXMLPart       = 8 << 20
	presentationNS   = "http://schemas.openxmlformats.org/presentationml/2006/main"
	drawingNS        = "http://schemas.openxmlformats.org/drawingml/2006/main"
	officeRelNS      = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	packageRelNS     = "http://schemas.openxmlformats.org/package/2006/relationships"
	contentNS        = "http://schemas.openxmlformats.org/package/2006/content-types"
	presentationType = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
	emuPerPixel      = 9525
)

type slidePackage map[string]*zip.File

type relationship struct {
	ID     string `xml:"Id,attr"`
	Type   string `xml:"Type,attr"`
	Target string `xml:"Target,attr"`
	Mode   string `xml:"TargetMode,attr,omitempty"`
}

type relationshipFile struct {
	XMLName xml.Name       `xml:"Relationships"`
	XMLNS   string         `xml:"xmlns,attr,omitempty"`
	Items   []relationship `xml:"Relationship"`
}

type contentOverride struct {
	Part string `xml:"PartName,attr"`
	Type string `xml:"ContentType,attr"`
}

type contentDefault struct {
	Extension string `xml:"Extension,attr"`
	Type      string `xml:"ContentType,attr"`
}

type contentTypes struct {
	XMLName   xml.Name          `xml:"Types"`
	XMLNS     string            `xml:"xmlns,attr,omitempty"`
	Defaults  []contentDefault  `xml:"Default"`
	Overrides []contentOverride `xml:"Override"`
}

func openPackage(data []byte) (slidePackage, error) {
	if len(data) > MaxUploadBytes {
		return nil, ErrLimit
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, ErrInvalid
	}
	if len(archive.File) > 700 {
		return nil, ErrLimit
	}
	parts := make(slidePackage)
	var expanded uint64
	for _, entry := range archive.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		if entry.UncompressedSize64 > maxExpanded-expanded {
			return nil, ErrLimit
		}
		expanded += entry.UncompressedSize64
		if !validPart(entry.Name) || parts[entry.Name] != nil {
			return nil, ErrInvalid
		}
		parts[entry.Name] = entry
	}
	return parts, nil
}

func validPart(name string) bool {
	return name != "." && name != ".." && name == path.Clean(name) &&
		!strings.HasPrefix(name, "/") && !strings.HasPrefix(name, "../") && !strings.ContainsRune(name, '\\')
}

func relationPath(parent string, rel relationship) (string, bool) {
	target, err := url.Parse(rel.Target)
	if err != nil || (rel.Mode != "" && rel.Mode != "Internal") || target.IsAbs() || target.Host != "" ||
		target.Path == "" || target.RawQuery != "" || target.Fragment != "" {
		return "", false
	}
	name := strings.TrimPrefix(target.Path, "/")
	if !strings.HasPrefix(target.Path, "/") {
		name = path.Join(path.Dir(parent), name)
	}
	return name, validPart(name)
}

func (parts slidePackage) data(name string, maxBytes uint64) ([]byte, error) {
	part := parts[name]
	if part == nil {
		return nil, ErrInvalid
	}
	if part.UncompressedSize64 > maxBytes {
		return nil, ErrLimit
	}
	source, err := part.Open()
	if err != nil {
		return nil, ErrInvalid
	}
	defer source.Close()
	data, err := io.ReadAll(io.LimitReader(source, int64(maxBytes)+1))
	if err != nil || uint64(len(data)) != part.UncompressedSize64 {
		return nil, ErrInvalid
	}
	return data, nil
}

func (parts slidePackage) xml(name string, value any) error {
	data, err := parts.data(name, maxXMLPart)
	if err != nil {
		return err
	}
	if err := xml.Unmarshal(data, value); err != nil {
		return fmt.Errorf("%w: unreadable presentation XML", ErrInvalid)
	}
	return nil
}

func (parts slidePackage) relationships(parent string) (map[string]relationship, error) {
	name := "_rels/.rels"
	if parent != "" {
		name = path.Join(path.Dir(parent), "_rels", path.Base(parent)+".rels")
		if parts[name] == nil {
			return nil, nil
		}
	}
	var content relationshipFile
	if err := parts.xml(name, &content); err != nil {
		return nil, err
	}
	byID := make(map[string]relationship, len(content.Items))
	for _, entry := range content.Items {
		if entry.ID == "" || byID[entry.ID].ID != "" {
			return nil, ErrInvalid
		}
		byID[entry.ID] = entry
	}
	return byID, nil
}

func relatedPart(rels map[string]relationship, parent, kind string) string {
	for _, rel := range rels {
		if strings.HasSuffix(rel.Type, "/"+kind) {
			if part, ok := relationPath(parent, rel); ok {
				return part
			}
		}
	}
	return ""
}
