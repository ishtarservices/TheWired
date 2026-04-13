package proxy

import (
	"net/http"
	"regexp"
	"strings"
)

var sha256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Router maps API paths to backend services
type Router struct {
	backendURL string
}

func NewRouter(backendURL string) *Router {
	return &Router{backendURL: backendURL}
}

// NewBlossomHandler returns a handler that proxies Blossom endpoints to the backend.
// Backend handles kind 24242 auth for PUT/DELETE; GET/HEAD are unauthenticated.
func NewBlossomHandler(backendURL string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxy := newReverseProxy(backendURL, r.URL.Path)
		proxy.ServeHTTP(w, r)
	})
}

// IsBlossomPath returns true if the path should be routed as a Blossom endpoint.
func IsBlossomPath(path string) bool {
	// /upload (PUT/HEAD)
	if path == "/upload" {
		return true
	}
	// /list/<pubkey>
	if strings.HasPrefix(path, "/list/") {
		return true
	}
	// /<sha256> or /<sha256>.<ext> (GET/DELETE)
	trimmed := strings.TrimPrefix(path, "/")
	// Strip file extension if present
	if idx := strings.LastIndex(trimmed, "."); idx > 0 {
		trimmed = trimmed[:idx]
	}
	return len(trimmed) == 64 && sha256Pattern.MatchString(trimmed)
}

// Handler returns an http.Handler that proxies requests to the backend
func (rt *Router) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Strip /api prefix
		backendPath := strings.TrimPrefix(r.URL.Path, "/api")
		if backendPath == "" {
			backendPath = "/"
		}

		proxy := newReverseProxy(rt.backendURL, backendPath)
		proxy.ServeHTTP(w, r)
	})
}
