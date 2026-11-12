package document

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/model"
)

type ProjectVersion struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Author    string    `json:"author,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	Files     int       `json:"files"`
}

type ProjectVersionList struct {
	Versions []ProjectVersion `json:"versions"`
	Next     *uuid.UUID       `json:"next,omitempty"`
}

type ProjectVersionRequest struct {
	RequestID uuid.UUID `json:"requestId"`
	Name      string    `json:"name"`
}

type ProjectRestoreRequest struct {
	RequestID uuid.UUID `json:"requestId"`
	Token     string    `json:"token"`
}

type ProjectRestoreChange struct {
	Key    uuid.UUID `json:"key"`
	Name   string    `json:"name"`
	Kind   string    `json:"kind"`
	Action string    `json:"action"`
}

type ProjectRestorePreview struct {
	Token   string                 `json:"token"`
	Changes []ProjectRestoreChange `json:"changes"`
}

func saveProjectVersion(ctx context.Context, tx pgx.Tx, project, actor uuid.UUID, name, kind string, files projectFiles) (uuid.UUID, error) {
	if err := files.checkSize(); err != nil {
		return uuid.Nil, err
	}
	version := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO project_versions (id, project_id, actor_id, name, kind) VALUES ($1, $2, $3, $4, $5)
	`, version, project, actor, name, kind); err != nil {
		return uuid.Nil, err
	}
	for _, key := range projectKeys(files) {
		file := files[key]
		if err := pinProjectVersionDocument(ctx, tx, project, file); err != nil {
			return uuid.Nil, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_version_files (version_id, project_id, file_key, resource_kind, digest, archived_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, version, project, key, file.room.Kind, file.digest, file.archivedAt); err != nil {
			return uuid.Nil, err
		}
	}
	return version, nil
}

func pinProjectVersionDocument(ctx context.Context, tx pgx.Tx, project uuid.UUID, file projectFile) error {
	tag, err := tx.Exec(ctx, `
		INSERT INTO project_version_documents (project_id, digest, document) VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, project, file.digest, file.content)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	ids, err := assets.References(file.content.Elements)
	if err != nil || len(ids) == 0 {
		return err
	}
	tag, err = tx.Exec(ctx, `
		INSERT INTO project_version_assets (project_id, digest, asset_id)
		SELECT $1, $2, a.asset_id FROM board_assets a JOIN asset_blobs b ON b.id = a.asset_id AND b.ready
		WHERE a.board_id = $3 AND a.asset_id = ANY($4::text[])
	`, project, file.digest, file.room.ID, ids)
	if err == nil && tag.RowsAffected() != int64(len(ids)) {
		return assets.ErrNotFound
	}
	return err
}

func ListProjectVersions(ctx context.Context, actor, project uuid.UUID, before *uuid.UUID) (ProjectVersionList, error) {
	const pageSize = 25
	result := ProjectVersionList{Versions: []ProjectVersion{}}
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		scope, err := getProjectScope(ctx, tx, actor, project)
		if err != nil {
			return err
		}
		if !scope.canEdit() {
			return model.ErrDirectoryForbidden
		}
		rows, err := tx.Query(ctx, `
			SELECT v.id, v.name, v.kind, coalesce(u.display_name, v.imported_author), v.created_at,
				(SELECT count(*) FROM project_version_files f WHERE f.version_id = v.id)
			FROM project_versions v LEFT JOIN users u ON u.id = v.actor_id
			WHERE v.project_id = $1 AND ($2::uuid IS NULL OR (v.created_at, v.id) < (
				SELECT created_at, id FROM project_versions WHERE id = $2 AND project_id = $1
			))
			ORDER BY v.created_at DESC, v.id DESC LIMIT $3
		`, project, before, pageSize+1)
		if err != nil {
			return err
		}
		result.Versions, err = pgx.AppendRows(result.Versions, rows, pgx.RowToStructByPos[ProjectVersion])
		if len(result.Versions) > pageSize {
			result.Versions = result.Versions[:pageSize]
			result.Next = &result.Versions[pageSize-1].ID
		}
		return err
	})
	return result, err
}

func NameProjectVersion(ctx context.Context, actor, project uuid.UUID, input ProjectVersionRequest) (ProjectAction, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.RequestID == uuid.Nil || !projectTitle(input.Name) {
		return ProjectAction{}, projectInput("Enter a snapshot name of up to 120 characters.")
	}
	fingerprint := projectFingerprint(struct {
		Action string
		Input  ProjectVersionRequest
	}{"snapshot", input})
	var result ProjectAction
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockProjectOrganizations(ctx, tx, []uuid.UUID{project}, nil); err != nil {
			return err
		}
		scope, err := getProjectScope(ctx, tx, actor, project)
		if err != nil {
			return err
		}
		if !scope.canEdit() {
			return model.ErrDirectoryForbidden
		}
		receipt, found, err := projectReceipt(ctx, tx, project, actor, input.RequestID, fingerprint)
		if err != nil || found {
			result = receipt
			return err
		}
		files, err := captureProjectFiles(ctx, tx, []projectScope{scope}, true)
		if err != nil {
			return err
		}
		id, err := saveProjectVersion(ctx, tx, project, actor, input.Name, "named", files[project])
		if err != nil {
			return err
		}
		result = ProjectAction{ProjectID: project, VersionID: &id, Files: len(files[project])}
		return recordProjectReceipt(ctx, tx, project, actor, input.RequestID, fingerprint, result)
	})
	return result, err
}

func readProjectVersionFiles(ctx context.Context, tx pgx.Tx, project, version uuid.UUID) (projectFiles, error) {
	var exists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM project_versions WHERE id = $1 AND project_id = $2)", version, project).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, model.ErrDirectoryNotFound
	}
	rows, err := tx.Query(ctx, `
		SELECT f.file_key, f.resource_kind, f.digest, f.archived_at, d.document, octet_length(d.document::text)
		FROM project_version_files f JOIN project_version_documents d ON d.project_id = f.project_id AND d.digest = f.digest
		WHERE f.version_id = $1 AND f.project_id = $2
	`, version, project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	files := make(projectFiles)
	for rows.Next() {
		var file projectFile
		if err := rows.Scan(&file.key, &file.room.Kind, &file.digest, &file.archivedAt, &file.content, &file.size); err != nil {
			return nil, err
		}
		files[file.key] = file
	}
	return files, rows.Err()
}

func projectRestoreChanges(current, saved projectFiles) []ProjectRestoreChange {
	changes := []ProjectRestoreChange{}
	for _, key := range projectKeys(saved) {
		file, live := saved[key], current[key]
		if file.state() == live.state() {
			continue
		}
		action := "restore"
		if live.room.ID == "" {
			action = "recreate"
		}
		changes = append(changes, ProjectRestoreChange{key, file.content.Name, file.room.Kind, action})
	}
	for _, key := range projectKeys(current) {
		file := current[key]
		if _, present := saved[key]; !present && file.archivedAt == nil {
			changes = append(changes, ProjectRestoreChange{key, file.content.Name, file.room.Kind, "archive"})
		}
	}
	return changes
}

func PreviewProjectRestore(ctx context.Context, actor, project, version uuid.UUID) (ProjectRestorePreview, error) {
	var result ProjectRestorePreview
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		scope, err := getProjectScope(ctx, tx, actor, project)
		if err != nil {
			return err
		}
		if scope.role != "manager" {
			return model.ErrDirectoryForbidden
		}
		saved, err := readProjectVersionFiles(ctx, tx, project, version)
		if err != nil {
			return err
		}
		files, err := captureProjectFiles(ctx, tx, []projectScope{scope}, false)
		if err != nil {
			return err
		}
		current := files[project]
		result = ProjectRestorePreview{current.token(), projectRestoreChanges(current, saved)}
		return nil
	})
	return result, err
}

func RestoreProjectVersion(ctx context.Context, actor, project, version uuid.UUID, input ProjectRestoreRequest) (ProjectAction, error) {
	if input.RequestID == uuid.Nil || len(input.Token) != 64 {
		return ProjectAction{}, projectInput("Review the files before restoring this snapshot.")
	}
	fingerprint := projectFingerprint(struct {
		Action  string
		Version uuid.UUID
		Input   ProjectRestoreRequest
	}{"restore", version, input})
	result := ProjectAction{ProjectID: project}
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockProjectOrganizations(ctx, tx, []uuid.UUID{project}, nil); err != nil {
			return err
		}
		scope, err := getProjectScope(ctx, tx, actor, project)
		if err != nil {
			return err
		}
		if scope.role != "manager" {
			return model.ErrDirectoryForbidden
		}
		receipt, found, err := projectReceipt(ctx, tx, project, actor, input.RequestID, fingerprint)
		if err != nil || found {
			result = receipt
			return err
		}
		saved, err := readProjectVersionFiles(ctx, tx, project, version)
		if err != nil {
			return err
		}
		files, err := captureProjectFiles(ctx, tx, []projectScope{scope}, true)
		if err != nil {
			return err
		}
		current := files[project]
		if current.token() != input.Token {
			return staleProject()
		}
		changes := projectRestoreChanges(current, saved)
		if len(changes) != 0 {
			if _, err := saveProjectVersion(ctx, tx, project, actor, "Before restore", "before_restore", current); err != nil {
				return err
			}
			for _, change := range changes {
				file, state, err := applyProjectFile(ctx, tx, scope, actor, current[change.Key], saved[change.Key], project)
				if err != nil {
					return err
				}
				current[change.Key] = file
				if state != nil {
					result.Updates = append(result.Updates, *state)
				}
			}
			id, err := saveProjectVersion(ctx, tx, project, actor, "Restored project", "restored", current)
			if err != nil {
				return err
			}
			result.Files, result.VersionID = len(changes), &id
		}
		return recordProjectReceipt(ctx, tx, project, actor, input.RequestID, fingerprint, result)
	})
	return result, err
}
