package document

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/model"
)

var errArchiveLegacyImage = &ProjectFault{"PROJECT_ARCHIVE_IMAGE", "A legacy board contains an image that is not stored in OpenJam. Save it as a private image before exporting."}

type archiveCapture struct {
	manifest    projectArchiveManifest
	origin      *url.URL
	documents   map[string][]byte
	images      map[string]assets.Metadata
	inline      map[string][]byte
	fileVersion map[string]map[string]string // source room, source digest -> archive digest
	bytes       int64
	versions    int
	references  int
}

func ExportProjectArchive(ctx context.Context, actor, project uuid.UUID, sourceOrigin string) (string, []byte, error) {
	origin, err := parseArchiveOrigin(sourceOrigin)
	if err != nil {
		return "", nil, err
	}
	capture := archiveCapture{
		manifest: projectArchiveManifest{Format: projectArchiveFormat, Version: 1, Origin: origin.String()},
		origin:   origin, documents: map[string][]byte{}, images: map[string]assets.Metadata{},
		inline: map[string][]byte{}, fileVersion: map[string]map[string]string{},
	}
	err = pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		scope, err := requireArchiveManager(ctx, tx, actor, project)
		if err != nil {
			return err
		}
		capture.manifest.Name = scope.name
		return capture.capture(ctx, tx, scope)
	})
	if err != nil {
		return "", nil, err
	}

	for _, id := range sortedArchiveKeys(capture.images) {
		capture.manifest.Assets = append(capture.manifest.Assets, capture.images[id])
	}
	if _, err := validateArchiveManifest(capture.manifest); err != nil {
		return "", nil, err
	}
	raw, err := capture.zip(ctx)
	if err != nil {
		return "", nil, err
	}
	// Close the snapshot before fetching from the object store. Check the
	// source grant again before releasing the completed package.
	if _, err := requireArchiveManager(ctx, db.Pool(), actor, project); err != nil {
		return "", nil, err
	}
	return capture.manifest.Name, raw, nil
}

func requireArchiveManager(ctx context.Context, query projectScopeQuery, actor, project uuid.UUID) (projectScope, error) {
	scope, err := getProjectScope(ctx, query, actor, project)
	if err == nil && scope.role != "manager" {
		err = model.ErrDirectoryForbidden
	}
	return scope, err
}

func (c *archiveCapture) capture(ctx context.Context, tx pgx.Tx, scope projectScope) error {
	rows, err := tx.Query(ctx, `
		SELECT u.id, u.display_name, 'manager'::text FROM users u WHERE u.id = $2
		UNION ALL
		SELECT u.id, u.display_name, m.role FROM project_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.project_id = $1 AND m.user_id <> $2 AND openjam_project_role($1, m.user_id) IS NOT NULL
		ORDER BY 1 LIMIT $3
	`, scope.id, scope.owner, maxArchiveMembers+1)
	if err != nil {
		return err
	}
	c.manifest.Members, err = pgx.CollectRows(rows, pgx.RowToStructByPos[archiveMember])
	if err != nil {
		return err
	}
	if len(c.manifest.Members) > maxArchiveMembers {
		return ErrProjectArchiveLimit
	}
	byProject, err := captureProjectFiles(ctx, tx, []projectScope{scope}, false)
	if err != nil {
		return err
	}
	files := byProject[scope.id]
	c.references = len(files)
	for _, key := range projectKeys(files) {
		file := files[key]
		media := archiveMediaSource{room: file.room.ID}
		digest, err := c.addDocument(ctx, tx, file.room.Kind, file.content, media)
		if err != nil {
			return err
		}
		c.fileVersion[file.room.ID] = map[string]string{file.digest: digest}
		versions, err := c.captureFileVersions(ctx, tx, file)
		if err != nil {
			return err
		}
		c.manifest.Files = append(c.manifest.Files, archiveFile{
			archiveRevision: archiveRevision{key, file.room.Kind, digest, file.archivedAt},
			RoomID:          file.room.ID, Epoch: file.head.Epoch, Seq: file.head.Seq, Versions: versions,
		})
	}
	return c.captureProjectVersions(ctx, tx, scope.id)
}

func (c *archiveCapture) captureFileVersions(ctx context.Context, tx pgx.Tx, file projectFile) ([]VersionSummary, error) {
	rows, err := tx.Query(ctx, "SELECT "+versionFields+versionJoins+`
		WHERE v.board_id = $1 ORDER BY v.created_at, v.id LIMIT $2
	`, file.room.ID, maxArchiveVersions-c.versions+1)
	if err != nil {
		return nil, err
	}
	versions, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (VersionSummary, error) { return scanVersion(row, nil) })
	if err != nil {
		return nil, err
	}
	c.versions += len(versions)
	if c.versions > maxArchiveVersions {
		return nil, ErrProjectArchiveLimit
	}
	byDigest := c.fileVersion[file.room.ID]
	for i := range versions {
		v := &versions[i]
		sourceDigest := v.Hash
		digest := byDigest[sourceDigest]
		if digest == "" {
			var doc Document
			var size int
			err := tx.QueryRow(ctx, `
				SELECT octet_length(s.document::text), CASE WHEN octet_length(s.document::text) <= $3 THEN s.document ELSE '{}'::jsonb END
				FROM board_versions v JOIN board_snapshots s ON (s.board_id, s.epoch, s.seq, s.reason)
					= (v.board_id, v.epoch, v.seq, v.snapshot_reason)
				WHERE v.board_id = $1 AND v.id = $2
			`, file.room.ID, v.ID, PortableDocumentLimit).Scan(&size, &doc)
			if err != nil {
				return nil, err
			}
			if size > PortableDocumentLimit {
				return nil, ErrProjectArchiveLimit
			}
			if _, actual, err := encodeDocument(doc); err != nil || actual != sourceDigest {
				return nil, fmt.Errorf("archive: file version %s has an inconsistent checksum", v.ID)
			}
			digest, err = c.addDocument(ctx, tx, file.room.Kind, doc, archiveMediaSource{room: file.room.ID})
			if err != nil {
				return nil, err
			}
			byDigest[sourceDigest] = digest
		}
		v.Hash = digest
	}
	return versions, nil
}

func (c *archiveCapture) captureProjectVersions(ctx context.Context, tx pgx.Tx, project uuid.UUID) error {
	type versionRecord struct {
		id      uuid.UUID
		version archiveProjectVersion
	}
	rows, err := tx.Query(ctx, `
		SELECT v.id, v.name, v.kind, coalesce(u.display_name, v.imported_author), v.created_at
		FROM project_versions v LEFT JOIN users u ON u.id = v.actor_id
		WHERE v.project_id = $1 ORDER BY v.created_at, v.id LIMIT $2
	`, project, maxArchiveVersions-c.versions+1)
	if err != nil {
		return err
	}
	versions, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (versionRecord, error) {
		var v versionRecord
		err := row.Scan(&v.id, &v.version.Name, &v.version.Kind, &v.version.Author, &v.version.CreatedAt)
		return v, err
	})
	if err != nil {
		return err
	}
	if c.versions+len(versions) > maxArchiveVersions {
		return ErrProjectArchiveLimit
	}
	byDigest := make(map[string]string)
	for _, v := range versions {
		rows, err := tx.Query(ctx, `
			SELECT file_key, resource_kind, digest, archived_at FROM project_version_files
			WHERE project_id = $1 AND version_id = $2 ORDER BY file_key LIMIT $3
		`, project, v.id, maxProjectFiles+1)
		if err != nil {
			return err
		}
		v.version.Files, err = pgx.CollectRows(rows, pgx.RowToStructByPos[archiveRevision])
		if err != nil {
			return err
		}
		c.references += len(v.version.Files)
		if len(v.version.Files) > maxProjectFiles || c.references > maxArchiveFileRefs {
			return ErrProjectArchiveLimit
		}
		for i := range v.version.Files {
			f := &v.version.Files[i]
			sourceDigest := f.Digest
			digest := byDigest[sourceDigest]
			if digest == "" {
				var doc Document
				var size int
				err := tx.QueryRow(ctx, `
					SELECT octet_length(document::text), CASE WHEN octet_length(document::text) <= $3 THEN document ELSE '{}'::jsonb END
					FROM project_version_documents WHERE project_id = $1 AND digest = $2
				`, project, sourceDigest, PortableDocumentLimit).Scan(&size, &doc)
				if err != nil {
					return err
				}
				if size > PortableDocumentLimit {
					return ErrProjectArchiveLimit
				}
				if _, actual, err := encodeDocument(doc); err != nil || actual != sourceDigest {
					return fmt.Errorf("archive: project snapshot %s has an inconsistent checksum", v.id)
				}
				digest, err = c.addDocument(ctx, tx, f.Kind, doc, archiveMediaSource{project: project, digest: sourceDigest})
				if err != nil {
					return err
				}
				byDigest[sourceDigest] = digest
			}
			f.Digest = digest
		}
		c.manifest.Versions = append(c.manifest.Versions, v.version)
	}
	return nil
}

type archiveMediaSource struct {
	room    string
	project uuid.UUID
	digest  string
}

func (c *archiveCapture) addDocument(ctx context.Context, tx pgx.Tx, kind string, doc Document, source archiveMediaSource) (string, error) {
	// Authorize the typed references against this particular source revision,
	// even if another room or revision already added the same payload.
	ids, err := assets.References(doc.Elements)
	if err != nil {
		return "", err
	}
	if len(ids) > 0 {
		if err := c.captureRegisteredImages(ctx, tx, source, ids); err != nil {
			return "", err
		}
	}
	doc, err = rewriteArchiveDocument(kind, doc, c.origin, nil)
	if err != nil {
		return "", err
	}
	if err := c.normalizeInlineImages(&doc); err != nil {
		return "", err
	}
	if err := validateArchiveDocument(kind, doc); err != nil {
		return "", fmt.Errorf("%w File: %s.", err, doc.Name)
	}
	data, digest, err := encodeDocument(doc)
	if err != nil {
		return "", err
	}
	if len(data) > PortableDocumentLimit {
		return "", ErrProjectArchiveLimit
	}
	if c.documents[digest] == nil {
		if err := c.reserve(int64(len(data))); err != nil {
			return "", err
		}
		c.documents[digest] = data
	}
	return digest, nil
}

func (c *archiveCapture) reserve(size int64) error {
	if size > maxArchiveExpanded-c.bytes || len(c.documents)+len(c.images)+1 >= maxArchiveEntries {
		return ErrProjectArchiveLimit
	}
	c.bytes += size
	return nil
}

func (c *archiveCapture) captureRegisteredImages(ctx context.Context, tx pgx.Tx, source archiveMediaSource, ids []string) error {
	const fields = "SELECT b.id, b.mime_type, b.size_bytes, b.width, b.height FROM asset_blobs b "
	var rows pgx.Rows
	var err error
	if source.room != "" {
		rows, err = tx.Query(ctx, fields+`
			JOIN board_assets a ON a.asset_id = b.id
			WHERE a.board_id = $1 AND b.id = ANY($2::text[]) AND b.ready
		`, source.room, ids)
	} else {
		rows, err = tx.Query(ctx, fields+`
			JOIN project_version_assets a ON a.asset_id = b.id
			WHERE a.project_id = $1 AND a.digest = $2 AND b.id = ANY($3::text[]) AND b.ready
		`, source.project, source.digest, ids)
	}
	if err != nil {
		return err
	}
	metas, err := pgx.CollectRows(rows, pgx.RowToStructByPos[assets.Metadata])
	if err != nil {
		return err
	}
	if len(metas) != len(ids) {
		return assets.ErrNotFound
	}
	for _, meta := range metas {
		if err := c.addImage(meta); err != nil {
			return err
		}
	}
	return nil
}

func (c *archiveCapture) addImage(meta assets.Metadata) error {
	if prior, ok := c.images[meta.ID]; ok {
		if prior != meta {
			return assets.ErrInvalidImage
		}
		return nil
	}
	if err := c.reserve(meta.Size); err != nil {
		return err
	}
	c.images[meta.ID] = meta
	return nil
}

func (c *archiveCapture) normalizeInlineImages(doc *Document) error {
	for i, raw := range doc.Elements {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return err
		}
		if rawString(fields["type"]) != "image" || fields["assetId"] != nil || fields["src"] == nil {
			continue
		}
		src := rawString(fields["src"])
		if src == "" {
			if string(fields["src"]) != `""` {
				return errArchiveLegacyImage
			}
			continue
		}
		data, err := assets.ParseLegacyDataURI(src)
		if err != nil {
			return errArchiveLegacyImage
		}
		meta, err := assets.Inspect(data, "")
		if err != nil {
			return errArchiveLegacyImage
		}
		if err := c.addImage(meta); err != nil {
			return err
		}
		c.inline[meta.ID] = data
		fields["assetId"] = jsonString(meta.ID)
		delete(fields, "src")
		doc.Elements[i], err = json.Marshal(fields)
		if err != nil {
			return err
		}
	}
	return nil
}

func sortedArchiveKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

type archiveBuffer struct{ bytes.Buffer }

func (b *archiveBuffer) Write(p []byte) (int, error) {
	if len(p) > ProjectArchiveMaxZIP-b.Len() {
		return 0, ErrProjectArchiveLimit
	}
	return b.Buffer.Write(p)
}

func (c *archiveCapture) zip(ctx context.Context) ([]byte, error) {
	manifest, err := json.Marshal(c.manifest)
	if err != nil {
		return nil, err
	}
	if len(manifest) > maxArchiveManifest || int64(len(manifest))+c.bytes > maxArchiveExpanded {
		return nil, ErrProjectArchiveLimit
	}
	var raw archiveBuffer
	writer := zip.NewWriter(&raw)
	write := func(name string, method uint16, data []byte) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: name, Method: method})
		if err != nil {
			return err
		}
		_, err = entry.Write(data)
		return err
	}
	if err := write("project.json", zip.Deflate, manifest); err != nil {
		return nil, err
	}
	for _, digest := range sortedArchiveKeys(c.documents) {
		if err := write("documents/"+digest+".json", zip.Deflate, c.documents[digest]); err != nil {
			return nil, err
		}
	}
	for _, image := range c.manifest.Assets {
		data := c.inline[image.ID]
		if data == nil {
			data, err = assets.ReadRegistered(ctx, image)
			if err != nil {
				return nil, err
			}
		}
		if err := write("images/"+image.ID, zip.Store, data); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return raw.Bytes(), nil
}
