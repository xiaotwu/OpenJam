package main

import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed all:static
var staticFiles embed.FS

// StaticFS returns the embedded static files as an fs.FS rooted at "static/".
// Returns error if the static directory only contains .gitkeep (dev mode).
func StaticFS() (fs.FS, error) {
	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return nil, err
	}
	// Check if index.html exists (real build output vs placeholder)
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, fmt.Errorf("no frontend build found in embedded static files")
	}
	return sub, nil
}
