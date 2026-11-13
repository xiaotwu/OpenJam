package document

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xiaotwu/shiori/server/internal/assets"
	"github.com/xiaotwu/shiori/server/internal/db"
	"github.com/xiaotwu/shiori/server/internal/model"
)

type ProjectArchiveMapping struct {
	SourceUserID uuid.UUID `json:"sourceUserId"`
	TargetUserID uuid.UUID `json:"targetUserId"`
	Role         string    `json:"role"`
}

type ProjectArchiveRestore struct {
	RequestID uuid.UUID               `json:"requestId"`
	Name      string                  `json:"name,omitempty"`
	Mappings  []ProjectArchiveMapping `json:"mappings,omitempty"`
}

func ArchiveRestoreAllowed(ctx context.Context, actor, workspace uuid.UUID) error {
	_, err := archiveDestination(ctx, db.Pool(), actor, workspace)
	return err
}

func archiveDestination(ctx context.Context, query projectScopeQuery, actor, workspace uuid.UUID) (projectScope, error) {
	scope := projectScope{role: "manager"}
	err := query.QueryRow(ctx, `
		SELECT o.id, o.owner_id, o.kind FROM workspaces w
		JOIN organizations o ON o.id = w.organization_id
		WHERE w.id = $1 AND (o.owner_id = $2 OR openjam_team_role(o.id, $2) IS NOT NULL)
	`, workspace, actor).Scan(&scope.organization, &scope.owner, &scope.kind)
	if errors.Is(err, pgx.ErrNoRows) {
		err = model.ErrDirectoryNotFound
	}
	return scope, err
}

func RestoreProjectArchive(ctx context.Context, actor, workspace uuid.UUID, raw []byte, input ProjectArchiveRestore) (model.Project, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.RequestID == uuid.Nil || (input.Name != "" && !projectTitle(input.Name)) || len(input.Mappings) > maxArchiveMembers {
		return model.Project{}, projectInput("Provide a restore request ID and a project name of up to 120 characters.")
	}
	scope, err := archiveDestination(ctx, db.Pool(), actor, workspace)
	if err != nil {
		return model.Project{}, err
	}
	slices.SortFunc(input.Mappings, func(a, b ProjectArchiveMapping) int { return slices.Compare(a.SourceUserID[:], b.SourceUserID[:]) })
	fingerprint := projectFingerprint(struct {
		Package string
		Options ProjectArchiveRestore
	}{archiveDigest(raw), input})
	readReceipt := func(q projectScopeQuery) (model.Project, bool, error) {
		return archiveRestoreReceipt(ctx, q, workspace, actor, input.RequestID, fingerprint)
	}
	if result, found, err := readReceipt(db.Pool()); found || err != nil {
		return result, err
	}
	bundle, err := readProjectArchive(raw)
	if err != nil {
		return model.Project{}, err
	}
	if err := checkArchiveMappings(ctx, db.Pool(), scope, actor, bundle.manifest.Members, input.Mappings); err != nil {
		return model.Project{}, err
	}

	origin, err := parseArchiveOrigin(bundle.manifest.Origin)
	if err != nil {
		return model.Project{}, err
	}
	targets := make(map[string]archiveLinkTarget, len(bundle.manifest.Files))
	for _, file := range bundle.manifest.Files {
		targets[file.RoomID] = archiveLinkTarget{file.Kind, uuid.NewString()}
	}
	kinds, err := validateArchiveManifest(bundle.manifest)
	if err != nil {
		return model.Project{}, err
	}
	var expanded int
	for digest, doc := range bundle.documents {
		if err := ctx.Err(); err != nil {
			return model.Project{}, err
		}
		rewritten, err := rewriteArchiveDocument(kinds[digest], doc.Document, origin, targets)
		if err != nil {
			return model.Project{}, err
		}
		if err := validateArchiveDocument(kinds[digest], rewritten); err != nil {
			return model.Project{}, err
		}
		data, _, err := encodeDocument(rewritten)
		if err != nil {
			return model.Project{}, err
		}
		expanded += len(data)
		if len(data) > PortableDocumentLimit || expanded > maxArchiveExpanded {
			return model.Project{}, ErrProjectArchiveLimit
		}
		bundle.documents[digest] = archiveDocument{rewritten, doc.Assets}
	}
	// Objects staged before a failed or revoked restore remain private and
	// unlinked; the bounded staging sweep can reclaim them.
	for _, meta := range bundle.manifest.Assets {
		if err := assets.Stage(ctx, meta, bundle.images[meta.ID]); err != nil {
			return model.Project{}, err
		}
		delete(bundle.images, meta.ID)
	}

	name := input.Name
	if name == "" {
		name = bundle.manifest.Name
	}
	result := model.Project{ID: uuid.New(), WorkspaceID: workspace, Name: name, Role: "manager"}
	err = pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockProjectOrganizations(ctx, tx, nil, &workspace); err != nil {
			return err
		}
		scope, err := archiveDestination(ctx, tx, actor, workspace)
		if err != nil {
			return err
		}
		if prior, found, err := readReceipt(tx); found || err != nil {
			result = prior
			return err
		}
		if err := checkArchiveMappings(ctx, tx, scope, actor, bundle.manifest.Members, input.Mappings); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)`,
			result.ID, workspace, result.Name); err != nil {
			return err
		}
		if scope.owner != actor {
			if err := writeArchiveGrant(ctx, tx, result.ID, actor, "manager"); err != nil {
				return err
			}
		}
		for _, mapping := range input.Mappings {
			if err := writeArchiveGrant(ctx, tx, result.ID, mapping.TargetUserID, mapping.Role); err != nil {
				return err
			}
		}
		if err := writeArchiveContent(ctx, tx, result.ID, scope.owner, bundle, targets); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO project_archive_restores (workspace_id, actor_id, request_id, project_id, fingerprint)
			VALUES ($1, $2, $3, $4, $5)
		`, workspace, actor, input.RequestID, result.ID, fingerprint)
		return err
	})
	return result, err
}

func archiveRestoreReceipt(ctx context.Context, query projectScopeQuery, workspace, actor, request uuid.UUID, fingerprint string) (model.Project, bool, error) {
	var result model.Project
	var prior string
	var manager bool
	err := query.QueryRow(ctx, `
		SELECT p.id, p.workspace_id, p.name, p.is_default, r.fingerprint,
			coalesce(openjam_project_role(p.id, $2) = 'manager', false)
		FROM project_archive_restores r JOIN projects p ON p.id = r.project_id
		WHERE r.workspace_id = $1 AND r.actor_id = $2 AND r.request_id = $3
			AND p.workspace_id = $1
	`, workspace, actor, request).Scan(&result.ID, &result.WorkspaceID, &result.Name, &result.IsDefault, &prior, &manager)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Project{}, false, nil
	}
	if err != nil {
		return model.Project{}, false, err
	}
	if !manager {
		return model.Project{}, false, model.ErrDirectoryNotFound
	}
	if prior != fingerprint {
		return model.Project{}, false, &ProjectFault{"PROJECT_ARCHIVE_REQUEST_REUSED", "This restore request already used a different package or mapping."}
	}
	result.Role = "manager"
	return result, true, nil
}

func checkArchiveMappings(ctx context.Context, query projectScopeQuery, scope projectScope, actor uuid.UUID, members []archiveMember, mappings []ProjectArchiveMapping) error {
	if len(mappings) == 0 {
		return nil
	}
	if scope.kind != "team" {
		return projectInput("Member mappings are only available for a Team restore.")
	}
	sources := make(map[uuid.UUID]bool, len(members))
	for _, member := range members {
		sources[member.ID] = true
	}
	targets := make(map[uuid.UUID]bool, len(mappings))
	targetIDs := make([]uuid.UUID, 0, len(mappings))
	for _, mapping := range mappings {
		if !sources[mapping.SourceUserID] || mapping.TargetUserID == uuid.Nil || targets[mapping.TargetUserID] ||
			mapping.TargetUserID == actor || mapping.TargetUserID == scope.owner || !archiveRole(mapping.Role) {
			return projectInput("Map each source member to a different existing Team member and choose a valid project role.")
		}
		delete(sources, mapping.SourceUserID)
		targets[mapping.TargetUserID] = true
		targetIDs = append(targetIDs, mapping.TargetUserID)
	}
	var active int
	if err := query.QueryRow(ctx, `
		SELECT count(*) FROM team_members WHERE organization_id = $1 AND user_id = ANY($2::uuid[]) AND revoked_at IS NULL
	`, scope.organization, targetIDs).Scan(&active); err != nil {
		return err
	}
	if active != len(targetIDs) {
		return &ProjectFault{"PROJECT_ARCHIVE_MEMBERS_CHANGED", "A mapped person is no longer a member of the destination Team. Review the mapping."}
	}
	return nil
}

func writeArchiveGrant(ctx context.Context, tx pgx.Tx, project, member uuid.UUID, role string) error {
	_, err := tx.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)`, project, member, role)
	return err
}

func writeArchiveContent(ctx context.Context, tx pgx.Tx, project, owner uuid.UUID, bundle projectArchive, targets map[string]archiveLinkTarget) error {
	media := make(map[string]assets.Metadata, len(bundle.manifest.Assets))
	for _, meta := range bundle.manifest.Assets {
		media[meta.ID] = meta
	}
	// Hash canonical JSONB documents exactly as the live version reader does.
	canonical := make(map[string]string, len(bundle.documents))
	for _, digest := range sortedArchiveKeys(bundle.documents) {
		doc := bundle.documents[digest]
		if err := tx.QueryRow(ctx, "SELECT $1::jsonb", doc.Document).Scan(&doc.Document); err != nil {
			return err
		}
		_, hash, err := encodeDocument(doc.Document)
		if err != nil {
			return err
		}
		bundle.documents[digest], canonical[digest] = doc, hash
	}
	for _, file := range bundle.manifest.Files {
		if err := restoreArchiveFile(ctx, tx, project, owner, file, targets[file.RoomID].id, bundle.documents, canonical, media); err != nil {
			return err
		}
	}
	pinned := make(map[string]bool)
	for _, version := range bundle.manifest.Versions {
		if err := restoreArchiveProjectVersion(ctx, tx, project, version, bundle.documents, canonical, pinned); err != nil {
			return err
		}
	}
	return nil
}

func restoreArchiveFile(ctx context.Context, tx pgx.Tx, project, owner uuid.UUID, file archiveFile, room string,
	documents map[string]archiveDocument, canonical map[string]string, media map[string]assets.Metadata) error {
	live := documents[file.Digest]
	if _, err := tx.Exec(ctx, `INSERT INTO rooms (id, name, owner_id, resource_kind) VALUES ($1, $2, $3, $4)`,
		room, live.Document.Name, owner, file.Kind); err != nil {
		return err
	}
	epoch, seq := file.Epoch, file.Seq
	versions := make(map[uuid.UUID]uuid.UUID, len(file.Versions))
	images := make(map[string]assets.Metadata)
	addImages := func(doc archiveDocument) {
		for _, id := range doc.Assets {
			images[id] = media[id]
		}
	}
	addImages(live)
	for _, v := range file.Versions {
		epoch, seq = max(epoch, v.Epoch), max(seq, v.Seq)
		versions[v.ID] = uuid.New()
		addImages(documents[v.Hash])
	}
	// Keep imported historical positions and give the editable head a fresh
	// epoch. All positions at or below the head sequence require a full snapshot.
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_heads (board_id, mode, epoch, head_seq, floor_seq, default_page_id)
		VALUES ($1, 'active', $2, $3, $3, $4)
	`, room, epoch+1, seq, live.Document.DefaultPageID); err != nil {
		return err
	}
	metas := make([]assets.Metadata, 0, len(images))
	for _, id := range sortedArchiveKeys(images) {
		metas = append(metas, images[id])
	}
	if err := assets.Grant(ctx, tx, room, metas); err != nil {
		return err
	}
	if err := materializeDocument(ctx, tx, room, seq, live.Document); err != nil {
		return err
	}
	if err := writeProjectFileLocation(ctx, tx, project, projectFile{key: file.FileKey, room: lockedRoom{ID: room}, archivedAt: file.ArchivedAt}); err != nil {
		return err
	}
	for _, v := range file.Versions {
		hash := canonical[v.Hash]
		reason := "project_archive:" + hash
		if _, err := tx.Exec(ctx, `
			INSERT INTO board_snapshots (board_id, epoch, seq, reason, document, digest, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING
		`, room, v.Epoch, v.Seq, reason, documents[v.Hash].Document, hash, v.CreatedAt); err != nil {
			return err
		}
		var prior *uuid.UUID
		if v.SourceVersionID != nil {
			if id, exists := versions[*v.SourceVersionID]; exists {
				prior = &id
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO board_versions (id, board_id, epoch, seq, snapshot_reason, kind, name,
				created_at, imported_author, imported_participants, source_version_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::text[], '{}'), $11)
		`, versions[v.ID], room, v.Epoch, v.Seq, reason, v.Kind, v.Name, v.CreatedAt, v.Author, v.Participants, prior); err != nil {
			return err
		}
	}
	return nil
}

func restoreArchiveProjectVersion(ctx context.Context, tx pgx.Tx, project uuid.UUID, version archiveProjectVersion,
	documents map[string]archiveDocument, canonical map[string]string, pinned map[string]bool) error {
	id := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO project_versions (id, project_id, name, kind, created_at, imported_author)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, project, version.Name, version.Kind, version.CreatedAt, version.Author); err != nil {
		return err
	}
	for _, file := range version.Files {
		doc, hash := documents[file.Digest], canonical[file.Digest]
		if !pinned[hash] {
			if _, err := tx.Exec(ctx, `
				INSERT INTO project_version_documents (project_id, digest, document) VALUES ($1, $2, $3)
			`, project, hash, doc.Document); err != nil {
				return err
			}
			if len(doc.Assets) > 0 {
				tag, err := tx.Exec(ctx, `
					INSERT INTO project_version_assets (project_id, digest, asset_id)
					SELECT $1, $2, id FROM asset_blobs WHERE id = ANY($3::text[]) AND ready ORDER BY id FOR KEY SHARE
				`, project, hash, doc.Assets)
				if err != nil {
					return err
				}
				if tag.RowsAffected() != int64(len(doc.Assets)) {
					return fmt.Errorf("%w: a snapshot image is no longer available", assets.ErrNotFound)
				}
			}
			pinned[hash] = true
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_version_files (version_id, project_id, file_key, resource_kind, digest, archived_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, id, project, file.FileKey, file.Kind, hash, file.ArchivedAt); err != nil {
			return err
		}
	}
	return nil
}
