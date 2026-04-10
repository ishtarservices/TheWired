package proxy

import (
	"net"
	"net/http"
	"strings"
)

// TrustedProxyMiddleware strips X-Forwarded-* headers from requests that
// do not originate from a trusted proxy CIDR. This prevents external clients
// from spoofing their IP or protocol to bypass rate-limiting or auth checks.
func TrustedProxyMiddleware(trustedCIDRs []string, next http.Handler) http.Handler {
	nets := parseCIDRs(trustedCIDRs)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isTrusted(r.RemoteAddr, nets) {
			r.Header.Del("X-Forwarded-For")
			r.Header.Del("X-Forwarded-Proto")
			r.Header.Del("X-Forwarded-Host")
			r.Header.Del("X-Real-Ip")
		}
		next.ServeHTTP(w, r)
	})
}

func parseCIDRs(cidrs []string) []*net.IPNet {
	var nets []*net.IPNet
	for _, cidr := range cidrs {
		_, ipnet, err := net.ParseCIDR(cidr)
		if err != nil {
			// Try as a bare IP (e.g. "127.0.0.1")
			ip := net.ParseIP(cidr)
			if ip == nil {
				continue
			}
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			ipnet = &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)}
		}
		nets = append(nets, ipnet)
	}
	return nets
}

func isTrusted(remoteAddr string, nets []*net.IPNet) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil {
		return false
	}
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}
