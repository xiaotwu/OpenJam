package boardfiles

import (
	"encoding/json"
	"fmt"
	"image"
	"strings"
)

type widgetCell struct {
	Content, BackgroundColor string
}

type widgetCard struct {
	Text, Title, Content string
}

type widgetColumn struct {
	Title, Color string
	Cards, Notes []widgetCard
}

type widgetSummary struct {
	Question, Prompt, Category string
	Cells                      [][]widgetCell
	Columns                    []widgetColumn
	Items, PickedItems         []string
	CustomQuestions            []string
	CurrentIndex               int
	Options                    []struct {
		Text  string
		Votes int
	}
	Reactions []struct {
		Emoji string
		Count int
	}
	Votes   []point
	Entries []struct {
		Mood    string
		Comment string
	}
	Minutes, ElapsedMs                 int64
	RemainingMs, DeadlineAt, StartedAt *int64
}

func (r *renderer) paintWidget(dst *image.RGBA, el renderElement, p point, width, height, scale, opacity float64) {
	var data widgetSummary
	// Interpret only the printable fields for the specific widget. A legacy
	// widget may store "columns" as a number instead of column objects.
	var values map[string]json.RawMessage
	if err := json.Unmarshal(el.WidgetData, &values); err == nil {
		if el.WidgetType != "kanban" && el.WidgetType != "retro" {
			delete(values, "columns")
		}
		if subset, err := json.Marshal(values); err == nil {
			_ = json.Unmarshal(subset, &data)
		}
	}
	paintPolygon(dst, roundedBox(p, width, height, 10*scale), withOpacity(rgb(0xf8fafc), opacity))
	paintStroke(dst, roundedBox(p, width, height, 10*scale), scale, withOpacity(rgb(0xcbd5e1), opacity), true)
	pad := 9 * scale
	title := strings.ReplaceAll(el.WidgetType, "-", " ")
	if title == "" {
		title = "widget"
	}
	label := strings.ToUpper(title[:1]) + title[1:]
	r.text(dst, label, p.X+pad, p.Y+pad, width-2*pad, 24*scale, 16*scale, "left", withOpacity(rgb(0x1e293b), opacity))
	body := point{p.X + pad, p.Y + 33*scale}
	bodyW, bodyH := width-2*pad, height-42*scale
	if bodyW <= 0 || bodyH <= 0 {
		return
	}

	var lines []string
	switch el.WidgetType {
	case "table":
		r.paintTable(dst, data.Cells, body, bodyW, bodyH, scale, opacity)
	case "kanban", "retro":
		r.paintColumns(dst, data.Columns, body, bodyW, bodyH, scale, opacity)
	case "timer", "stopwatch":
		elapsed := data.ElapsedMs
		if el.WidgetType == "timer" {
			switch {
			case data.DeadlineAt != nil:
				elapsed = max(0, *data.DeadlineAt-r.capturedAt)
			case data.RemainingMs != nil:
				elapsed = *data.RemainingMs
			default:
				elapsed = min(max(data.Minutes, 1), 180) * 60000
			}
		} else if data.StartedAt != nil {
			elapsed += max(0, r.capturedAt-*data.StartedAt)
		}
		elapsed = max(0, elapsed)
		r.text(dst, fmt.Sprintf("%02d:%02d", elapsed/60000, elapsed/1000%60), body.X, body.Y,
			bodyW, bodyH, 32*scale, "middle", withOpacity(rgb(0x1e293b), opacity))
	case "poll":
		lines = append(lines, data.Question)
		for _, item := range data.Options {
			lines = append(lines, fmt.Sprintf("%s  %d", item.Text, item.Votes))
		}
	case "random-picker":
		lines = append(lines, data.Items...)
		if len(data.PickedItems) > 0 {
			lines = append(lines, "Picked  "+strings.Join(data.PickedItems, ", "))
		}
	case "question-card":
		lines = append(lines, data.Category)
		if data.CurrentIndex >= 0 && data.CurrentIndex < len(data.CustomQuestions) {
			lines = append(lines, data.CustomQuestions[data.CurrentIndex])
		}
	case "mood-meter":
		for _, entry := range data.Entries {
			lines = append(lines, strings.TrimSpace(entry.Mood+" "+entry.Comment))
		}
	case "reaction-counter":
		for _, reaction := range data.Reactions {
			lines = append(lines, fmt.Sprintf("%s  %d", reaction.Emoji, reaction.Count))
		}
	case "dot-voting":
		for _, vote := range data.Votes {
			if !renderableNumber(vote.X) || !renderableNumber(vote.Y) {
				continue
			}
			paintPolygon(dst, regularPolygon(point{p.X + vote.X*scale, p.Y + vote.Y*scale}, 4*scale, 4*scale, 16, 0),
				withOpacity(rgb(0x6366f1), opacity))
		}
		lines = append(lines, fmt.Sprintf("%d votes", len(data.Votes)))
	}
	if len(lines) > 0 {
		r.text(dst, strings.Join(lines, "\n"), body.X, body.Y, bodyW, bodyH, 13*scale, "left", withOpacity(rgb(0x334155), opacity))
	}
}

func (r *renderer) paintTable(dst *image.RGBA, cells [][]widgetCell, p point, width, height, scale, opacity float64) {
	if len(cells) == 0 {
		return
	}
	rows := min(len(cells), 60)
	columns := 0
	for _, row := range cells[:rows] {
		columns = max(columns, min(len(row), 60))
	}
	if columns == 0 {
		return
	}
	cellW, cellH := width/float64(columns), height/float64(rows)
	for y, row := range cells[:rows] {
		for x, cell := range row[:min(len(row), columns)] {
			pos := point{p.X + float64(x)*cellW, p.Y + float64(y)*cellH}
			paintRect(dst, pos, cellW, cellH, withOpacity(rgb(0xe2e8f0), opacity))
			paintRect(dst, point{pos.X + scale, pos.Y + scale}, cellW-scale, cellH-scale, paintColor(cell.BackgroundColor, rgb(0xffffff), opacity))
			r.text(dst, cell.Content, pos.X+3*scale, pos.Y+3*scale, cellW-5*scale, cellH-4*scale, 12*scale, "left", withOpacity(rgb(0x334155), opacity))
		}
	}
}

func (r *renderer) paintColumns(dst *image.RGBA, columns []widgetColumn, p point, width, height, scale, opacity float64) {
	if len(columns) == 0 {
		return
	}
	columns = columns[:min(12, len(columns))]
	columnW := width / float64(len(columns))
	for index, column := range columns {
		pos := point{p.X + float64(index)*columnW, p.Y}
		paintRect(dst, pos, columnW-3*scale, height, paintColor(column.Color, rgb(0xe2e8f0), opacity))
		innerW := columnW - 10*scale
		r.text(dst, column.Title, pos.X+4*scale, pos.Y+5*scale, innerW, 24*scale, 13*scale, "left", withOpacity(rgb(0x1e293b), opacity))
		cards := column.Cards
		if len(cards) == 0 {
			cards = column.Notes
		}
		y := pos.Y + 29*scale
		for _, card := range cards {
			if y+23*scale > pos.Y+height {
				break
			}
			paintRect(dst, point{pos.X + 4*scale, y}, innerW, 22*scale, withOpacity(rgb(0xffffff), opacity))
			value := card.Text
			if value == "" {
				value = card.Title
			}
			if value == "" {
				value = card.Content
			}
			r.text(dst, value, pos.X+7*scale, y+2*scale, innerW-5*scale, 20*scale, 11*scale, "left", withOpacity(rgb(0x334155), opacity))
			y += 26 * scale
		}
	}
}
