package main

import (
	"log"
	"os"

	"github.com/project-wb/server/internal/config"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/handler"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/storage"
	"github.com/project-wb/server/internal/ws"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	if err := db.Init(cfg.DatabaseURL); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := db.Migrate(); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	if cfg.RedisURL != "" {
		if err := db.InitRedis(cfg.RedisURL); err != nil {
			log.Printf("Warning: Failed to connect to Redis: %v (continuing without cache)", err)
		}
	}

	if err := storage.Init(cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey, cfg.MinioUseSSL); err != nil {
		log.Printf("Warning: Failed to connect to MinIO: %v (exports will be disabled)", err)
	}

	hub := ws.NewHub()
	go hub.Run()

	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CorsOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	auth := r.Group("/api/auth")
	{
		auth.POST("/register", handler.Register)
		auth.POST("/login", handler.Login)
		auth.POST("/logout", handler.Logout)
	}

	api := r.Group("/api")
	api.Use(middleware.AuthRequired())
	{
		api.GET("/me", handler.Me)
		api.PUT("/me", handler.UpdateProfile)

		api.POST("/rooms", handler.CreateRoom)
		api.GET("/rooms", handler.ListRooms)
		api.GET("/rooms/:id", handler.GetRoom)
		api.DELETE("/rooms/:id", handler.DeleteRoom)

		api.POST("/rooms/:id/save", handler.SaveBoard)
		api.GET("/rooms/:id/load", handler.LoadBoard)

		api.POST("/rooms/:id/export/png", handler.ExportPNG)
		api.POST("/rooms/:id/export/json", handler.ExportJSON)
		api.GET("/exports/:key", handler.GetExport)
	}

	r.GET("/ws", func(c *gin.Context) {
		handler.HandleWebSocket(hub, c)
	})

	staticPaths := []string{"./static", "../app/dist", "./dist"}
	var staticDir string
	for _, path := range staticPaths {
		if _, err := os.Stat(path); err == nil {
			staticDir = path
			break
		}
	}

	if staticDir != "" {
		r.Static("/assets", staticDir+"/assets")
		r.Static("/icons", staticDir+"/icons")
		r.NoRoute(func(c *gin.Context) {
			c.File(staticDir + "/index.html")
		})
		log.Printf("📦 Serving static frontend from %s", staticDir)
	}

	port := cfg.Port
	if port == "" {
		port = "8080"
	}

	log.Printf("✅ Whiteboard server (Go + Gin + PostgreSQL) starting on http://localhost:%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
		os.Exit(1)
	}
}
