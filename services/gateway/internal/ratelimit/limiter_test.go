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
	_, err := NewLimiter("not-a-valid-url")
	if err == nil {
		t.Error("expected error for invalid Redis URL")
	}
}

func TestNewLimiter_ValidURL(t *testing.T) {
	// This should parse successfully. We won't actually connect to Redis.
	limiter, err := NewLimiter("redis://localhost:6379")
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
