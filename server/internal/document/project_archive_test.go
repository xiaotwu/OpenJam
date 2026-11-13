package document

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestArchiveRewritesOnlyLocalFileLinks(t *testing.T) {
	origin, err := parseArchiveOrigin("https://shiori.example")
	if err != nil {
		t.Fatal(err)
	}
	targets := map[string]archiveLinkTarget{"old-doc": {"doc", "new-doc"}, "old-sheet": {"sheet", "new-sheet"}}
	for _, tc := range []struct{ input, want string }{
		{"[Read](/doc/old-doc?block=b1#heading)", "[Read](/doc/new-doc?block=b1#heading)"},
		{"[Read](https://SHIORI.EXAMPLE:443/board/old-doc?invite=sample&page=a#token=secret&keep=1)", "[Read](/doc/new-doc?page=a#keep=1)"},
		{"查看/doc/old-doc?block=b1。然后打开/sheet/old-sheet?cell=A1。", "查看/doc/new-doc?block=b1。然后打开/sheet/new-sheet?cell=A1。"},
		{"/?room=old-doc&block=b1", "/doc/new-doc?block=b1"},
		{"//shiori.example/sheet/old-sheet?sheet=tab&cell=B2", "/sheet/new-sheet?sheet=tab&cell=B2"},
		{"/room/outside?page=abc", "https://shiori.example/room/outside?page=abc"},
		{"[Other](https://other.example/doc/old-doc#share=other)", "[Other](https://other.example/doc/old-doc#share=other)"},
		{"ftp://shiori.example/doc/old-doc", "ftp://shiori.example/doc/old-doc"},
		{"file/doc/old-doc /other/doc/old-doc", "file/doc/old-doc /other/doc/old-doc"},
		{"/auth?mode=login&next=%2Fdoc%2Fold-doc%3Fblock%3Db1#invite=key", "/auth?mode=login&next=%2Fdoc%2Fnew-doc%3Fblock%3Db1"},
		{"/doc/old-doc?share=secret;broken&block=b1", "/doc/new-doc?block=b1"},
		{"/teams/team-id/invite#invite=secret", "https://shiori.example/teams/team-id/invite"},
	} {
		if got := rewriteArchiveText(tc.input, origin, targets); got != tc.want {
			t.Errorf("rewrite %q:\n got %q\nwant %q", tc.input, got, tc.want)
		}
	}
	if got := rewriteArchiveText("/doc/old-doc?share=sample&block=b1#invite=sample2", origin, nil); got != "/doc/old-doc?block=b1" {
		t.Fatalf("export must scrub credentials before any ID mapping: %q", got)
	}
}

func TestProjectArchiveRejectsUnlistedAndChangedEntries(t *testing.T) {
	doc := Document{Name: "Plan", DefaultPageID: "page", Pages: []json.RawMessage{json.RawMessage(`{"id":"page","name":"Page 1"}`)}}
	data, digest, err := encodeDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	docEntry := "documents/" + digest + ".json"
	manifest, err := json.Marshal(projectArchiveManifest{
		Format: projectArchiveFormat, Version: 1, Name: "Studio", Origin: "https://shiori.example",
		Files: []archiveFile{{archiveRevision: archiveRevision{FileKey: uuid.New(), Kind: "board", Digest: digest}, RoomID: "original", Epoch: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	build := func(extra string, content []byte) []byte {
		t.Helper()
		var buf bytes.Buffer
		z := zip.NewWriter(&buf)
		entry := func(name string, content []byte) {
			w, err := z.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := w.Write(content); err != nil {
				t.Fatal(err)
			}
		}
		entry("project.json", manifest)
		entry(docEntry, content)
		if extra != "" {
			entry(extra, []byte("unexpected"))
		}
		if err := z.Close(); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	info, err := InspectProjectArchive(build("", data))
	if err != nil || info.Files != 1 || info.Name != "Studio" {
		t.Fatalf("expected a valid archive: %+v %v", info, err)
	}
	for _, raw := range [][]byte{
		build("another-file.txt", data),
		build("project.json", data),
		build("", bytes.Replace(data, []byte("Plan"), []byte("Other plan"), 1)),
	} {
		if _, err := InspectProjectArchive(raw); !errors.Is(err, ErrProjectArchiveInvalid) {
			t.Fatalf("archive tamper should be invalid, got %v", err)
		}
	}
}
