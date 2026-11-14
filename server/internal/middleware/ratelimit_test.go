package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestRateLimiter_AllowsBurstThenBlocks(t *testing.T) {
	rl := NewRateLimiter(100, 3) // high rate, burst 3
	defer rl.Stop()

	// First 3 requests should be allowed (burst)
	for i := 0; i < 3; i++ {
		if !rl.allow("1.2.3.4") {
			t.Fatalf("request %d should be allowed within burst", i)
		}
	}
	// 4th should be blocked
	if rl.allow("1.2.3.4") {
		t.Fatal("request 4 should be blocked after burst exhausted")
	}
}

func TestRateLimiter_RefillsOverTime(t *testing.T) {
	rl := NewRateLimiter(100, 2) // 100 tokens/sec, burst 2
	defer rl.Stop()

	rl.allow("ip") // 1 token left
	rl.allow("ip") // 0 tokens left
	if rl.allow("ip") {
		t.Fatal("should be blocked when bucket empty")
	}

	// Wait for refill (>10ms at 100/s gives 1 token)
	time.Sleep(20 * time.Millisecond)
	if !rl.allow("ip") {
		t.Fatal("should be allowed after refill")
	}
}

func TestRateLimiter_PerIPIsolation(t *testing.T) {
	rl := NewRateLimiter(0, 1) // no refill, burst 1
	defer rl.Stop()

	if !rl.allow("1.1.1.1") {
		t.Fatal("first request from 1.1.1.1 should be allowed")
	}
	if rl.allow("1.1.1.1") {
		t.Fatal("second request from 1.1.1.1 should be blocked")
	}
	// Different IP should still have its own bucket
	if !rl.allow("2.2.2.2") {
		t.Fatal("first request from 2.2.2.2 should be allowed (isolated bucket)")
	}
}

func TestAssetRateLimitPreservesSyncBudget(t *testing.T) {
	assets, sync := NewRateLimiter(0, 1), NewRateLimiter(0, 1)
	t.Cleanup(assets.Stop)
	t.Cleanup(sync.Stop)
	router := gin.New()
	account := &model.User{ID: uuid.New()}
	authenticated := router.Group("", func(c *gin.Context) {
		c.Set(UserContextKey, account)
	})
	ok := func(c *gin.Context) { c.Status(http.StatusNoContent) }
	authenticated.GET("/image", RateLimitAssetUser(assets), ok)
	authenticated.GET("/changes", RateLimitUser(sync), ok)

	for _, test := range []struct {
		path   string
		status int
	}{
		{"/image", http.StatusNoContent},
		{"/image", http.StatusTooManyRequests},
		{"/changes", http.StatusNoContent},
		{"/changes", http.StatusTooManyRequests},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
		if response.Code != test.status {
			t.Errorf("%s returned %d, want %d", test.path, response.Code, test.status)
		}
		if test.status == http.StatusTooManyRequests && response.Header().Get("Retry-After") != "1" {
			t.Errorf("%s missing Retry-After on 429", test.path)
		}
	}
}
