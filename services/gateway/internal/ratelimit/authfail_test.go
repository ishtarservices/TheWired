package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// handlerReturning401 always 401s — simulates the NIP-98 middleware rejecting a
// forged/expired auth event.
func handlerReturning401() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
}

// TestAuthFailGuard_BlocksAfterLimit confirms a per-IP brute-force of the
// (expensive) signature verify gets throttled with a 429 once it exceeds the
// failure budget — the requests that 401 inside NIP-98 are now counted (#111).
func TestAuthFailGuard_BlocksAfterLimit(t *testing.T) {
	g := NewAuthFailGuard(5)
	handler := g.Middleware(handlerReturning401())

	newReq := func() *http.Request {
		req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
		req.RemoteAddr = "203.0.113.7:5555"
		req.Header.Set("Authorization", "Nostr deadbeef") // carries auth -> guarded
		return req
	}

	// First 5 failures pass through to the 401 handler (counted, not yet blocked).
	for i := 0; i < 5; i++ {
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, newReq())
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("request %d: expected 401 passthrough, got %d", i, rr.Code)
		}
	}

	// The 6th is over budget -> guard short-circuits with 429 before auth runs.
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, newReq())
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 once failure budget exceeded, got %d", rr.Code)
	}
}

// TestAuthFailGuard_UnauthedBypass confirms anonymous requests (no Authorization
// header) are never guarded — they're limited by the downstream IP bucket, and
// guarding them would let one anon flood lock out auth retries for the whole IP.
func TestAuthFailGuard_UnauthedBypass(t *testing.T) {
	g := NewAuthFailGuard(1)
	// Pre-load the IP's bucket past the limit so we'd block if it were checked.
	g.recordFailure("203.0.113.9", timeNowForTest())
	g.recordFailure("203.0.113.9", timeNowForTest())

	reached := false
	handler := g.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
	req.RemoteAddr = "203.0.113.9:6666"
	// No Authorization header.
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if !reached || rr.Code != http.StatusOK {
		t.Errorf("unauthenticated request should bypass the guard, got code %d reached=%v", rr.Code, reached)
	}
}

// TestAuthFailGuard_SuccessNotCounted confirms only 401s accumulate — a client
// making many *successful* authed calls is never throttled by this guard.
func TestAuthFailGuard_SuccessNotCounted(t *testing.T) {
	g := NewAuthFailGuard(3)
	handler := g.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for i := 0; i < 10; i++ {
		req := httptest.NewRequest("GET", "http://localhost:9080/api/spaces", nil)
		req.RemoteAddr = "203.0.113.11:7777"
		req.Header.Set("Authorization", "Nostr valid")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d: success should never be throttled, got %d", i, rr.Code)
		}
	}
}

// TestAuthFailGuard_PerIPIsolation confirms one abusive IP doesn't throttle a
// different IP — buckets are keyed per client IP.
func TestAuthFailGuard_PerIPIsolation(t *testing.T) {
	g := NewAuthFailGuard(2)
	now := timeNowForTest()

	// Exhaust IP A's budget.
	g.recordFailure("10.0.0.1", now)
	g.recordFailure("10.0.0.1", now)

	if !g.blocked("10.0.0.1", now) {
		t.Errorf("IP A should be blocked after 2 failures with limit 2")
	}
	if g.blocked("10.0.0.2", now) {
		t.Errorf("IP B must not be affected by IP A's failures")
	}
}

// TestAuthFailGuard_WindowExpiry confirms failures age out of the sliding window
// so a client recovers after the window passes.
func TestAuthFailGuard_WindowExpiry(t *testing.T) {
	g := NewAuthFailGuard(2)
	base := timeNowForTest()

	g.recordFailure("10.0.0.3", base)
	g.recordFailure("10.0.0.3", base)
	if !g.blocked("10.0.0.3", base) {
		t.Fatalf("expected block immediately after 2 failures")
	}

	// 61s later the failures are outside the 60s window -> unblocked.
	later := base.Add(61 * time.Second)
	if g.blocked("10.0.0.3", later) {
		t.Errorf("failures should have aged out of the window after 61s")
	}
}

// timeNowForTest returns a fixed reference time. We avoid time.Now() in the
// window-math tests so they're deterministic; the Middleware uses time.Now()
// itself, which the integration-style tests above exercise.
func timeNowForTest() time.Time {
	return time.Unix(1_700_000_000, 0)
}
