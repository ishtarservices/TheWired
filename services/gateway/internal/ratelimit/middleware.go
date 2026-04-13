package ratelimit

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// RateLimitMiddleware applies per-pubkey rate limiting.
func RateLimitMiddleware(limiter *Limiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pubkey := r.Header.Get("X-Auth-Pubkey")
		if pubkey == "" {
			// No auth = use real client IP for limiting.
			// Behind a reverse proxy, RemoteAddr is the proxy's IP;
			// use X-Forwarded-For (first entry) to get the real client IP.
			ip := r.RemoteAddr
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				if first, _, ok := strings.Cut(xff, ","); ok {
					ip = strings.TrimSpace(first)
				} else {
					ip = strings.TrimSpace(xff)
				}
			}
			pubkey = "anon:" + ip
		}

		// Determine category
		category := "read"
		if r.Method == "POST" || r.Method == "PUT" || r.Method == "DELETE" {
			category = "write"
		}
		if strings.Contains(r.URL.Path, "/search") {
			category = "search"
		}

		result, err := limiter.Allow(r.Context(), pubkey, category)
		if err != nil {
			log.Printf("Rate limiter error: %v", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"error":"service temporarily unavailable","code":"SERVICE_UNAVAILABLE"}`))
			return
		}

		// Always expose rate limit info so clients can self-throttle
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", result.Remaining))
		w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", result.ResetAt.Unix()))

		if !result.Allowed {
			retryAfter := int64(time.Until(result.ResetAt).Seconds())
			if retryAfter < 1 {
				retryAfter = 1
			}
			w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"rate limit exceeded","code":"RATE_LIMITED"}`))
			return
		}

		next.ServeHTTP(w, r)
	})
}
