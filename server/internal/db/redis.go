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
)

func InitRedis(redisURL string) error {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return err
	}

	rdb = redis.NewClient(opt)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return rdb.Ping(ctx).Err()
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

type PubSubMessage struct {
	RoomID   string `json:"roomId"`
	SenderID string `json:"senderId"`
	Type     string `json:"type"`
	Payload  []byte `json:"payload"`
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
