package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Limits defines rate limit thresholds (per pubkey, per minute).
type Limits struct {
	ReadPerMin   int
	WritePerMin  int
	SearchPerMin int
}

var DefaultLimits = Limits{
	ReadPerMin:   100,
	WritePerMin:  30,
	SearchPerMin: 10,
}

// AllowResult contains the outcome of a rate limit check.
type AllowResult struct {
	Allowed   bool
	Remaining int64
	ResetAt   time.Time
}

// Limiter implements sliding window rate limiting with Redis.
// Uses a Lua script so the check-then-add is atomic — denied requests
// do NOT increment the counter (prevents cascading 429 storms).
type Limiter struct {
	client *redis.Client
	limits Limits
}

// rateLimitScript atomically cleans, counts, and conditionally adds.
// KEYS[1] = sorted set key
// ARGV[1] = window start (ms) — entries older than this are pruned
// ARGV[2] = now (ms) — score + member for the new entry
// ARGV[3] = limit
// ARGV[4] = TTL (seconds) for the key
// ARGV[5] = reset time (ms) — end of the current window
//
// Returns {allowed (0/1), remaining, resetMs}.
var rateLimitScript = redis.NewScript(`
local key = KEYS[1]
local windowStart = ARGV[1]
local now = ARGV[2]
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local resetMs = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, now)
  redis.call('EXPIRE', key, ttl)
  return {1, limit - count - 1, resetMs}
end

return {0, 0, resetMs}
`)

func NewLimiter(redisURL string, limits Limits) (*Limiter, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("invalid REDIS_URL %q: %w", redisURL, err)
	}
	return &Limiter{
		client: redis.NewClient(opts),
		limits: limits,
	}, nil
}

// Allow checks if a request is within rate limits.
// Denied requests are NOT counted toward the window.
func (l *Limiter) Allow(ctx context.Context, pubkey string, category string) (AllowResult, error) {
	var limit int
	switch category {
	case "write":
		limit = l.limits.WritePerMin
	case "search":
		limit = l.limits.SearchPerMin
	default:
		limit = l.limits.ReadPerMin
	}

	key := fmt.Sprintf("ratelimit:%s:%s", category, pubkey)
	window := time.Minute
	now := time.Now()
	windowStart := now.Add(-window)
	resetAt := now.Add(window)

	// TTL = 2× window so the key outlives the sliding window
	ttlSeconds := int64(window.Seconds()) * 2

	result, err := rateLimitScript.Run(ctx, l.client, []string{key},
		windowStart.UnixMilli(),
		now.UnixMilli(),
		limit,
		ttlSeconds,
		resetAt.UnixMilli(),
	).Int64Slice()

	if err != nil {
		return AllowResult{}, fmt.Errorf("redis error: %w", err)
	}

	return AllowResult{
		Allowed:   result[0] == 1,
		Remaining: result[1],
		ResetAt:   time.UnixMilli(result[2]),
	}, nil
}
