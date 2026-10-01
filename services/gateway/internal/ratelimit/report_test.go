package ratelimit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// reportLimiter returns a limiter on the dev Redis (db 15), or skips when it is
// not reachable — the report bucket's behaviour needs the real Lua script.
func reportLimiter(t *testing.T, limits Limits) *Limiter {
	t.Helper()
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		url = "redis://localhost:6380/15"
	}
	l, err := NewLimiter(url, limits)
	if err != nil {
		t.Fatalf("limiter: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := l.client.Ping(ctx).Err(); err != nil {
		t.Skipf("redis not reachable at %s: %v", url, err)
	}
	return l
}

func reportRequest(ip, pubkey string) *http.Request {
	req := httptest.NewRequest("POST", "http://localhost:9080/api/reports", nil)
	req.RemoteAddr = ip + ":5555"
	if pubkey != "" {
		req.Header.Set("X-Auth-Pubkey", pubkey)
	}
	return req
}

// A guest report needs no key, so the intake is capped per IP per hour on top
// of the write budget, and the backend learns the IP (to hash) only here.
func TestReportIntake_GuestBucketIsPerIPAndTight(t *testing.T) {
	limits := DefaultLimits
	limits.ReportAnonPerHour = 3
	l := reportLimiter(t, limits)
	const ip = "198.51.100.23"
	l.client.Del(context.Background(), "ratelimit:report:anon:"+ip, "ratelimit:write:anon:"+ip)

	var sawIP string
	handler := RateLimitMiddleware(l, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawIP = r.Header.Get(ClientIPHeader)
		w.WriteHeader(http.StatusOK)
	}))

	for i := 0; i < 3; i++ {
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, reportRequest(ip, ""))
		if rr.Code != http.StatusOK {
			t.Fatalf("report %d: expected 200, got %d", i, rr.Code)
		}
		if sawIP != ip {
			t.Fatalf("backend should receive the guest IP, got %q", sawIP)
		}
	}
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, reportRequest(ip, ""))
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("4th guest report: expected 429, got %d", rr.Code)
	}
	if got := rr.Body.String(); !strings.Contains(got, "REPORT_RATE_LIMITED") {
		t.Errorf("expected REPORT_RATE_LIMITED body, got %q", got)
	}

	// Another IP is untouched.
	const other = "198.51.100.24"
	l.client.Del(context.Background(), "ratelimit:report:anon:"+other, "ratelimit:write:anon:"+other)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, reportRequest(other, ""))
	if rr.Code != http.StatusOK {
		t.Errorf("other IP: expected 200, got %d", rr.Code)
	}
}

// The backend serves /reports/ too: a trailing slash must not skip the bucket.
func TestReportIntake_TrailingSlashCountsToo(t *testing.T) {
	limits := DefaultLimits
	limits.ReportAnonPerHour = 1
	l := reportLimiter(t, limits)
	const ip = "198.51.100.27"
	l.client.Del(context.Background(), "ratelimit:report:anon:"+ip, "ratelimit:write:anon:"+ip)
	sawIP := ""
	handler := RateLimitMiddleware(l, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawIP = r.Header.Get(ClientIPHeader)
		w.WriteHeader(http.StatusOK)
	}))
	slashed := func() *http.Request {
		req := httptest.NewRequest("POST", "http://localhost:9080/api/reports/", nil)
		req.RemoteAddr = ip + ":5555"
		return req
	}
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, slashed())
	if rr.Code != http.StatusOK || sawIP != ip {
		t.Fatalf("first slashed report: code %d, ip %q", rr.Code, sawIP)
	}
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, slashed())
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("second slashed report should hit the cap, got %d", rr.Code)
	}
}

// A signed-in reporter is keyed by pubkey and never forwards an IP.
func TestReportIntake_SignedInIsKeyedByPubkeyWithoutIP(t *testing.T) {
	l := reportLimiter(t, DefaultLimits)
	const pk = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
	l.client.Del(context.Background(), "ratelimit:report:"+pk, "ratelimit:write:"+pk)

	sawIP := "unset"
	handler := RateLimitMiddleware(l, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawIP = r.Header.Get(ClientIPHeader)
		w.WriteHeader(http.StatusOK)
	}))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, reportRequest("198.51.100.25", pk))
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if sawIP != "" {
		t.Errorf("signed-in report must not carry the client IP, got %q", sawIP)
	}
}

// Other writes never get the client IP header.
func TestReportIntake_OnlyTheReportRouteForwardsIP(t *testing.T) {
	l := reportLimiter(t, DefaultLimits)
	const ip = "198.51.100.26"
	l.client.Del(context.Background(), "ratelimit:write:anon:"+ip)
	sawIP := "unset"
	handler := RateLimitMiddleware(l, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawIP = r.Header.Get(ClientIPHeader)
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("POST", "http://localhost:9080/api/spaces", nil)
	req.RemoteAddr = ip + ":5555"
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if sawIP != "" {
		t.Errorf("non-report route forwarded the client IP: %q", sawIP)
	}
}
