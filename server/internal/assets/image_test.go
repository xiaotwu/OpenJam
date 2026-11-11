package assets

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"testing"
)

func TestInspectRasterImage(t *testing.T) {
	var input bytes.Buffer
	if err := png.Encode(&input, image.NewRGBA(image.Rect(0, 0, 2, 3))); err != nil {
		t.Fatal(err)
	}
	data := input.Bytes()
	hash := sha256.Sum256(data)
	meta, err := Inspect(data, "application/octet-stream")
	if err != nil || meta != (Metadata{ID: hex.EncodeToString(hash[:]), Size: int64(len(data)), Width: 2, Height: 3, MIMEType: "image/png"}) {
		t.Fatalf("PNG metadata = %+v, %v", meta, err)
	}
	if _, err := Inspect(data, "image/jpeg"); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("conflicting MIME = %v", err)
	}
	if _, err := Inspect(data[:len(data)-12], "image/png"); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("truncated PNG = %v", err)
	}
	if _, err := Inspect([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), "image/svg+xml"); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("SVG = %v", err)
	}
	oversized := bytes.Clone(data)
	binary.BigEndian.PutUint32(oversized[16:20], 8192)
	binary.BigEndian.PutUint32(oversized[20:24], 8192)
	binary.BigEndian.PutUint32(oversized[29:33], crc32.ChecksumIEEE(oversized[12:29]))
	if _, err := Inspect(oversized, "image/png"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("PNG decoded pixel budget = %v", err)
	}
	legacy := "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
	if decoded, err := ParseLegacyDataURI(legacy); err != nil || !bytes.Equal(decoded, data) {
		t.Fatalf("legacy raster data URI = %v", err)
	}
	if _, err := ParseLegacyDataURI("https://example.invalid/image.png"); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("external URL accepted: %v", err)
	}
}

func TestInspectGIFRejectsMultipleFrames(t *testing.T) {
	pixels := image.NewPaletted(image.Rect(0, 0, 4, 3), color.Palette{color.White, color.Black})
	var input bytes.Buffer
	if err := gif.Encode(&input, pixels, nil); err != nil {
		t.Fatal(err)
	}
	if meta, err := Inspect(input.Bytes(), "image/gif"); err != nil || meta.Width != 4 || meta.Height != 3 {
		t.Fatalf("static GIF metadata = %+v, %v", meta, err)
	}
	input.Reset()
	if err := gif.EncodeAll(&input, &gif.GIF{Image: []*image.Paletted{pixels, pixels}, Delay: []int{1, 1}}); err != nil {
		t.Fatal(err)
	}
	if _, err := Inspect(input.Bytes(), "image/gif"); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("animated GIF accepted: %v", err)
	}
}

func TestInspectWebPChecksCodedFrameDimensions(t *testing.T) {
	// Two 2x3 rasters encoded as extended WebP with alpha and lossless WebP.
	for _, encoded := range []string{
		"UklGRlgAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAgECAQIBAAFZQOCAqAAAA8AEAnQEqAgADAAIANCUATpdAAGEg33AAAP78XamNZ4tikNzPDaqyWgAA",
		"UklGRiAAAABXRUJQVlA4TBQAAAAvAYAAEA9wCZGN+MhMgeJARvQ/AA==",
	} {
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if meta, err := Inspect(data, "image/webp"); err != nil || meta.Width != 2 || meta.Height != 3 {
			t.Fatalf("static WebP metadata = %+v, %v", meta, err)
		}
		if staticWebP(data, image.Config{Width: 1, Height: 3}) {
			t.Fatal("WebP validation accepted dimensions other than the coded frame")
		}
	}
}

func TestAssetReferences(t *testing.T) {
	const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	image := json.RawMessage(`{"type":"image","assetId":"` + digest + `","src":""}`)
	legacy := json.RawMessage(`{"type":"image","src":"data:image/png;base64,legacy"}`)
	ids, err := References([]json.RawMessage{image, legacy, image})
	if err != nil || len(ids) != 1 || ids[0] != digest {
		t.Fatalf("image references = %v, %v", ids, err)
	}
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"type":"image","assetId":"../assets/v1/a"}`),
		json.RawMessage(`{"type":"image","assetId":null}`),
		json.RawMessage(`{"type":"sticky","assetId":"` + digest + `"}`),
		json.RawMessage(`{"type":"image","assetId":"` + digest + `","src":"https://example.invalid"}`),
	} {
		if _, err := References([]json.RawMessage{raw}); !errors.Is(err, ErrInvalidReference) {
			t.Fatalf("invalid reference %s = %v", raw, err)
		}
	}
}
