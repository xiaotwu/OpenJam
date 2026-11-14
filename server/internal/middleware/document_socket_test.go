package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestDocumentSocketAdmitsSharedIPReconnect(t *testing.T) {
	gate := testDocumentSocketGate(t)
	router := testDocumentSocketRouter(gate)
	var clients sync.WaitGroup
	for i := 1; i <= 50; i++ {
		clients.Add(1)
		go func(client int) {
			defer clients.Done()
			token := fmt.Sprintf("%064x", client)
			res := tryDocumentSocket(router, "192.0.2.3", token, "")
			if res.Code != http.StatusNoContent {
				t.Errorf("account %d on the shared IP got %d, want admission", client, res.Code)
			}
		}(i)
	}
	clients.Wait()
}

func TestDocumentSocketRateLimitsTheVerifiedAccount(t *testing.T) {
	gate := testDocumentSocketGate(t)
	account := uuid.New()
	gate.findSession = func(_ context.Context, token string) (*model.Session, error) {
		if token == fmt.Sprintf("%064x", 9) {
			return &model.Session{Token: token, UserID: uuid.New()}, nil
		}
		return &model.Session{Token: token, UserID: account}, nil
	}
	router := testDocumentSocketRouter(gate)
	for i := 1; i <= 4; i++ {
		// Each request presents a different valid session for the same account.
		res := tryDocumentSocket(router, "192.0.2.3", fmt.Sprintf("%064x", i), "")
		if i <= 3 && res.Code != http.StatusNoContent {
			t.Fatalf("request %d unexpectedly got %d", i, res.Code)
		}
		if i == 4 && (res.Code != http.StatusTooManyRequests || res.Header().Get("Retry-After") == "") {
			t.Fatalf("request %d got %d without a usable account limit", i, res.Code)
		}
	}
	if res := tryDocumentSocket(router, "192.0.2.3", fmt.Sprintf("%064x", 9), ""); res.Code != http.StatusNoContent {
		t.Fatalf("another account on the same IP was limited: %d", res.Code)
	}
}

func TestDocumentSocketLimitsRejectedRequestsAndSessionLookups(t *testing.T) {
	gate := testDocumentSocketGate(t)
	var lookups atomic.Int32
	gate.findSession = func(_ context.Context, token string) (*model.Session, error) {
		lookups.Add(1)
		if token == fmt.Sprintf("%064x", 99) {
			return &model.Session{Token: token, UserID: uuid.New()}, nil
		}
		return nil, nil
	}
	router := testDocumentSocketRouter(gate)

	for _, token := range []string{"", "short", "xyz"} {
		if res := tryDocumentSocket(router, "192.0.2.3", token, ""); res.Code != http.StatusUnauthorized {
			t.Fatalf("invalid credentials got %d", res.Code)
		}
	}
	if res := tryDocumentSocket(router, "192.0.2.3", "", ""); res.Code != http.StatusTooManyRequests {
		t.Fatalf("a repeated anonymous request got %d", res.Code)
	}
	if count := lookups.Load(); count != 0 {
		t.Fatalf("malformed tokens caused %d database lookups", count)
	}
	if res := tryDocumentSocket(router, "192.0.2.3", fmt.Sprintf("%064x", 99), ""); res.Code != http.StatusNoContent {
		t.Fatalf("anonymous traffic blocked a valid session on the same IP: %d", res.Code)
	}

	for i := 1; i <= 70; i++ {
		res := tryDocumentSocket(router, "192.0.2.4", fmt.Sprintf("%064x", i), "")
		want := http.StatusUnauthorized
		if i > 3 {
			want = http.StatusTooManyRequests
		}
		if res.Code != want {
			t.Fatalf("unverified token %d got %d, want %d", i, res.Code, want)
		}
	}
	if count := lookups.Load(); count != 65 {
		t.Fatalf("expected 64 lookups for distinct unverified tokens plus the valid session, got %d", count)
	}
}

func TestDocumentSocketCapsConcurrentAuthentication(t *testing.T) {
	gate := testDocumentSocketGate(t)
	gate.inFlight = make(chan struct{}, 1)
	entered, release := make(chan struct{}), make(chan struct{})
	gate.findSession = func(ctx context.Context, token string) (*model.Session, error) {
		close(entered)
		select {
		case <-release:
			return &model.Session{Token: token, UserID: uuid.New()}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	router := testDocumentSocketRouter(gate)
	token := fmt.Sprintf("%064x", 1)
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() { result <- tryDocumentSocket(router, "192.0.2.3", token, "") }()
	<-entered
	res := tryDocumentSocket(router, "192.0.2.4", token, "")
	close(release)
	first := <-result
	if res.Code != http.StatusTooManyRequests || first.Code != http.StatusNoContent || len(gate.inFlight) != 0 {
		t.Fatalf("first request %d, over capacity %d, active auth checks %d", first.Code, res.Code, len(gate.inFlight))
	}
}

func TestDocumentSocketUsesCookieBeforeBearer(t *testing.T) {
	gate := testDocumentSocketGate(t)
	cookie := fmt.Sprintf("%064x", 1)
	gate.findSession = func(_ context.Context, token string) (*model.Session, error) {
		if token == cookie {
			return &model.Session{Token: token, UserID: uuid.New()}, nil
		}
		return nil, nil
	}
	router := testDocumentSocketRouter(gate)
	res := tryDocumentSocket(router, "192.0.2.3", fmt.Sprintf("%064x", 2), cookie)
	if res.Code != http.StatusNoContent {
		t.Fatalf("valid browser session did not take precedence: %d", res.Code)
	}
}

func testDocumentSocketGate(t *testing.T) *documentSocketAdmission {
	t.Helper()
	gate := &documentSocketAdmission{
		rejected: NewRateLimiter(0, 3),
		lookups:  NewRateLimiter(0, 64),
		accounts: NewRateLimiter(0, 3),
		inFlight: make(chan struct{}, 64),
		findSession: func(_ context.Context, token string) (*model.Session, error) {
			id := uuid.NewSHA1(uuid.NameSpaceOID, []byte(token))
			return &model.Session{Token: token, UserID: id}, nil
		},
		findUser: func(_ context.Context, id uuid.UUID) (*model.User, error) {
			return &model.User{ID: id}, nil
		},
	}
	t.Cleanup(gate.rejected.Stop)
	t.Cleanup(gate.lookups.Stop)
	t.Cleanup(gate.accounts.Stop)
	return gate
}

func testDocumentSocketRouter(gate *documentSocketAdmission) *gin.Engine {
	router := gin.New()
	_ = router.SetTrustedProxies(nil)
	router.GET("/ws/v2", gate.authenticate, func(c *gin.Context) {
		user, session := GetUser(c), GetSession(c)
		if user == nil || session == nil || user.ID != session.UserID {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusNoContent)
	})
	return router
}

func tryDocumentSocket(router *gin.Engine, ip, bearer, cookie string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/ws/v2", nil)
	req.RemoteAddr = ip + ":12345"
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: "wb_session", Value: cookie})
	}
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	return res
}
