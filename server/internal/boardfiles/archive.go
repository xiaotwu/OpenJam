package boardfiles

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/document"
)

const (
	ArchiveFormat    = "openjam.board"
	ArchiveVersion   = 1
	MaxPackageBytes  = 32 * 1024 * 1024
	maxPackageAssets = 512
	manifestName     = "board.json"
)

type packageSource struct {
	Epoch int64  `json:"epoch"`
	Seq   int64  `json:"seq"`
	Hash  string `json:"hash"`
}

type packageAsset struct {
	assets.Metadata
	Data []byte `json:"data,omitempty"`
}

type boardPackage struct {
	Format   string            `json:"format"`
	Version  int               `json:"version"`
	Source   *packageSource    `json:"source,omitempty"`
	Document document.Document `json:"document"`
	Assets   []packageAsset    `json:"assets"`
}

func capturePackage(ctx context.Context, actor uuid.UUID, snapshot document.Snapshot) (boardPackage, error) {
	bundle := boardPackage{
		Format: ArchiveFormat, Version: ArchiveVersion, Document: snapshot.Document,
		Source: &packageSource{Epoch: snapshot.Epoch, Seq: snapshot.Seq, Hash: snapshot.Hash},
		Assets: []packageAsset{},
	}
	ids, err := assets.References(bundle.Document.Elements)
	if err != nil {
		return boardPackage{}, err
	}
	if len(ids) > maxPackageAssets {
		return boardPackage{}, ErrTooLarge
	}
	var total int64
	for _, id := range ids {
		meta, reader, err := assets.Get(ctx, snapshot.BoardID, actor, id)
		if err != nil {
			return boardPackage{}, err
		}
		total += meta.Size
		if total > MaxPackageBytes {
			reader.Close()
			return boardPackage{}, ErrTooLarge
		}
		data, readErr := io.ReadAll(io.LimitReader(reader, meta.Size+1))
		reader.Close()
		if readErr != nil || int64(len(data)) != meta.Size {
			return boardPackage{}, assets.ErrUnavailable
		}
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) != id {
			return boardPackage{}, assets.ErrUnavailable
		}
		bundle.Assets = append(bundle.Assets, packageAsset{Metadata: meta, Data: data})
	}
	// Existing inline raster images are kept portable. The importer converts
	// them to private objects when it creates the new board.
	if err := validateLegacyImages(bundle.Document); err != nil {
		return boardPackage{}, err
	}
	return bundle, nil
}

func validateLegacyImages(content document.Document) error {
	for _, raw := range content.Elements {
		var image struct{ Type, AssetID, Src string }
		if err := json.Unmarshal(raw, &image); err != nil {
			return ErrInvalidFile
		}
		if image.Type == "image" && image.AssetID == "" && image.Src != "" {
			if _, err := parseLegacyImage(image.Src); err != nil {
				return err
			}
		}
	}
	return nil
}

func parseLegacyImage(src string) ([]byte, error) {
	if !strings.HasPrefix(src, "data:") {
		return nil, ErrExternalImage
	}
	data, err := assets.ParseLegacyDataURI(src)
	if err != nil {
		if errors.Is(err, assets.ErrTooLarge) {
			return nil, ErrTooLarge
		}
		return nil, fmt.Errorf("%w: image data is not a supported raster file", ErrInvalidFile)
	}
	return data, nil
}

type packageBuffer struct {
	bytes.Buffer
}

func (buf *packageBuffer) Write(data []byte) (int, error) {
	if buf.Len()+len(data) > MaxPackageBytes {
		return 0, ErrTooLarge
	}
	return buf.Buffer.Write(data)
}

func encodePackage(bundle boardPackage, format string) ([]byte, error) {
	payload, err := json.Marshal(bundle.Document)
	if err != nil {
		return nil, err
	}
	if len(payload) > document.PortableDocumentLimit {
		return nil, ErrTooLarge
	}
	total := len(payload) + len(bundle.Assets)*320 + 512
	for _, asset := range bundle.Assets {
		size := len(asset.Data)
		if format == "json" {
			size = 4 * ((size + 2) / 3)
		}
		total += size
		if total > MaxPackageBytes {
			return nil, ErrTooLarge
		}
	}
	if format == "json" {
		return json.Marshal(bundle)
	}
	buf := &packageBuffer{}
	writer := zip.NewWriter(buf)
	manifest := bundle
	manifest.Assets = make([]packageAsset, 0, len(bundle.Assets))
	for _, asset := range bundle.Assets {
		manifest.Assets = append(manifest.Assets, packageAsset{Metadata: asset.Metadata})
	}
	entry, err := writer.Create(manifestName)
	if err != nil {
		return nil, err
	}
	if err := json.NewEncoder(entry).Encode(manifest); err != nil {
		return nil, err
	}
	for _, asset := range bundle.Assets {
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: assetEntry(asset.ID), Method: zip.Store})
		if err != nil {
			return nil, err
		}
		if _, err := entry.Write(asset.Data); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func assetEntry(id string) string { return "assets/" + id }

func validDigest(value string) bool {
	data, err := hex.DecodeString(value)
	return err == nil && len(data) == sha256.Size && hex.EncodeToString(data) == value
}

func decodePackage(data []byte, mediaType string) (boardPackage, error) {
	if len(data) == 0 || len(data) > MaxPackageBytes {
		return boardPackage{}, ErrTooLarge
	}
	var bundle boardPackage
	var entries map[string]*zip.File
	if mediaType == "application/zip" {
		var err error
		entries, err = archiveEntries(data)
		if err != nil {
			return boardPackage{}, err
		}
		data, err = readArchiveEntry(entries[manifestName], MaxPackageBytes)
		if err != nil {
			return boardPackage{}, err
		}
		delete(entries, manifestName)
	}
	if err := json.Unmarshal(data, &bundle); err != nil {
		return boardPackage{}, ErrInvalidFile
	}
	if bundle.Format == "" && bundle.Version == 0 && entries == nil {
		var legacy struct {
			Name          string
			Pages         json.RawMessage
			Elements      json.RawMessage
			Stamps        json.RawMessage
			CurrentPageID string
		}
		if err := json.Unmarshal(data, &legacy); err != nil || legacy.Name == "" ||
			(len(legacy.Pages) == 0 && len(legacy.Elements) == 0) {
			return boardPackage{}, ErrInvalidFile
		}
		doc, err := document.NormalizeLegacyFile(legacy.Name, data)
		if err != nil {
			return boardPackage{}, ErrInvalidFile
		}
		bundle = boardPackage{Format: ArchiveFormat, Version: ArchiveVersion, Document: doc}
	}
	if bundle.Format != ArchiveFormat || bundle.Version != ArchiveVersion {
		return boardPackage{}, ErrInvalidFile
	}
	if len(bundle.Assets) > maxPackageAssets {
		return boardPackage{}, ErrTooLarge
	}
	encoded, err := json.Marshal(bundle.Document)
	if err != nil || len(encoded) > document.PortableDocumentLimit {
		return boardPackage{}, ErrTooLarge
	}
	if err := document.ValidatePortable(bundle.Document); err != nil {
		if errors.Is(err, document.ErrPortableTooLarge) {
			return boardPackage{}, ErrTooLarge
		}
		return boardPackage{}, fmt.Errorf("%w: %s", ErrInvalidFile, err)
	}
	refs, err := assets.References(bundle.Document.Elements)
	if err != nil {
		return boardPackage{}, ErrInvalidFile
	}
	byID := make(map[string]bool, len(refs))
	for _, id := range refs {
		byID[id] = true
	}
	var total int64
	for index, asset := range bundle.Assets {
		if !byID[asset.ID] || !validDigest(asset.ID) || asset.Size <= 0 {
			return boardPackage{}, ErrInvalidFile
		}
		if asset.Size > MaxPackageBytes-total {
			return boardPackage{}, ErrTooLarge
		}
		total += asset.Size
		delete(byID, asset.ID)
		if entries != nil {
			if len(asset.Data) != 0 {
				return boardPackage{}, ErrInvalidFile
			}
			entryName := assetEntry(asset.ID)
			asset.Data, err = readArchiveEntry(entries[entryName], asset.Size)
			if err != nil {
				return boardPackage{}, err
			}
			delete(entries, entryName)
		}
		meta, err := assets.Inspect(asset.Data, asset.MIMEType)
		if err != nil || meta != asset.Metadata {
			return boardPackage{}, ErrInvalidFile
		}
		bundle.Assets[index] = asset
	}
	if len(byID) != 0 || len(entries) != 0 {
		return boardPackage{}, ErrInvalidFile
	}
	return bundle, nil
}

func archiveEntries(data []byte) (map[string]*zip.File, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(reader.File) > maxPackageAssets+1 {
		return nil, ErrInvalidFile
	}
	entries := make(map[string]*zip.File, len(reader.File))
	var size uint64
	for _, file := range reader.File {
		if (file.Name != manifestName && (!strings.HasPrefix(file.Name, "assets/") ||
			!validDigest(strings.TrimPrefix(file.Name, "assets/")))) ||
			entries[file.Name] != nil || !file.Mode().IsRegular() {
			return nil, ErrInvalidFile
		}
		if file.UncompressedSize64 > MaxPackageBytes-size {
			return nil, ErrTooLarge
		}
		size += file.UncompressedSize64
		entries[file.Name] = file
	}
	return entries, nil
}

func readArchiveEntry(entry *zip.File, limit int64) ([]byte, error) {
	if entry == nil {
		return nil, ErrInvalidFile
	}
	if entry.UncompressedSize64 > uint64(limit) {
		return nil, ErrTooLarge
	}
	reader, err := entry.Open()
	if err != nil {
		return nil, ErrInvalidFile
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil || uint64(len(data)) != entry.UncompressedSize64 {
		return nil, ErrInvalidFile
	}
	return data, nil
}

func prepareImport(bundle *boardPackage) error {
	known := make(map[string]bool, len(bundle.Assets))
	for _, asset := range bundle.Assets {
		known[asset.ID] = true
	}
	for index, raw := range bundle.Document.Elements {
		var el struct{ Type, AssetID, Src string }
		if err := json.Unmarshal(raw, &el); err != nil {
			return ErrInvalidFile
		}
		if el.Type != "image" || el.AssetID != "" || el.Src == "" {
			continue
		}
		data, err := parseLegacyImage(el.Src)
		if err != nil {
			return err
		}
		meta, err := assets.Inspect(data, "")
		if err != nil {
			return ErrInvalidFile
		}
		if !known[meta.ID] {
			if len(bundle.Assets) >= maxPackageAssets {
				return ErrTooLarge
			}
			bundle.Assets = append(bundle.Assets, packageAsset{Metadata: meta, Data: data})
			known[meta.ID] = true
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return ErrInvalidFile
		}
		fields["assetId"], _ = json.Marshal(meta.ID)
		delete(fields, "src")
		bundle.Document.Elements[index], err = json.Marshal(fields)
		if err != nil {
			return ErrInvalidFile
		}
	}
	return nil
}
