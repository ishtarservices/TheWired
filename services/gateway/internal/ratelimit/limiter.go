package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Limiter implements sliding window rate limiting with Redis
type Limiter struct {
	client *redis.Client
}

// Limits defines rate limit thresholds
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

func NewLimiter(redisURL string) (*Limiter, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("invalid REDIS_URL %q: %w", redisURL, err)
	}
	return &Limiter{
		client: redis.NewClient(opts),
	}, nil
}

// Allow checks if a request is within rate limits
func (l *Limiter) Allow(ctx context.Context, pubkey string, category string) (bool, error) {
	var limit int
	switch category {
	case "write":
		limit = DefaultLimits.WritePerMin
	case "search":
		limit = DefaultLimits.SearchPerMin
	default:
		limit = DefaultLimits.ReadPerMin
	}

	key := fmt.Sprintf("ratelimit:%s:%s", category, pubkey)
	window := time.Minute

	// Sliding window counter
	now := time.Now()
	pipe := l.client.Pipeline()
	pipe.ZRemRangeByScore(ctx, key, "-inf", fmt.Sprintf("%d", now.Add(-window).UnixMilli()))
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(now.UnixMilli()), Member: now.UnixMilli()})
	pipe.ZCard(ctx, key)
	pipe.Expire(ctx, key, window*2)

	cmds, err := pipe.Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("redis error: %w", err)
	}

	count := cmds[2].(*redis.IntCmd).Val()
	return count <= int64(limit), nil
}
