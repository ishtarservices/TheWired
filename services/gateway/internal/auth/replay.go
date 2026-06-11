package auth

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// ReplayGuard records single-use NIP-98 auth events so a captured Authorization
// header can't be replayed within its freshness window (#64).
type ReplayGuard interface {
	// Reserve atomically records eventID as used. It returns fresh=true if the id
	// had NOT been seen before (the request is original) and fresh=false if it is
	// a replay. A non-nil error means the backing store was unreachable; callers
	// MUST fail open (allow the request) so a cache blip can't lock out auth.
	Reserve(ctx context.Context, eventID string) (fresh bool, err error)
}

// replayKeyPrefix namespaces the replay keys in Redis.
const replayKeyPrefix = "nip98:replay:"

// replayTTL bounds how long a used id is remembered. NIP-98 events are valid for
// ±60s (see VerifyNIP98), so 120s fully covers the window with margin; after it
// the id is forgotten and the event would fail the created_at check anyway.
const replayTTL = 120 * time.Second

// RedisReplayGuard is a Redis-backed ReplayGuard using SET NX EX for an atomic
// check-and-store.
type RedisReplayGuard struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewRedisReplayGuard dials Redis from a redis:// URL.
func NewRedisReplayGuard(redisURL string) (*RedisReplayGuard, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	return &RedisReplayGuard{rdb: redis.NewClient(opt), ttl: replayTTL}, nil
}

// Reserve implements ReplayGuard. SET key 1 NX EX ttl returns true only if the
// key did not already exist — i.e. this is the first time we've seen the id.
func (g *RedisReplayGuard) Reserve(ctx context.Context, eventID string) (bool, error) {
	return g.rdb.SetNX(ctx, replayKeyPrefix+eventID, "1", g.ttl).Result()
}
