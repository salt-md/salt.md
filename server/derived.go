package server

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Computed database properties: relations, rollups and formulas. All are
// resolved SERVER-SIDE when rows are returned, so they work with pagination and
// stay consistent regardless of client.

type propDef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	// relation
	RelationCollection string `json:"relationCollection"`
	// rollup
	RollupRelation string `json:"rollupRelation"`
	RollupTarget   string `json:"rollupTarget"`
	RollupAgg      string `json:"rollupAgg"` // sum|count|avg|min|max
	// formula
	Formula string `json:"formula"`
}

func parseSchema(schemaJSON string) []propDef {
	var defs []propDef
	json.Unmarshal([]byte(schemaJSON), &defs)
	return defs
}

// toNumber best-effort coerces a stored prop value to a float. Handles the Go
// numeric types produced by our own computed aggregates (int) as well as the
// float64 that JSON numbers decode to.
func toNumber(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case bool:
		if t {
			return 1, true
		}
		return 0, true
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(t), 64); err == nil {
			return f, true
		}
	}
	return 0, false
}

// computeDerived injects rollup and formula values into each row's props map,
// resolving relations against the target collection. Formulas support +-*/(),
// numeric literals, and other-property references by id, with cycle detection.
func (s *Server) computeDerived(u *user, schema []propDef, rows []map[string]any) {
	// Index derived props.
	var rollups, formulas, relations []propDef
	for _, d := range schema {
		switch d.Type {
		case "rollup":
			rollups = append(rollups, d)
		case "formula":
			formulas = append(formulas, d)
		case "relation":
			relations = append(relations, d)
		}
	}
	if len(rollups) == 0 && len(formulas) == 0 && len(relations) == 0 {
		return
	}

	// Rollups: for each row, aggregate a target property over its related rows.
	for _, ru := range rollups {
		targetRows := s.relatedRowProps(u, ru.RollupRelation, ru.RollupTarget, rows)
		for i, row := range rows {
			props, _ := row["props"].(map[string]any)
			if props == nil {
				continue
			}
			props[ru.ID] = aggregate(ru.RollupAgg, targetRows[i])
		}
	}

	// Formulas: evaluate per row with cycle detection across formula refs.
	formulaByID := map[string]propDef{}
	for _, f := range formulas {
		formulaByID[f.ID] = f
	}
	for _, row := range rows {
		props, _ := row["props"].(map[string]any)
		if props == nil {
			continue
		}
		for _, f := range formulas {
			val, err := evalFormula(f.Formula, props, formulaByID, map[string]bool{})
			if err != nil {
				props[f.ID] = "⚠ " + err.Error()
			} else {
				props[f.ID] = val
			}
		}
	}
}

// relatedRowProps returns, per input row, the list of target-property values of
// the rows it relates to (via relationProp holding an array of target ids).
func (s *Server) relatedRowProps(u *user, relationProp, targetProp string, rows []map[string]any) [][]any {
	// Collect all referenced target ids.
	idSet := map[string]bool{}
	for _, row := range rows {
		props, _ := row["props"].(map[string]any)
		for _, id := range relationIDs(props[relationProp]) {
			idSet[id] = true
		}
	}
	// Fetch target props for referenced ids.
	targetVal := map[string]any{}
	for id := range idSet {
		// The target ids come from a row the user fills in themselves —
		// unchecked that was a read primitive on EVERY page of the instance:
		// create your own database, write somebody else's page id into the
		// relation, put a rollup on it, and the value stood in your own table.
		// Even "count" revealed whether an id exists at all.
		if !s.canRead(u.ID, id) {
			continue
		}
		// The workspace boundary of a narrowed API token applies too: otherwise
		// a token restricted to workspace A would read values out of workspace B
		// through a relation — one the human is a member of, but the token is
		// not meant to reach.
		if !u.tokenCanReach(s.pageWorkspace(id)) {
			continue
		}
		var p string
		if s.db.QueryRow(`SELECT props FROM pages WHERE id = ? AND trashed_at IS NULL`, id).Scan(&p) == nil {
			var m map[string]any
			json.Unmarshal([]byte(p), &m)
			targetVal[id] = m[targetProp]
		}
	}
	out := make([][]any, len(rows))
	for i, row := range rows {
		props, _ := row["props"].(map[string]any)
		for _, id := range relationIDs(props[relationProp]) {
			if v, ok := targetVal[id]; ok { // dangling ids (deleted rows) are skipped — no dead reference
				out[i] = append(out[i], v)
			}
		}
	}
	return out
}

func relationIDs(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	var ids []string
	for _, x := range arr {
		if s, ok := x.(string); ok {
			ids = append(ids, s)
		}
	}
	return ids
}

func aggregate(agg string, vals []any) any {
	nums := make([]float64, 0, len(vals))
	for _, v := range vals {
		if n, ok := toNumber(v); ok {
			nums = append(nums, n)
		}
	}
	switch agg {
	case "count":
		return len(vals)
	case "sum":
		sum := 0.0
		for _, n := range nums {
			sum += n
		}
		return sum
	case "avg":
		if len(nums) == 0 {
			return 0
		}
		sum := 0.0
		for _, n := range nums {
			sum += n
		}
		return sum / float64(len(nums))
	case "min":
		if len(nums) == 0 {
			return 0
		}
		m := math.Inf(1)
		for _, n := range nums {
			if n < m {
				m = n
			}
		}
		return m
	case "max":
		if len(nums) == 0 {
			return 0
		}
		m := math.Inf(-1)
		for _, n := range nums {
			if n > m {
				m = n
			}
		}
		return m
	default:
		return len(vals)
	}
}

// ---- formula evaluator (recursive descent: + - * /, parens, numbers, {propId}) ----

func evalFormula(expr string, props map[string]any, formulas map[string]propDef, visiting map[string]bool) (float64, error) {
	p := &fparser{s: expr, formulas: formulas, props: props, visiting: visiting}
	v, err := p.parseExpr()
	if err != nil {
		return 0, err
	}
	p.skipSpace()
	if p.pos < len(p.s) {
		return 0, fmt.Errorf("unexpected %q", p.s[p.pos:])
	}
	return v, nil
}

type fparser struct {
	s        string
	pos      int
	formulas map[string]propDef
	props    map[string]any
	visiting map[string]bool
}

func (p *fparser) skipSpace() {
	for p.pos < len(p.s) && (p.s[p.pos] == ' ' || p.s[p.pos] == '\t') {
		p.pos++
	}
}

func (p *fparser) parseExpr() (float64, error) { // + and -
	v, err := p.parseTerm()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpace()
		if p.pos >= len(p.s) {
			return v, nil
		}
		op := p.s[p.pos]
		if op != '+' && op != '-' {
			return v, nil
		}
		p.pos++
		rhs, err := p.parseTerm()
		if err != nil {
			return 0, err
		}
		if op == '+' {
			v += rhs
		} else {
			v -= rhs
		}
	}
}

func (p *fparser) parseTerm() (float64, error) { // * and /
	v, err := p.parseFactor()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpace()
		if p.pos >= len(p.s) {
			return v, nil
		}
		op := p.s[p.pos]
		if op != '*' && op != '/' {
			return v, nil
		}
		p.pos++
		rhs, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		if op == '*' {
			v *= rhs
		} else {
			if rhs == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			v /= rhs
		}
	}
}

func (p *fparser) parseFactor() (float64, error) {
	p.skipSpace()
	if p.pos >= len(p.s) {
		return 0, fmt.Errorf("unexpected end")
	}
	c := p.s[p.pos]
	if c == '(' {
		p.pos++
		v, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		p.skipSpace()
		if p.pos >= len(p.s) || p.s[p.pos] != ')' {
			return 0, fmt.Errorf("missing )")
		}
		p.pos++
		return v, nil
	}
	if c == '-' {
		p.pos++
		v, err := p.parseFactor()
		return -v, err
	}
	if c == '{' { // {propId} reference
		end := strings.IndexByte(p.s[p.pos:], '}')
		if end < 0 {
			return 0, fmt.Errorf("missing }")
		}
		id := p.s[p.pos+1 : p.pos+end]
		p.pos += end + 1
		return p.resolveRef(id)
	}
	// number
	start := p.pos
	for p.pos < len(p.s) && (p.s[p.pos] >= '0' && p.s[p.pos] <= '9' || p.s[p.pos] == '.') {
		p.pos++
	}
	if p.pos == start {
		return 0, fmt.Errorf("unexpected %q", string(c))
	}
	return strconv.ParseFloat(p.s[start:p.pos], 64)
}

func (p *fparser) resolveRef(id string) (float64, error) {
	// A referenced formula is evaluated recursively with cycle detection.
	if f, ok := p.formulas[id]; ok {
		if p.visiting[id] {
			return 0, fmt.Errorf("circular reference in formula")
		}
		p.visiting[id] = true
		v, err := evalFormula(f.Formula, p.props, p.formulas, p.visiting)
		delete(p.visiting, id)
		return v, err
	}
	n, _ := toNumber(p.props[id])
	return n, nil
}
