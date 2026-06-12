package proxy

import "net/http"

// internalHeaders are set by the gateway after verification and trusted blindly
// by the backend. They MUST be stripped from every inbound request so a client
// can't forge them. Extend this list when new internal headers are added.
var internalHeaders = []string{"X-Auth-Pubkey"}

// StripInternalHeaders removes internal/trusted headers from inbound requests
// before any routing. It wraps the whole mux so routes that bypass the NIP-98
// middleware (/upload, /list/, /hls/) can't be fed a forged X-Auth-Pubkey (#108).
// The NIP-98 middleware re-injects the verified value deeper in the chain.
func StripInternalHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, h := range internalHeaders {
			r.Header.Del(h)
		}
		next.ServeHTTP(w, r)
	})
}
