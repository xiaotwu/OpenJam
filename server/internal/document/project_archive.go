package document

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/assets"
	"github.com/xiaotwu/shiori/server/internal/model"
)

const (
	ProjectArchiveMaxZIP = 64 << 20
	maxArchiveExpanded   = 96 << 20
	maxArchiveManifest   = 4 << 20
	maxArchiveVersions   = 1500
	maxArchiveFileRefs   = 15000
	maxArchiveMembers    = 1000
	maxArchiveEntries    = 4096
)

const projectArchiveFormat = "openjam.project"

var (
	ErrProjectArchiveLimit   = errors.New("This project exceeds the archive size or history limits.")
	ErrProjectArchiveInvalid = errors.New("This is not a valid Shiori project archive.")
)

type archiveMember struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Role string    `json:"role"`
}

type archiveRevision struct {
	FileKey    uuid.UUID  `json:"fileKey"`
	Kind       string     `json:"kind"`
	Digest     string     `json:"digest"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

type archiveFile struct {
	archiveRevision
	RoomID   string           `json:"roomId"`
	Epoch    int64            `json:"epoch"`
	Seq      int64            `json:"seq"`
	Versions []VersionSummary `json:"versions"`
}

type archiveProjectVersion struct {
	Name      string            `json:"name"`
	Kind      string            `json:"kind"`
	Author    string            `json:"author,omitempty"`
	CreatedAt time.Time         `json:"createdAt"`
	Files     []archiveRevision `json:"files"`
}

type projectArchiveManifest struct {
	Format   string                  `json:"format"`
	Version  int                     `json:"version"`
	Name     string                  `json:"name"`
	Origin   string                  `json:"origin"`
	Members  []archiveMember         `json:"members"`
	Files    []archiveFile           `json:"files"`
	Versions []archiveProjectVersion `json:"versions"`
	Assets   []assets.Metadata       `json:"assets"`
}

type ProjectArchiveInfo struct {
	Name            string          `json:"name"`
	Files           int             `json:"files"`
	FileVersions    int             `json:"fileVersions"`
	ProjectVersions int             `json:"projectVersions"`
	Images          int             `json:"images"`
	Members         []archiveMember `json:"members"`
}

type archiveDocument struct {
	Document Document
	Assets   []string
}

type projectArchive struct {
	manifest  projectArchiveManifest
	documents map[string]archiveDocument
	images    map[string][]byte
}

func (m projectArchiveManifest) info() ProjectArchiveInfo {
	members := m.Members
	if members == nil {
		members = []archiveMember{}
	}
	count := 0
	for _, file := range m.Files {
		count += len(file.Versions)
	}
	return ProjectArchiveInfo{m.Name, len(m.Files), count, len(m.Versions), len(m.Assets), members}
}

func InspectProjectArchive(raw []byte) (ProjectArchiveInfo, error) {
	archive, err := readProjectArchive(raw)
	if err != nil {
		return ProjectArchiveInfo{}, err
	}
	return archive.manifest.info(), nil
}

func readProjectArchive(raw []byte) (projectArchive, error) {
	if len(raw) > ProjectArchiveMaxZIP {
		return projectArchive{}, ErrProjectArchiveLimit
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return projectArchive{}, ErrProjectArchiveInvalid
	}
	if len(reader.File) > maxArchiveEntries {
		return projectArchive{}, ErrProjectArchiveLimit
	}
	files := make(map[string]*zip.File, len(reader.File))
	var total uint64
	for _, f := range reader.File {
		if files[f.Name] != nil || f.FileInfo().IsDir() || !f.Mode().IsRegular() || f.Flags&1 != 0 ||
			(f.Method != zip.Store && f.Method != zip.Deflate) {
			return projectArchive{}, ErrProjectArchiveInvalid
		}
		if f.UncompressedSize64 > maxArchiveExpanded-total {
			return projectArchive{}, ErrProjectArchiveLimit
		}
		total += f.UncompressedSize64
		files[f.Name] = f
	}
	manifestData, err := readArchiveEntry(files["project.json"], maxArchiveManifest)
	if err != nil {
		return projectArchive{}, err
	}
	var archive projectArchive
	if !decodeArchiveJSON(manifestData, &archive.manifest) {
		return projectArchive{}, ErrProjectArchiveInvalid
	}
	kinds, err := validateArchiveManifest(archive.manifest)
	if err != nil {
		return projectArchive{}, err
	}
	if len(files) != 1+len(kinds)+len(archive.manifest.Assets) {
		return projectArchive{}, ErrProjectArchiveInvalid
	}
	archive.documents = make(map[string]archiveDocument, len(kinds))
	requiredAssets := make(map[string]bool)
	for digest, kind := range kinds {
		data, err := readArchiveEntry(files["documents/"+digest+".json"], PortableDocumentLimit)
		if err != nil {
			return projectArchive{}, err
		}
		var doc Document
		if archiveDigest(data) != digest || !decodeArchiveJSON(data, &doc) {
			return projectArchive{}, ErrProjectArchiveInvalid
		}
		if err := validateArchiveDocument(kind, doc); err != nil {
			return projectArchive{}, err
		}
		refs, err := archiveImageReferences(doc)
		if err != nil {
			return projectArchive{}, err
		}
		archive.documents[digest] = archiveDocument{doc, refs}
		for _, id := range refs {
			requiredAssets[id] = true
		}
	}
	archive.images = make(map[string][]byte, len(archive.manifest.Assets))
	if len(requiredAssets) != len(archive.manifest.Assets) {
		return projectArchive{}, ErrProjectArchiveInvalid
	}
	for _, meta := range archive.manifest.Assets {
		if !requiredAssets[meta.ID] {
			return projectArchive{}, ErrProjectArchiveInvalid
		}
		data, err := readArchiveEntry(files["images/"+meta.ID], assets.MaxImageBytes)
		if err != nil {
			return projectArchive{}, err
		}
		actual, err := assets.Inspect(data, meta.MIMEType)
		if err != nil || actual != meta {
			return projectArchive{}, ErrProjectArchiveInvalid
		}
		archive.images[meta.ID] = data
	}
	return archive, nil
}

func readArchiveEntry(file *zip.File, limit int) ([]byte, error) {
	if file == nil {
		return nil, ErrProjectArchiveInvalid
	}
	if file.UncompressedSize64 > uint64(limit) {
		return nil, ErrProjectArchiveLimit
	}
	reader, err := file.Open()
	if err != nil {
		return nil, ErrProjectArchiveInvalid
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, int64(file.UncompressedSize64)+1))
	if err != nil || uint64(len(data)) != file.UncompressedSize64 {
		return nil, ErrProjectArchiveInvalid
	}
	return data, nil
}

func decodeArchiveJSON(data []byte, out any) bool {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return utf8.Valid(data) && decoder.Decode(out) == nil && decoder.Decode(new(any)) == io.EOF
}

func archiveDigest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func archiveRole(role string) bool {
	return slices.Contains([]string{"manager", "edit", "comment", "view"}, role)
}

func archiveText(value string, limit int) bool {
	return utf8.RuneCountInString(value) <= limit && !strings.ContainsRune(value, 0)
}

func archiveTime(t time.Time) bool { return t.Year() >= 1 && t.Year() <= 9999 && !t.IsZero() }

func validateArchiveManifest(m projectArchiveManifest) (map[string]string, error) {
	if m.Format != projectArchiveFormat || m.Version != 1 || !projectTitle(m.Name) {
		return nil, ErrProjectArchiveInvalid
	}
	origin, err := parseArchiveOrigin(m.Origin)
	if err != nil || origin.String() != m.Origin {
		return nil, ErrProjectArchiveInvalid
	}
	if len(m.Files) > maxProjectFiles || len(m.Versions) > maxArchiveVersions ||
		len(m.Members) > maxArchiveMembers || len(m.Assets) >= maxArchiveEntries {
		return nil, ErrProjectArchiveLimit
	}
	members := make(map[uuid.UUID]bool, len(m.Members))
	for _, member := range m.Members {
		if member.ID == uuid.Nil || members[member.ID] || !archiveText(member.Name, 255) || !archiveRole(member.Role) {
			return nil, ErrProjectArchiveInvalid
		}
		members[member.ID] = true
	}
	images := make(map[string]bool, len(m.Assets))
	for _, meta := range m.Assets {
		if !assets.ValidID(meta.ID) || images[meta.ID] || meta.Size <= 0 || meta.Size > assets.MaxImageBytes {
			return nil, ErrProjectArchiveInvalid
		}
		images[meta.ID] = true
	}
	digests := make(map[string]string)
	keyKinds := make(map[uuid.UUID]string)
	revision := func(r archiveRevision) bool {
		if r.FileKey == uuid.Nil || !slices.Contains([]string{model.ResourceBoard, model.ResourceDoc, model.ResourceSheet, model.ResourceSlides}, r.Kind) ||
			!assets.ValidID(r.Digest) || (r.ArchivedAt != nil && !archiveTime(*r.ArchivedAt)) {
			return false
		}
		if prior := keyKinds[r.FileKey]; prior != "" && prior != r.Kind {
			return false
		}
		if prior := digests[r.Digest]; prior != "" && prior != r.Kind {
			return false
		}
		keyKinds[r.FileKey], digests[r.Digest] = r.Kind, r.Kind
		return true
	}
	rooms := make(map[string]bool, len(m.Files))
	versionCount := len(m.Versions)
	for _, file := range m.Files {
		if !validArchiveRoomID(file.RoomID) || rooms[file.RoomID] || keyKinds[file.FileKey] != "" ||
			!revision(file.archiveRevision) || !archivePosition(file.Epoch, file.Seq, true) {
			return nil, ErrProjectArchiveInvalid
		}
		rooms[file.RoomID] = true
		versionCount += len(file.Versions)
		if versionCount > maxArchiveVersions {
			return nil, ErrProjectArchiveLimit
		}
		seen := make(map[uuid.UUID]bool, len(file.Versions))
		for _, v := range file.Versions {
			ref := archiveRevision{FileKey: file.FileKey, Kind: file.Kind, Digest: v.Hash}
			if v.ID == uuid.Nil || seen[v.ID] || !revision(ref) || !archivePosition(v.Epoch, v.Seq, false) ||
				!projectTitle(v.Name) || !archiveTime(v.CreatedAt) || !archiveText(v.Author, 255) ||
				!slices.Contains([]string{versionNamed, versionCheckpoint, versionBeforeRestore, versionRestored}, v.Kind) ||
				len(v.Participants) > maxArchiveMembers {
				return nil, ErrProjectArchiveInvalid
			}
			for _, participant := range v.Participants {
				if !archiveText(participant, 255) {
					return nil, ErrProjectArchiveInvalid
				}
			}
			seen[v.ID] = true
		}
	}
	refCount := len(m.Files)
	for _, version := range m.Versions {
		if !projectTitle(version.Name) || !archiveText(version.Author, 255) || !archiveTime(version.CreatedAt) ||
			!slices.Contains([]string{"named", "imported", "before_sync", "pulled", "pushed", "before_restore", "restored"}, version.Kind) {
			return nil, ErrProjectArchiveInvalid
		}
		refCount += len(version.Files)
		if len(version.Files) > maxProjectFiles || refCount > maxArchiveFileRefs {
			return nil, ErrProjectArchiveLimit
		}
		seen := make(map[uuid.UUID]bool, len(version.Files))
		for _, r := range version.Files {
			if seen[r.FileKey] || !revision(r) {
				return nil, ErrProjectArchiveInvalid
			}
			seen[r.FileKey] = true
		}
	}
	return digests, nil
}

func archivePosition(epoch, seq int64, live bool) bool {
	minEpoch := int64(1)
	if live {
		minEpoch = 0 // Unactivated legacy board.
	}
	return epoch >= minEpoch && epoch < maxSafeSequence && seq >= 0 && seq < maxSafeSequence
}

func validateArchiveDocument(kind string, content Document) error {
	if strings.TrimSpace(content.Name) == "" || !archiveText(content.Name, 255) || len(content.Pages) == 0 {
		return ErrProjectArchiveInvalid
	}
	if len(content.Pages)+len(content.Elements)+len(content.Stamps) > PortableRecordLimit {
		return ErrProjectArchiveLimit
	}
	if kind == model.ResourceBoard {
		if err := ValidatePortable(content); err != nil {
			return fmt.Errorf("%w %v", ErrProjectArchiveInvalid, err)
		}
		return nil
	}
	if len(content.Stamps) != 0 || (kind == model.ResourceDoc && len(content.Elements) != 0) {
		return ErrProjectArchiveInvalid
	}
	pages := make(map[string]bool, len(content.Pages))
	for _, raw := range content.Pages {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil {
			return ErrProjectArchiveInvalid
		}
		id := rawString(fields["id"])
		if !validEntityID(id) || pages[id] {
			return ErrProjectArchiveInvalid
		}
		pages[id] = true
		var err error
		switch kind {
		case model.ResourceDoc:
			err = validateDocBlock(fields)
		case model.ResourceSheet:
			err = validateSheetTab(fields)
		case model.ResourceSlides:
			err = validateSlidePage(fields, raw)
		default:
			return ErrProjectArchiveInvalid
		}
		if err != nil {
			return fmt.Errorf("%w %v", ErrProjectArchiveInvalid, err)
		}
	}
	if !pages[content.DefaultPageID] {
		return ErrProjectArchiveInvalid
	}
	elements := make(map[string]bool, len(content.Elements))
	for _, raw := range content.Elements {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil {
			return ErrProjectArchiveInvalid
		}
		id := rawString(fields["id"])
		if !validEntityID(id) || elements[id] || !pages[rawString(fields["pageId"])] {
			return ErrProjectArchiveInvalid
		}
		elements[id] = true
		if kind == model.ResourceSlides {
			if err := validateSlideObject(fields, raw); err != nil {
				return fmt.Errorf("%w %v", ErrProjectArchiveInvalid, err)
			}
		}
	}
	var err error
	switch kind {
	case model.ResourceDoc:
		_, err = DocBlocks(Snapshot{ResourceKind: kind, Document: content})
	case model.ResourceSheet:
		_, _, _, err = decodeWorkbook(content)
	case model.ResourceSlides:
		_, err = PresentationSlides(Snapshot{ResourceKind: kind, Document: content})
	}
	if err != nil {
		return fmt.Errorf("%w %v", ErrProjectArchiveInvalid, err)
	}
	return nil
}

// Archive input must never introduce an external image load. Export normalizes
// existing inline raster images before writing the package.
func archiveImageReferences(doc Document) ([]string, error) {
	for _, raw := range doc.Elements {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil {
			return nil, ErrProjectArchiveInvalid
		}
		if rawString(fields["type"]) == "image" && fields["src"] != nil && string(fields["src"]) != `""` {
			return nil, ErrProjectArchiveInvalid
		}
	}
	refs, err := assets.References(doc.Elements)
	if err != nil {
		return nil, ErrProjectArchiveInvalid
	}
	return refs, nil
}
