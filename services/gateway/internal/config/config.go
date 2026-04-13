package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port           int
	BackendURL     string
	RedisURL       string
	RelayURL       string
	LogLevel       string
	AllowedOrigins []string
	TrustedProxies []string // CIDRs allowed to set X-Forwarded-* headers

	RateLimitRead   int // per-pubkey reads per minute
	RateLimitWrite  int // per-pubkey writes per minute
	RateLimitSearch int // per-pubkey searches per minute
}

func Load() *Config {
	port, _ := strconv.Atoi(getEnv("GATEWAY_PORT", "9080"))
	originsStr := getEnv("ALLOWED_ORIGINS", "*")
	var origins []string
	for _, o := range strings.Split(originsStr, ",") {
		if trimmed := strings.TrimSpace(o); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}

	var proxies []string
	for _, p := range strings.Split(getEnv("TRUSTED_PROXIES", "172.16.0.0/12,10.0.0.0/8,192.168.0.0/16,127.0.0.0/8"), ",") {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			proxies = append(proxies, trimmed)
		}
	}

	return &Config{
		Port:           port,
		BackendURL:     getEnv("BACKEND_URL", "http://localhost:3002"),
		RedisURL:       getEnv("REDIS_URL", "redis://localhost:6380"),
		RelayURL:       getEnv("RELAY_URL", "ws://localhost:7777"),
		LogLevel:       getEnv("LOG_LEVEL", "info"),
		AllowedOrigins: origins,
		TrustedProxies: proxies,

		RateLimitRead:   getEnvInt("RATE_LIMIT_READ_PER_MIN", 100),
		RateLimitWrite:  getEnvInt("RATE_LIMIT_WRITE_PER_MIN", 30),
		RateLimitSearch: getEnvInt("RATE_LIMIT_SEARCH_PER_MIN", 10),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
