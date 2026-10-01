package proxy

import (
	"net/http"
	"net/http/httputil"
	"net/url"
)

// newReverseProxy forwards to targetURL with the request path replaced by
// `path` (decoded) / `rawPath` (its original percent-encoding, or "" when the
// default encoding of `path` is already exact). Carrying RawPath matters for
// path segments holding an encoded "/" (`%2F`): with only the decoded Path set,
// the outgoing request line re-encodes it as a literal "/", the segment splits
// in two, and the backend route no longer matches (e.g. a music d-tag with a
// slash in DELETE /music/track/:pubkey/:slug). url.URL ignores a RawPath that
// isn't a valid encoding of Path, so a mismatched value degrades to the old
// decoded behaviour rather than forwarding the wrong path.
func newReverseProxy(targetURL, path, rawPath string) *httputil.ReverseProxy {
	target, _ := url.Parse(targetURL)

	director := func(req *http.Request) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = path
		req.URL.RawPath = rawPath
		req.Host = target.Host
	}

	proxy := &httputil.ReverseProxy{Director: director}

	// Strip CORS headers from backend response — the gateway CORS middleware owns these.
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("Access-Control-Allow-Origin")
		resp.Header.Del("Access-Control-Allow-Methods")
		resp.Header.Del("Access-Control-Allow-Headers")
		resp.Header.Del("Access-Control-Allow-Credentials")
		resp.Header.Del("Access-Control-Max-Age")
		return nil
	}

	return proxy
}
