package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// An unparsable BACKEND_URL used to be ignored (url.Parse error dropped) and
// surfaced as a 502 on every request. It is a boot-time configuration error.
func TestNewRouter_RejectsUnparsableBackendURL(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected NewRouter to panic on an unparsable backend URL")
		}
	}()
	NewRouter("http://[::1", nil)
}

func TestNewBlossomHandler_RejectsUnparsableBackendURL(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected NewBlossomHandler to panic on an unparsable backend URL")
		}
	}()
	NewBlossomHandler("://nope", nil)
}

func TestValidateBackendURL(t *testing.T) {
	if err := ValidateBackendURL("http://backend:3002"); err != nil {
		t.Fatalf("valid URL rejected: %v", err)
	}
	for _, bad := range []string{"", "backend:3002", "http://", "://x", "ftp://backend"} {
		if err := ValidateBackendURL(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

// A backend that never sends headers must not pin a gateway goroutine (and
// the client) forever: the transport has a response-header timeout.
func TestReverseProxy_ResponseHeaderTimeout(t *testing.T) {
	release := make(chan struct{})
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	defer close(release)

	rt := NewRouter(backend.URL, nil)
	rt.transport = newBackendTransport(100 * time.Millisecond)

	req := httptest.NewRequest("GET", "http://gateway/api/spaces", nil)
	rr := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		rt.Handler().ServeHTTP(rr, req)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("proxy hung on a backend that never answered")
	}
	if rr.Code != http.StatusBadGateway && rr.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 502/504, got %d", rr.Code)
	}
}

// X-Wired-Client is set by our own apps and read by the backend's identity
// hook; it is not an internal header, so the proxy must pass it through as-is.
// Pairing it with a forged X-Auth-Pubkey must not change that header's fate:
// the strip still removes the pubkey (regression for the proxy auth-header
// bypass, #108) while the app header reaches the backend.
func TestRouter_ForwardsWiredClientHeader_StripsForgedPubkey(t *testing.T) {
	var gotClient, gotPubkey string
	var pubkeyPresent bool
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotClient = r.Header.Get("X-Wired-Client")
		gotPubkey = r.Header.Get("X-Auth-Pubkey")
		_, pubkeyPresent = r.Header["X-Auth-Pubkey"]
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	req := httptest.NewRequest("GET", "http://gateway/api/spaces", nil)
	req.Header.Set("X-Wired-Client", "desktop/0.7.2 (macos)")
	req.Header.Set("X-Auth-Pubkey", "deadbeef")
	req.Header.Set("X-Gateway-Auth", "1.00")
	rr := httptest.NewRecorder()
	StripInternalHeaders(NewRouter(backend.URL, nil).Handler()).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || gotClient != "desktop/0.7.2 (macos)" {
		t.Fatalf("status %d, backend saw X-Wired-Client=%q", rr.Code, gotClient)
	}
	if pubkeyPresent {
		t.Fatalf("forged X-Auth-Pubkey reached the backend next to X-Wired-Client: %q", gotPubkey)
	}
}
