package slideformat

import (
	"archive/zip"
	"bytes"
	"image"
	"image/color"
	"image/png"
	"reflect"
	"strings"
	"testing"

	"github.com/xiaotwu/shiori/server/internal/assets"
)

func TestPPTXEditableRoundTrip(t *testing.T) {
	var photo bytes.Buffer
	canvas := image.NewRGBA(image.Rect(0, 0, 96, 64))
	canvas.Set(24, 20, color.RGBA{R: 48, G: 80, B: 125, A: 255})
	if err := png.Encode(&photo, canvas); err != nil {
		t.Fatal(err)
	}
	meta, err := assets.Inspect(photo.Bytes(), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	first := BlankSlide()
	first.Name = "Release · 审阅"
	first.Background = "#f7f2e9"
	first.Objects = []Object{
		{Type: "text", Box: Box{X: 90, Y: 70, Width: 600, Height: 200}, Text: "计划 & delivery\n第二行",
			FontFamily: "Arial", FontSize: 48, FontWeight: "bold", FontStyle: "italic", Color: "#23364d", TextAlign: "center"},
		{Type: "image", Box: Box{X: 720, Y: 100, Width: 420, Height: 280, Rotation: 5}, AssetID: meta.ID,
			OriginalWidth: meta.Width, OriginalHeight: meta.Height, Caption: "Workshop artwork", Crop: &Crop{Left: 2500, Bottom: 1000}},
	}
	second := BlankSlide()
	second.Name = "Next steps"
	slides := []Slide{first, second}
	data, err := WritePPTX(slides, map[string]Media{meta.ID: {Metadata: meta, Data: photo.Bytes()}})
	if err != nil {
		t.Fatal(err)
	}
	parts, err := openPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	content, err := parts.data("ppt/slides/slide1.xml", maxXMLPart)
	if err != nil || !bytes.Contains(content, []byte(`lang="zh-CN"`)) || !bytes.Contains(content, []byte(`<a:ea typeface="Microsoft YaHei"/>`)) {
		t.Fatalf("exported Chinese text lacks an East Asian font hint: %v", err)
	}
	imported, err := ReadPPTX(data)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(imported.Slides, slides) || len(imported.Media) != 1 || !bytes.Equal(imported.Media[meta.ID].Data, photo.Bytes()) {
		t.Fatalf("presentation did not round trip: %+v", imported.Slides)
	}
}

func TestPPTXExternalImageIsSkipped(t *testing.T) {
	slide := BlankSlide()
	var photo bytes.Buffer
	if err := png.Encode(&photo, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	meta, err := assets.Inspect(photo.Bytes(), "")
	if err != nil {
		t.Fatal(err)
	}
	slide.Objects = []Object{{Type: "image", Box: Box{Width: 120, Height: 120}, AssetID: meta.ID,
		OriginalWidth: 8, OriginalHeight: 8}}
	data, err := WritePPTX([]Slide{slide}, map[string]Media{meta.ID: {Metadata: meta, Data: photo.Bytes()}})
	if err != nil {
		t.Fatal(err)
	}
	parts, err := openPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	var changed bytes.Buffer
	archive := zip.NewWriter(&changed)
	for path := range parts {
		payload, err := parts.data(path, MaxUploadBytes)
		if err != nil {
			t.Fatal(err)
		}
		if path == "ppt/slides/_rels/slide1.xml.rels" {
			payload = []byte(strings.ReplaceAll(string(payload), `Target="../media/image1.png"`,
				`Target="https://example.invalid/image.png" TargetMode="External"`))
		}
		part, err := archive.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(payload); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	imported, err := ReadPPTX(changed.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(imported.Slides[0].Objects) != 0 || len(imported.Media) != 0 || len(imported.Warnings) != 1 {
		t.Fatalf("external picture should be omitted with a notice: %+v", imported.Warnings)
	}
}
