package ratelimit

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// PROBE #109 — the anon rate-limit key strips the ephemeral port and uses the
// rightmost (trusted) X-Forwarded-For entry, not the spoofable leftmost.
func TestClientIP(t *testing.T) {
	// direct connection: strip the port.
	req := httptest.NewRequest("GET", "http://x/api/spaces", nil)
	req.RemoteAddr = "1.2.3.4:54321"
	if got := clientIP(req); got != "1.2.3.4" {
		t.Errorf("direct: want 1.2.3.4, got %q", got)
	}

	// XFF present: take the rightmost (trusted) hop.
	req2 := httptest.NewRequest("GET", "http://x/api/spaces", nil)
	req2.RemoteAddr = "10.0.0.1:1"
	req2.Header.Set("X-Forwarded-For", "9.9.9.9, 5.6.7.8")
	if got := clientIP(req2); got != "5.6.7.8" {
		t.Errorf("xff: want rightmost 5.6.7.8, got %q", got)
	}
}

// PROBE #122 — POST /api/profiles/batch is a semantic read and must get the read
// category, not write.
func TestClassify(t *testing.T) {
	cases := []struct {
		method, path, want string
	}{
		{"POST", "/api/profiles/batch", "read"},
		{"POST", "/api/spaces", "write"},
		{"GET", "/api/spaces", "read"},
		{"DELETE", "/api/invites/x", "write"},
		{"GET", "/api/search/music", "search"},
		{"POST", "/api/search/anything", "search"},
	}
	for _, c := range cases {
		if got := classify(c.method, c.path); got != c.want {
			t.Errorf("classify(%s %s) = %q, want %q", c.method, c.path, got, c.want)
		}
	}
}

// PROBE #66 — the ZADD member must include a per-request nonce, so same-millisecond
// requests don't collapse to a single sorted-set entry (undercounting bursts).
func TestRateLimitScript_UsesNonceMember(t *testing.T) {
	src := rateLimitScriptSrc
	if !strings.Contains(src, "ARGV[6]") {
		t.Error("rate-limit script does not reference the nonce (ARGV[6])")
	}
	if !strings.Contains(src, "now .. ':' .. nonce") {
		t.Error("ZADD member is not nonce-suffixed; same-ms requests will collapse")
	}
}
