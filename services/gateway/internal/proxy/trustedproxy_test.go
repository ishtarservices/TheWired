package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTrustedProxyMiddleware_TrustedPreservesHeaders(t *testing.T) {
	var gotXFF, gotXFP string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotXFF = r.Header.Get("X-Forwarded-For")
		gotXFP = r.Header.Get("X-Forwarded-Proto")
		w.WriteHeader(http.StatusOK)
	})

	handler := TrustedProxyMiddleware([]string{"127.0.0.0/8"}, inner)

	req := httptest.NewRequest("GET", "http://example.com/api/test", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	req.Header.Set("X-Forwarded-For", "203.0.113.50")
	req.Header.Set("X-Forwarded-Proto", "https")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if gotXFF != "203.0.113.50" {
		t.Errorf("trusted proxy: X-Forwarded-For should be preserved, got %q", gotXFF)
	}
	if gotXFP != "https" {
		t.Errorf("trusted proxy: X-Forwarded-Proto should be preserved, got %q", gotXFP)
	}
}

func TestTrustedProxyMiddleware_UntrustedStripsHeaders(t *testing.T) {
	var gotXFF, gotXFP, gotXFH, gotXRI string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotXFF = r.Header.Get("X-Forwarded-For")
		gotXFP = r.Header.Get("X-Forwarded-Proto")
		gotXFH = r.Header.Get("X-Forwarded-Host")
		gotXRI = r.Header.Get("X-Real-Ip")
		w.WriteHeader(http.StatusOK)
	})

	handler := TrustedProxyMiddleware([]string{"10.0.0.0/8"}, inner)

	req := httptest.NewRequest("GET", "http://example.com/api/test", nil)
	req.RemoteAddr = "203.0.113.50:12345" // NOT in 10.0.0.0/8
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "evil.com")
	req.Header.Set("X-Real-Ip", "1.2.3.4")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if gotXFF != "" {
		t.Errorf("untrusted proxy: X-Forwarded-For should be stripped, got %q", gotXFF)
	}
	if gotXFP != "" {
		t.Errorf("untrusted proxy: X-Forwarded-Proto should be stripped, got %q", gotXFP)
	}
	if gotXFH != "" {
		t.Errorf("untrusted proxy: X-Forwarded-Host should be stripped, got %q", gotXFH)
	}
	if gotXRI != "" {
		t.Errorf("untrusted proxy: X-Real-Ip should be stripped, got %q", gotXRI)
	}
}

func TestTrustedProxyMiddleware_BareIPTrusted(t *testing.T) {
	var gotXFF string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotXFF = r.Header.Get("X-Forwarded-For")
		w.WriteHeader(http.StatusOK)
	})

	// Trusted CIDRs include a bare IP (no /mask).
	handler := TrustedProxyMiddleware([]string{"192.168.1.1"}, inner)

	req := httptest.NewRequest("GET", "http://example.com/", nil)
	req.RemoteAddr = "192.168.1.1:9999"
	req.Header.Set("X-Forwarded-For", "10.20.30.40")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if gotXFF != "10.20.30.40" {
		t.Errorf("bare IP trust: X-Forwarded-For should be preserved, got %q", gotXFF)
	}
}

func TestTrustedProxyMiddleware_EmptyCIDRs_StripsAll(t *testing.T) {
	var gotXFF string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotXFF = r.Header.Get("X-Forwarded-For")
		w.WriteHeader(http.StatusOK)
	})

	// No trusted CIDRs -- everything is untrusted.
	handler := TrustedProxyMiddleware(nil, inner)

	req := httptest.NewRequest("GET", "http://example.com/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if gotXFF != "" {
		t.Errorf("empty CIDRs: X-Forwarded-For should be stripped, got %q", gotXFF)
	}
}

func TestParseCIDRs_InvalidEntries(t *testing.T) {
	// Invalid CIDR and invalid bare IP should be skipped.
	nets := parseCIDRs([]string{"not-a-cidr", "also-invalid", "10.0.0.0/8"})
	if len(nets) != 1 {
		t.Errorf("expected 1 valid net, got %d", len(nets))
	}
}

func TestParseCIDRs_IPv6(t *testing.T) {
	nets := parseCIDRs([]string{"::1"})
	if len(nets) != 1 {
		t.Errorf("expected 1 net for IPv6 loopback, got %d", len(nets))
	}
	// Mask should be /128 for a single IPv6 address.
	ones, bits := nets[0].Mask.Size()
	if ones != 128 || bits != 128 {
		t.Errorf("expected /128 mask, got /%d (bits=%d)", ones, bits)
	}
}

func TestIsTrusted_NoPort(t *testing.T) {
	nets := parseCIDRs([]string{"10.0.0.0/8"})
	// isTrusted should handle remoteAddr without a port.
	if !isTrusted("10.1.2.3", nets) {
		t.Error("expected 10.1.2.3 (no port) to be trusted in 10.0.0.0/8")
	}
}

func TestIsTrusted_InvalidIP(t *testing.T) {
	nets := parseCIDRs([]string{"10.0.0.0/8"})
	if isTrusted("not-an-ip", nets) {
		t.Error("expected invalid IP to not be trusted")
	}
}
