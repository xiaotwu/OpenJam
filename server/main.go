package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/project-wb/server/internal/agent"
	"github.com/project-wb/server/internal/config"
	"github.com/project-wb/server/internal/db"
	"github.com/project-wb/server/internal/handler"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/storage"
	"github.com/project-wb/server/internal/ws"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	mode := "api"
	if len(args) > 0 {
		mode = args[0]
	}
	if mode == "documents" {
		if err := validateDocumentArguments(args[1:]); err != nil {
			return err
		}
	} else if len(args) > 1 || (mode != "api" && mode != "migrate" && mode != "worker") {
		return fmt.Errorf("usage: openjam-server [api|worker|migrate|documents]")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	startupCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if err := db.InitContext(startupCtx, cfg.DatabaseURL); err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	defer db.Close()

	if mode == "migrate" || (mode == "api" && cfg.AutoMigrate) {
		if err := db.MigrateContext(startupCtx); err != nil {
			return fmt.Errorf("apply database migrations: %w", err)
		}
	}
	if mode == "migrate" {
		log.Print("Database migrations complete")
		return nil
	}
	if err := db.CheckSchema(startupCtx); err != nil {
		return fmt.Errorf("check database schema (run openjam-server migrate before starting the API): %w", err)
	}
	cancel()
	if mode == "documents" {
		return runDocumentCommand(ctx, args[1:], os.Stdout)
	}
	agentConfig, err := agent.LoadConfig()
	if err != nil {
		return err
	}

	if mode == "api" && cfg.RedisURL != "" {
		if err := db.InitRedis(cfg.RedisURL); err != nil {
			log.Printf("Warning: Failed to connect to Redis: %v (continuing without cache)", err)
		}
	}

	if err := storage.InitWithBucket(cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey, cfg.MinioUseSSL, cfg.MinioBucket); err != nil {
		log.Printf("Object storage unavailable: %v", err)
	} else {
		log.Printf("Object storage ready (bucket %s)", cfg.MinioBucket)
	}
	if mode == "worker" {
		return runWorker(ctx, agentConfig)
	}

	hub := ws.NewHub()
	var draining atomic.Bool
	router, err := newRouter(cfg, hub, draining.Load, agentConfig)
	if err != nil {
		return err
	}
	hubCtx, stopHub := context.WithCancel(context.Background())
	defer stopHub()
	go hub.Run(hubCtx)
	go cleanupExpiredSessions(ctx)

	server := &http.Server{
		Addr:              net.JoinHostPort(cfg.BindHost, cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       75 * time.Second,
	}
	serveError := make(chan error, 1)
	go func() {
		log.Printf("OpenJam API listening on %s", server.Addr)
		serveError <- server.ListenAndServe()
	}()

	select {
	case err := <-serveError:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP: %w", err)
		}
		return nil
	case <-ctx.Done():
		draining.Store(true)
		hub.CloseConnections()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return fmt.Errorf("drain HTTP requests: %w", err)
		}
		return nil
	}
}

func newRouter(cfg *config.Config, hub *ws.Hub, draining func() bool, agentConfig agent.Config) (*gin.Engine, error) {
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(requestLog, gin.Recovery())
	if err := r.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		return nil, fmt.Errorf("configure trusted proxies: %w", err)
	}
	// SPA routes (/board/:id, /workplace, ...) have no file extension and must be
	// served index.html, not redirected. Gin's trailing-slash redirect turns
	// "/board/x" into "301 ./" which loops in the browser; disabling it keeps
	// deep links reachable and lets NoRoute serve the SPA shell.
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false
	handler.InitWebSocket(cfg.CorsOrigins)
	handler.SetCookieSecurity(cfg.Environment)

	// Per-IP rate limiters: a strict one for auth endpoints (brute-force
	// protection) and a general one for the rest of the API.
	authLimiter := middleware.NewRateLimiter(0.2, 5) // 1 req / 5s, burst 5
	apiLimiter := middleware.NewRateLimiter(5, 20)   // 5 rps, burst 20
	wsLimiter := middleware.NewRateLimiter(2, 3)     // 2 rps, burst 3 (per-IP WS connects)
	syncLimiter := middleware.NewRateLimiter(30, 60) // per authenticated editor

	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CorsOrigins,
		AllowMethods:     []string{"GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "Idempotency-Key", "Last-Event-ID", "Range"},
		ExposeHeaders:    []string{"X-Request-ID", "Content-Disposition", "ETag"},
		AllowCredentials: true,
	}))

	registerHealthRoutes(r, db.Pool().Ping, draining)

	auth := r.Group("/api/auth")
	auth.Use(middleware.RateLimit(authLimiter))
	{
		auth.POST("/register", handler.Register)
		auth.POST("/login", handler.Login)
		auth.POST("/logout", handler.Logout)
	}

	api := r.Group("/api")
	api.Use(middleware.AuthRequired(), middleware.RateLimit(apiLimiter))
	{
		api.GET("/me", handler.Me)
		api.PUT("/me", handler.UpdateProfile)

		api.POST("/rooms", handler.CreateRoom)
		api.GET("/rooms", handler.ListRooms)
		api.GET("/rooms/:id", handler.GetRoom)
		api.PUT("/rooms/:id", func(c *gin.Context) { handler.UpdateRoom(c, hub.NotifyDocument) })
		api.DELETE("/rooms/:id", handler.DeleteRoom)
		api.GET("/rooms/:id/share", handler.GetShareSettings)
		api.PUT("/rooms/:id/share", handler.UpdateShareSettings)
		api.POST("/rooms/:id/invites", handler.InviteRoomMember)
		api.DELETE("/rooms/:id/members/:userId", handler.RemoveRoomMember)

		api.POST("/rooms/:id/save", handler.SaveBoard)
		api.GET("/rooms/:id/load", handler.LoadBoard)

		api.POST("/rooms/:id/export/png", handler.ExportPNG)
		api.POST("/rooms/:id/export/json", handler.ExportJSON)
		api.GET("/exports/*key", handler.GetExport)
	}
	handler.RegisterDirectoryRoutes(api)
	syncAPI := r.Group("/api", middleware.DocumentAuthRequired(), middleware.RateLimitUser(syncLimiter))
	handler.RegisterDocumentRoutes(syncAPI, hub.NotifyDocument, hub.NotifyAccessChanged, agentConfig)
	handler.RegisterAgentOrganizationRoutes(syncAPI, agentConfig)
	handler.RegisterAgentProfileRoutes(syncAPI)
	handler.RegisterFileJobRoutes(syncAPI)
	handler.RegisterBoardImportRoutes(syncAPI)

	r.GET("/ws", middleware.RateLimit(wsLimiter), func(c *gin.Context) {
		handler.HandleWebSocket(hub, c)
	})
	r.GET("/ws/v2", middleware.RateLimit(wsLimiter), func(c *gin.Context) {
		handler.HandleDocumentWebSocket(hub, c)
	})

	mountFrontend(r, frontendFiles())
	return r, nil
}

func requestLog(c *gin.Context) {
	start := time.Now()
	requestID := uuid.NewString()
	c.Header("X-Request-ID", requestID)
	c.Next()
	log.Printf("request_id=%s method=%s route=%q status=%d duration=%s",
		requestID, c.Request.Method, c.FullPath(), c.Writer.Status(), time.Since(start).Round(time.Microsecond))
}

func registerHealthRoutes(r *gin.Engine, ping func(context.Context) error, draining func() bool) {
	r.GET("/livez", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	r.GET("/startupz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "started"})
	})
	r.GET("/readyz", func(c *gin.Context) {
		if draining() {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "draining"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), time.Second)
		defer cancel()
		if err := ping(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable", "database": "unreachable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready", "database": "ok"})
	})
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":         "ok",
			"exportsEnabled": storage.IsInitialized(),
		})
	})
}

func frontendFiles() fs.FS {
	if staticFS, err := StaticFS(); err == nil {
		log.Print("Serving embedded frontend")
		return staticFS
	}

	for _, path := range []string{"../app/dist", "./static", "./dist"} {
		files := os.DirFS(path)
		if info, err := fs.Stat(files, "index.html"); err == nil && !info.IsDir() {
			log.Printf("Serving frontend from %s", path)
			return files
		}
	}
	log.Print("Frontend assets unavailable. Run the Vite development server or build OpenJam.")
	return nil
}

func mountFrontend(r *gin.Engine, files fs.FS) {
	var index []byte
	if files != nil {
		index, _ = fs.ReadFile(files, "index.html")
		for _, directory := range []string{"assets", "icons"} {
			if info, err := fs.Stat(files, directory); err == nil && info.IsDir() {
				sub, err := fs.Sub(files, directory)
				if err == nil {
					r.StaticFS("/"+directory, http.FS(sub))
				}
			}
		}
	}

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/api" || strings.HasPrefix(path, "/api/") || path == "/ws" || strings.HasPrefix(path, "/ws/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "Endpoint not found"})
			return
		}
		isAsset := path == "/assets" || path == "/icons" || strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/icons/")
		if len(index) == 0 || isAsset || (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) {
			c.Status(http.StatusNotFound)
			return
		}
		c.Header("Cache-Control", "no-cache")
		c.Header("Content-Type", "text/html; charset=utf-8")
		if c.Request.Method == http.MethodHead {
			c.Status(http.StatusOK)
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", index)
	})
}

func cleanupExpiredSessions(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := model.DeleteExpiredSessions(ctx); err != nil && ctx.Err() == nil {
				log.Printf("Delete expired sessions: %v", err)
			}
		}
	}
}
