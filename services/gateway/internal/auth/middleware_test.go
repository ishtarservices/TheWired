package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// captureHandler records whether it was called and what headers it saw.
type captureHandler struct {
	called      bool
	pubkeyValue string
	hasPubkey   bool
}

func (h *captureHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.called = true
	h.pubkeyValue = r.Header.Get("X-Auth-Pubkey")
	_, h.hasPubkey = r.Header["X-Auth-Pubkey"]
	w.WriteHeader(http.StatusOK)
}

func TestMiddleware_NoAuthHeader_PassesThrough(t *testing.T) {
	inner := &captureHandler{}
	handler := NIP98Middleware(inner)

	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if !inner.called {
		t.Fatal("expected inner handler to be called")
	}
	if inner.hasPubkey {
		t.Errorf("expected no X-Auth-Pubkey header, but got %q", inner.pubkeyValue)
	}
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestMiddleware_StripsInboundXAuthPubkey(t *testing.T) {
	inner := &captureHandler{}
	handler := NIP98Middleware(inner)

	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	// A malicious client sets X-Auth-Pubkey to try spoofing identity.
	req.Header.Set("X-Auth-Pubkey", "deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if !inner.called {
		t.Fatal("expected inner handler to be called")
	}
	if inner.hasPubkey {
		t.Errorf("spoofed X-Auth-Pubkey should have been stripped, but got %q", inner.pubkeyValue)
	}
}

func TestMiddleware_InvalidAuthScheme_Returns401(t *testing.T) {
	inner := &captureHandler{}
	handler := NIP98Middleware(inner)

	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	req.Header.Set("Authorization", "Bearer some-token")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if inner.called {
		t.Error("inner handler should not be called for invalid auth scheme")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestMiddleware_InvalidBase64_Returns401(t *testing.T) {
	inner := &captureHandler{}
	handler := NIP98Middleware(inner)

	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	req.Header.Set("Authorization", "Nostr !!!not-valid-base64!!!")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if inner.called {
		t.Error("inner handler should not be called for invalid base64")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestMiddleware_InvalidEventJSON_Returns401(t *testing.T) {
	inner := &captureHandler{}
	handler := NIP98Middleware(inner)

	// Encode something that is valid base64 but not valid JSON.
	encoded := base64.StdEncoding.EncodeToString([]byte("this is not json"))
	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	req.Header.Set("Authorization", "Nostr "+encoded)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if inner.called {
		t.Error("inner handler should not be called for invalid JSON")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestMiddleware_InvalidKind_Returns401(t *testing.T) {
	inner := &captureHandler{}
	handler := NIP98Middleware(inner)

	// A well-formed event JSON but with wrong kind.
	event := NostrEvent{
		Kind:      1, // wrong, should be 27235
		CreatedAt: time.Now().Unix(),
		Tags: [][]string{
			{"u", "http://localhost:9080/api/spaces"},
			{"method", "GET"},
		},
	}
	eventJSON, _ := json.Marshal(event)
	encoded := base64.StdEncoding.EncodeToString(eventJSON)

	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	req.Header.Set("Authorization", "Nostr "+encoded)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if inner.called {
		t.Error("inner handler should not be called for invalid kind")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestMiddleware_XForwardedProto_UsedForScheme(t *testing.T) {
	inner := &captureHandler{}
	handler := NIP98Middleware(inner)

	// Build an event that targets https:// URL -- the middleware should detect
	// X-Forwarded-Proto: https and build the expected URL accordingly.
	// The event itself will fail verification (no valid sig), but we can
	// check that it gets past the URL matching step by inspecting the error.
	event := NostrEvent{
		Kind:      27235,
		CreatedAt: time.Now().Unix(),
		Tags: [][]string{
			{"u", "https://example.com/api/spaces"},
			{"method", "GET"},
		},
	}
	// Compute a correct event ID so the URL check error is about sig, not ID.
	serialized, _ := json.Marshal([]interface{}{
		0, event.PubKey, event.CreatedAt, event.Kind, event.Tags, event.Content,
	})
	hash := sha256.Sum256(serialized)
	event.ID = hex.EncodeToString(hash[:])
	// Sig is empty -- will fail signature verification, which means URL matched.

	eventJSON, _ := json.Marshal(event)
	encoded := base64.StdEncoding.EncodeToString(eventJSON)

	req := httptest.NewRequest("GET", "http://example.com/api/spaces", nil)
	req.Host = "example.com"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("Authorization", "Nostr "+encoded)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	// We expect 401 because the signature is invalid, but that means URL
	// matching with https:// scheme worked (otherwise it would fail on URL mismatch).
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
	body := rr.Body.String()
	// If URL had NOT matched, we'd see "URL mismatch" in the error.
	if strings.Contains(body, "URL mismatch") {
		t.Error("URL mismatch error -- X-Forwarded-Proto was not used for scheme")
	}
}
