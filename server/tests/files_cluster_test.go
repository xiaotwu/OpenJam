package tests

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/document"
	"github.com/project-wb/server/internal/jobs"
)

func TestFilesCluster(t *testing.T) {
	if os.Getenv("OPENJAM_CLUSTER_FILES") != "1" {
		t.Skip("requires an isolated two-replica cluster with object storage and a file worker")
	}
	a, b, dsn := os.Getenv("OPENJAM_CLUSTER_PRIMARY"), os.Getenv("OPENJAM_CLUSTER_SECONDARY"), os.Getenv("OPENJAM_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 10 * time.Second}
	owner, _ := registerClusterUser(t, client, a, "File owner")
	viewer, viewerEmail := registerClusterUser(t, client, b, "File viewer")
	outsider, _ := registerClusterUser(t, client, b, "File outsider")
	room := clusterJSON[struct{ ID string }](t, client, a, owner, "POST", "/api/rooms", map[string]string{"name": "Portable workshop"}, 200)
	board := "/api/v2/boards/" + room.ID
	first := clusterJSON[document.Snapshot](t, client, a, owner, "GET", board+"/snapshot", nil, 200)
	invite := clusterJSON[struct{ Token string }](t, client, a, owner, "POST", board+"/sharing/invitations", map[string]any{
		"email": viewerEmail, "permission": "view", "expiresInDays": 1,
	}, 201)
	clusterJSON[map[string]any](t, client, b, viewer, "POST", board+"/sharing/invitations/accept", map[string]string{"token": invite.Token}, 200)
	viewerID := clusterJSON[struct{ User struct{ ID string } }](t, client, b, viewer, "GET", "/api/me", nil, 200).User.ID
	var encoded bytes.Buffer
	fixture := image.NewRGBA(image.Rect(0, 0, 32, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 32; x++ {
			fixture.Set(x, y, color.RGBA{R: uint8(80 + x), G: uint8(80 + y), B: 233, A: 255})
		}
	}
	if err := png.Encode(&encoded, fixture); err != nil {
		t.Fatal(err)
	}
	assetBytes := encoded.Bytes()
	assertStatus := func(result clusterResponse, expected int) []byte {
		t.Helper()
		if result.err != nil || result.status != expected {
			t.Fatalf("HTTP status %d, want %d: %s %v", result.status, expected, result.body, result.err)
		}
		return result.body
	}
	upload := fileClusterRequest(client, a, owner, "POST", board+"/assets", assetBytes, map[string]string{"Content-Type": "image/png"})
	var asset assets.Metadata
	if err := json.Unmarshal(assertStatus(upload, 201), &asset); err != nil || asset.ID == "" || asset.Width != 32 {
		t.Fatalf("invalid asset metadata: %+v %v", asset, err)
	}
	imagePath := board + "/assets/" + asset.ID
	assertStatus(fileClusterRequest(client, a, "", "GET", imagePath, nil, nil), 401)
	assertStatus(fileClusterRequest(client, b, outsider, "GET", imagePath, nil, nil), 403)
	assertStatus(fileClusterRequest(client, b, viewer, "POST", board+"/assets", assetBytes, map[string]string{"Content-Type": "image/png"}), 403)
	read := assertStatus(fileClusterRequest(client, b, viewer, "GET", imagePath, nil, map[string]string{"Range": "bytes=0-7"}), 206)
	if !bytes.Equal(read, assetBytes[:8]) {
		t.Fatal("second replica returned different range bytes")
	}
	image := map[string]any{"id": "private-image", "type": "image", "assetId": asset.ID, "src": "", "pageId": first.Document.DefaultPageID,
		"x": 40, "y": 60, "width": 160, "height": 80, "zIndex": 1, "rotation": 0, "opacity": 1, "originalWidth": 32, "originalHeight": 16, "objectFit": "contain"}
	clusterJSON[document.Ack](t, client, a, owner, "POST", board+"/commands", clusterCommand(uuid.NewString(), first.Epoch, first.Seq,
		map[string]any{"kind": "add", "collection": "elements", "id": "private-image", "value": image}), 200)
	source := clusterJSON[document.Snapshot](t, client, b, owner, "GET", board+"/snapshot", nil, 200)

	exportBody := map[string]any{"requestId": uuid.NewString(), "format": "zip", "scope": "board"}
	exports := acrossFileReplicas(a, b, func(base string) clusterResponse {
		return clusterRequest(client, base, owner, "POST", board+"/files/export", exportBody)
	})
	decodeJob := func(result clusterResponse) jobs.Job {
		t.Helper()
		var job jobs.Job
		if err := json.Unmarshal(assertStatus(result, 202), &job); err != nil || job.ID == uuid.Nil {
			t.Fatalf("invalid queued job: %+v %v", job, err)
		}
		return job
	}
	left, right := decodeJob(exports[0]), decodeJob(exports[1])
	if left.ID != right.ID {
		t.Fatal("duplicate export created multiple jobs")
	}
	jobPath := "/api/v2/jobs/" + left.ID.String()
	waitFileJob(t, client, b, owner, jobPath)
	archive := assertStatus(fileClusterRequest(client, b, owner, "GET", jobPath+"/artifact", nil, nil), 200)
	assertStatus(fileClusterRequest(client, a, viewer, "GET", jobPath+"/artifact", nil, nil), 404)
	if readback := assertStatus(fileClusterRequest(client, a, owner, "GET", jobPath+"/artifact", nil, nil), 200); !bytes.Equal(archive, readback) {
		t.Fatal("duplicate artifact reads returned different bytes")
	}
	importHeaders := map[string]string{"Content-Type": "application/zip", "Idempotency-Key": uuid.NewString()}
	imports := acrossFileReplicas(a, b, func(base string) clusterResponse {
		return fileClusterRequest(client, base, owner, "POST", "/api/v2/board-imports", archive, importHeaders)
	})
	importedLeft, importedRight := decodeJob(imports[0]), decodeJob(imports[1])
	if importedLeft.ID != importedRight.ID {
		t.Fatal("duplicate import created multiple jobs")
	}
	imported := waitFileJob(t, client, a, owner, "/api/v2/jobs/"+importedLeft.ID.String())
	var created struct{ BoardID, Hash string }
	if err := json.Unmarshal(imported.Result, &created); err != nil || created.BoardID == "" || created.BoardID == room.ID || created.Hash != source.Hash {
		t.Fatalf("import result did not preserve snapshot: %+v %v", created, err)
	}
	copyPath := "/api/v2/boards/" + created.BoardID
	copyA := clusterJSON[document.Snapshot](t, client, a, owner, "GET", copyPath+"/snapshot", nil, 200)
	copyB := clusterJSON[document.Snapshot](t, client, b, owner, "GET", copyPath+"/snapshot", nil, 200)
	if copyA.Hash != copyB.Hash || copyA.Hash != source.Hash || !bytes.Equal(assertStatus(fileClusterRequest(client, b, owner, "GET", copyPath+"/assets/"+asset.ID, nil, nil), 200), assetBytes) {
		t.Fatal("imported board or image diverged across replicas")
	}
	assertStatus(fileClusterRequest(client, a, viewer, "GET", copyPath+"/assets/"+asset.ID, nil, nil), 403)
	deadline := time.Now().Add(15 * time.Second)
	for {
		result := fileClusterRequest(client, b, viewer, "GET", board+"/thumbnail", nil, nil)
		if result.status == 200 {
			config, err := png.DecodeConfig(bytes.NewReader(result.body))
			if err != nil || config.Width != 320 || config.Height != 180 {
				t.Fatalf("unexpected thumbnail: %+v %v", config, err)
			}
			break
		}
		assertStatus(result, 202)
		if time.Now().After(deadline) {
			t.Fatal("thumbnail job did not finish")
		}
		time.Sleep(300 * time.Millisecond)
	}
	assertStatus(fileClusterRequest(client, a, owner, "DELETE", board+"/sharing/members/"+viewerID, nil, nil), 204)
	assertStatus(fileClusterRequest(client, b, viewer, "GET", imagePath, nil, nil), 403)
	assertStatus(fileClusterRequest(client, b, viewer, "GET", board+"/thumbnail", nil, nil), 403)
	t.Logf("private ZIP round-trip retained asset %s and document hash %s on both replicas", asset.ID, source.Hash)
}

func acrossFileReplicas(a, b string, request func(string) clusterResponse) [2]clusterResponse {
	left, right := make(chan clusterResponse, 1), make(chan clusterResponse, 1)
	go func() { left <- request(a) }()
	go func() { right <- request(b) }()
	return [2]clusterResponse{<-left, <-right}
}

func fileClusterRequest(client *http.Client, base, token, method, path string, data []byte, headers map[string]string) clusterResponse {
	request, err := http.NewRequest(method, base+path, bytes.NewReader(data))
	if err != nil {
		return clusterResponse{err: err}
	}
	request.Header.Set("Origin", base)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	if token != "" {
		request.AddCookie(&http.Cookie{Name: "wb_session", Value: token})
	}
	response, err := client.Do(request)
	if err != nil {
		return clusterResponse{err: err}
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	return clusterResponse{status: response.StatusCode, body: body, err: err}
}

func waitFileJob(t *testing.T, client *http.Client, base, token, path string) jobs.Job {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		job := clusterJSON[jobs.Job](t, client, base, token, "GET", path, nil, 200)
		if job.Status == jobs.StatusSucceeded {
			return job
		}
		if job.Status != jobs.StatusQueued && job.Status != jobs.StatusRunning {
			t.Fatalf("job %s stopped in %s (%s)", job.ID, job.Status, job.ErrorCode)
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Fatal("file job did not finish")
	return jobs.Job{}
}
