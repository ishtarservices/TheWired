package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/thewired/gateway/internal/auth"
	"github.com/thewired/gateway/internal/config"
	"github.com/thewired/gateway/internal/cors"
	gmiddleware "github.com/thewired/gateway/internal/logging"
	"github.com/thewired/gateway/internal/proxy"
	"github.com/thewired/gateway/internal/ratelimit"
)

func main() {
	cfg := config.Load()

	limits := ratelimit.Limits{
		ReadPerMin:   cfg.RateLimitRead,
		WritePerMin:  cfg.RateLimitWrite,
		SearchPerMin: cfg.RateLimitSearch,
	}
	limiter, err := ratelimit.NewLimiter(cfg.RedisURL, limits)
	if err != nil {
		log.Fatalf("Failed to initialize rate limiter: %v", err)
	}
	router := proxy.NewRouter(cfg.BackendURL)

	mux := http.NewServeMux()

	// Health check (no auth required)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"gateway"}`))
	})

	// Blossom endpoints (no auth at gateway -- backend handles kind 24242)
	// PUT /upload, HEAD /upload
	blossomHandler := proxy.TrustedProxyMiddleware(cfg.TrustedProxies,
		gmiddleware.LoggingMiddleware(
			cors.BlossomCORSMiddleware(
				proxy.NewBlossomHandler(cfg.BackendURL),
			),
		),
	)
	mux.Handle("/upload", blossomHandler)
	mux.Handle("/list/", blossomHandler)

	// API routes: trusted-proxy (strip spoofed headers) -> logging -> CORS -> auth -> rate limit -> proxy
	apiHandler := proxy.TrustedProxyMiddleware(cfg.TrustedProxies,
		gmiddleware.LoggingMiddleware(
			cors.CORSMiddleware(cfg.AllowedOrigins)(
				auth.NIP98Middleware(
					ratelimit.RateLimitMiddleware(limiter,
						router.Handler(),
					),
				),
			),
		),
	)
	mux.Handle("/api/", apiHandler)

	// Blossom blob retrieval/deletion catch-all: /<sha256>[.<ext>]
	// Registered as "/" so it catches paths not matched by /upload, /list/, /api/, /uploads/, /health
	// NIP-98 auth is optional here — allows backend to check access for protected blobs
	defaultHandler := proxy.TrustedProxyMiddleware(cfg.TrustedProxies,
		gmiddleware.LoggingMiddleware(
			cors.BlossomCORSMiddleware(
				auth.NIP98Middleware(
					http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						if proxy.IsBlossomPath(r.URL.Path) {
							proxy.NewBlossomHandler(cfg.BackendURL).ServeHTTP(w, r)
							return
						}
						http.NotFound(w, r)
					}),
				),
			),
		),
	)
	mux.Handle("/", defaultHandler)

	addr := fmt.Sprintf(":%d", cfg.Port)
	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	// Start server in a goroutine
	go func() {
		log.Printf("Gateway listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for SIGTERM or SIGINT
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	sig := <-quit
	log.Printf("Received %v, shutting down...", sig)

	// Give in-flight requests 15 seconds to complete
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Gateway stopped")
}
