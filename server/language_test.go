package server

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The English-first rule, enforced on the Go side.
//
// The frontend has `npm run check`, which fails the build on a bare string or
// a drifted catalog. The server had nothing — and it showed: twelve finished
// German sentences were sitting in login redirects, plus two whole emails,
// none of which any frontend check could ever see. They were found by reading,
// which is exactly the "hunt through other people's commits" this project is
// meant to avoid.
//
// So the same bargain applies here. New German in a .go file fails the build.
//
// What counts as German is deliberately crude: an umlaut, or two or more words
// from a list that has no English homographs. Crude is fine — the goal is to
// catch a paragraph somebody wrote in German, not to identify a language.

var germanWords = regexp.MustCompile(`(?i)\b(und|nicht|wird|werden|sind|eine|einen|einem|einer|kann|muss|müssen|soll|sollen|beim|des|für|aus|nach|über|ohne|damit|weil|wenn|dann|noch|nur|schon|sich|hier|aber|oder|bitte|kein|keine|wurde|wurden|diese|dieser|dieses|jeder|jede|mehr|sehr|immer|wieder|zwischen|während|deshalb|sonst|bereits|jetzt|etwas|nichts|alles|ihre|seine|unser|gibt|geben|machen|macht|lassen|bleibt|steht|liegt|dabei|darauf|dafür|dadurch|daher|sowie|zum|zur|vom|beim)\b`)

var umlauts = regexp.MustCompile(`[äöüßÄÖÜ]`)

// exemptLine is the per-line escape hatch, same spelling as the frontend
// check. The reason is mandatory: a bare marker is how a rule quietly dies.
var exemptLine = regexp.MustCompile(`i18n-ok:\s*\S`)

// exemptFile exempts a whole file, for the ones whose German IS the subject —
// the search-folding fixtures test that "Verträge" finds "Vertrag", and
// translating them would delete the test.
var exemptFile = regexp.MustCompile(`i18n-ok-file:\s*\S`)

// pendingTranslation lists the files whose comments have not been converted
// yet. It exists so the check can be switched on before the sweep is finished,
// and it is a debt list, not a config option: it must shrink to nothing.
//
// A file that is already clean may not stay on the list — see the second half
// of the test. Otherwise this turns into the usual allowlist that outlives the
// problem and quietly re-opens the door.
var pendingTranslation = map[string]bool{
	"server/admin.go":          true,
	"server/audit.go":          true,
	"server/collab.go":         true,
	"server/db.go":             true,
	"server/ingest.go":         true,
	"server/lifecycle.go":      true,
	"server/mail_oauth.go":     true,
	"server/mcp.go":            true,
	"server/mcp_db.go":         true,
	"server/mcp_history.go":    true,
	"server/mcp_pages.go":      true,
	"server/mcp_schema.go":     true,
	"server/mcp_workspace.go":  true,
	"server/pages.go":          true,
	"server/server.go":         true,
	"server/transfer.go":       true,
	"server/workspace_move.go": true,
}

func goSources(t *testing.T) []string {
	t.Helper()
	var out []string
	err := filepath.Walk("..", func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// web/ has its own check; the rest is not ours.
			if name := info.Name(); name == "node_modules" || name == "dist" || name == ".git" || name == "web" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(path, ".go") {
			out = append(out, filepath.ToSlash(strings.TrimPrefix(path, "../")))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	sort.Strings(out)
	return out
}

// germanLines returns the 1-based line numbers that read as German.
func germanLines(t *testing.T, rel string) []int {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	text := string(raw)
	if exemptFile.MatchString(text) {
		return nil
	}
	var hits []int
	for i, line := range strings.Split(text, "\n") {
		if exemptLine.MatchString(line) {
			continue
		}
		if umlauts.MatchString(line) || len(germanWords.FindAllString(line, -1)) >= 2 {
			hits = append(hits, i+1)
		}
	}
	return hits
}

func TestSourceIsEnglish(t *testing.T) {
	for _, rel := range goSources(t) {
		hits := germanLines(t, rel)
		if len(hits) > 0 && !pendingTranslation[rel] {
			t.Errorf("%s: %d line(s) read as German, first at %s:%d\n"+
				"    Source text and comments are English (see CLAUDE.md).\n"+
				"    A line that is German on purpose says why: // i18n-ok: <reason>",
				rel, len(hits), rel, hits[0])
		}
	}
}

// TestNoStalePendingTranslation keeps the debt list honest. A file that has
// been converted has to leave the list in the same commit, or the list stops
// describing anything and starts hiding things.
func TestNoStalePendingTranslation(t *testing.T) {
	for rel := range pendingTranslation {
		if _, err := os.Stat(filepath.Join("..", rel)); err != nil {
			t.Errorf("%s is on pendingTranslation but does not exist", rel)
			continue
		}
		if len(germanLines(t, rel)) == 0 {
			t.Errorf("%s is already English — remove it from pendingTranslation", rel)
		}
	}
}
