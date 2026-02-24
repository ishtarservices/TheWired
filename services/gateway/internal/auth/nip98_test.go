package auth

import (
	"testing"
)

func TestGetTagValue(t *testing.T) {
	tags := [][]string{
		{"u", "http://localhost:9080/api/spaces"},
		{"method", "GET"},
	}

	if v := getTagValue(tags, "u"); v != "http://localhost:9080/api/spaces" {
		t.Errorf("expected URL tag, got %s", v)
	}

	if v := getTagValue(tags, "method"); v != "GET" {
		t.Errorf("expected GET method, got %s", v)
	}

	if v := getTagValue(tags, "missing"); v != "" {
		t.Errorf("expected empty string for missing tag, got %s", v)
	}
}

func TestVerifyNIP98_InvalidKind(t *testing.T) {
	event := &NostrEvent{
		Kind: 1,
	}
	err := VerifyNIP98(event, "http://example.com", "GET")
	if err == nil {
		t.Error("expected error for invalid kind")
	}
}
