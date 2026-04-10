package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRouter_StripAPIPrefix(t *testing.T) {
	// Start a fake backend that records the path it receives.
	var receivedPath string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	router := NewRouter(backend.URL)
	handler := router.Handler()

	tests := []struct {
		inPath   string
		wantPath string
	}{
		{"/api/spaces", "/spaces"},
		{"/api/profiles/me", "/profiles/me"},
		{"/api/health", "/health"},
		{"/api", "/"},
	}

	for _, tt := range tests {
		receivedPath = ""
		req := httptest.NewRequest("GET", "http://gateway"+tt.inPath, nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if receivedPath != tt.wantPath {
			t.Errorf("path %q: backend got %q, want %q", tt.inPath, receivedPath, tt.wantPath)
		}
	}
}

func TestRouter_PreservesHeaders(t *testing.T) {
	var receivedPubkey string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPubkey = r.Header.Get("X-Auth-Pubkey")
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	router := NewRouter(backend.URL)
	handler := router.Handler()

	req := httptest.NewRequest("GET", "http://gateway/api/spaces", nil)
	req.Header.Set("X-Auth-Pubkey", "abc123")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if receivedPubkey != "abc123" {
		t.Errorf("expected X-Auth-Pubkey=abc123 forwarded, got %q", receivedPubkey)
	}
}

func TestRouter_StripsCORSFromBackend(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Backend sets CORS headers that should be stripped by the proxy.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	router := NewRouter(backend.URL)
	handler := router.Handler()

	req := httptest.NewRequest("GET", "http://gateway/api/spaces", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	corsHeaders := []string{
		"Access-Control-Allow-Origin",
		"Access-Control-Allow-Methods",
		"Access-Control-Allow-Headers",
		"Access-Control-Allow-Credentials",
		"Access-Control-Max-Age",
	}
	for _, h := range corsHeaders {
		if v := rr.Header().Get(h); v != "" {
			t.Errorf("expected %s to be stripped, got %q", h, v)
		}
	}
}

func TestNewUploadsHandler_PassesPathThrough(t *testing.T) {
	var receivedPath string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	handler := NewUploadsHandler(backend.URL)

	req := httptest.NewRequest("GET", "http://gateway/uploads/abc123.jpg", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if receivedPath != "/uploads/abc123.jpg" {
		t.Errorf("expected /uploads/abc123.jpg, got %q", receivedPath)
	}
}
