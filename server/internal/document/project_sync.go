package document

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/model"
)

type ProjectImport struct {
	RequestID   uuid.UUID `json:"requestId"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	Name        string    `json:"name"`
	Mode        string    `json:"mode"`
}

type ProjectLink struct {
	ProjectID        uuid.UUID `json:"projectId"`
	ProjectName      string    `json:"projectName"`
	OrganizationName string    `json:"organizationName"`
}

type ProjectFileSummary struct {
	ID       string `json:"id,omitempty"`
	Name     string `json:"name"`
	Archived bool   `json:"archived"`
}

type ProjectDifference struct {
	Key     uuid.UUID           `json:"key"`
	Kind    string              `json:"kind"`
	State   string              `json:"state"`
	Current *ProjectFileSummary `json:"current,omitempty"`
	Linked  *ProjectFileSummary `json:"linked,omitempty"`
}

type ProjectSyncPreview struct {
	Token   string              `json:"token"`
	Changes []ProjectDifference `json:"changes"`
}

type ProjectSyncRequest struct {
	RequestID uuid.UUID   `json:"requestId"`
	Token     string      `json:"token"`
	Direction string      `json:"direction"`
	Name      string      `json:"name,omitempty"`
	Resolve   []uuid.UUID `json:"resolve,omitempty"`
}

type ProjectAction struct {
	ProjectID      uuid.UUID           `json:"projectId"`
	OrganizationID *uuid.UUID          `json:"organizationId,omitempty"`
	VersionID      *uuid.UUID          `json:"versionId,omitempty"`
	Files          int                 `json:"files"`
	Updates        []VersionBoardState `json:"-"`
}

func projectReceipt(ctx context.Context, tx pgx.Tx, project, actor, request uuid.UUID, fingerprint string) (ProjectAction, bool, error) {
	var result ProjectAction
	var savedActor uuid.UUID
	var savedFingerprint string
	err := tx.QueryRow(ctx, `
		SELECT actor_id, fingerprint, result FROM project_operation_receipts WHERE project_id = $1 AND request_id = $2
	`, project, request).Scan(&savedActor, &savedFingerprint, &result)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProjectAction{}, false, nil
	}
	if err != nil {
		return ProjectAction{}, false, err
	}
	if savedActor != actor || savedFingerprint != fingerprint {
		return ProjectAction{}, false, &ProjectFault{"PROJECT_REQUEST_CONFLICT", "That request ID was used for a different project operation."}
	}
	return result, true, nil
}

func recordProjectReceipt(ctx context.Context, tx pgx.Tx, project, actor, request uuid.UUID, fingerprint string, result ProjectAction) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO project_operation_receipts (project_id, request_id, actor_id, fingerprint, result)
		VALUES ($1, $2, $3, $4, $5)
	`, project, request, actor, fingerprint, result)
	return err
}

func ImportProject(ctx context.Context, actor, sourceID uuid.UUID, input ProjectImport) (ProjectAction, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.RequestID == uuid.Nil || input.WorkspaceID == uuid.Nil ||
		!projectTitle(input.Name) || (input.Mode != "linked" && input.Mode != "independent") {
		return ProjectAction{}, projectInput("Choose a team workspace, a project name, and an import mode.")
	}
	fingerprint := projectFingerprint(struct {
		Action string
		Input  ProjectImport
	}{"import", input})
	var result ProjectAction
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockProjectOrganizations(ctx, tx, []uuid.UUID{sourceID}, &input.WorkspaceID); err != nil {
			return err
		}
		source, err := getProjectScope(ctx, tx, actor, sourceID)
		if err != nil {
			return err
		}
		if source.kind != "personal" || source.owner != actor {
			return model.ErrDirectoryForbidden
		}
		target := projectScope{id: uuid.New(), kind: "team", role: "manager", name: input.Name}
		err = tx.QueryRow(ctx, `
			SELECT o.id, o.owner_id FROM workspaces w JOIN organizations o ON o.id = w.organization_id
			WHERE w.id = $1 AND o.kind = 'team' AND openjam_team_role(o.id, $2) IS NOT NULL
		`, input.WorkspaceID, actor).Scan(&target.organization, &target.owner)
		if errors.Is(err, pgx.ErrNoRows) {
			return model.ErrDirectoryNotFound
		}
		if err != nil {
			return err
		}
		receipt, found, err := projectReceipt(ctx, tx, sourceID, actor, input.RequestID, fingerprint)
		if err != nil {
			return err
		}
		if found {
			if _, err := getProjectScope(ctx, tx, actor, receipt.ProjectID); err != nil {
				return err
			}
			result = receipt
			return nil
		}
		captured, err := captureProjectFiles(ctx, tx, []projectScope{source}, true)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)",
			target.id, input.WorkspaceID, target.name); err != nil {
			return err
		}
		if target.owner != actor {
			if _, err := tx.Exec(ctx, "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'manager')", target.id, actor); err != nil {
				return err
			}
		}
		if input.Mode == "linked" {
			if _, err := tx.Exec(ctx, "INSERT INTO project_sync_links (team_project_id, personal_project_id) VALUES ($1, $2)", target.id, source.id); err != nil {
				return err
			}
		}
		copies := make(projectFiles, len(captured[source.id]))
		for _, key := range projectKeys(captured[source.id]) {
			file := captured[source.id][key]
			copy, _, err := applyProjectFile(ctx, tx, target, actor, projectFile{}, file, uuid.Nil)
			if err != nil {
				return err
			}
			copies[key] = copy
			if input.Mode == "linked" {
				if err := writeSyncBase(ctx, tx, target.id, key, syncBase{file.state(), copy.state()}); err != nil {
					return err
				}
			}
		}
		version, err := saveProjectVersion(ctx, tx, target.id, actor, "Imported project", "imported", copies)
		if err != nil {
			return err
		}
		result = ProjectAction{ProjectID: target.id, OrganizationID: &target.organization, VersionID: &version, Files: len(copies)}
		return recordProjectReceipt(ctx, tx, sourceID, actor, input.RequestID, fingerprint, result)
	})
	return result, err
}

func ListProjectLinks(ctx context.Context, actor, project uuid.UUID) ([]ProjectLink, error) {
	links := []ProjectLink{}
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		scope, err := getProjectScope(ctx, tx, actor, project)
		if err != nil || scope.role != "manager" {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT p.id, p.name, o.name FROM project_sync_links l
			JOIN projects p ON p.id = CASE WHEN l.personal_project_id = $1 THEN l.team_project_id ELSE l.personal_project_id END
			JOIN workspaces w ON w.id = p.workspace_id JOIN organizations o ON o.id = w.organization_id
			WHERE $1 IN (l.personal_project_id, l.team_project_id) AND openjam_project_role(p.id, $2) = 'manager'
			ORDER BY lower(o.name), lower(p.name), p.id
		`, project, actor)
		if err != nil {
			return err
		}
		links, err = pgx.AppendRows(links, rows, pgx.RowToStructByPos[ProjectLink])
		return err
	})
	return links, err
}

type syncBase struct{ Personal, Team string }

func writeSyncBase(ctx context.Context, tx pgx.Tx, team, key uuid.UUID, base syncBase) error {
	if base.Personal == "" && base.Team == "" {
		_, err := tx.Exec(ctx, "DELETE FROM project_sync_base WHERE team_project_id = $1 AND file_key = $2", team, key)
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO project_sync_base (team_project_id, file_key, personal_state, team_state)
		VALUES ($1, $2, $3, $4) ON CONFLICT (team_project_id, file_key) DO UPDATE
		SET personal_state = excluded.personal_state, team_state = excluded.team_state
	`, team, key, base.Personal, base.Team)
	return err
}

type projectSyncState struct {
	current, linked           projectScope
	currentFiles, linkedFiles projectFiles
	team                      uuid.UUID
	base                      map[uuid.UUID]syncBase
}

func readProjectPair(ctx context.Context, tx pgx.Tx, actor, project, peer uuid.UUID) (projectSyncState, error) {
	var pair projectSyncState
	var err error
	pair.current, err = getProjectScope(ctx, tx, actor, project)
	if err != nil {
		return pair, err
	}
	pair.linked, err = getProjectScope(ctx, tx, actor, peer)
	if err != nil {
		return pair, err
	}
	if pair.current.role != "manager" || pair.linked.role != "manager" {
		return pair, model.ErrDirectoryNotFound
	}
	team, personal := pair.current.id, pair.linked.id
	if pair.current.kind == "personal" {
		team, personal = personal, team
	}
	err = tx.QueryRow(ctx, `
		SELECT team_project_id FROM project_sync_links WHERE team_project_id = $1 AND personal_project_id = $2
	`, team, personal).Scan(&pair.team)
	if errors.Is(err, pgx.ErrNoRows) {
		return pair, model.ErrDirectoryNotFound
	}
	return pair, err
}

func (pair *projectSyncState) capture(ctx context.Context, tx pgx.Tx, lock bool) error {
	files, err := captureProjectFiles(ctx, tx, []projectScope{pair.current, pair.linked}, lock)
	if err != nil {
		return err
	}
	pair.currentFiles, pair.linkedFiles = files[pair.current.id], files[pair.linked.id]
	pair.base = make(map[uuid.UUID]syncBase)
	rows, err := tx.Query(ctx, "SELECT file_key, personal_state, team_state FROM project_sync_base WHERE team_project_id = $1", pair.team)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var key uuid.UUID
		var base syncBase
		if err := rows.Scan(&key, &base.Personal, &base.Team); err != nil {
			return err
		}
		pair.base[key] = base
	}
	return rows.Err()
}

func (pair projectSyncState) oriented(current, linked string) syncBase {
	if pair.current.id == pair.team {
		return syncBase{linked, current}
	}
	return syncBase{current, linked}
}

func projectFileSummary(file projectFile) *ProjectFileSummary {
	if file.digest == "" {
		return nil
	}
	return &ProjectFileSummary{file.room.ID, file.content.Name, file.archivedAt != nil}
}

func (pair projectSyncState) preview() ProjectSyncPreview {
	keys := make(map[uuid.UUID]bool, len(pair.currentFiles)+len(pair.linkedFiles))
	for key := range pair.currentFiles {
		keys[key] = true
	}
	for key := range pair.linkedFiles {
		keys[key] = true
	}
	preview := ProjectSyncPreview{Changes: []ProjectDifference{}, Token: projectFingerprint(struct {
		Current, Linked string
		Base            map[uuid.UUID]syncBase
	}{pair.currentFiles.token(), pair.linkedFiles.token(), pair.base})}
	for _, key := range projectKeys(keys) {
		current, linked := pair.currentFiles[key], pair.linkedFiles[key]
		if current.state() == linked.state() {
			continue
		}
		saved, live := pair.base[key], pair.oriented(current.state(), linked.state())
		currentChanged, linkedChanged := saved.Personal != live.Personal, saved.Team != live.Team
		if pair.current.id == pair.team {
			currentChanged, linkedChanged = linkedChanged, currentChanged
		}
		kind := current.room.Kind
		if kind == "" {
			kind = linked.room.Kind
		}
		var state string
		switch {
		case currentChanged && linkedChanged:
			state = "conflict"
		case currentChanged:
			state = "outgoing"
		case linkedChanged:
			state = "incoming"
		default:
			continue
		}
		preview.Changes = append(preview.Changes, ProjectDifference{key, kind, state, projectFileSummary(current), projectFileSummary(linked)})
	}
	return preview
}

func PreviewProjectSync(ctx context.Context, actor, project, peer uuid.UUID) (ProjectSyncPreview, error) {
	var preview ProjectSyncPreview
	err := pgx.BeginTxFunc(ctx, db.Pool(), pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		pair, err := readProjectPair(ctx, tx, actor, project, peer)
		if err != nil {
			return err
		}
		if err := pair.capture(ctx, tx, false); err != nil {
			return err
		}
		preview = pair.preview()
		return nil
	})
	return preview, err
}

func SyncProject(ctx context.Context, actor, project, peer uuid.UUID, input ProjectSyncRequest) (ProjectAction, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.RequestID == uuid.Nil || len(input.Token) != 64 || (input.Direction != "pull" && input.Direction != "push") ||
		(input.Name != "" && !projectTitle(input.Name)) || len(input.Resolve) > 2*maxProjectFiles {
		return ProjectAction{}, projectInput("Review the changes and choose Pull or Commit & Push.")
	}
	fingerprint := projectFingerprint(struct {
		Action string
		Peer   uuid.UUID
		Input  ProjectSyncRequest
	}{"sync", peer, input})
	var result ProjectAction
	err := pgx.BeginFunc(ctx, db.Pool(), func(tx pgx.Tx) error {
		if err := lockProjectOrganizations(ctx, tx, []uuid.UUID{project, peer}, nil); err != nil {
			return err
		}
		pair, err := readProjectPair(ctx, tx, actor, project, peer)
		if err != nil {
			return err
		}
		receipt, found, err := projectReceipt(ctx, tx, project, actor, input.RequestID, fingerprint)
		if err != nil || found {
			result = receipt
			return err
		}
		if err := pair.capture(ctx, tx, true); err != nil {
			return err
		}
		preview := pair.preview()
		if preview.Token != input.Token {
			return staleProject()
		}
		result, err = applyProjectSync(ctx, tx, actor, pair, preview.Changes, input)
		if err != nil {
			return err
		}
		return recordProjectReceipt(ctx, tx, project, actor, input.RequestID, fingerprint, result)
	})
	return result, err
}

func applyProjectSync(ctx context.Context, tx pgx.Tx, actor uuid.UUID, pair projectSyncState, changes []ProjectDifference, input ProjectSyncRequest) (ProjectAction, error) {
	target, targetFiles, sourceFiles := pair.current, pair.currentFiles, pair.linkedFiles
	direction, versionKind, versionName := "incoming", "pulled", "Pulled changes"
	if input.Direction == "push" {
		target, targetFiles, sourceFiles = pair.linked, pair.linkedFiles, pair.currentFiles
		direction, versionKind, versionName = "outgoing", "pushed", "Project commit"
		if input.Name != "" {
			versionName = input.Name
		}
	}
	resolved := make(map[uuid.UUID]bool, len(input.Resolve))
	for _, key := range input.Resolve {
		resolved[key] = true
	}
	var selected []uuid.UUID
	for _, change := range changes {
		if change.State == direction || (change.State == "conflict" && resolved[change.Key]) {
			selected = append(selected, change.Key)
		}
		if change.State == "conflict" {
			delete(resolved, change.Key)
		}
	}
	if len(resolved) != 0 {
		return ProjectAction{}, projectInput("Resolve conflicts listed in the current preview.")
	}
	result := ProjectAction{ProjectID: target.id}
	if len(selected) > 0 {
		if _, err := saveProjectVersion(ctx, tx, target.id, actor, "Before sync", "before_sync", targetFiles); err != nil {
			return ProjectAction{}, err
		}
	}
	reconciled := make(map[uuid.UUID]bool)
	for key, base := range pair.base {
		state := pair.currentFiles[key].state()
		if state == pair.linkedFiles[key].state() && base != (syncBase{state, state}) {
			reconciled[key] = true
		}
	}
	for key, file := range pair.currentFiles {
		if _, ok := pair.base[key]; !ok && file.state() == pair.linkedFiles[key].state() {
			reconciled[key] = true
		}
	}
	for _, key := range selected {
		file, changed, err := applyProjectFile(ctx, tx, target, actor, targetFiles[key], sourceFiles[key], uuid.Nil)
		if err != nil {
			return ProjectAction{}, err
		}
		targetFiles[key] = file
		if changed != nil {
			result.Updates = append(result.Updates, *changed)
		}
		reconciled[key] = true
	}
	if err := targetFiles.checkSize(); err != nil {
		return ProjectAction{}, err
	}
	for _, key := range projectKeys(reconciled) {
		base := pair.oriented(pair.currentFiles[key].state(), pair.linkedFiles[key].state())
		if err := writeSyncBase(ctx, tx, pair.team, key, base); err != nil {
			return ProjectAction{}, err
		}
	}
	if len(selected) == 0 {
		return result, nil
	}
	version, err := saveProjectVersion(ctx, tx, target.id, actor, versionName, versionKind, targetFiles)
	if err != nil {
		return ProjectAction{}, err
	}
	if input.Direction == "push" {
		version, err = saveProjectVersion(ctx, tx, pair.current.id, actor, versionName, "pushed", sourceFiles)
		if err != nil {
			return ProjectAction{}, err
		}
		result.ProjectID = pair.current.id
	}
	result.VersionID, result.Files = &version, len(selected)
	return result, nil
}
