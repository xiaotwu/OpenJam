package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

func init() {
	_ = godotenv.Load()
}

type Config struct {
	Port        string
	BindHost    string
	Environment string
	AutoMigrate bool

	DatabaseURL string
	RedisURL    string

	CorsOrigins    []string
	TrustedProxies []string

	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioUseSSL    bool
	MinioBucket    string

	MeetingsMediaURL    string
	MeetingsMediaKey    string
	MeetingsMediaSecret string
}

func Load() (*Config, error) {
	autoMigrate, err := strconv.ParseBool(getEnv("OPENJAM_AUTO_MIGRATE", "true"))
	if err != nil {
		return nil, fmt.Errorf("OPENJAM_AUTO_MIGRATE must be true or false")
	}

	// Accept both CORS_ORIGIN and CORS_ORIGINS for compatibility
	corsOrigins := getEnvList("CORS_ORIGINS", nil)
	if corsOrigins == nil {
		corsOrigins = getEnvList("CORS_ORIGIN", []string{"http://localhost:5173"})
	}

	return &Config{
		Port:        getEnv("PORT", "8080"),
		BindHost:    getEnv("OPENJAM_BIND_HOST", ""),
		Environment: getEnv("ENVIRONMENT", "development"),
		AutoMigrate: autoMigrate,

		DatabaseURL: getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable"),
		RedisURL:    getEnv("REDIS_URL", ""),

		CorsOrigins:    corsOrigins,
		TrustedProxies: getEnvList("OPENJAM_TRUSTED_PROXIES", nil),

		MinioEndpoint:  getEnv("MINIO_ENDPOINT", "localhost:8333"),
		MinioAccessKey: getEnv("MINIO_ACCESS_KEY", "minioadmin"),
		MinioSecretKey: getEnv("MINIO_SECRET_KEY", "minioadmin"),
		MinioUseSSL:    getEnv("MINIO_USE_SSL", "false") == "true",
		MinioBucket:    getEnv("MINIO_BUCKET", "openjam"),

		MeetingsMediaURL:    getEnv("OPENJAM_MEETINGS_MEDIA_URL", ""),
		MeetingsMediaKey:    getEnv("OPENJAM_MEETINGS_MEDIA_KEY", ""),
		MeetingsMediaSecret: getEnv("OPENJAM_MEETINGS_MEDIA_SECRET", ""),
	}, nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getEnvList(key string, fallback []string) []string {
	if value := os.Getenv(key); value != "" {
		var result []string
		for _, s := range splitAndTrim(value, ",") {
			if s != "" {
				result = append(result, s)
			}
		}
		if len(result) > 0 {
			return result
		}
	}
	return fallback
}

func splitAndTrim(s, sep string) []string {
	parts := make([]string, 0)
	for _, part := range strings.Split(s, sep) {
		parts = append(parts, strings.TrimSpace(part))
	}
	return parts
}
