package cors

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func corsProbe(t *testing.T, allowed []string, origin string) http.Header {
	t.Helper()
	h := CORSMiddleware(allowed)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "http://gateway/api/spaces", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr.Header()
}

// An empty list (the production default when ALLOWED_ORIGINS is unset) must
// reflect nothing — not fall back to "*".
func TestCORS_EmptyListDeniesEveryOrigin(t *testing.T) {
	for _, origin := range []string{"https://evil.example", "https://thewired.app", "tauri://localhost"} {
		if got := corsProbe(t, nil, origin).Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("origin %s: Access-Control-Allow-Origin = %q, want none", origin, got)
		}
	}
}

func TestCORS_StarAllowsAll(t *testing.T) {
	if got := corsProbe(t, []string{"*"}, "https://anything.example").Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("got %q, want *", got)
	}
}

func TestCORS_ListedOriginsReflected_UnlistedDenied(t *testing.T) {
	allowed := []string{"https://thewired.app", "tauri://localhost", "https://tauri.localhost", "http://localhost"}
	for _, origin := range []string{"https://thewired.app", "tauri://localhost", "https://tauri.localhost", "http://localhost:4173"} {
		h := corsProbe(t, allowed, origin)
		if got := h.Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("origin %s: reflected %q", origin, got)
		}
		if h.Get("Vary") != "Origin" {
			t.Errorf("origin %s: Vary: Origin missing", origin)
		}
	}
	for _, origin := range []string{"https://evil.example", "https://thewired.app.evil.example", "http://tauri.localhost"} {
		if got := corsProbe(t, allowed, origin).Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("origin %s: reflected %q, want none", origin, got)
		}
	}
}

func TestCORS_PreflightShortCircuits(t *testing.T) {
	called := false
	h := CORSMiddleware([]string{"https://thewired.app"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	req := httptest.NewRequest("OPTIONS", "http://gateway/api/spaces", nil)
	req.Header.Set("Origin", "https://thewired.app")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent || called {
		t.Fatalf("preflight: %d called=%v", rr.Code, called)
	}
}

// X-Wired-Client (which of our apps an authenticated call comes from) is a
// custom header, so a browser-context client (Vite dev, tauri localhost) only
// sends it when the preflight allows it.
func TestCORS_AllowsWiredClientHeader(t *testing.T) {
	got := corsProbe(t, []string{"https://thewired.app"}, "https://thewired.app").Get("Access-Control-Allow-Headers")
	for _, want := range []string{"Authorization", "Content-Type", "X-Wired-Client"} {
		if !strings.Contains(got, want) {
			t.Errorf("Access-Control-Allow-Headers = %q, missing %s", got, want)
		}
	}
}
