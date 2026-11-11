package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

var rdb *redis.Client

const (
	SessionKeyPrefix    = "session:"
	UserKeyPrefix       = "user:"
	RoomOnlineKeyPrefix = "room:online:"
	PubSubChannel       = "openjam:broadcast"
	documentPresenceKey = "openjam:document:presence:"
)

func InitRedis(redisURL string) error {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return err
	}
	opt.ContextTimeoutEnabled = true

	client := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return err
	}
	rdb = client
	return nil
}

func Redis() *redis.Client {
	return rdb
}

func HasRedis() bool {
	return rdb != nil
}

func CacheSet(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	if rdb == nil {
		return nil
	}
	return rdb.Set(ctx, key, value, expiration).Err()
}

func CacheGet(ctx context.Context, key string) (string, error) {
	if rdb == nil {
		return "", redis.Nil
	}
	return rdb.Get(ctx, key).Result()
}

func CacheDel(ctx context.Context, keys ...string) error {
	if rdb == nil {
		return nil
	}
	return rdb.Del(ctx, keys...).Err()
}

func CacheSetJSON(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	if rdb == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return rdb.Set(ctx, key, data, expiration).Err()
}

func CacheGetJSON(ctx context.Context, key string, dest interface{}) error {
	if rdb == nil {
		return redis.Nil
	}
	data, err := rdb.Get(ctx, key).Result()
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(data), dest)
}

func CacheSession(ctx context.Context, token string, sessionData interface{}, expiration time.Duration) error {
	return CacheSetJSON(ctx, SessionKeyPrefix+token, sessionData, expiration)
}

func GetCachedSession(ctx context.Context, token string, dest interface{}) error {
	return CacheGetJSON(ctx, SessionKeyPrefix+token, dest)
}

func InvalidateSession(ctx context.Context, token string) error {
	return CacheDel(ctx, SessionKeyPrefix+token)
}

func CacheUser(ctx context.Context, userID string, userData interface{}, expiration time.Duration) error {
	return CacheSetJSON(ctx, UserKeyPrefix+userID, userData, expiration)
}

func GetCachedUser(ctx context.Context, userID string, dest interface{}) error {
	return CacheGetJSON(ctx, UserKeyPrefix+userID, dest)
}

func InvalidateUser(ctx context.Context, userID string) error {
	return CacheDel(ctx, UserKeyPrefix+userID)
}

func AddOnlineUser(ctx context.Context, roomID, userID string) error {
	if rdb == nil {
		return nil
	}
	return rdb.SAdd(ctx, RoomOnlineKeyPrefix+roomID, userID).Err()
}

func RemoveOnlineUser(ctx context.Context, roomID, userID string) error {
	if rdb == nil {
		return nil
	}
	return rdb.SRem(ctx, RoomOnlineKeyPrefix+roomID, userID).Err()
}

func GetOnlineUsers(ctx context.Context, roomID string) ([]string, error) {
	if rdb == nil {
		return nil, nil
	}
	return rdb.SMembers(ctx, RoomOnlineKeyPrefix+roomID).Result()
}

func GetOnlineUserCount(ctx context.Context, roomID string) (int64, error) {
	if rdb == nil {
		return 0, nil
	}
	return rdb.SCard(ctx, RoomOnlineKeyPrefix+roomID).Result()
}

// The shared Redis clock keeps lease deadlines consistent across replicas.
const refreshDocumentPresenceScript = `
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
local ttl = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
for i = 2, #ARGV do
  redis.call('ZADD', KEYS[1], now + ttl, ARGV[i])
end
if #ARGV > 1 then
  redis.call('PEXPIRE', KEYS[1], ttl * 2)
end
return redis.call('ZRANGE', KEYS[1], 0, -1)
`

// RefreshDocumentPresence renews this replica's connection leases and lists
// the live leases on each requested board in a single round trip.
func RefreshDocumentPresence(ctx context.Context, rooms map[string][]string, ttl time.Duration) (map[string][]string, error) {
	if rdb == nil || len(rooms) == 0 {
		return nil, nil
	}
	pipe := rdb.Pipeline()
	commands := make(map[string]*redis.Cmd, len(rooms))
	for roomID, leases := range rooms {
		args := make([]interface{}, 1, 1+len(leases))
		args[0] = ttl.Milliseconds()
		for _, lease := range leases {
			args = append(args, lease)
		}
		commands[roomID] = pipe.Eval(ctx, refreshDocumentPresenceScript, []string{documentPresenceKey + roomID}, args...)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	result := make(map[string][]string, len(commands))
	for roomID, cmd := range commands {
		members, err := cmd.StringSlice()
		if err != nil {
			return nil, err
		}
		result[roomID] = members
	}
	return result, nil
}

func RemoveDocumentPresence(ctx context.Context, roomID, lease string) error {
	if rdb == nil {
		return nil
	}
	return rdb.ZRem(ctx, documentPresenceKey+roomID, lease).Err()
}

type PubSubMessage struct {
	InstanceID string `json:"instanceId,omitempty"`
	RoomID     string `json:"roomId"`
	SenderID   string `json:"senderId"`
	Type       string `json:"type"`
	Payload    []byte `json:"payload"`
}

func Publish(ctx context.Context, msg *PubSubMessage) error {
	if rdb == nil {
		return nil
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return rdb.Publish(ctx, PubSubChannel, data).Err()
}

func Subscribe(ctx context.Context) (*redis.PubSub, error) {
	if rdb == nil {
		return nil, fmt.Errorf("redis not initialized")
	}
	return rdb.Subscribe(ctx, PubSubChannel), nil
}
