package ratelimit

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

// readOverrides classifies semantically-read POST endpoints as reads so they get
// the read budget, not the much smaller write budget (#122).
var readOverrides = map[string]bool{
	"POST /api/profiles/batch": true,
}

// clientIP returns the rate-limit key IP for an unauthenticated request. XFF only
// reaches here from a trusted proxy (untrusted XFF is stripped upstream); take the
// RIGHTMOST entry (the hop the trusted proxy vouches for), and strip the ephemeral
// port from a direct RemoteAddr so one client isn't N separate buckets (#109).
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// classify picks the rate-limit category for a (method, path). Search wins; then
// the read overrides; then write methods; else read.
func classify(method, path string) string {
	if strings.Contains(path, "/search") {
		return "search"
	}
	if readOverrides[method+" "+path] {
		return "read"
	}
	if method == "POST" || method == "PUT" || method == "DELETE" {
		return "write"
	}
	return "read"
}

// ClientIPHeader carries the caller's IP to the backend for the guest report
// intake only (the backend stores a keyed hash of it to spot report floods).
// It is an internal header: proxy.StripInternalHeaders removes any inbound copy.
const ClientIPHeader = "X-Client-Ip"

// isReportIntake: the report endpoint guests can reach without a key. The
// backend serves it with and without a trailing slash, so both must count.
func isReportIntake(r *http.Request) bool {
	return r.Method == http.MethodPost && strings.TrimRight(r.URL.Path, "/") == "/api/reports"
}

func writeTooMany(w http.ResponseWriter, result AllowResult, code string) {
	retryAfter := int64(time.Until(result.ResetAt).Seconds())
	if retryAfter < 1 {
		retryAfter = 1
	}
	w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	w.Write([]byte(`{"error":"rate limit exceeded","code":"` + code + `"}`))
}

// RateLimitMiddleware applies per-pubkey rate limiting. `failOpen` controls the
// behavior on a Redis error: true (default) lets the request through so a cache
// blip can't 503 the whole API; false returns 503 (#67).
func RateLimitMiddleware(limiter *Limiter, failOpen bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pubkey := r.Header.Get("X-Auth-Pubkey")
		anonymous := pubkey == ""
		if anonymous {
			pubkey = "anon:" + clientIP(r)
		}

		category := classify(r.Method, r.URL.Path)

		result, err := limiter.Allow(r.Context(), pubkey, category)
		if err != nil {
			log.Printf("Rate limiter error (fail-open=%v): %v", failOpen, err)
			if failOpen {
				next.ServeHTTP(w, r) // degraded: don't take the API down with Redis
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"error":"service temporarily unavailable","code":"SERVICE_UNAVAILABLE"}`))
			return
		}

		// Always expose rate limit info so clients can self-throttle
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", result.Remaining))
		w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", result.ResetAt.Unix()))

		if !result.Allowed {
			writeTooMany(w, result, "RATE_LIMITED")
			return
		}

		if isReportIntake(r) {
			report, err := limiter.AllowReport(r.Context(), pubkey, anonymous)
			if err != nil {
				log.Printf("Report rate limiter error (fail-open=%v): %v", failOpen, err)
				if !failOpen {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusServiceUnavailable)
					w.Write([]byte(`{"error":"service temporarily unavailable","code":"SERVICE_UNAVAILABLE"}`))
					return
				}
			} else if !report.Allowed {
				writeTooMany(w, report, "REPORT_RATE_LIMITED")
				return
			}
			if anonymous {
				r.Header.Set(ClientIPHeader, clientIP(r))
			}
		}

		next.ServeHTTP(w, r)
	})
}
