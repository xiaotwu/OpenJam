package storage

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInitWithBucketLeavesStorageUnavailableAfterFailedProbe(t *testing.T) {
	previous := activeBucket.Swap(nil)
	t.Cleanup(func() { activeBucket.Store(previous) })

	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer endpoint.Close()

	err := InitWithBucket(strings.TrimPrefix(endpoint.URL, "http://"), "test-key", "test-secret", false, "test-bucket")
	if err == nil {
		t.Fatal("expected bucket probe to fail")
	}
	if IsInitialized() {
		t.Fatal("failed bucket probe published an active storage client")
	}
}
