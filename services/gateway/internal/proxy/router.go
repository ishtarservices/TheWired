package proxy

import (
	"net/http"
	"strings"
)

// Router maps API paths to backend services
type Router struct {
	backendURL string
}

func NewRouter(backendURL string) *Router {
	return &Router{backendURL: backendURL}
}

// NewUploadsHandler returns a handler that proxies /uploads/ requests to the backend without auth.
func NewUploadsHandler(backendURL string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxy := newReverseProxy(backendURL, r.URL.Path)
		proxy.ServeHTTP(w, r)
	})
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
