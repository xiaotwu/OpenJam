package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

func TestDirectoryWithPostgres(t *testing.T) {
	ctx := directoryTestDatabase(t)

	// Populate the versionless schema a previous OpenJam build would leave behind.
	legacySQL, err := os.ReadFile("../db/migrations/001_legacy.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, string(legacySQL)); err != nil {
		t.Fatal(err)
	}
	owner, ownerToken := directoryTestUser(t, ctx, "owner@example.invalid")
	member, memberToken := directoryTestUser(t, ctx, "member@example.invalid")
	legacyBoard, err := model.CreateRoomWithID(ctx, "legacy-review-board", "Legacy review", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	elements := []any{map[string]any{"id": "legacy-note", "type": "text"}}
	if err := model.SaveBoardData(ctx, legacyBoard.ID, &model.BoardData{Name: legacyBoard.Name, Elements: elements}); err != nil {
		t.Fatal(err)
	}

	migrations := make(chan error, 2)
	for i := 0; i < cap(migrations); i++ {
		go func() { migrations <- db.MigrateContext(ctx) }()
	}
	for i := 0; i < cap(migrations); i++ {
		if err := <-migrations; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.CheckSchema(ctx); err != nil {
		t.Fatal(err)
	}
	if board, err := model.LoadBoardData(ctx, legacyBoard.ID); err != nil || board.Name != legacyBoard.Name || !reflect.DeepEqual(board.Elements, elements) {
		t.Fatalf("legacy board data after migration: %+v, %v", board, err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterDirectoryRoutes(router.Group("/api", middleware.AuthRequired()))
	const directoryPath = "/api/v2/directory"
	directoryRequest[struct{}](t, router, "", "GET", directoryPath, nil, http.StatusUnauthorized)

	type directoryResult struct {
		directory model.Directory
		err       error
	}
	results := make(chan directoryResult, 2)
	for i := 0; i < cap(results); i++ {
		go func() {
			directory, err := model.ListDirectory(ctx, owner.ID)
			results <- directoryResult{directory: directory, err: err}
		}()
	}
	var personalDrafts uuid.UUID
	for i := 0; i < cap(results); i++ {
		result := <-results
		dir := result.directory
		if result.err != nil || len(dir.Organizations) != 1 || len(dir.Workspaces) != 1 || len(dir.Projects) != 1 || len(dir.Boards) != 1 {
			t.Fatalf("initial directory: %+v, %v", dir, result.err)
		}
		if dir.Organizations[0].Kind != "personal" || dir.Projects[0].Name != "Drafts" || dir.Boards[0].ProjectID == nil ||
			*dir.Boards[0].ProjectID != dir.Projects[0].ID || dir.Boards[0].ID != legacyBoard.ID {
			t.Fatalf("legacy Drafts projection: %+v", dir)
		}
		if personalDrafts != uuid.Nil && dir.Projects[0].ID != personalDrafts {
			t.Fatalf("concurrent initialization changed Drafts ID")
		}
		personalDrafts = dir.Projects[0].ID
	}

	org := directoryRequest[model.Organization](t, router, ownerToken, "POST", "/api/v2/organizations", gin.H{"name": " Design team "}, http.StatusCreated)
	if org.Kind != "team" || org.Name != "Design team" {
		t.Fatalf("created organization: %+v", org)
	}
	afterCreate := directoryRequest[model.Directory](t, router, ownerToken, "GET", directoryPath, nil, http.StatusOK)
	var generalWorkspace uuid.UUID
	for _, workspace := range afterCreate.Workspaces {
		if workspace.OrganizationID == org.ID && workspace.Name == "General" {
			generalWorkspace = workspace.ID
		}
	}
	foundDrafts := false
	for _, project := range afterCreate.Projects {
		if project.WorkspaceID == generalWorkspace && project.Name == "Drafts" {
			foundDrafts = true
		}
	}
	if generalWorkspace == uuid.Nil || !foundDrafts {
		t.Fatalf("missing new organization's workspace and Drafts: %+v", afterCreate)
	}
	workspacePath := "/api/v2/organizations/" + org.ID.String() + "/workspaces"
	directoryRequest[struct{}](t, router, memberToken, "POST", workspacePath, gin.H{"name": "Hidden"}, http.StatusNotFound)
	workspace := directoryRequest[model.Workspace](t, router, ownerToken, "POST", workspacePath, gin.H{"name": "Design"}, http.StatusCreated)
	projectPath := "/api/v2/workspaces/" + workspace.ID.String() + "/projects"
	firstProject := directoryRequest[model.Project](t, router, ownerToken, "POST", projectPath, gin.H{"name": "Planning"}, http.StatusCreated)
	secondProject := directoryRequest[model.Project](t, router, ownerToken, "POST", projectPath, gin.H{"name": "Review"}, http.StatusCreated)
	boardsPath := "/api/v2/projects/" + firstProject.ID.String() + "/boards"
	directoryRequest[struct{}](t, router, ownerToken, "POST", boardsPath, gin.H{"name": "  "}, http.StatusBadRequest)
	board := directoryRequest[model.DirectoryBoard](t, router, ownerToken, "POST", boardsPath, gin.H{"name": "Sprint review"}, http.StatusCreated)
	if board.ID == "" || board.OwnerID != owner.ID || board.Permission != "owner" || board.ProjectID == nil || *board.ProjectID != firstProject.ID {
		t.Fatalf("created board: %+v", board)
	}
	initial, err := model.LoadBoardDataForUser(ctx, board.ID, owner.ID)
	if err != nil || initial.Name != board.Name || initial.UpdatedAt.IsZero() {
		t.Fatalf("new board load: %+v, %v", initial, err)
	}
	firstSave, err := model.SaveBoardDataWithVersion(ctx, board.ID, initial, initial.UpdatedAt)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := model.SaveBoardDataWithVersion(ctx, board.ID, initial, initial.UpdatedAt); !errors.Is(err, model.ErrBoardConflict) {
		t.Fatalf("stale save got %v, want ErrBoardConflict", err)
	}
	loaded, err := model.LoadBoardDataForUser(ctx, board.ID, owner.ID)
	if err != nil || !loaded.UpdatedAt.Equal(firstSave) {
		t.Fatalf("board load after save: %+v, %v", loaded, err)
	}
	renamed, err := model.UpdateRoom(ctx, board.ID, "Sprint review updated", owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err = model.LoadBoardDataForUser(ctx, board.ID, owner.ID)
	if err != nil || loaded.Name != renamed.Name || !loaded.UpdatedAt.Equal(renamed.UpdatedAt) {
		t.Fatalf("board load after directory rename: %+v, %v", loaded, err)
	}
	boardPath := "/api/v2/boards/" + board.ID
	directoryRequest[struct{}](t, router, ownerToken, "PUT", boardPath+"/location", gin.H{"projectId": personalDrafts}, http.StatusConflict)
	directoryRequest[struct{}](t, router, ownerToken, "PUT", boardPath+"/location", gin.H{"projectId": secondProject.ID}, http.StatusOK)
	directoryRequest[struct{}](t, router, memberToken, "PUT", boardPath+"/favorite", gin.H{"favorite": true}, http.StatusNotFound)
	if _, err := model.InviteRoomMemberByEmail(ctx, board.ID, owner.ID, member.Email, model.RoomPermissionComment); err != nil {
		t.Fatal(err)
	}
	directoryRequest[struct{}](t, router, memberToken, "PUT", boardPath+"/archive", gin.H{"archived": true}, http.StatusNotFound)
	directoryRequest[struct{}](t, router, memberToken, "PUT", boardPath+"/favorite", gin.H{"favorite": true}, http.StatusOK)
	directoryRequest[struct{}](t, router, ownerToken, "PUT", boardPath+"/archive", gin.H{"archived": true}, http.StatusOK)
	memberDir := directoryRequest[model.Directory](t, router, memberToken, "GET", directoryPath, nil, http.StatusOK)
	if len(memberDir.Organizations) != 1 || memberDir.Organizations[0].Kind != "personal" || len(memberDir.Boards) != 1 ||
		memberDir.Boards[0].ProjectID != nil || memberDir.Boards[0].Permission != "comment" || !memberDir.Boards[0].Favorite {
		t.Fatalf("member directory: %+v", memberDir)
	}
	if err := model.UserCanAccessRoom(ctx, board.ID, member.ID); err != nil {
		t.Fatalf("directory archive changed existing room access: %v", err)
	}
	ownerDir := directoryRequest[model.Directory](t, router, ownerToken, "GET", directoryPath, nil, http.StatusOK)
	foundBoard := false
	for _, listed := range ownerDir.Boards {
		if listed.ID == board.ID {
			foundBoard = true
			if listed.ProjectID == nil || *listed.ProjectID != secondProject.ID || listed.ArchivedAt == nil || listed.Favorite {
				t.Fatalf("owner directory board: %+v", listed)
			}
		}
	}
	if !foundBoard {
		t.Fatal("owner directory is missing the created board")
	}
	directoryRequest[struct{}](t, router, ownerToken, "PUT", boardPath+"/archive", gin.H{"archived": false}, http.StatusOK)
	directoryRequest[struct{}](t, router, memberToken, "PUT", boardPath+"/favorite", gin.H{"favorite": false}, http.StatusOK)
}

func directoryTestDatabase(t *testing.T) context.Context {
	t.Helper()
	dsn := os.Getenv("OPENJAM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set OPENJAM_TEST_DATABASE_URL to run the PostgreSQL integration test")
	}
	scopedURL, err := url.Parse(dsn)
	if err != nil || (scopedURL.Scheme != "postgres" && scopedURL.Scheme != "postgresql") {
		t.Fatal("OPENJAM_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "openjam_directory_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	schemaIdentifier := pgx.Identifier{schema}.Sanitize()
	if _, err := conn.Exec(ctx, "CREATE SCHEMA "+schemaIdentifier); err != nil {
		_ = conn.Close(ctx)
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		defer conn.Close(cleanupCtx)
		if _, err := conn.Exec(cleanupCtx, "DROP SCHEMA "+schemaIdentifier+" CASCADE"); err != nil {
			t.Errorf("remove disposable schema %s: %v", schema, err)
		}
	})
	params := scopedURL.Query()
	params.Set("search_path", schema)
	scopedURL.RawQuery = params.Encode()
	if err := db.InitContext(ctx, scopedURL.String()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	var path string
	if err := db.Pool().QueryRow(ctx, "SHOW search_path").Scan(&path); err != nil || path != schema {
		t.Fatalf("database did not isolate the test schema: %q, %v", path, err)
	}
	return ctx
}

func directoryTestUser(t *testing.T, ctx context.Context, email string) (*model.User, string) {
	t.Helper()
	user, err := model.CreateUser(ctx, email, "integration-test-password", "Directory tester")
	if err != nil {
		t.Fatal(err)
	}
	session, err := model.CreateSession(ctx, user.ID, 3600)
	if err != nil {
		t.Fatal(err)
	}
	return user, session.Token
}

func directoryRequest[T any](t *testing.T, router http.Handler, token, method, path string, payload any, status int) T {
	t.Helper()
	var body []byte
	if payload != nil {
		var err error
		body, err = json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "wb_session", Value: token})
	}
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != status {
		t.Fatalf("%s %s returned %d, want %d: %s", method, path, resp.Code, status, resp.Body)
	}
	var result T
	if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode %s %s response: %v", method, path, err)
	}
	return result
}
