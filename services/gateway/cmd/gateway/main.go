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

	// HLS adaptive audio streams (public, GET-only, no auth, no rate limit).
	// Segments are immutable + CDN-cached so rate-limiting would just burn
	// Redis for no benefit. Same CORS policy as Blossom GETs.
	hlsHandler := proxy.TrustedProxyMiddleware(cfg.TrustedProxies,
		gmiddleware.LoggingMiddleware(
			cors.BlossomCORSMiddleware(
				proxy.NewBlossomHandler(cfg.BackendURL),
			),
		),
	)
	mux.Handle("/hls/", hlsHandler)

	// #64 — single-use replay guard for API auth events (Redis SET NX EX). If
	// Redis is unreachable at startup we run without it (fail-open) rather than
	// refusing to boot; per-request errors also fail open inside the middleware.
	replayGuard, err := auth.NewRedisReplayGuard(cfg.RedisURL)
	if err != nil {
		log.Printf("NIP-98 replay guard disabled (Redis init failed): %v", err)
	}

	// API routes: trusted-proxy -> logging -> CORS -> auth-fail guard -> auth ->
	// rate limit -> proxy. The auth-fail guard sits OUTSIDE NIP-98 so it can count
	// 401s and throttle per-IP brute-force of the (expensive) signature verify.
	failOpen := cfg.RateLimitFailMode != "closed"
	authFail := ratelimit.NewAuthFailGuard(cfg.AuthFailPerMin)
	// A typed-nil *RedisReplayGuard in an interface is non-nil; pass the interface
	// explicitly so a failed init really disables the guard.
	var replay auth.ReplayGuard
	if replayGuard != nil {
		replay = replayGuard
	}
	apiHandler := proxy.TrustedProxyMiddleware(cfg.TrustedProxies,
		gmiddleware.LoggingMiddleware(
			cors.CORSMiddleware(cfg.AllowedOrigins)(
				authFail.Middleware(
					auth.NIP98MiddlewareWithReplay(replay,
						ratelimit.RateLimitMiddleware(limiter, failOpen,
							router.Handler(),
						),
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
		Addr: addr,
		// Strip forgeable internal headers on EVERY route before routing (#108).
		Handler: proxy.StripInternalHeaders(mux),
		// #65 — bound slow-header/idle connections (Slowloris). Read/Write body
		// timeouts are intentionally left unset because /upload streams large
		// Blossom blobs and the catch-all streams them back to slow clients.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
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
