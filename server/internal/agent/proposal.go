package agent

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/document"
)

type Proposal struct {
	Title    string  `json:"title"`
	Summary  string  `json:"summary"`
	Question string  `json:"question"`
	Groups   []Group `json:"groups"`
	Nodes    []Node  `json:"nodes"`
	Edges    []Edge  `json:"edges"`
}

type Group struct {
	Title string   `json:"title"`
	Items []string `json:"items"`
}

type Node struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type Edge struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label"`
}

type Usage struct {
	InputTokens  int `json:"inputTokens,omitempty"`
	OutputTokens int `json:"outputTokens,omitempty"`
}

type Preview struct {
	PageID     string               `json:"pageId"`
	Placement  string               `json:"placement"`
	Operations []document.Operation `json:"operations"`
	Bounds     box                  `json:"bounds"`
}

type PreviewResult struct {
	Proposal      Proposal       `json:"proposal"`
	Preview       *Preview       `json:"preview,omitempty"`
	Usage         *Usage         `json:"usage,omitempty"`
	ExternalReply *ExternalReply `json:"externalReply,omitempty"`
}

type storedResult struct {
	PreviewResult
	Basis runBasis `json:"basis"`
}

var nodeID = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`)

func (p *Proposal) valid(workflow string, answered bool) bool {
	p.Title, p.Summary, p.Question = strings.TrimSpace(p.Title), strings.TrimSpace(p.Summary), strings.TrimSpace(p.Question)
	if p.Groups == nil || p.Nodes == nil || p.Edges == nil || !validText(p.Summary, 500, true) ||
		!validText(p.Question, 280, true) || !validText(p.Title, 100, p.Question != "") {
		return false
	}
	if p.Question != "" {
		return !answered && len(p.Groups)+len(p.Nodes)+len(p.Edges) == 0
	}
	if workflow == "flowchart" {
		return p.validGraph()
	}
	return p.validGroups()
}

func (p *Proposal) validGroups() bool {
	if len(p.Groups) < 1 || len(p.Groups) > 6 || len(p.Nodes)+len(p.Edges) != 0 {
		return false
	}
	total := 0
	for i := range p.Groups {
		group := &p.Groups[i]
		group.Title = strings.TrimSpace(group.Title)
		if !validText(group.Title, 80, false) || len(group.Items) < 1 || len(group.Items) > 8 {
			return false
		}
		total += len(group.Items)
		for j := range group.Items {
			group.Items[j] = strings.TrimSpace(group.Items[j])
			if !validText(group.Items[j], 280, false) {
				return false
			}
		}
	}
	return total <= 32
}

func (p *Proposal) validGraph() bool {
	if len(p.Groups) != 0 || len(p.Nodes) < 2 || len(p.Nodes) > 16 || len(p.Edges) > 24 {
		return false
	}
	nodes := make(map[string]bool, len(p.Nodes))
	for i := range p.Nodes {
		node := &p.Nodes[i]
		node.Label = strings.TrimSpace(node.Label)
		if !nodeID.MatchString(node.ID) || nodes[node.ID] || !validText(node.Label, 180, false) {
			return false
		}
		nodes[node.ID] = true
	}
	edges := make(map[[2]string]bool, len(p.Edges))
	for i := range p.Edges {
		edge := &p.Edges[i]
		edge.Label = strings.TrimSpace(edge.Label)
		pair := [2]string{edge.From, edge.To}
		if edge.From == edge.To || !nodes[edge.From] || !nodes[edge.To] || edges[pair] || !validText(edge.Label, 80, true) {
			return false
		}
		edges[pair] = true
	}
	return true
}

func stableID(runID uuid.UUID, label string) string {
	return uuid.NewSHA1(runID, []byte(label)).String()
}

type layout struct {
	runID       uuid.UUID
	actor       uuid.UUID
	timestamp   int64
	origin      point
	preview     Preview
	hasGeometry bool
}

func buildPreview(proposal Proposal, basis runBasis, id, actor uuid.UUID, created time.Time) (Preview, error) {
	l := layout{
		runID: id, actor: actor, timestamp: created.UnixMilli(), origin: basis.Origin,
		preview: Preview{PageID: basis.PageID, Placement: basis.Placement},
	}
	if basis.Placement == newPage {
		value, err := json.Marshal(map[string]string{"id": basis.PageID, "name": proposal.Title})
		if err != nil {
			return Preview{}, err
		}
		l.preview.Operations = append(l.preview.Operations, document.Operation{
			Kind: "add", Collection: "pages", ID: basis.PageID, Value: value,
		})
	}
	if err := l.addText("title", proposal.Title, box{0, 0, 1240, 64}, 40, true); err != nil {
		return Preview{}, err
	}
	if proposal.Summary != "" {
		if err := l.addText("summary", proposal.Summary, box{0, 64, 1240, 64}, 17, false); err != nil {
			return Preview{}, err
		}
	}
	var err error
	if len(proposal.Nodes) > 0 {
		err = l.addGraph(proposal)
	} else {
		err = l.addGroups(proposal.Groups)
	}
	if err != nil {
		return Preview{}, err
	}
	bounds := l.preview.Bounds
	if bounds.X+bounds.Width > maxCoordinate || bounds.Y+bounds.Height > maxCoordinate {
		return Preview{}, conflict("TARGET_OUT_OF_RANGE", "Choose a new page for this draft.")
	}
	return l.preview, nil
}

func (l *layout) addElement(label, kind string, bounds box, fields map[string]any) error {
	id := stableID(l.runID, label)
	bounds.X += l.origin.X
	bounds.Y += l.origin.Y
	fields["id"], fields["pageId"], fields["type"] = id, l.preview.PageID, kind
	fields["x"], fields["y"], fields["width"], fields["height"] = bounds.X, bounds.Y, bounds.Width, bounds.Height
	fields["rotation"], fields["locked"], fields["opacity"] = 0, false, 1
	fields["createdAt"], fields["updatedAt"], fields["createdBy"] = l.timestamp, l.timestamp, l.actor.String()
	fields["zIndex"] = l.timestamp + int64(len(l.preview.Operations))
	value, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	l.preview.Operations = append(l.preview.Operations, document.Operation{
		Kind: "add", Collection: "elements", ID: id, Value: value,
	})
	if !l.hasGeometry {
		l.preview.Bounds = bounds
		l.hasGeometry = true
	} else {
		old := l.preview.Bounds
		x, y := min(old.X, bounds.X), min(old.Y, bounds.Y)
		l.preview.Bounds = box{x, y, max(old.X+old.Width, bounds.X+bounds.Width) - x, max(old.Y+old.Height, bounds.Y+bounds.Height) - y}
	}
	return nil
}

func (l *layout) addText(id, text string, bounds box, size int, bold bool) error {
	weight := "normal"
	if bold {
		weight = "bold"
	}
	return l.addElement(id, "text", bounds, map[string]any{
		"text": text, "fontFamily": "Geist Variable, sans-serif", "fontSize": size,
		"fontWeight": weight, "fontStyle": "normal", "color": "", "textAlign": "left",
	})
}

func (l *layout) addGroups(groups []Group) error {
	colors := [...]string{"yellow", "blue", "green", "purple", "orange", "pink"}
	for i, group := range groups {
		x, y := float64(i%2)*660, 152+float64(i/2)*620
		name := fmt.Sprintf("group-%d", i)
		children := make([]string, 0, len(group.Items))
		for j := range group.Items {
			children = append(children, stableID(l.runID, fmt.Sprintf("%s-item-%d", name, j)))
		}
		height := 64 + 170*float64((len(group.Items)+2)/3)
		if err := l.addElement(name, "frame", box{x, y, 620, height}, map[string]any{
			"name": group.Title, "backgroundColor": "#eef2ff", "showName": true, "childIds": children,
		}); err != nil {
			return err
		}
		for j, item := range group.Items {
			bounds := box{x + 24 + float64(j%3)*196, y + 52 + float64(j/3)*170, 180, 154}
			if err := l.addElement(fmt.Sprintf("%s-item-%d", name, j), "sticky", bounds, map[string]any{
				"text": item, "color": colors[i], "fontSize": 15, "textAlign": "left", "stickyShape": "square",
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (l *layout) addGraph(proposal Proposal) error {
	positions := make(map[string]box, len(proposal.Nodes))
	for i, node := range proposal.Nodes {
		positions[node.ID] = box{float64(i%4) * 310, 152 + float64(i/4)*204, 220, 104}
	}
	for i, edge := range proposal.Edges {
		if err := l.addEdge(i, edge, positions[edge.From], positions[edge.To]); err != nil {
			return err
		}
	}
	for _, node := range proposal.Nodes {
		if err := l.addElement("node-"+node.ID, "shape", positions[node.ID], map[string]any{
			"shapeType": "rounded-rectangle", "fill": "#e0e7ff", "stroke": "#6366f1",
			"strokeWidth": 2, "fontSize": 17, "text": node.Label,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (l *layout) addEdge(i int, edge Edge, from, to box) error {
	start, end, startSide, endSide := anchors(from, to)
	bounds := box{min(start.X, end.X), min(start.Y, end.Y), max(1, math.Abs(start.X-end.X)), max(1, math.Abs(start.Y-end.Y))}
	name := fmt.Sprintf("edge-%d", i)
	if err := l.addElement(name, "connector", bounds, map[string]any{
		"style": "elbow", "startArrow": "none", "endArrow": "arrow", "stroke": "#64748b", "strokeWidth": 2,
		"startPoint":  point{start.X + l.origin.X, start.Y + l.origin.Y},
		"endPoint":    point{end.X + l.origin.X, end.Y + l.origin.Y},
		"startAnchor": startSide, "endAnchor": endSide,
		"startElementId": stableID(l.runID, "node-"+edge.From), "endElementId": stableID(l.runID, "node-"+edge.To),
	}); err != nil {
		return err
	}
	if edge.Label == "" {
		return nil
	}
	return l.addText(name+"-label", edge.Label, box{(start.X+end.X)/2 - 45, (start.Y+end.Y)/2 + 8, 148, 42}, 13, false)
}

func anchors(a, b box) (point, point, string, string) {
	cx, cy := a.X+a.Width/2, a.Y+a.Height/2
	dx, dy := b.X+b.Width/2, b.Y+b.Height/2
	if math.Abs(dx-cx) >= math.Abs(dy-cy) {
		if dx >= cx {
			return point{a.X + a.Width, cy}, point{b.X, dy}, "right", "left"
		}
		return point{a.X, cy}, point{b.X + b.Width, dy}, "left", "right"
	}
	if dy >= cy {
		return point{cx, a.Y + a.Height}, point{dx, b.Y}, "bottom", "top"
	}
	return point{cx, a.Y}, point{dx, b.Y + b.Height}, "top", "bottom"
}
