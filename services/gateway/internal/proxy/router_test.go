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

func TestNewBlossomHandler_PassesPathThrough(t *testing.T) {
	var receivedPath string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	handler := NewBlossomHandler(backend.URL)

	hash := "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
	req := httptest.NewRequest("GET", "http://gateway/"+hash+".mp3", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if receivedPath != "/"+hash+".mp3" {
		t.Errorf("expected /%s.mp3, got %q", hash, receivedPath)
	}
}

func TestIsBlossomPath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/upload", true},
		{"/list/abc123", true},
		{"/" + "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", true},
		{"/" + "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" + ".mp3", true},
		{"/api/spaces", false},
		{"/health", false},
		{"/short-hash", false},
		{"/not-hex-gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg", false},
	}

	for _, tt := range tests {
		got := IsBlossomPath(tt.path)
		if got != tt.want {
			t.Errorf("IsBlossomPath(%q) = %v, want %v", tt.path, got, tt.want)
		}
	}
}

// An encoded "/" inside a path segment (a music d-tag like "ep/1", sent as
// "ep%2F1" by encodeURIComponent) must reach the backend still encoded —
// otherwise the segment splits and DELETE /music/track/:pubkey/:slug 404s.
func TestRouter_PreservesEncodedSlash(t *testing.T) {
	var gotURI, gotPath string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotURI = r.RequestURI
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	handler := NewRouter(backend.URL).Handler()
	pk := "56f03c035bf7d75b1120f2e0688a76ae3cd8e027d31b97ea97e171b3d33be4c5"

	tests := []struct {
		method, in, wantURI, wantPath string
	}{
		{"DELETE", "/api/music/track/" + pk + "/ep%2F1", "/music/track/" + pk + "/ep%2F1", "/music/track/" + pk + "/ep/1"},
		{"GET", "/api/music/resolve/album/" + pk + "/a%2Fb%2Fc?x=1", "/music/resolve/album/" + pk + "/a%2Fb%2Fc?x=1", "/music/resolve/album/" + pk + "/a/b/c"},
		{"GET", "/api/music/access/" + pk + "/%2Flead", "/music/access/" + pk + "/%2Flead", "/music/access/" + pk + "//lead"},
		// Other escapes keep round-tripping, plain paths stay plain.
		{"GET", "/api/invites/a%20b", "/invites/a%20b", "/invites/a b"},
		{"GET", "/api/spaces/seed1/members?limit=5", "/spaces/seed1/members?limit=5", "/spaces/seed1/members"},
		{"GET", "/api", "/", "/"},
	}
	for _, tt := range tests {
		gotURI, gotPath = "", ""
		req := httptest.NewRequest(tt.method, "http://gateway"+tt.in, nil)
		handler.ServeHTTP(httptest.NewRecorder(), req)
		if gotURI != tt.wantURI {
			t.Errorf("%s %s: backend request URI %q, want %q", tt.method, tt.in, gotURI, tt.wantURI)
		}
		if gotPath != tt.wantPath {
			t.Errorf("%s %s: backend decoded path %q, want %q", tt.method, tt.in, gotPath, tt.wantPath)
		}
	}
}

// Through a real ServeMux "/api/" mount (as cmd/gateway wires it) the encoded
// slash is neither redirected nor decoded on the way to the backend.
func TestRouter_EncodedSlashThroughServeMux(t *testing.T) {
	var gotURI string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotURI = r.RequestURI
		w.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()

	mux := http.NewServeMux()
	mux.Handle("/api/", NewRouter(backend.URL).Handler())
	gw := httptest.NewServer(mux)
	defer gw.Close()

	req, _ := http.NewRequest("DELETE", gw.URL+"/api/music/album/abc/x%2F%2Fy", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d, want 204 (no redirect)", resp.StatusCode)
	}
	if gotURI != "/music/album/abc/x%2F%2Fy" {
		t.Errorf("backend request URI %q, want /music/album/abc/x%%2F%%2Fy", gotURI)
	}
}

func TestNewBlossomHandler_PreservesEncoding(t *testing.T) {
	var gotURI string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotURI = r.RequestURI
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	req := httptest.NewRequest("GET", "http://gateway/list/a%2Fb", nil)
	NewBlossomHandler(backend.URL).ServeHTTP(httptest.NewRecorder(), req)
	if gotURI != "/list/a%2Fb" {
		t.Errorf("backend request URI %q, want /list/a%%2Fb", gotURI)
	}
}
