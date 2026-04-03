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

	return &Config{
		Port:           port,
		BackendURL:     getEnv("BACKEND_URL", "http://localhost:3002"),
		RedisURL:       getEnv("REDIS_URL", "redis://localhost:6380"),
		RelayURL:       getEnv("RELAY_URL", "ws://localhost:7777"),
		LogLevel:       getEnv("LOG_LEVEL", "info"),
		AllowedOrigins: origins,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
