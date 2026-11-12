package document

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/project-wb/server/internal/model"
	"github.com/project-wb/server/internal/sheetformat"
)

type archiveLinkTarget struct {
	kind string
	id   string
}

var (
	archiveRoomIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,36}$`)
	archiveURLPattern    = regexp.MustCompile(`(?i)(https?://|//|/)[^\s<>"'\x60()\\\[\]{}\p{Z}。，、；！？“”「」『』【】]+`)
)

func validArchiveRoomID(id string) bool { return archiveRoomIDPattern.MatchString(id) }

func parseArchiveOrigin(value string) (*url.URL, error) {
	origin, err := url.Parse(value)
	if err != nil || origin.User != nil || origin.Hostname() == "" ||
		(origin.Scheme != "http" && origin.Scheme != "https") || len(value) > 512 ||
		(origin.Path != "" && origin.Path != "/") || origin.ForceQuery || origin.RawQuery != "" || origin.Fragment != "" ||
		strings.ContainsAny(origin.Host, "\\%") {
		return nil, projectInput("Provide the HTTP or HTTPS origin of this OpenJam instance.")
	}
	origin.Path, origin.RawPath = "", ""
	origin.Host = strings.ToLower(origin.Host)
	return origin, nil
}

func archiveAuthority(u *url.URL) string {
	port := u.Port()
	if port == "" && u.Scheme == "http" {
		port = "80"
	}
	if port == "" && u.Scheme == "https" {
		port = "443"
	}
	return strings.ToLower(u.Hostname()) + "|" + port
}

// Only user-visible content and typed link fields may contain application links.
// File IDs change, but page, block, cell and object IDs do not.
func rewriteArchiveDocument(kind string, content Document, origin *url.URL, targets map[string]archiveLinkTarget) (Document, error) {
	rewrite := func(value string) string { return rewriteArchiveText(value, origin, targets) }
	for _, collection := range []*[]json.RawMessage{&content.Pages, &content.Elements} {
		if *collection == nil {
			continue
		}
		records := make([]json.RawMessage, len(*collection))
		for i, raw := range *collection {
			var fields map[string]json.RawMessage
			if json.Unmarshal(raw, &fields) != nil || fields == nil {
				return Document{}, ErrProjectArchiveInvalid
			}
			changed := false
			keys := []string{"text", "href", "url", "link", "hyperlink", "caption", "description"}
			if kind == model.ResourceSheet && rawString(fields["type"]) == "sheetCell" {
				keys = append(keys, "display")
				if rawString(fields["valueType"]) == "text" {
					keys = append(keys, "input")
				}
			}
			for _, key := range keys {
				if before := rawString(fields[key]); before != "" {
					if after := rewrite(before); after != before {
						fields[key] = jsonString(after)
						changed = true
					}
				}
			}
			if data := fields["widgetData"]; data != nil {
				next, rewrote, err := rewriteArchiveWidget(data, rewrite, 0)
				if err != nil {
					return Document{}, err
				}
				if rewrote {
					fields["widgetData"], changed = next, true
				}
			}
			records[i] = raw
			if changed {
				next, err := json.Marshal(fields)
				if err != nil {
					return Document{}, err
				}
				records[i] = next
			}
		}
		*collection = records
	}
	if kind == model.ResourceSheet {
		if err := calculateArchiveSheet(&content); err != nil {
			return Document{}, err
		}
	}
	return content, nil
}

func calculateArchiveSheet(content *Document) error {
	tabs, _, formulas, err := decodeWorkbook(*content)
	if err != nil {
		return fmt.Errorf("%w %v", ErrProjectArchiveInvalid, err)
	}
	if len(formulas) == 0 {
		return nil
	}
	values := sheetformat.Calculate(tabs)
	displays := make(map[string]string, len(formulas))
	for _, f := range formulas {
		if display := values[f.tab][f.address].Display; display != f.cell.Display {
			displays[f.cell.ID] = display
		}
	}
	if len(displays) == 0 {
		return nil
	}
	for i, raw := range content.Elements {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return err
		}
		if display, ok := displays[rawString(fields["id"])]; ok {
			if display == "" {
				delete(fields, "display")
			} else {
				fields["display"] = jsonString(display)
			}
			content.Elements[i], err = json.Marshal(fields)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func rewriteArchiveWidget(data json.RawMessage, rewrite func(string) string, depth int) (json.RawMessage, bool, error) {
	if depth > 64 || len(data) == 0 {
		return nil, false, ErrProjectArchiveInvalid
	}
	switch data[0] {
	case '"':
		before := rawString(data)
		if after := rewrite(before); after != before {
			return jsonString(after), true, nil
		}
	case '{':
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return nil, false, err
		}
		changed := false
		for key, value := range fields {
			next, rewrote, err := rewriteArchiveWidget(value, rewrite, depth+1)
			if err != nil {
				return nil, false, err
			}
			if rewrote {
				fields[key], changed = next, true
			}
		}
		if changed {
			next, err := json.Marshal(fields)
			return next, true, err
		}
	case '[':
		var values []json.RawMessage
		if err := json.Unmarshal(data, &values); err != nil {
			return nil, false, err
		}
		changed := false
		for i, value := range values {
			next, rewrote, err := rewriteArchiveWidget(value, rewrite, depth+1)
			if err != nil {
				return nil, false, err
			}
			if rewrote {
				values[i], changed = next, true
			}
		}
		if changed {
			next, err := json.Marshal(values)
			return next, true, err
		}
	}
	return data, false, nil
}

func rewriteArchiveText(value string, origin *url.URL, targets map[string]archiveLinkTarget) string {
	matches := archiveURLPattern.FindAllStringIndex(value, -1)
	if len(matches) == 0 {
		return value
	}
	var out strings.Builder
	offset := 0
	for _, m := range matches {
		left, _ := utf8.DecodeLastRuneInString(value[:m[0]])
		// Avoid treating a suffix of a filename, hostname, or another URI
		// scheme as a root-relative application link.
		if m[0] > 0 && ((left < 128 && (unicode.IsLetter(left) || unicode.IsNumber(left))) || strings.ContainsRune("/.:_%+@?#=&-\\", left)) {
			continue
		}
		candidate := value[m[0]:m[1]]
		urlText := strings.TrimRight(candidate, ".,;!。，、；！")
		updated := rewriteArchiveURL(urlText, origin, targets, true)
		if updated != urlText {
			out.WriteString(value[offset:m[0]])
			out.WriteString(updated)
			out.WriteString(candidate[len(urlText):])
			offset = m[1]
		}
	}
	if offset == 0 {
		return value
	}
	out.WriteString(value[offset:])
	return out.String()
}

func rewriteArchiveURL(value string, origin *url.URL, targets map[string]archiveLinkTarget, allowAuth bool) string {
	u, err := url.Parse(value)
	if err != nil || !strings.HasPrefix(u.Path, "/") || u.Opaque != "" || u.User != nil {
		return value
	}
	if u.Host != "" {
		authority := *u
		if authority.Scheme == "" {
			authority.Scheme = origin.Scheme
		}
		if authority.Scheme != origin.Scheme || archiveAuthority(&authority) != archiveAuthority(origin) {
			return value
		}
	} else if u.Scheme != "" || strings.HasPrefix(value, "//") {
		return value
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	var kind, room string
	params, queryErr := url.ParseQuery(u.RawQuery)
	originalQuery := params.Encode()
	if len(parts) == 2 && validArchiveRoomID(parts[1]) {
		switch parts[0] {
		case "board", "room":
			kind, room = model.ResourceBoard, parts[1]
		case "doc", "sheet", "slides":
			kind, room = parts[0], parts[1]
		}
	}
	if u.Path == "/" && validArchiveRoomID(params.Get("room")) {
		kind, room = model.ResourceBoard, params.Get("room")
	}
	teamInvite := len(parts) == 3 && parts[0] == "teams" && validArchiveRoomID(parts[1]) && parts[2] == "invite"
	// Older credential URLs may have been pasted from the sign-in page.
	if u.Path == "/auth" && allowAuth {
		next := params.Get("next")
		if strings.HasPrefix(next, "/") && !strings.HasPrefix(next, "//") {
			redirect := rewriteArchiveURL(next, origin, targets, false)
			if redirect != next {
				if targets != nil && strings.HasPrefix(redirect, origin.String()+"/") {
					// The target login page cannot redirect to an absolute URL.
					return redirect
				}
				params.Set("next", redirect)
			}
		}
	} else if kind == "" && !teamInvite {
		return value
	}
	changed := queryErr != nil || params.Encode() != originalQuery
	credential := func(key string) bool {
		return strings.EqualFold(key, "share") || strings.EqualFold(key, "invite") || strings.EqualFold(key, "token")
	}
	for key := range params {
		if credential(key) {
			params.Del(key)
			changed = true
		}
	}
	if changed {
		u.RawQuery, u.ForceQuery = params.Encode(), false
	}
	// Preserve ordinary anchors byte for byte; only remove credential fields.
	if strings.Contains(u.Fragment, "=") {
		fragments := strings.Split(u.EscapedFragment(), "&")
		safe := fragments[:0]
		for _, item := range fragments {
			key, _, _ := strings.Cut(item, "=")
			key, _ = url.QueryUnescape(key)
			if !credential(key) {
				safe = append(safe, item)
			}
		}
		if len(safe) != len(fragments) {
			raw := strings.Join(safe, "&")
			u.Fragment, _ = url.PathUnescape(raw)
			u.RawFragment = raw
			changed = true
		}
	}
	if targets != nil {
		if target, ok := targets[room]; ok {
			if u.Path == "/" {
				params.Del("room")
				u.RawQuery, u.ForceQuery = params.Encode(), false
			}
			u.Path, u.RawPath = fmt.Sprintf("/%s/%s", target.kind, target.id), ""
			u.Scheme, u.Host = "", ""
			changed = true
		} else if (kind != "" || teamInvite) && u.Host == "" {
			u.Scheme, u.Host = origin.Scheme, origin.Host
			changed = true
		}
	}
	if !changed {
		return value
	}
	return u.String()
}
