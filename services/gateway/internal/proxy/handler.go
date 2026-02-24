package proxy

import (
	"net/http"
	"net/http/httputil"
	"net/url"
)

func newReverseProxy(targetURL, path string) *httputil.ReverseProxy {
	target, _ := url.Parse(targetURL)

	director := func(req *http.Request) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = path
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
