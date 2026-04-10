package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"
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

func TestGetTagValue_EmptyTags(t *testing.T) {
	var tags [][]string
	if v := getTagValue(tags, "u"); v != "" {
		t.Errorf("expected empty string for nil tags, got %s", v)
	}
}

func TestGetTagValue_ShortTag(t *testing.T) {
	// A tag with only one element (no value) should not match.
	tags := [][]string{
		{"u"},
	}
	if v := getTagValue(tags, "u"); v != "" {
		t.Errorf("expected empty string for short tag, got %s", v)
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

func TestVerifyNIP98_ExpiredTimestamp(t *testing.T) {
	event := &NostrEvent{
		Kind:      27235,
		CreatedAt: time.Now().Unix() - 120, // 2 minutes ago
		Tags: [][]string{
			{"u", "http://example.com/api/test"},
			{"method", "GET"},
		},
	}
	err := VerifyNIP98(event, "http://example.com/api/test", "GET")
	if err == nil {
		t.Error("expected error for expired timestamp")
	}
}

func TestVerifyNIP98_FutureTimestamp(t *testing.T) {
	event := &NostrEvent{
		Kind:      27235,
		CreatedAt: time.Now().Unix() + 120, // 2 minutes in the future
		Tags: [][]string{
			{"u", "http://example.com/api/test"},
			{"method", "GET"},
		},
	}
	err := VerifyNIP98(event, "http://example.com/api/test", "GET")
	if err == nil {
		t.Error("expected error for future timestamp")
	}
}

func TestVerifyNIP98_URLMismatch(t *testing.T) {
	event := &NostrEvent{
		Kind:      27235,
		CreatedAt: time.Now().Unix(),
		Tags: [][]string{
			{"u", "http://example.com/api/wrong"},
			{"method", "GET"},
		},
	}
	err := VerifyNIP98(event, "http://example.com/api/correct", "GET")
	if err == nil {
		t.Error("expected error for URL mismatch")
	}
}

func TestVerifyNIP98_MethodMismatch(t *testing.T) {
	event := &NostrEvent{
		Kind:      27235,
		CreatedAt: time.Now().Unix(),
		Tags: [][]string{
			{"u", "http://example.com/api/test"},
			{"method", "POST"},
		},
	}
	err := VerifyNIP98(event, "http://example.com/api/test", "GET")
	if err == nil {
		t.Error("expected error for method mismatch")
	}
}

func TestVerifyNIP98_MissingURLTag(t *testing.T) {
	event := &NostrEvent{
		Kind:      27235,
		CreatedAt: time.Now().Unix(),
		Tags: [][]string{
			{"method", "GET"},
		},
	}
	err := VerifyNIP98(event, "http://example.com/api/test", "GET")
	if err == nil {
		t.Error("expected error for missing URL tag")
	}
}

func TestVerifyNIP98_MissingMethodTag(t *testing.T) {
	event := &NostrEvent{
		Kind:      27235,
		CreatedAt: time.Now().Unix(),
		Tags: [][]string{
			{"u", "http://example.com/api/test"},
		},
	}
	err := VerifyNIP98(event, "http://example.com/api/test", "GET")
	if err == nil {
		t.Error("expected error for missing method tag")
	}
}

// --- verifyEventID tests ---

// hexRepeat returns a 64-char hex string by repeating char c.
func hexRepeat(c byte) string {
	return strings.Repeat(string(c), 64)
}

func computeEventID(event *NostrEvent) string {
	serialized, _ := json.Marshal([]interface{}{
		0, event.PubKey, event.CreatedAt, event.Kind, event.Tags, event.Content,
	})
	hash := sha256.Sum256(serialized)
	return hex.EncodeToString(hash[:])
}

func TestVerifyEventID_ValidHash(t *testing.T) {
	event := &NostrEvent{
		PubKey:    hexRepeat('a'),
		CreatedAt: 1700000000,
		Kind:      27235,
		Tags: [][]string{
			{"u", "http://example.com"},
			{"method", "GET"},
		},
		Content: "",
	}
	event.ID = computeEventID(event)

	if err := verifyEventID(event); err != nil {
		t.Errorf("expected valid event ID, got error: %v", err)
	}
}

func TestVerifyEventID_InvalidHash(t *testing.T) {
	event := &NostrEvent{
		ID:        hexRepeat('0'),
		PubKey:    hexRepeat('a'),
		CreatedAt: 1700000000,
		Kind:      27235,
		Tags: [][]string{
			{"u", "http://example.com"},
			{"method", "GET"},
		},
		Content: "",
	}

	err := verifyEventID(event)
	if err == nil {
		t.Error("expected error for mismatched event ID")
	}
}

func TestVerifyEventID_EmptyContent(t *testing.T) {
	event := &NostrEvent{
		PubKey:    hexRepeat('b'),
		CreatedAt: 1700000000,
		Kind:      27235,
		Tags:      [][]string{},
		Content:   "",
	}
	event.ID = computeEventID(event)

	if err := verifyEventID(event); err != nil {
		t.Errorf("expected valid event ID with empty content, got error: %v", err)
	}
}

func TestVerifyEventID_WithContent(t *testing.T) {
	event := &NostrEvent{
		PubKey:    hexRepeat('c'),
		CreatedAt: 1700000000,
		Kind:      27235,
		Tags:      [][]string{{"u", "http://test.com"}, {"method", "POST"}},
		Content:   "hello world",
	}
	event.ID = computeEventID(event)

	if err := verifyEventID(event); err != nil {
		t.Errorf("expected valid event ID with content, got error: %v", err)
	}
}

// --- verifySignature tests ---

func TestVerifySignature_InvalidIDHex(t *testing.T) {
	event := &NostrEvent{
		ID:     "not-hex",
		PubKey: hexRepeat('a'),
		Sig:    strings.Repeat("aa", 64),
	}
	err := verifySignature(event)
	if err == nil {
		t.Error("expected error for invalid ID hex")
	}
}

func TestVerifySignature_ShortID(t *testing.T) {
	event := &NostrEvent{
		ID:     "aabb",
		PubKey: hexRepeat('a'),
		Sig:    strings.Repeat("aa", 64),
	}
	err := verifySignature(event)
	if err == nil {
		t.Error("expected error for short ID (not 32 bytes)")
	}
}

func TestVerifySignature_InvalidSigHex(t *testing.T) {
	event := &NostrEvent{
		ID:     hexRepeat('a'),
		PubKey: hexRepeat('a'),
		Sig:    "not-hex",
	}
	err := verifySignature(event)
	if err == nil {
		t.Error("expected error for invalid sig hex")
	}
}

func TestVerifySignature_ShortSig(t *testing.T) {
	event := &NostrEvent{
		ID:     hexRepeat('a'),
		PubKey: hexRepeat('a'),
		Sig:    "aabb",
	}
	err := verifySignature(event)
	if err == nil {
		t.Error("expected error for short sig (not 64 bytes)")
	}
}

func TestVerifySignature_InvalidPubkeyHex(t *testing.T) {
	event := &NostrEvent{
		ID:     hexRepeat('a'),
		PubKey: "not-hex",
		Sig:    strings.Repeat("aa", 64),
	}
	err := verifySignature(event)
	if err == nil {
		t.Error("expected error for invalid pubkey hex")
	}
}

func TestVerifySignature_ShortPubkey(t *testing.T) {
	event := &NostrEvent{
		ID:     hexRepeat('a'),
		PubKey: "aabb",
		Sig:    strings.Repeat("aa", 64),
	}
	err := verifySignature(event)
	if err == nil {
		t.Error("expected error for short pubkey (not 32 bytes)")
	}
}

func TestVerifySignature_MismatchedSignature(t *testing.T) {
	// Use the generator point x-coordinate as pubkey -- it's a valid secp256k1 point.
	event := &NostrEvent{
		ID:     hexRepeat('a'),
		PubKey: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
		Sig:    strings.Repeat("ab", 64),
	}

	err := verifySignature(event)
	if err == nil {
		t.Error("expected error for mismatched signature")
	}
}
