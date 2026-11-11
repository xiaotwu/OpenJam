package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func TestHealthRoutes(t *testing.T) {
	r := gin.New()
	var pingError error
	var draining bool
	registerHealthRoutes(r, func(context.Context) error { return pingError }, func() bool { return draining })

	status := func(path string) int {
		response := httptest.NewRecorder()
		r.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		return response.Code
	}

	if got := status("/readyz"); got != http.StatusOK {
		t.Fatalf("readyz after startup = %d", got)
	}
	pingError = errors.New("database stopped")
	if got := status("/readyz"); got != http.StatusServiceUnavailable {
		t.Errorf("readyz during database failure = %d", got)
	}
	if got := status("/livez"); got != http.StatusOK {
		t.Errorf("livez during database failure = %d", got)
	}
	if got := status("/startupz"); got != http.StatusOK {
		t.Errorf("startupz after successful startup = %d", got)
	}
	pingError = nil
	draining = true
	if got := status("/readyz"); got != http.StatusServiceUnavailable {
		t.Errorf("readyz during shutdown = %d", got)
	}
}

func TestFrontendDeepLinksAndMissingEndpoints(t *testing.T) {
	r := gin.New()
	r.RedirectTrailingSlash = false
	mountFrontend(r, fstest.MapFS{
		"index.html":    {Data: []byte("<!doctype html><div>OpenJam</div>")},
		"assets/app.js": {Data: []byte("export {}")},
	})

	for _, test := range []struct {
		method, path string
		status       int
		body         string
	}{
		{http.MethodGet, "/workplace", http.StatusOK, "OpenJam"},
		{http.MethodGet, "/board/legacy-board", http.StatusOK, "OpenJam"},
		{http.MethodHead, "/board/legacy-board", http.StatusOK, ""},
		{http.MethodGet, "/assets/app.js", http.StatusOK, "export {}"},
		{http.MethodGet, "/assets/missing.js", http.StatusNotFound, ""},
		{http.MethodGet, "/api/v2/missing", http.StatusNotFound, "Endpoint not found"},
		{http.MethodPost, "/board/legacy-board", http.StatusNotFound, ""},
	} {
		response := httptest.NewRecorder()
		r.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != test.status {
			t.Errorf("%s %s status = %d, want %d", test.method, test.path, response.Code, test.status)
		}
		if test.body != "" && !strings.Contains(response.Body.String(), test.body) {
			t.Errorf("%s %s body = %q, want %q", test.method, test.path, response.Body.String(), test.body)
		}
		if (test.method == http.MethodHead || test.status == http.StatusNotFound) && strings.Contains(response.Body.String(), "OpenJam") {
			t.Errorf("%s %s served the app shell", test.method, test.path)
		}
	}
}
