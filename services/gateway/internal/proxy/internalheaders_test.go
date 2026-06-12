package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// PROBE #108 — a forged internal X-Auth-Pubkey must be stripped on every route
// before routing (including /upload, /list/, /hls/ which skip the NIP-98 middleware).
func TestStripInternalHeaders_RemovesForgedXAuthPubkey(t *testing.T) {
	var saw string
	var present bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		saw = r.Header.Get("X-Auth-Pubkey")
		_, present = r.Header["X-Auth-Pubkey"]
		w.WriteHeader(http.StatusOK)
	})

	handler := StripInternalHeaders(inner)
	req := httptest.NewRequest("HEAD", "http://localhost:9080/upload", nil)
	req.Header.Set("X-Auth-Pubkey", "deadbeef")
	handler.ServeHTTP(httptest.NewRecorder(), req)

	if present {
		t.Errorf("forged X-Auth-Pubkey reached the handler: %q", saw)
	}
}

// A value legitimately set downstream (after the strip, e.g. by the NIP-98
// middleware) is untouched.
func TestStripInternalHeaders_DoesNotBlockDownstreamInjection(t *testing.T) {
	var saw string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Simulate the NIP-98 middleware injecting the verified pubkey.
		r.Header.Set("X-Auth-Pubkey", "verified")
		saw = r.Header.Get("X-Auth-Pubkey")
		w.WriteHeader(http.StatusOK)
	})
	handler := StripInternalHeaders(inner)
	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if saw != "verified" {
		t.Errorf("expected downstream-injected value to survive, got %q", saw)
	}
}
