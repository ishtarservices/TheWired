package auth

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
)

// NIP98Middleware extracts and verifies the NIP-98 auth header
func NIP98Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

		// Build expected URL from request
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		expectedURL := scheme + "://" + r.Host + r.URL.Path

		if err := VerifyNIP98(&event, expectedURL, r.Method); err != nil {
			http.Error(w, `{"error":"`+err.Error()+`","code":"AUTH_FAILED"}`, http.StatusUnauthorized)
			return
		}

		// Inject pubkey header for backend
		r.Header.Set("X-Auth-Pubkey", event.PubKey)
		next.ServeHTTP(w, r)
	})
}
