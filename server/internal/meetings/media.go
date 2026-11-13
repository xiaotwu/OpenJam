package meetings

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/model"
)

const (
	roomPrefix     = "openjam-meeting-"
	roomService    = "/twirp/livekit.RoomService/"
	accessInterval = 2 * time.Second
)

// Media is the private LiveKit connection shared by Shiori API replicas.
type Media struct {
	base      *url.URL
	key       string
	secret    []byte
	client    *http.Client
	transport *http.Transport
}

func NewMedia(endpoint, key, secret string) (*Media, error) {
	if endpoint == "" {
		return nil, nil
	}
	base, err := url.Parse(endpoint)
	if err != nil || base.Hostname() == "" || (base.Scheme != "http" && base.Scheme != "https") ||
		base.User != nil || (base.Path != "" && base.Path != "/") || base.ForceQuery || base.RawQuery != "" ||
		base.Fragment != "" || key == "" || len(secret) < 32 {
		return nil, fmt.Errorf("meetings require a private HTTP(S) media origin, an API key and a secret of at least 32 bytes")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ResponseHeaderTimeout = 5 * time.Second
	return &Media{
		base: base, key: key, secret: []byte(secret), transport: transport,
		client: &http.Client{
			Transport: transport, Timeout: 3 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func (m *Media) token(subject, name string, grant map[string]any) string {
	now := time.Now()
	// Shiori signs the upstream request with LiveKit's HS256 access token format.
	// The meeting link contains only the Shiori meeting ID.
	claims, _ := json.Marshal(map[string]any{
		"iss": m.key, "sub": subject, "name": name,
		"nbf": now.Add(-5 * time.Second).Unix(), "exp": now.Add(time.Minute).Unix(), "video": grant,
	})
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`)) +
		"." + base64.RawURLEncoding.EncodeToString(claims)
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (m *Media) ServeSignal(w http.ResponseWriter, r *http.Request, path string, meeting, identity uuid.UUID, name string) {
	token := m.token(identity.String(), name, map[string]any{
		"roomJoin": true, "room": roomPrefix + meeting.String(), "canSubscribe": true,
		"canPublish": true, "canPublishData": false, "canUpdateOwnMetadata": false,
	})
	proxy := httputil.ReverseProxy{
		Transport: m.transport,
		Rewrite: func(req *httputil.ProxyRequest) {
			req.SetURL(m.base)
			req.Out.URL.Path, req.Out.URL.RawPath = path, ""
			query := req.Out.URL.Query()
			query.Del("access_token")
			req.Out.URL.RawQuery = query.Encode()
			req.Out.Header.Del("Cookie")
			req.Out.Header.Del("Referer")
			req.Out.Header.Set("Authorization", "Bearer "+token)
		},
		ModifyResponse: func(res *http.Response) error {
			res.Header.Del("Set-Cookie")
			res.Header.Del("Access-Control-Allow-Origin")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "Meeting media is unavailable.", http.StatusServiceUnavailable)
		},
	}
	proxy.ServeHTTP(w, r)
}

func (m *Media) roomCall(ctx context.Context, method string, body, result any, grant map[string]any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	target := *m.base
	target.Path = roomService + method
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+m.token("openjam", "", grant))
	res, err := m.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound && method != "ListRooms" {
		return nil
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("meeting media %s returned HTTP %d", method, res.StatusCode)
	}
	if result == nil {
		_, err := io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
		return err
	}
	return json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(result)
}

func (m *Media) Run(ctx context.Context) {
	defer m.transport.CloseIdleConnections()
	ticker := time.NewTicker(accessInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.reconcile(ctx)
		}
	}
}

func (m *Media) reconcile(ctx context.Context) {
	var result struct {
		Rooms []struct{ Name string }
	}
	err := m.roomCall(ctx, "ListRooms", struct{}{}, &result, map[string]any{"roomList": true})
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("check live meetings: %v", err)
		}
		return
	}
	for _, room := range result.Rooms {
		id, ok := strings.CutPrefix(room.Name, roomPrefix)
		if !ok {
			continue
		}
		meeting, err := uuid.Parse(id)
		if err != nil {
			continue
		}
		if err := m.reconcileRoom(ctx, room.Name, meeting); err != nil && ctx.Err() == nil {
			log.Printf("check meeting %s: %v", meeting, err)
		}
	}
}

func (m *Media) reconcileRoom(ctx context.Context, room string, meeting uuid.UUID) error {
	var result struct {
		Participants []struct{ Identity string }
	}
	body := map[string]string{"room": room}
	admin := map[string]any{"roomAdmin": true, "room": room}
	if err := m.roomCall(ctx, "ListParticipants", body, &result, admin); err != nil || len(result.Participants) == 0 {
		return err
	}
	identities := make([]uuid.UUID, 0, len(result.Participants))
	for _, participant := range result.Participants {
		if id, err := uuid.Parse(participant.Identity); err == nil {
			identities = append(identities, id)
		}
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Second)
	open, allowed, err := model.MeetingParticipants(checkCtx, meeting, identities)
	cancel()
	if err != nil && ctx.Err() == nil {
		log.Printf("check meeting %s permissions: %v", meeting, err)
	}
	if err != nil || !open {
		return m.roomCall(ctx, "DeleteRoom", body, nil, map[string]any{"roomCreate": true})
	}
	for _, participant := range result.Participants {
		id, err := uuid.Parse(participant.Identity)
		if err == nil && slices.Contains(allowed, id) {
			continue
		}
		err = m.roomCall(ctx, "RemoveParticipant",
			map[string]string{"room": room, "identity": participant.Identity}, nil, admin)
		if err != nil {
			return err
		}
	}
	return nil
}
