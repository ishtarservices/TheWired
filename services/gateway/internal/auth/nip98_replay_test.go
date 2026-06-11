package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	btcec "github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// signedAuthHeaderWithTags builds a real schnorr-signed NIP-98 header with extra
// tags beyond u/method (used to attach a `payload` tag).
func signedAuthHeaderWithTags(t *testing.T, method, url string, extra [][]string) string {
	t.Helper()
	priv, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	tags := append([][]string{{"u", url}, {"method", method}}, extra...)
	ev := NostrEvent{
		PubKey:    hex.EncodeToString(schnorr.SerializePubKey(priv.PubKey())),
		CreatedAt: time.Now().Unix(),
		Kind:      27235,
		Tags:      tags,
		Content:   "",
	}
	serialized, err := serializeEvent(&ev)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	hash := sha256.Sum256(serialized)
	ev.ID = hex.EncodeToString(hash[:])
	sig, err := schnorr.Sign(priv, hash[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	ev.Sig = hex.EncodeToString(sig.Serialize())
	j, _ := json.Marshal(ev)
	return "Nostr " + base64.StdEncoding.EncodeToString(j)
}

func payloadTag(body []byte) []string {
	sum := sha256.Sum256(body)
	return []string{"payload", hex.EncodeToString(sum[:])}
}

// bodyEchoHandler reads the (proxied) body so tests can confirm it survives the
// payload-verification buffering intact.
type bodyEchoHandler struct {
	called bool
	body   string
}

func (h *bodyEchoHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.called = true
	b, _ := io.ReadAll(r.Body)
	h.body = string(b)
	w.WriteHeader(http.StatusOK)
}

// PROBE #64 — a `payload` tag binding the body hash must verify when the body
// matches, and the proxied body must be forwarded byte-for-byte (the middleware
// buffers it to hash, then restores r.Body).
func TestMiddleware_PayloadTag_MatchesAndBodyForwarded(t *testing.T) {
	body := []byte(`{"name":"luna's space & co","n":2}`)
	url := "http://localhost:9080/api/spaces"

	inner := &bodyEchoHandler{}
	handler := NIP98Middleware(inner)

	req := httptest.NewRequest("POST", url, strings.NewReader(string(body)))
	req.Header.Set("Authorization", signedAuthHeaderWithTags(t, "POST", url, [][]string{payloadTag(body)}))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	if !inner.called || inner.body != string(body) {
		t.Errorf("body not forwarded intact: got %q want %q", inner.body, string(body))
	}
}

// PROBE #64 — a payload tag that does NOT match the body is a forgery/tamper and
// must 401.
func TestMiddleware_PayloadTag_Mismatch_Rejected(t *testing.T) {
	signedBody := []byte(`{"amount":10}`)
	sentBody := []byte(`{"amount":1000000}`) // tampered after signing
	url := "http://localhost:9080/api/spaces"

	inner := &bodyEchoHandler{}
	handler := NIP98Middleware(inner)

	req := httptest.NewRequest("POST", url, strings.NewReader(string(sentBody)))
	req.Header.Set("Authorization", signedAuthHeaderWithTags(t, "POST", url, [][]string{payloadTag(signedBody)}))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for tampered body vs payload tag, got %d", rr.Code)
	}
	if inner.called {
		t.Error("inner handler must not run when payload verification fails")
	}
}

// fakeReplayGuard is an in-memory ReplayGuard for the middleware tests.
type fakeReplayGuard struct {
	seen map[string]bool
	err  error
}

func (g *fakeReplayGuard) Reserve(_ context.Context, id string) (bool, error) {
	if g.err != nil {
		return false, g.err
	}
	if g.seen[id] {
		return false, nil
	}
	g.seen[id] = true
	return true, nil
}

// PROBE #64 — the same signed auth header replayed within the window is rejected
// on the second use (single-use), while the first use succeeds.
func TestMiddleware_Replay_SecondUseRejected(t *testing.T) {
	guard := &fakeReplayGuard{seen: map[string]bool{}}
	inner := &captureHandler{}
	handler := NIP98MiddlewareWithReplay(guard, inner)

	url := "http://localhost:9080/api/spaces"
	header := signedAuthHeader(t, "GET", url) // one fixed event, reused

	// First use — fresh — passes.
	req1 := httptest.NewRequest("GET", url, nil)
	req1.Header.Set("Authorization", header)
	rr1 := httptest.NewRecorder()
	handler.ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Fatalf("first use should pass, got %d (%s)", rr1.Code, rr1.Body.String())
	}

	// Second use — replay — 401.
	req2 := httptest.NewRequest("GET", url, nil)
	req2.Header.Set("Authorization", header)
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusUnauthorized {
		t.Fatalf("replay should be rejected, got %d", rr2.Code)
	}
	if !strings.Contains(rr2.Body.String(), "AUTH_REPLAY") {
		t.Errorf("expected AUTH_REPLAY code, got %s", rr2.Body.String())
	}
}

// #64 — a replay-store outage must NOT lock out auth: fail open.
func TestMiddleware_Replay_FailOpenOnStoreError(t *testing.T) {
	guard := &fakeReplayGuard{seen: map[string]bool{}, err: errors.New("redis down")}
	inner := &captureHandler{}
	handler := NIP98MiddlewareWithReplay(guard, inner)

	url := "http://localhost:9080/api/spaces"
	req := httptest.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", signedAuthHeader(t, "GET", url))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("replay-store error must fail open (200), got %d", rr.Code)
	}
	if !inner.called {
		t.Error("request should pass through when the replay store errors")
	}
}
