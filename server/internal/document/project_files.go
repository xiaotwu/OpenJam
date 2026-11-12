package document

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/model"
)

const (
	maxProjectFiles = 100
	maxProjectBytes = 32 << 20
)

var ErrProjectTooLarge = errors.New("A project snapshot supports up to 100 files and 32 MiB of document data. Move some files to another project and try again.")

type ProjectFault struct {
	Code    string
	Message string
}

func (e *ProjectFault) Error() string { return e.Message }

func projectInput(message string) error { return &ProjectFault{"PROJECT_INPUT", message} }

func staleProject() error {
	return &ProjectFault{"STALE_PROJECT", "The project changed. Review the refreshed files and try again."}
}

func projectTitle(name string) bool {
	return name != "" && utf8.RuneCountInString(name) <= 120 && !strings.ContainsRune(name, 0)
}

type projectScope struct {
	id, organization, owner uuid.UUID
	name, kind, role        string
	drafts                  bool
}

type projectScopeQuery interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func getProjectScope(ctx context.Context, tx projectScopeQuery, actor, project uuid.UUID) (projectScope, error) {
	scope := projectScope{id: project}
	err := tx.QueryRow(ctx, `
		SELECT o.id, o.owner_id, p.name, o.kind, p.is_default AND w.is_default AND o.kind = 'personal',
			coalesce(openjam_project_role(p.id, $1), '')
		FROM projects p JOIN workspaces w ON w.id = p.workspace_id
		JOIN organizations o ON o.id = w.organization_id WHERE p.id = $2
	`, actor, project).Scan(&scope.organization, &scope.owner, &scope.name, &scope.kind, &scope.drafts, &scope.role)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && scope.role == "") {
		return projectScope{}, model.ErrDirectoryNotFound
	}
	return scope, err
}

func (scope projectScope) canEdit() bool { return scope.role == "manager" || scope.role == "edit" }

// Membership changes, file creation and moves take the organization lock before
// locking rooms. The same order protects the whole file set during a project write.
func lockProjectOrganizations(ctx context.Context, tx pgx.Tx, projects []uuid.UUID, workspace *uuid.UUID) error {
	_, err := tx.Exec(ctx, `
		SELECT id FROM organizations WHERE id IN (
			SELECT w.organization_id FROM workspaces w JOIN projects p ON p.workspace_id = w.id
			WHERE p.id = ANY($1::uuid[])
		) OR id = (SELECT organization_id FROM workspaces WHERE id = $2)
		ORDER BY id FOR NO KEY UPDATE
	`, projects, workspace)
	return err
}

type projectFile struct {
	key        uuid.UUID
	room       lockedRoom
	head       Head
	archivedAt *time.Time
	digest     string
	content    Document
	size       int
}

type projectFiles map[uuid.UUID]projectFile

func (file projectFile) state() string {
	if file.archivedAt != nil {
		return "-" + file.digest
	}
	return file.digest
}

func projectKeys[T any](files map[uuid.UUID]T) []uuid.UUID {
	keys := make([]uuid.UUID, 0, len(files))
	for key := range files {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	return keys
}

func projectFingerprint(input any) string {
	// All callers pass internal scalar structs and JSON-compatible values.
	data, _ := json.Marshal(input)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (files projectFiles) token() string {
	type revision struct {
		Key         uuid.UUID
		Room, State string
		Epoch, Seq  int64
		UpdatedAt   time.Time
	}
	revisions := make([]revision, 0, len(files))
	for _, key := range projectKeys(files) {
		file := files[key]
		revisions = append(revisions, revision{key, file.room.ID, file.state(), file.head.Epoch, file.head.Seq, file.room.UpdatedAt})
	}
	return projectFingerprint(revisions)
}

func (files projectFiles) checkSize() error {
	var total int
	for _, file := range files {
		total += file.size
	}
	if len(files) > maxProjectFiles || total > maxProjectBytes {
		return ErrProjectTooLarge
	}
	return nil
}

func captureProjectFiles(ctx context.Context, tx pgx.Tx, scopes []projectScope, lock bool) (map[uuid.UUID]projectFiles, error) {
	files := make(map[uuid.UUID]projectFiles, len(scopes))
	ids := make([]uuid.UUID, 0, len(scopes))
	var drafts, draftsOwner *uuid.UUID
	for _, scope := range scopes {
		ids = append(ids, scope.id)
		files[scope.id] = make(projectFiles)
		if scope.drafts {
			drafts, draftsOwner = &scope.id, &scope.owner
		}
	}
	const inScope = `
		FROM rooms r LEFT JOIN board_directory d ON d.room_id = r.id
		WHERE (d.project_id = ANY($1::uuid[]) OR ($2::uuid IS NOT NULL AND d.room_id IS NULL AND r.owner_id = $3))
	`
	limit := len(scopes)*maxProjectFiles + 1
	var lockedIDs []string
	if lock {
		rows, err := tx.Query(ctx, "SELECT r.id "+inScope+" ORDER BY r.id LIMIT $4 FOR UPDATE OF r", ids, drafts, draftsOwner, limit)
		if err != nil {
			return nil, err
		}
		lockedIDs, err = pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return nil, err
		}
	}
	// A concurrent archive updates the directory row while holding the room
	// lock. Read that metadata after acquiring the locks, in a fresh statement.
	rows, err := tx.Query(ctx, `
		SELECT coalesce(d.project_id, $2::uuid), coalesce(d.file_key, md5('openjam-draft:' || r.id)::uuid),
			r.id, r.name, r.resource_kind, r.updated_at, d.archived_at
	`+inScope+` AND (NOT $5 OR r.id = ANY($6::varchar[])) ORDER BY r.id LIMIT $4`,
		ids, drafts, draftsOwner, limit, lock, lockedIDs)
	if err != nil {
		return nil, err
	}
	type entry struct {
		project uuid.UUID
		file    projectFile
	}
	entries, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (entry, error) {
		var e entry
		r := &e.file.room
		err := row.Scan(&e.project, &e.file.key, &r.ID, &r.Name, &r.Kind, &r.UpdatedAt, &e.file.archivedAt)
		return e, err
	})
	if err != nil {
		return nil, err
	}
	totals := make(map[uuid.UUID]int, len(scopes))
	for _, e := range entries {
		if len(files[e.project]) >= maxProjectFiles {
			return nil, ErrProjectTooLarge
		}
		file, err := captureProjectFile(ctx, tx, e.file, maxProjectBytes-totals[e.project])
		if err != nil {
			return nil, err
		}
		totals[e.project] += file.size
		files[e.project][file.key] = file
	}
	return files, nil
}

func captureProjectFile(ctx context.Context, tx pgx.Tx, file projectFile, budget int) (projectFile, error) {
	head, err := readHead(ctx, tx, file.room.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return file, err
	}
	var bytes int64
	if head.Mode == modeActive {
		err = tx.QueryRow(ctx, `
			SELECT coalesce(sum(size), 0) FROM (
				SELECT octet_length(data::text) AS size FROM board_pages WHERE board_id = $1 AND NOT deleted
				UNION ALL SELECT octet_length(data::text) FROM board_elements WHERE board_id = $1 AND NOT deleted
				UNION ALL SELECT octet_length(data::text) FROM board_stamps WHERE board_id = $1 AND NOT deleted
			) records
		`, file.room.ID).Scan(&bytes)
	} else {
		err = tx.QueryRow(ctx, "SELECT coalesce(octet_length(board_data::text), 0) FROM rooms WHERE id = $1", file.room.ID).Scan(&bytes)
	}
	if err != nil {
		return file, err
	}
	if bytes > int64(budget) {
		return file, ErrProjectTooLarge
	}
	if head.Mode == modeActive {
		snapshot, err := snapshotLocked(ctx, tx, file.room, head, "")
		if err != nil {
			return file, err
		}
		file.content = snapshot.Document
	} else {
		legacy, err := readLegacyDocument(ctx, tx, file.room)
		if err != nil {
			return file, err
		}
		// Normalize JSON object order the same way as the active document tables.
		if err := tx.QueryRow(ctx, "SELECT $1::jsonb", legacy.Document).Scan(&file.content); err != nil {
			return file, err
		}
	}
	file.head = head
	payload, digest, err := encodeDocument(file.content)
	if len(payload) > budget {
		return file, ErrProjectTooLarge
	}
	file.size, file.digest = len(payload), digest
	return file, err
}

func applyProjectFile(ctx context.Context, tx pgx.Tx, target projectScope, actor uuid.UUID, current, source projectFile, storedProject uuid.UUID) (projectFile, *VersionBoardState, error) {
	if current.room.ID != "" && current.state() == source.state() {
		return current, nil, nil
	}
	if source.digest == "" {
		if current.room.ID == "" || current.archivedAt != nil {
			return current, nil, nil
		}
		// A missing file on the other side archives this copy and preserves its
		// local history. The common base records the resulting pair of states.
		now := time.Now().UTC()
		current.archivedAt = &now
		return current, nil, writeProjectFileLocation(ctx, tx, target.id, current)
	}
	if current.room.ID != "" && current.room.Kind != source.room.Kind {
		return current, nil, fmt.Errorf("project file %s changed resource kind", source.key)
	}
	fresh := current.room.ID == ""
	if fresh {
		current.key = source.key
		current.room = lockedRoom{ID: uuid.NewString(), Kind: source.room.Kind, Name: source.content.Name}
		if err := tx.QueryRow(ctx, `
			INSERT INTO rooms (id, name, owner_id, resource_kind) VALUES ($1, $2, $3, $4) RETURNING updated_at
		`, current.room.ID, current.room.Name, target.owner, current.room.Kind).Scan(&current.room.UpdatedAt); err != nil {
			return current, nil, err
		}
	}
	var changed *VersionBoardState
	if current.digest != source.digest {
		refs, err := assets.References(source.content.Elements)
		if err != nil {
			return current, nil, err
		}
		if err := linkProjectImages(ctx, tx, current.room.ID, source, storedProject, refs); err != nil {
			return current, nil, err
		}
		snapshot, err := writeProjectDocument(ctx, tx, actor, current, source.content, fresh)
		if err != nil {
			return current, nil, err
		}
		if snapshot.Hash != source.digest {
			return current, nil, fmt.Errorf("project file %s did not match its snapshot", source.key)
		}
		state := versionBoardState(snapshot)
		changed = &state
		current.content, current.digest, current.size = snapshot.Document, snapshot.Hash, source.size
		current.room.Name, current.room.UpdatedAt = snapshot.Document.Name, snapshot.UpdatedAt
		current.head.Epoch, current.head.Seq = snapshot.Epoch, snapshot.Seq
		current.head.Mode, current.head.DefaultPageID = modeActive, snapshot.Document.DefaultPageID
	}
	current.archivedAt = source.archivedAt
	return current, changed, writeProjectFileLocation(ctx, tx, target.id, current)
}

func writeProjectFileLocation(ctx context.Context, tx pgx.Tx, project uuid.UUID, file projectFile) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO board_directory (room_id, project_id, file_key, archived_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (room_id) DO UPDATE SET archived_at = excluded.archived_at
	`, file.room.ID, project, file.key, file.archivedAt)
	return err
}

func writeProjectDocument(ctx context.Context, tx pgx.Tx, actor uuid.UUID, current projectFile, content Document, fresh bool) (Snapshot, error) {
	head := current.head
	room := current.room
	if fresh {
		head = Head{Mode: modeActive, Epoch: 1, DefaultPageID: content.DefaultPageID}
		if _, err := tx.Exec(ctx, `
			INSERT INTO board_heads (board_id, mode, epoch, default_page_id) VALUES ($1, $2, $3, $4)
		`, room.ID, head.Mode, head.Epoch, head.DefaultPageID); err != nil {
			return Snapshot{}, err
		}
		if err := materializeDocument(ctx, tx, room.ID, head.Seq, content); err != nil {
			return Snapshot{}, err
		}
	} else {
		if head.Mode != modeActive {
			active, _, err := activateLocked(ctx, tx, room, head, "")
			if err != nil {
				return Snapshot{}, err
			}
			head.Mode, head.Epoch, head.Seq = modeActive, active.Epoch, active.Seq
		} else {
			before := Snapshot{BoardID: room.ID, Epoch: head.Epoch, Seq: head.Seq, Document: current.content}
			if _, err := storeVersion(ctx, tx, before, versionMarker{kind: versionNamed, name: "Before project update", actor: &actor}); err != nil {
				return Snapshot{}, err
			}
		}
		if head.Epoch >= maxSafeSequence || head.Seq >= maxSafeSequence {
			return Snapshot{}, projectInput("A file reached its version limit.")
		}
		head.Epoch++
		head.Seq++
		head.FloorSeq, head.DefaultPageID = head.Seq, content.DefaultPageID
	}
	var saved Snapshot
	var err error
	if fresh {
		saved, err = snapshotLocked(ctx, tx, room, head, "")
	} else {
		saved, err = replaceDocument(ctx, tx, room, head, content)
	}
	if err != nil {
		return Snapshot{}, err
	}
	_, err = storeVersion(ctx, tx, saved, versionMarker{kind: versionNamed, name: "Project update", actor: &actor})
	return saved, err
}

func linkProjectImages(ctx context.Context, tx pgx.Tx, targetID string, source projectFile, storedProject uuid.UUID, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if source.room.ID != "" {
		return assets.CopyLinks(ctx, tx, source.room.ID, targetID, ids)
	}
	rows, err := tx.Query(ctx, `
		SELECT b.id, b.mime_type, b.size_bytes, b.width, b.height FROM project_version_assets a
		JOIN asset_blobs b ON b.id = a.asset_id AND b.ready
		WHERE a.project_id = $1 AND a.digest = $2 AND a.asset_id = ANY($3::text[])
	`, storedProject, source.digest, ids)
	if err != nil {
		return err
	}
	media, err := pgx.CollectRows(rows, pgx.RowToStructByPos[assets.Metadata])
	if err != nil {
		return err
	}
	if len(media) != len(ids) {
		return assets.ErrNotFound
	}
	return assets.Grant(ctx, tx, targetID, media)
}
