package ratelimit

import (
	"net/http"
	"strings"
)

// RateLimitMiddleware applies per-pubkey rate limiting
func RateLimitMiddleware(limiter *Limiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pubkey := r.Header.Get("X-Auth-Pubkey")
		if pubkey == "" {
			// No auth = use IP-based limiting
			pubkey = "anon:" + r.RemoteAddr
		}

		// Determine category
		category := "read"
		if r.Method == "POST" || r.Method == "PUT" || r.Method == "DELETE" {
			category = "write"
		}
		if strings.Contains(r.URL.Path, "/search") {
			category = "search"
		}

		allowed, err := limiter.Allow(r.Context(), pubkey, category)
		if err != nil {
			// Log but allow on error
			next.ServeHTTP(w, r)
			return
		}

		if !allowed {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"rate limit exceeded","code":"RATE_LIMITED"}`))
			return
		}

		next.ServeHTTP(w, r)
	})
}
