package agent

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xiaotwu/shiori/server/internal/config"
)

type Choice struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Cloud    bool   `json:"cloud"`
	Label    string `json:"label,omitempty"`
}

type Config struct {
	endpoint string
	token    string
	client   *http.Client
	choices  []Choice
}

var modelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$`)

func isCloudProvider(provider string) bool {
	return provider == "openai" || provider == "external"
}

// LoadConfig reads only deployment-owned settings. Requests cannot select a URL,
// supply credentials, or access a model outside these configured choices.
func LoadConfig() (Config, error) {
	endpoint := strings.TrimSpace(config.Env("SHIORI_AGENT_URL"))
	if endpoint == "" {
		return Config{}, nil
	}
	u, err := url.Parse(endpoint)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" ||
		u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" ||
		(u.Path != "" && u.Path != "/") || u.Opaque != "" {
		return Config{}, fmt.Errorf("SHIORI_AGENT_URL must be an HTTP or HTTPS service origin")
	}
	token := config.Env("SHIORI_AGENT_TOKEN")
	if len(token) < 32 || len(token) > 512 || strings.ContainsAny(token, " \t\r\n") {
		return Config{}, fmt.Errorf("SHIORI_AGENT_TOKEN must be a shared token of 32–512 non-whitespace characters")
	}
	timeout := 95 * time.Second
	if raw := config.Env("SHIORI_AGENT_TIMEOUT_SECONDS"); raw != "" {
		seconds, err := strconv.Atoi(raw)
		if err != nil || seconds < 1 || seconds > 170 {
			return Config{}, fmt.Errorf("SHIORI_AGENT_TIMEOUT_SECONDS must be between 1 and 170")
		}
		timeout = time.Duration(seconds) * time.Second
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	result := Config{
		endpoint: u.Scheme + "://" + u.Host + "/generate",
		token:    token,
		client: &http.Client{
			Timeout:       timeout,
			Transport:     transport,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
	for _, candidate := range []struct {
		key string
		Choice
	}{
		{key: "SHIORI_OLLAMA_MODEL", Choice: Choice{Provider: "ollama"}},
		{key: "SHIORI_OPENAI_MODEL", Choice: Choice{Provider: "openai", Cloud: true}},
		{key: "SHIORI_EXTERNAL_AGENT_MODEL", Choice: Choice{Provider: "external", Cloud: true}},
	} {
		model := strings.TrimSpace(config.Env(candidate.key))
		if model == "" {
			continue
		}
		if !modelPattern.MatchString(model) {
			return Config{}, fmt.Errorf("%s contains an invalid configured model name", candidate.key)
		}
		candidate.Model = model
		if candidate.Provider == "external" {
			label := strings.TrimSpace(config.Env("SHIORI_EXTERNAL_AGENT_LABEL"))
			if label == "" {
				label = "External Agent"
			}
			if !validText(label, 80, false) || strings.ContainsAny(label, "\n\r\t\u2028\u2029") {
				return Config{}, fmt.Errorf("SHIORI_EXTERNAL_AGENT_LABEL must be a single line of up to 80 characters")
			}
			candidate.Label = label
		}
		result.choices = append(result.choices, candidate.Choice)
	}
	if raw := config.Env("SHIORI_AGENT_MOCK"); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return Config{}, fmt.Errorf("SHIORI_AGENT_MOCK must be true or false")
		}
		if enabled {
			result.choices = append(result.choices, Choice{Provider: "mock", Model: "deterministic-v1"})
		}
	}
	return result, nil
}

func (config Config) choice(provider, model string) (Choice, bool) {
	for _, candidate := range config.choices {
		if candidate.Provider == provider && candidate.Model == model {
			return candidate, true
		}
	}
	return Choice{}, false
}
