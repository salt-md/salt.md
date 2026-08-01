package server

import "testing"

// A rollup without a condition must keep counting everything — existing
// databases carry rollups defined before conditions existed, and they may not
// change meaning under an upgrade.
func TestRollupWithoutConditionCountsEverything(t *testing.T) {
	d := propDef{Type: "rollup", RollupAgg: "count"}
	for _, props := range []map[string]any{
		{"status": "erledigt"},
		{"status": "eingang"},
		{},
		nil,
	} {
		if !matchesRollupWhere(d, props) {
			t.Errorf("no condition should match %v", props)
		}
	}
}

// The number a progress bar needs: how many of the related rows are done.
func TestRollupConditionSelectsRows(t *testing.T) {
	done := propDef{RollupWhereProp: "status", RollupWhereOp: "is", RollupWhereValue: "erledigt"}
	open := propDef{RollupWhereProp: "status", RollupWhereOp: "is_not", RollupWhereValue: "erledigt"}

	rows := []map[string]any{
		{"status": "erledigt"},
		{"status": "erledigt"},
		{"status": "eingang"},
		{"status": "in-arbeit"},
		{}, // no status at all
	}
	count := func(d propDef) int {
		n := 0
		for _, r := range rows {
			if matchesRollupWhere(d, r) {
				n++
			}
		}
		return n
	}
	if got := count(done); got != 2 {
		t.Errorf("done: got %d, want 2", got)
	}
	// is_not must include the row with no status — "not done" is true of it.
	if got := count(open); got != 3 {
		t.Errorf("open: got %d, want 3", got)
	}
}

func TestRollupConditionOperators(t *testing.T) {
	cases := []struct {
		op, value string
		props     map[string]any
		want      bool
	}{
		{"is", "a", map[string]any{"p": "a"}, true},
		{"is", "a", map[string]any{"p": "b"}, false},
		{"is_not", "a", map[string]any{"p": "b"}, true},
		{"is_empty", "", map[string]any{"p": ""}, true},
		{"is_empty", "", map[string]any{"p": "  "}, true}, // whitespace is empty
		{"is_empty", "", map[string]any{"p": "x"}, false},
		{"is_not_empty", "", map[string]any{"p": "x"}, true},
		{"is_not_empty", "", map[string]any{}, false}, // missing counts as empty
		{"contains", "erle", map[string]any{"p": "erledigt"}, true},
		{"contains", "ERLE", map[string]any{"p": "erledigt"}, true}, // case-insensitive
		{"contains", "x", map[string]any{"p": "erledigt"}, false},
		// A typo in the operator must not silently match everything — that would
		// turn "done" into "all" and quietly show 100% progress.
		{"tippfehler", "a", map[string]any{"p": "b"}, false},
		{"tippfehler", "a", map[string]any{"p": "a"}, true},
		// Non-string values still compare (a number in a text condition).
		{"is", "3", map[string]any{"p": float64(3)}, true},
	}
	for _, c := range cases {
		d := propDef{RollupWhereProp: "p", RollupWhereOp: c.op, RollupWhereValue: c.value}
		if got := matchesRollupWhere(d, c.props); got != c.want {
			t.Errorf("op=%q value=%q props=%v → %v, want %v", c.op, c.value, c.props, got, c.want)
		}
	}
}

// A backrelation with an incomplete definition must return nothing rather than
// guessing at a collection — a half-configured property is a blank column, not
// a listing of somebody else's database.
func TestBackrelationNeedsBothHalves(t *testing.T) {
	s := &Server{}
	rows := []map[string]any{{"id": "abc"}}
	for _, d := range []propDef{
		{Type: "backrelation"},
		{Type: "backrelation", BackrelationCollection: "coll"},
		{Type: "backrelation", BackrelationProp: "system"},
	} {
		got := s.backrelationIDs(&user{ID: "u"}, d, rows)
		if len(got) != 1 || got[0] != nil {
			t.Errorf("incomplete definition %+v returned %v, want nothing", d, got)
		}
	}
}
