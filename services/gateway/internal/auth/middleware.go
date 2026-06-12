package auth

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
)

var (
	errPayloadMismatch   = errors.New("payload hash mismatch")
	errPayloadTooLarge   = errors.New("payload too large to verify")
	errPayloadUnreadable = errors.New("could not read request body")
)

// maxPayloadVerifyBytes bounds how much request body we'll buffer to verify a
// NIP-98 `payload` tag. Authenticated API bodies are small JSON; this cap stops
// a forged huge-body request (with a payload tag) from ballooning gateway memory.
// Bodies larger than this with a payload tag are rejected, not silently passed.
const maxPayloadVerifyBytes = 8 << 20 // 8 MiB

// NIP98Middleware verifies the NIP-98 auth header with no replay protection.
// Used on the public Blossom catch-all, where bodies are large blobs and the
// replay surface is low.
func NIP98Middleware(next http.Handler) http.Handler {
	return nip98Middleware(nil, next)
}

// NIP98MiddlewareWithReplay verifies NIP-98 auth and additionally rejects replays
// via `guard` (#64). A nil guard disables replay checks. On a guard error the
// request is allowed through (fail-open) so a Redis blip can't lock out auth.
func NIP98MiddlewareWithReplay(guard ReplayGuard, next http.Handler) http.Handler {
	return nip98Middleware(guard, next)
}

func nip98Middleware(guard ReplayGuard, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Always strip X-Auth-Pubkey from inbound requests — it is an
		// internal header injected by this middleware after verification.
		// Without this, an unauthenticated client could forge it.
		r.Header.Del("X-Auth-Pubkey")

		authHeader := r.Header.Get("Authorization")

		// Allow unauthenticated requests (pubkey will be empty)
		if authHeader == "" {
			next.ServeHTTP(w, r)
			return
		}

		if !strings.HasPrefix(authHeader, "Nostr ") {
			http.Error(w, `{"error":"invalid auth scheme","code":"INVALID_AUTH"}`, http.StatusUnauthorized)
			return
		}

		// Decode base64 event
		eventB64 := strings.TrimPrefix(authHeader, "Nostr ")
		eventJSON, err := base64.StdEncoding.DecodeString(eventB64)
		if err != nil {
			http.Error(w, `{"error":"invalid base64","code":"INVALID_AUTH"}`, http.StatusUnauthorized)
			return
		}

		var event NostrEvent
		if err := json.Unmarshal(eventJSON, &event); err != nil {
			http.Error(w, `{"error":"invalid event JSON","code":"INVALID_AUTH"}`, http.StatusUnauthorized)
			return
		}

		// Build expected URL from request.
		// Behind a TLS-terminating reverse proxy (Caddy, nginx, etc.)
		// the direct connection is plain HTTP, so check X-Forwarded-Proto first.
		scheme := "http"
		if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
			scheme = proto
		} else if r.TLS != nil {
			scheme = "https"
		}
		// #63 — the client signs the FULL request URL including the query string
		// (NIP-98: the `u` tag MUST equal the absolute request URL). Comparing
		// path-only 401s every authenticated request that carries query params.
		// RequestURI() preserves the raw path+query as sent on the wire.
		expectedURL := scheme + "://" + r.Host + r.URL.RequestURI()

		if err := VerifyNIP98(&event, expectedURL, r.Method); err != nil {
			http.Error(w, `{"error":"`+err.Error()+`","code":"AUTH_FAILED"}`, http.StatusUnauthorized)
			return
		}

		// #64 — payload tag is verify-if-present: when the client binds the body
		// hash into the auth event, the body MUST match. (Clients emit no payload
		// tag today; this is forward-compatible and a no-op when absent.)
		if payloadTag := getTagValue(event.Tags, "payload"); payloadTag != "" {
			if err := verifyPayload(r, payloadTag); err != nil {
				http.Error(w, `{"error":"`+err.Error()+`","code":"AUTH_FAILED"}`, http.StatusUnauthorized)
				return
			}
		}

		// #64 — single-use replay protection, checked AFTER full verification so an
		// attacker can't poison the cache with unverified ids. Fail-open on a store
		// error: a Redis outage must not 401 every authenticated request.
		if guard != nil {
			fresh, err := guard.Reserve(r.Context(), event.ID)
			if err != nil {
				log.Printf("NIP-98 replay guard error (fail-open): %v", err)
			} else if !fresh {
				http.Error(w, `{"error":"auth event already used","code":"AUTH_REPLAY"}`, http.StatusUnauthorized)
				return
			}
		}

		// Inject pubkey header for backend
		r.Header.Set("X-Auth-Pubkey", event.PubKey)
		next.ServeHTTP(w, r)
	})
}

// verifyPayload checks that sha256(body) hex-equals the NIP-98 `payload` tag,
// then restores r.Body so the proxy can forward it unchanged. Bodies over the
// cap are rejected (we won't buffer unbounded memory to verify a claimed hash).
func verifyPayload(r *http.Request, payloadTag string) error {
	if r.Body == nil {
		// A payload tag with no body can only match the empty-string hash.
		return matchHash(payloadTag, nil)
	}
	limited := io.LimitReader(r.Body, maxPayloadVerifyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return errPayloadUnreadable
	}
	if len(body) > maxPayloadVerifyBytes {
		// Drain+restore best-effort, but reject: can't verify within the cap.
		r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), r.Body))
		return errPayloadTooLarge
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	return matchHash(payloadTag, body)
}

func matchHash(payloadTag string, body []byte) error {
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != payloadTag {
		return errPayloadMismatch
	}
	return nil
}
