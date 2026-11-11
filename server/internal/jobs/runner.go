package jobs

import (
	"context"
	"errors"
	"log"
	"slices"
	"time"
)

type Runner struct {
	Handlers      map[string]Handler
	LeaseDuration time.Duration
	PollInterval  time.Duration
	JobTimeout    time.Duration
	Maintenance   func(context.Context) error
}

func Run(ctx context.Context, runner Runner) error {
	if runner.LeaseDuration == 0 {
		runner.LeaseDuration = 30 * time.Second
	}
	if runner.PollInterval == 0 {
		runner.PollInterval = 250 * time.Millisecond
	}
	if runner.JobTimeout == 0 {
		runner.JobTimeout = 3 * time.Minute
	}
	kinds := make([]string, 0, len(runner.Handlers))
	for kind, handler := range runner.Handlers {
		if handler == nil {
			return ErrInvalid
		}
		kinds = append(kinds, kind)
	}
	if len(kinds) == 0 || !validKinds(kinds) || !validLeaseDuration(runner.LeaseDuration) ||
		runner.PollInterval < 10*time.Millisecond || runner.JobTimeout < 10*time.Millisecond {
		return ErrInvalid
	}
	slices.Sort(kinds)
	lastSweep := time.Time{}
	for ctx.Err() == nil {
		if time.Since(lastSweep) >= 10*time.Second {
			if err := Sweep(ctx); err != nil && ctx.Err() == nil {
				log.Print("OpenJam job cache sweep failed")
			}
			if runner.Maintenance != nil {
				if err := runner.Maintenance(ctx); err != nil && ctx.Err() == nil {
					log.Print("OpenJam job maintenance deferred")
				}
			}
			lastSweep = time.Now()
		}
		lease, err := Claim(ctx, kinds, runner.LeaseDuration)
		if err == nil {
			runner.process(ctx, lease, runner.Handlers[lease.Kind])
			continue
		}
		if !errors.Is(err, ErrNoWork) && ctx.Err() == nil {
			log.Print("OpenJam job claim failed")
		}
		timer := time.NewTimer(runner.PollInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
		case <-timer.C:
		}
	}
	return nil
}

func (runner Runner) process(ctx context.Context, lease Lease, handler Handler) {
	workCtx, stopWork := context.WithTimeout(ctx, runner.JobTimeout)
	defer stopWork()
	renewCtx, stopRenew := context.WithCancel(workCtx)
	renewDone := make(chan struct{})
	go func() {
		defer close(renewDone)
		ticker := time.NewTicker(runner.LeaseDuration / 3)
		defer ticker.Stop()
		for {
			select {
			case <-renewCtx.Done():
				return
			case <-ticker.C:
				heartbeat, cancel := context.WithTimeout(renewCtx, runner.LeaseDuration/3)
				err := Renew(heartbeat, lease.ID, lease.Token, runner.LeaseDuration)
				cancel()
				if err != nil {
					if renewCtx.Err() == nil {
						stopWork()
					}
					return
				}
			}
		}
	}()
	outcome, err := callHandler(workCtx, handler, lease)
	stopRenew()
	<-renewDone
	if ctx.Err() != nil {
		return
	}
	if workCtx.Err() != nil {
		err = workCtx.Err()
	}
	if err == nil {
		err = Renew(workCtx, lease.ID, lease.Token, runner.LeaseDuration)
		if err == nil {
			_, err = Complete(workCtx, lease, outcome)
		}
	}
	if err != nil && !errors.Is(err, ErrLeaseLost) && ctx.Err() == nil {
		if _, recordErr := Reject(ctx, lease, err); recordErr != nil && !errors.Is(recordErr, ErrLeaseLost) && ctx.Err() == nil {
			log.Printf("OpenJam could not record job failure id=%s kind=%s", lease.ID, lease.Kind)
		}
	}
}

func callHandler(ctx context.Context, handler Handler, lease Lease) (outcome Outcome, err error) {
	defer func() {
		if recover() != nil {
			outcome, err = Outcome{}, Retry("HANDLER_PANIC")
		}
	}()
	return handler(ctx, lease)
}
