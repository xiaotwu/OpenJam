package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/project-wb/server/internal/agent"
	"github.com/project-wb/server/internal/assets"
	"github.com/project-wb/server/internal/boardfiles"
	"github.com/project-wb/server/internal/jobs"
	"github.com/project-wb/server/internal/storage"
)

func runWorker(ctx context.Context, agentConfig agent.Config) error {
	lease := 30 * time.Second
	if raw := os.Getenv("OPENJAM_JOB_LEASE_SECONDS"); raw != "" {
		seconds, err := strconv.Atoi(raw)
		if err != nil || seconds < 2 || seconds > 300 {
			return fmt.Errorf("OPENJAM_JOB_LEASE_SECONDS must be between 2 and 300")
		}
		lease = time.Duration(seconds) * time.Second
	}
	if storage.IsInitialized() {
		sweepCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		defer func() { cancel(); <-done }()
		go func() {
			defer close(done)
			ticker := time.NewTicker(10 * time.Minute)
			defer ticker.Stop()
			for {
				if _, err := assets.Sweep(sweepCtx, 25); err != nil && sweepCtx.Err() == nil {
					log.Print("OpenJam asset cleanup deferred")
				}
				select {
				case <-sweepCtx.Done():
					return
				case <-ticker.C:
				}
			}
		}()
	}
	log.Print("OpenJam worker is polling the durable job queue")
	work, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan error, 2)
	for _, runner := range []jobs.Runner{
		{Handlers: boardfiles.Handlers(), LeaseDuration: lease},
		{Handlers: agent.Handlers(agentConfig), LeaseDuration: lease, Maintenance: agent.SweepConversations},
	} {
		go func() { results <- jobs.Run(work, runner) }()
	}
	err := <-results
	cancel()
	if other := <-results; err == nil {
		err = other
	}
	return err
}
