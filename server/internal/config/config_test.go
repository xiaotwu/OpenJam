package config

import (
	"os"
	"testing"
)

func TestEnvPrefersShioriSettingEvenWhenEmpty(t *testing.T) {
	const key = "SHIORI_CLUSTER_DOCS"
	t.Setenv("OPENJAM_CLUSTER_DOCS", "1")
	t.Setenv(key, "")
	if err := os.Unsetenv(key); err != nil {
		t.Fatal(err)
	}
	if got := Env(key); got != "1" {
		t.Fatalf("legacy setting alone: got %q", got)
	}

	t.Setenv(key, "0")
	if got := Env(key); got != "0" {
		t.Fatalf("both settings: got %q", got)
	}

	t.Setenv(key, "")
	if got := Env(key); got != "" {
		t.Fatalf("explicit empty setting: got %q", got)
	}
}
