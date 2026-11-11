package config

import (
	"os"
	"strings"

	"github.com/joho/godotenv"
)

func init() {
	_ = godotenv.Load()
}

type Config struct {
	Port        string
	Environment string

	DatabaseURL string
	RedisURL    string

	CorsOrigins []string

	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioUseSSL    bool

	SessionSecret string
	SessionMaxAge int
}

func Load() *Config {
	// Accept both CORS_ORIGIN and CORS_ORIGINS for compatibility
	corsOrigins := getEnvList("CORS_ORIGINS", nil)
	if corsOrigins == nil {
		corsOrigins = getEnvList("CORS_ORIGIN", []string{"http://localhost:5173"})
	}

	return &Config{
		Port:        getEnv("PORT", "8080"),
		Environment: getEnv("ENVIRONMENT", "development"),

		DatabaseURL: getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/openjam?sslmode=disable"),
		RedisURL:    getEnv("REDIS_URL", ""),

		CorsOrigins: corsOrigins,

		MinioEndpoint:  getEnv("MINIO_ENDPOINT", "localhost:9000"),
		MinioAccessKey: getEnv("MINIO_ACCESS_KEY", "minioadmin"),
		MinioSecretKey: getEnv("MINIO_SECRET_KEY", "minioadmin"),
		MinioUseSSL:    getEnv("MINIO_USE_SSL", "false") == "true",

		SessionSecret: getEnv("SESSION_SECRET", "your-secret-key-change-in-production"),
		SessionMaxAge: 86400 * 7,
	}
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
