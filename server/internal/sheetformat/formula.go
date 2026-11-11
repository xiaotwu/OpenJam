package sheetformat

import (
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

const (
	errValue = "#VALUE!"
	errRef   = "#REF!"
	errName  = "#NAME?"
	errNum   = "#NUM!"
	errZero  = "#DIV/0!"
	errCycle = "#CYCLE!"
	errBound = "#LIMIT!"

	maxRangeCells = 4096
	maxNesting    = 48
)

var (
	numberToken    = regexp.MustCompile(`^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?`)
	referenceToken = regexp.MustCompile(`^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})$`)
)

type reference struct {
	sheet       string
	address     Address
	fixedRow    bool
	fixedColumn bool
}

type expression struct {
	op     byte
	number float64
	text   string
	ref    reference
	args   []*expression
}

type parser struct {
	source string
	fault  string
}

func parseFormula(source string) (*expression, string) {
	p := parser{source: strings.TrimPrefix(source, "=")}
	root := p.expression(0, 0)
	if p.fault == "" && (p.peek() != 0 || root.op == ':') {
		p.fault = errValue
	}
	return root, p.fault
}

func (p *parser) fail(message string) *expression {
	if p.fault == "" {
		p.fault = message
	}
	return &expression{op: '#', text: p.fault}
}

func (p *parser) peek() byte {
	p.source = strings.TrimLeft(p.source, " \t\r\n")
	if len(p.source) == 0 {
		return 0
	}
	return p.source[0]
}

func (p *parser) take(ch byte) bool {
	if p.peek() == ch && ch != 0 {
		p.source = p.source[1:]
		return true
	}
	return false
}

func precedence(op byte) int {
	switch op {
	case '+', '-':
		return 1
	case '*', '/':
		return 2
	case '^':
		return 3
	}
	return 0
}

func (p *parser) expression(minimum, depth int) *expression {
	left := p.atom(depth)
	for p.fault == "" && p.take('%') {
		if left.op == ':' {
			return p.fail(errValue)
		}
		left = &expression{op: '%', args: []*expression{left}}
	}
	for p.fault == "" {
		op := p.peek()
		priority := precedence(op)
		if priority == 0 || priority < minimum {
			break
		}
		p.source = p.source[1:]
		right := p.expression(priority+1, depth+1)
		if left.op == ':' || right.op == ':' {
			return p.fail(errValue)
		}
		left = &expression{op: op, args: []*expression{left, right}}
	}
	return left
}

func (p *parser) atom(depth int) *expression {
	if depth > maxNesting {
		return p.fail(errBound)
	}
	ch := p.peek()
	if ch == '+' || ch == '-' {
		p.source = p.source[1:]
		child := p.atom(depth + 1)
		if child.op == ':' {
			return p.fail(errValue)
		}
		if ch == '-' {
			return &expression{op: '~', args: []*expression{child}}
		}
		return child
	}
	if p.take('(') {
		value := p.expression(0, depth+1)
		if !p.take(')') {
			return p.fail(errValue)
		}
		return value
	}
	if ch >= '0' && ch <= '9' || ch == '.' {
		token := numberToken.FindString(p.source)
		number, err := strconv.ParseFloat(token, 64)
		if err != nil {
			return p.fail(errNum)
		}
		p.source = p.source[len(token):]
		return &expression{op: 'n', number: number}
	}
	if strings.HasPrefix(p.source, "#REF!") {
		p.source = p.source[len("#REF!"):]
		return &expression{op: '#', text: errRef}
	}
	name, quoted := p.word()
	if name == "" {
		return p.fail(errValue)
	}
	if !quoted && p.take('(') {
		return p.function(name, depth)
	}
	ref := p.reference(name, quoted)
	left := &expression{op: 'r', ref: ref}
	if !p.take(':') {
		return left
	}
	name, quoted = p.word()
	end := p.reference(name, quoted)
	if end.sheet != "" && !strings.EqualFold(end.sheet, ref.sheet) {
		return p.fail(errRef)
	}
	return &expression{op: ':', args: []*expression{left, {op: 'r', ref: end}}}
}

func (p *parser) word() (string, bool) {
	if p.take('\'') {
		var name strings.Builder
		for {
			index := strings.IndexByte(p.source, '\'')
			if index < 0 {
				p.fail(errRef)
				return "", true
			}
			name.WriteString(p.source[:index])
			p.source = p.source[index+1:]
			if !strings.HasPrefix(p.source, "'") {
				return name.String(), true
			}
			name.WriteByte('\'')
			p.source = p.source[1:]
		}
	}
	end := strings.IndexAny(p.source, " \t\r\n()+-*/^%:,![]#=\"<>&@")
	if end < 0 {
		end = len(p.source)
	}
	word := p.source[:end]
	p.source = p.source[end:]
	return word, false
}

func (p *parser) reference(word string, quoted bool) reference {
	var ref reference
	if p.take('!') {
		if !ValidTabName(word) {
			p.fail(errRef)
			return ref
		}
		ref.sheet = word
		word, quoted = p.word()
	}
	match := referenceToken.FindStringSubmatch(word)
	if quoted || match == nil {
		p.fail(errName)
		return ref
	}
	ref.fixedColumn, ref.fixedRow = match[1] != "", match[3] != ""
	for _, char := range strings.ToUpper(match[2]) {
		ref.address.Col = ref.address.Col*26 + int(char-'A'+1)
	}
	ref.address.Row, _ = strconv.Atoi(match[4])
	if ref.address.Col > 16384 || ref.address.Row > 1048576 {
		p.fail(errRef)
	}
	return ref
}

func (p *parser) function(name string, depth int) *expression {
	name = strings.ToUpper(name)
	switch name {
	case "SUM", "AVERAGE", "MIN", "MAX", "COUNT":
	default:
		return p.fail(errName)
	}
	var args []*expression
	for {
		args = append(args, p.expression(0, depth+1))
		if p.fault != "" || !p.take(',') {
			break
		}
	}
	if !p.take(')') {
		return p.fail(errValue)
	}
	return &expression{op: 'f', text: name, args: args}
}

// OffsetSharedFormula translates the relative references in an XLSX shared
// formula. Ordinary formulas are stored verbatim, including unsupported ones.
func OffsetSharedFormula(source string, rows, cols int) (string, bool) {
	root, fault := parseFormula(source)
	if fault != "" {
		return "", false
	}
	return "=" + root.offset(rows, cols), true
}

func (e *expression) offset(rows, cols int) string {
	switch e.op {
	case 'n':
		return strconv.FormatFloat(e.number, 'g', -1, 64)
	case '#':
		return e.text
	case 'r':
		ref := e.ref
		if !ref.fixedRow {
			ref.address.Row += rows
		}
		if !ref.fixedColumn {
			ref.address.Col += cols
		}
		if ref.address.Row < 1 || ref.address.Row > 1048576 || ref.address.Col < 1 || ref.address.Col > 16384 {
			return errRef
		}
		var col string
		for n := ref.address.Col; n > 0; n = (n - 1) / 26 {
			col = string(rune('A'+(n-1)%26)) + col
		}
		if ref.fixedColumn {
			col = "$" + col
		}
		if ref.fixedRow {
			col += "$"
		}
		if ref.sheet != "" {
			col = "'" + strings.ReplaceAll(ref.sheet, "'", "''") + "'!" + col
		}
		return col + strconv.Itoa(ref.address.Row)
	case ':':
		return e.args[0].offset(rows, cols) + ":" + e.args[1].offset(rows, cols)
	case 'f':
		args := make([]string, len(e.args))
		for i, arg := range e.args {
			args[i] = arg.offset(rows, cols)
		}
		return e.text + "(" + strings.Join(args, ",") + ")"
	case '~':
		return "-(" + e.args[0].offset(rows, cols) + ")"
	case '%':
		return "(" + e.args[0].offset(rows, cols) + ")%"
	default:
		return "(" + e.args[0].offset(rows, cols) + string(e.op) + e.args[1].offset(rows, cols) + ")"
	}
}

type Result struct {
	Display string
	Kind    string
	Live    bool
}

type cellKey struct {
	tab     int
	address Address
}

type scalar struct {
	kind   string
	text   string
	number float64
}

func numberValue(number float64) scalar {
	if math.IsInf(number, 0) || math.IsNaN(number) {
		return scalar{kind: "error", text: errNum}
	}
	return scalar{kind: "number", number: number}
}

func (s scalar) numeric() (float64, bool) {
	switch s.kind {
	case "", "number":
		return s.number, true
	case "boolean":
		if s.text == "TRUE" {
			return 1, true
		}
		return 0, true
	case "text":
		return Number(s.text)
	}
	return 0, false
}

type calculation struct {
	tabs   []Tab
	values map[cellKey]scalar
	active map[cellKey]bool
	live   map[cellKey]bool
}

func Calculate(tabs []Tab) []map[Address]Result {
	c := calculation{tabs: tabs, values: map[cellKey]scalar{}, active: map[cellKey]bool{}, live: map[cellKey]bool{}}
	output := make([]map[Address]Result, len(tabs))
	for i, tab := range tabs {
		output[i] = make(map[Address]Result)
		var addresses []Address
		for address, value := range tab.Cells {
			if value.Kind == "formula" {
				addresses = append(addresses, address)
			}
		}
		slices.SortFunc(addresses, func(a, b Address) int {
			return (a.Row-b.Row)*MaxColumns + a.Col - b.Col
		})
		for _, address := range addresses {
			key := cellKey{tab: i, address: address}
			scalar := c.cell(key)
			display := scalar.text
			if scalar.kind == "number" {
				display = NumberString(scalar.number)
			}
			output[i][address] = Result{Display: display, Kind: scalar.kind, Live: c.live[key]}
		}
	}
	return output
}

func (c *calculation) cell(key cellKey) scalar {
	if value, ok := c.values[key]; ok {
		return value
	}
	if c.active[key] {
		return scalar{kind: "error", text: errCycle}
	}
	if len(c.active) >= 96 {
		return scalar{kind: "error", text: errBound}
	}
	value := c.tabs[key.tab].Cells[key.address]
	if value.Kind == "number" {
		number, _ := Number(value.Input)
		result := numberValue(number)
		c.values[key] = result
		return result
	}
	if value.Kind != "formula" {
		return scalar{kind: value.Kind, text: value.Input}
	}
	root, fault := parseFormula(value.Input)
	result := scalar{kind: "error", text: fault}
	if fault == "" {
		c.active[key] = true
		remaining := maxRangeCells
		result = c.evaluate(key.tab, root, &remaining)
		delete(c.active, key)
		c.live[key] = result.kind != "error" || result.text != errRef && result.text != errBound && result.text != errCycle
		if result.kind == "" {
			result = numberValue(0)
		}
	}
	c.values[key] = result
	return result
}

func (c *calculation) tabIndex(current int, name string) int {
	if name == "" {
		return current
	}
	for index, tab := range c.tabs {
		if strings.EqualFold(tab.Name, name) {
			return index
		}
	}
	return -1
}

func (c *calculation) evaluate(tab int, e *expression, remaining *int) scalar {
	switch e.op {
	case 'n':
		return numberValue(e.number)
	case '#':
		return scalar{kind: "error", text: e.text}
	case 'r':
		target := c.tabIndex(tab, e.ref.sheet)
		if target < 0 || !e.ref.address.Valid() {
			return scalar{kind: "error", text: errRef}
		}
		return c.cell(cellKey{tab: target, address: e.ref.address})
	case 'f':
		return c.aggregate(tab, e, remaining)
	}
	left := c.evaluate(tab, e.args[0], remaining)
	if left.kind == "error" {
		return left
	}
	a, ok := left.numeric()
	if !ok {
		return scalar{kind: "error", text: errValue}
	}
	if e.op == '~' {
		return numberValue(-a)
	}
	if e.op == '%' {
		return numberValue(a / 100)
	}
	right := c.evaluate(tab, e.args[1], remaining)
	if right.kind == "error" {
		return right
	}
	b, ok := right.numeric()
	if !ok {
		return scalar{kind: "error", text: errValue}
	}
	switch e.op {
	case '+':
		return numberValue(a + b)
	case '-':
		return numberValue(a - b)
	case '*':
		return numberValue(a * b)
	case '/':
		if b == 0 {
			return scalar{kind: "error", text: errZero}
		}
		return numberValue(a / b)
	default:
		return numberValue(math.Pow(a, b))
	}
}

func (c *calculation) aggregate(tab int, e *expression, remaining *int) scalar {
	count := 0
	var sum, low, high float64
	add := func(value scalar) {
		if value.kind == "number" {
			if count == 0 {
				low, high = value.number, value.number
			}
			count++
			sum += value.number
			low, high = min(low, value.number), max(high, value.number)
		}
	}
	for _, arg := range e.args {
		if arg.op != ':' {
			value := c.evaluate(tab, arg, remaining)
			if value.kind == "error" {
				if e.text == "COUNT" && arg.op == 'r' && value.text != errCycle && value.text != errBound {
					continue
				}
				return value
			}
			add(value)
			continue
		}
		start, end := arg.args[0].ref, arg.args[1].ref
		target := c.tabIndex(tab, start.sheet)
		if target < 0 || !start.address.Valid() || !end.address.Valid() {
			return scalar{kind: "error", text: errRef}
		}
		r1, r2 := min(start.address.Row, end.address.Row), max(start.address.Row, end.address.Row)
		c1, c2 := min(start.address.Col, end.address.Col), max(start.address.Col, end.address.Col)
		*remaining -= (r2 - r1 + 1) * (c2 - c1 + 1)
		if *remaining < 0 {
			return scalar{kind: "error", text: errBound}
		}
		for row := r1; row <= r2; row++ {
			for col := c1; col <= c2; col++ {
				value := c.cell(cellKey{tab: target, address: Address{Row: row, Col: col}})
				if value.kind == "error" && e.text != "COUNT" {
					return value
				}
				if value.text == errCycle || value.text == errBound {
					return value
				}
				add(value)
			}
		}
	}
	switch e.text {
	case "AVERAGE":
		if count == 0 {
			return scalar{kind: "error", text: errZero}
		}
		return numberValue(sum / float64(count))
	case "MIN":
		return numberValue(low)
	case "MAX":
		return numberValue(high)
	case "COUNT":
		return numberValue(float64(count))
	default:
		return numberValue(sum)
	}
}
