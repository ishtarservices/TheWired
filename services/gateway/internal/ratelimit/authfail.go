package ratelimit

import (
	"net/http"
	"sync"
	"time"
)

// AuthFailGuard rate-limits FAILED authentication attempts per client IP, in
// process (no Redis). It guards the schnorr-verification CPU cost: an attacker
// recomputing a valid event id once per 60s window still reaches the (expensive)
// signature verify on every request, and those requests 401 inside the NIP-98
// middleware — which runs AFTER the Redis limiter, so they were never counted
// (#111). This guard wraps OUTSIDE auth and counts 401s per IP.
type AuthFailGuard struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string][]time.Time
}

const maxAuthFailIPs = 10_000

func NewAuthFailGuard(limitPerMin int) *AuthFailGuard {
	return &AuthFailGuard{
		limit:   limitPerMin,
		window:  time.Minute,
		buckets: make(map[string][]time.Time),
	}
}

// blocked reports whether `ip` has exceeded the failure budget in the window.
func (g *AuthFailGuard) blocked(ip string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	cutoff := now.Add(-g.window)
	times := g.buckets[ip]
	kept := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(g.buckets, ip)
	} else {
		g.buckets[ip] = kept
	}
	return len(kept) >= g.limit
}

func (g *AuthFailGuard) recordFailure(ip string, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()
	// Cheap bound on the map: if it grows huge, drop it (the worst case is a brief
	// reset of failure counts under a distributed scan — acceptable).
	if len(g.buckets) > maxAuthFailIPs {
		g.buckets = make(map[string][]time.Time)
	}
	g.buckets[ip] = append(g.buckets[ip], now)
}

// Middleware enforces the guard. Only requests that CARRY an Authorization header
// are guarded (anon requests are limited downstream; valid-auth requests are
// limited by the pubkey bucket).
func (g *AuthFailGuard) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			next.ServeHTTP(w, r)
			return
		}
		ip := clientIP(r)
		now := time.Now()
		if g.blocked(ip, now) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"too many failed auth attempts","code":"AUTH_RATE_LIMITED"}`))
			return
		}
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		if rec.status == http.StatusUnauthorized {
			g.recordFailure(ip, now)
		}
	})
}

// statusRecorder captures the response status so the guard can detect 401s.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wroteHeader {
		s.status = code
		s.wroteHeader = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wroteHeader {
		s.status = http.StatusOK
		s.wroteHeader = true
	}
	return s.ResponseWriter.Write(b)
}
