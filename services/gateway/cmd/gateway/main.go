package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/thewired/gateway/internal/auth"
	"github.com/thewired/gateway/internal/config"
	"github.com/thewired/gateway/internal/cors"
	gmiddleware "github.com/thewired/gateway/internal/logging"
	"github.com/thewired/gateway/internal/proxy"
	"github.com/thewired/gateway/internal/ratelimit"
)

func main() {
	cfg := config.Load()

	limiter := ratelimit.NewLimiter(cfg.RedisURL)
	router := proxy.NewRouter(cfg.BackendURL)

	mux := http.NewServeMux()

	// Health check (no auth required)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"gateway"}`))
	})

	// Static uploads (no auth, just CORS + logging + proxy)
	uploadsHandler := gmiddleware.LoggingMiddleware(
		cors.CORSMiddleware(
			proxy.NewUploadsHandler(cfg.BackendURL),
		),
	)
	mux.Handle("/uploads/", uploadsHandler)

	// API routes (auth + rate limit + proxy)
	apiHandler := gmiddleware.LoggingMiddleware(
		cors.CORSMiddleware(
			auth.NIP98Middleware(
				ratelimit.RateLimitMiddleware(limiter,
					router.Handler(),
				),
			),
		),
	)
	mux.Handle("/api/", apiHandler)

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("Gateway listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
