package ratelimit

import (
	"testing"
)

func TestDefaultLimits(t *testing.T) {
	if DefaultLimits.ReadPerMin != 100 {
		t.Errorf("expected ReadPerMin=100, got %d", DefaultLimits.ReadPerMin)
	}
	if DefaultLimits.WritePerMin != 30 {
		t.Errorf("expected WritePerMin=30, got %d", DefaultLimits.WritePerMin)
	}
	if DefaultLimits.SearchPerMin != 10 {
		t.Errorf("expected SearchPerMin=10, got %d", DefaultLimits.SearchPerMin)
	}
}

func TestNewLimiter_InvalidURL(t *testing.T) {
	_, err := NewLimiter("not-a-valid-url", DefaultLimits)
	if err == nil {
		t.Error("expected error for invalid Redis URL")
	}
}

func TestNewLimiter_ValidURL(t *testing.T) {
	limiter, err := NewLimiter("redis://localhost:6379", DefaultLimits)
	if err != nil {
		t.Fatalf("unexpected error for valid Redis URL: %v", err)
	}
	if limiter == nil {
		t.Fatal("expected non-nil limiter")
	}
	if limiter.client == nil {
		t.Fatal("expected non-nil redis client")
	}
}

func TestNewLimiter_CustomLimits(t *testing.T) {
	limits := Limits{ReadPerMin: 200, WritePerMin: 50, SearchPerMin: 20}
	limiter, err := NewLimiter("redis://localhost:6379", limits)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if limiter.limits.ReadPerMin != 200 {
		t.Errorf("expected ReadPerMin=200, got %d", limiter.limits.ReadPerMin)
	}
	if limiter.limits.WritePerMin != 50 {
		t.Errorf("expected WritePerMin=50, got %d", limiter.limits.WritePerMin)
	}
	if limiter.limits.SearchPerMin != 20 {
		t.Errorf("expected SearchPerMin=20, got %d", limiter.limits.SearchPerMin)
	}
}

func TestAllowResult_Fields(t *testing.T) {
	r := AllowResult{Allowed: true, Remaining: 99}
	if !r.Allowed {
		t.Error("expected Allowed=true")
	}
	if r.Remaining != 99 {
		t.Errorf("expected Remaining=99, got %d", r.Remaining)
	}
}
