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

	btcec "github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// signedAuthHeader builds a real, schnorr-signed NIP-98 header for (method, url).
func signedAuthHeader(t *testing.T, method, url string) string {
	t.Helper()
	priv, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	ev := NostrEvent{
		PubKey:    hex.EncodeToString(schnorr.SerializePubKey(priv.PubKey())),
		CreatedAt: time.Now().Unix(),
		Kind:      27235,
		Tags:      [][]string{{"u", url}, {"method", method}},
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

// PROBE #63 + #110 — an authenticated GET carrying a multi-param query string
// (which puts `&` into the signed `u` tag) must verify. Pre-fix it 401'd twice:
// the gateway compared path-only (#63), and even with that fixed the Go
// HTML-escaping id recomputation diverged on `&` (#110).
func TestMiddleware_QueryStringWithAmpersand_Verifies(t *testing.T) {
	inner := &captureHandler{}
	handler := NIP98Middleware(inner)

	url := "http://localhost:9080/api/music/uploads?limit=10&offset=20"
	req := httptest.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", signedAuthHeader(t, "GET", url))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}
	if !inner.called || !inner.hasPubkey {
		t.Errorf("expected the request to pass through with X-Auth-Pubkey set")
	}
	body := rr.Body.String()
	if strings.Contains(body, "URL mismatch") {
		t.Error("#63 regression: query string not included in the compared URL")
	}
	if strings.Contains(body, "invalid event ID") {
		t.Error("#110 regression: HTML-escaping divergence on `&`")
	}
}

// The query is now part of the signature binding: signing path-only and sending
// with a query must be rejected.
func TestMiddleware_QueryNotSigned_Rejected(t *testing.T) {
	inner := &captureHandler{}
	handler := NIP98Middleware(inner)

	signedURL := "http://localhost:9080/api/spaces"
	sentURL := "http://localhost:9080/api/spaces?evil=1"
	req := httptest.NewRequest("GET", sentURL, nil)
	req.Header.Set("Authorization", signedAuthHeader(t, "GET", signedURL))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for query not covered by the signature, got %d", rr.Code)
	}
}

// PROBE #110 — the canonical serialization must not HTML-escape & < >.
func TestVerifyEventID_NoHTMLEscaping(t *testing.T) {
	ev := NostrEvent{
		PubKey:    "00",
		CreatedAt: 1700000000,
		Kind:      27235,
		Tags:      [][]string{{"u", "http://h/x?a=1&b=2"}, {"note", "<b>&"}},
		Content:   "a & b < c > d",
	}
	// id via the (correct) non-escaping serialization → must verify.
	serialized, _ := serializeEvent(&ev)
	h := sha256.Sum256(serialized)
	ev.ID = hex.EncodeToString(h[:])
	if err := verifyEventID(&ev); err != nil {
		t.Fatalf("non-escaping id should verify: %v", err)
	}
	// id via json.Marshal (HTML-escaping, the bug) → must NOT verify.
	escaped, _ := json.Marshal([]interface{}{0, ev.PubKey, ev.CreatedAt, ev.Kind, ev.Tags, ev.Content})
	if string(escaped) == string(serialized) {
		t.Skip("no escapable chars in this fixture (unexpected)")
	}
	he := sha256.Sum256(escaped)
	ev.ID = hex.EncodeToString(he[:])
	if err := verifyEventID(&ev); err == nil {
		t.Error("HTML-escaped id should NOT match the canonical id")
	}
}
