package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// NostrEvent represents a NIP-98 auth event (kind 27235)
type NostrEvent struct {
	ID        string     `json:"id"`
	PubKey    string     `json:"pubkey"`
	CreatedAt int64      `json:"created_at"`
	Kind      int        `json:"kind"`
	Tags      [][]string `json:"tags"`
	Content   string     `json:"content"`
	Sig       string     `json:"sig"`
}

// VerifyNIP98 verifies a NIP-98 auth event
func VerifyNIP98(event *NostrEvent, expectedURL, expectedMethod string) error {
	// Check kind
	if event.Kind != 27235 {
		return fmt.Errorf("invalid kind: expected 27235, got %d", event.Kind)
	}

	// Check timestamp (within 60 seconds)
	now := time.Now().Unix()
	if math.Abs(float64(now-event.CreatedAt)) > 60 {
		return fmt.Errorf("event too old or too new: created_at=%d, now=%d", event.CreatedAt, now)
	}

	// Check u tag (URL)
	urlTag := getTagValue(event.Tags, "u")
	if urlTag != expectedURL {
		return fmt.Errorf("URL mismatch: expected %s, got %s", expectedURL, urlTag)
	}

	// Check method tag
	methodTag := getTagValue(event.Tags, "method")
	if methodTag != expectedMethod {
		return fmt.Errorf("method mismatch: expected %s, got %s", expectedMethod, methodTag)
	}

	// Verify event ID
	if err := verifyEventID(event); err != nil {
		return fmt.Errorf("invalid event ID: %w", err)
	}

	// Verify schnorr signature
	if err := verifySignature(event); err != nil {
		return fmt.Errorf("invalid signature: %w", err)
	}

	return nil
}

func verifyEventID(event *NostrEvent) error {
	serialized, err := json.Marshal([]interface{}{
		0,
		event.PubKey,
		event.CreatedAt,
		event.Kind,
		event.Tags,
		event.Content,
	})
	if err != nil {
		return err
	}

	hash := sha256.Sum256(serialized)
	expectedID := hex.EncodeToString(hash[:])

	if expectedID != event.ID {
		return fmt.Errorf("ID mismatch: expected %s, got %s", expectedID, event.ID)
	}
	return nil
}

func verifySignature(event *NostrEvent) error {
	idBytes, err := hex.DecodeString(event.ID)
	if err != nil || len(idBytes) != 32 {
		return fmt.Errorf("invalid event ID hex")
	}

	sigBytes, err := hex.DecodeString(event.Sig)
	if err != nil || len(sigBytes) != 64 {
		return fmt.Errorf("invalid signature hex")
	}

	pubkeyBytes, err := hex.DecodeString(event.PubKey)
	if err != nil || len(pubkeyBytes) != 32 {
		return fmt.Errorf("invalid pubkey hex")
	}

	// Parse 32-byte x-only BIP-340 pubkey
	pubKey, err := schnorr.ParsePubKey(pubkeyBytes)
	if err != nil {
		return fmt.Errorf("failed to parse pubkey: %w", err)
	}

	// Parse 64-byte BIP-340 schnorr signature
	sig, err := schnorr.ParseSignature(sigBytes)
	if err != nil {
		return fmt.Errorf("failed to parse signature: %w", err)
	}

	// Verify BIP-340 schnorr signature over the event ID hash
	if !sig.Verify(idBytes, pubKey) {
		return fmt.Errorf("signature verification failed")
	}

	return nil
}

func getTagValue(tags [][]string, name string) string {
	for _, tag := range tags {
		if len(tag) >= 2 && tag[0] == name {
			return tag[1]
		}
	}
	return ""
}
