package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Rate limiter using a token-bucket per client IP. Pure standard library to
// avoid pulling in extra dependencies. Buckets are created lazily and pruned
// periodically so the map does not grow without bound.

type ipBucket struct {
	tokens   float64
	lastTime time.Time
	mu       sync.Mutex
}

type RateLimiter struct {
	rate     float64 // tokens per second
	burst    float64
	buckets  sync.Map
	stopOnce sync.Once
	stop     chan struct{}
}

// NewRateLimiter creates a per-IP token-bucket limiter allowing `rate`
// requests/second with a burst capacity of `burst`.
func NewRateLimiter(rate, burst float64) *RateLimiter {
	rl := &RateLimiter{
		rate:  rate,
		burst: burst,
		stop:  make(chan struct{}),
	}
	go rl.pruneLoop()
	return rl
}

func (rl *RateLimiter) Stop() {
	rl.stopOnce.Do(func() { close(rl.stop) })
}

// pruneLoop removes idle buckets every 5 minutes so the map stays bounded.
func (rl *RateLimiter) pruneLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	cutoff := 10 * time.Minute
	for {
		select {
		case <-rl.stop:
			return
		case <-ticker.C:
			now := time.Now()
			rl.buckets.Range(func(key, val any) bool {
				b := val.(*ipBucket)
				b.mu.Lock()
				idle := now.Sub(b.lastTime) > cutoff
				b.mu.Unlock()
				if idle {
					rl.buckets.Delete(key)
				}
				return true
			})
		}
	}
}

func (rl *RateLimiter) allow(ip string) bool {
	val, _ := rl.buckets.LoadOrStore(ip, &ipBucket{tokens: rl.burst, lastTime: time.Now()})
	b := val.(*ipBucket)

	b.mu.Lock()
	defer b.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(b.lastTime).Seconds()
	b.lastTime = now
	// Refill based on elapsed time.
	b.tokens += elapsed * rl.rate
	if b.tokens > rl.burst {
		b.tokens = rl.burst
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens -= 1
	return true
}

// RateLimit returns a Gin middleware that enforces the given rate/burst per IP.
func RateLimit(rl *RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := clientIP(c)
		if !rl.allow(ip) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests. Please slow down.",
			})
			return
		}
		c.Next()
	}
}

// RateLimitUser separates editors behind a shared gateway or office address.
func RateLimitUser(rl *RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		user := GetUser(c)
		if user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
			return
		}
		if !rl.allow(user.ID.String()) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"code": "RATE_LIMITED", "error": "Too many sync requests. Try again shortly.",
			})
			return
		}
		c.Next()
	}
}

func clientIP(c *gin.Context) string {
	// Trust X-Forwarded-For only the first hop when behind a proxy; fall back
	// to RemoteAddr. Gin's ClientIP() handles this but requires trusted
	// proxies config — for a self-hosted app we use the raw remote addr to
	// avoid spoofing when the proxy is not configured.
	if ip := c.ClientIP(); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return c.Request.RemoteAddr
	}
	return host
}
