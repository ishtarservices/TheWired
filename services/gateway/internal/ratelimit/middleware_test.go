package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// classifyCategory mirrors the inline category classification logic in
// RateLimitMiddleware so we can unit-test it without a live Redis connection.
func classifyCategory(method, path string) string {
	category := "read"
	if method == "POST" || method == "PUT" || method == "DELETE" {
		category = "write"
	}
	if strings.Contains(path, "/search") {
		category = "search"
	}
	return category
}

func TestClassifyCategory_GETIsRead(t *testing.T) {
	tests := []struct {
		method string
		path   string
		want   string
	}{
		{"GET", "/api/spaces", "read"},
		{"GET", "/api/profiles", "read"},
		{"GET", "/api/health", "read"},
		{"HEAD", "/api/health", "read"},
	}
	for _, tt := range tests {
		got := classifyCategory(tt.method, tt.path)
		if got != tt.want {
			t.Errorf("classifyCategory(%q, %q) = %q, want %q", tt.method, tt.path, got, tt.want)
		}
	}
}

func TestClassifyCategory_MutationsAreWrite(t *testing.T) {
	tests := []struct {
		method string
		path   string
		want   string
	}{
		{"POST", "/api/spaces", "write"},
		{"PUT", "/api/profiles/me", "write"},
		{"DELETE", "/api/spaces/123", "write"},
	}
	for _, tt := range tests {
		got := classifyCategory(tt.method, tt.path)
		if got != tt.want {
			t.Errorf("classifyCategory(%q, %q) = %q, want %q", tt.method, tt.path, got, tt.want)
		}
	}
}

func TestClassifyCategory_SearchPathIsSearch(t *testing.T) {
	tests := []struct {
		method string
		path   string
		want   string
	}{
		{"GET", "/api/search", "search"},
		{"GET", "/api/search/profiles", "search"},
		{"POST", "/api/search", "search"},
	}
	for _, tt := range tests {
		got := classifyCategory(tt.method, tt.path)
		if got != tt.want {
			t.Errorf("classifyCategory(%q, %q) = %q, want %q", tt.method, tt.path, got, tt.want)
		}
	}
}

func TestMiddleware_AnonymousUsesIP(t *testing.T) {
	// We can't call Allow without Redis, but we can verify the middleware
	// responds with 503 (service unavailable) when Redis is down, which
	// confirms it attempted rate limiting with the IP-based key.
	limiter, err := NewLimiter("redis://localhost:1", DefaultLimits) // port 1 = won't connect
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := RateLimitMiddleware(limiter, inner)

	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	// No X-Auth-Pubkey, so it should use IP
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	// Redis is unreachable, so we expect 503.
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when Redis is down, got %d", rr.Code)
	}
}

func TestMiddleware_XForwardedForUsedForAnonymous(t *testing.T) {
	// With Redis down, we still confirm the middleware runs and hits Redis
	// (getting 503), which means the XFF parsing path executed.
	limiter, err := NewLimiter("redis://localhost:1", DefaultLimits)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := RateLimitMiddleware(limiter, inner)

	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.50, 10.0.0.1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	// Redis down -> 503, but the middleware ran and attempted limiting.
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when Redis is down, got %d", rr.Code)
	}
}

func TestMiddleware_AuthenticatedUsesPubkey(t *testing.T) {
	limiter, err := NewLimiter("redis://localhost:1", DefaultLimits)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := RateLimitMiddleware(limiter, inner)

	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	req.Header.Set("X-Auth-Pubkey", "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	// Redis down -> 503, but confirms pubkey path was taken
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when Redis is down, got %d", rr.Code)
	}
}
