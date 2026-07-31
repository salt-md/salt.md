package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// /api/pages excludes database rows — except rows that carry live sub-pages
// (W124). Without their row in the list, the sidebar had no parent to hang a
// dossier under and showed it flat beside real top-level documents.
func TestListPagesIncludesRowsWithChildren(t *testing.T) {
	s := testServer(t)
	uid, cookie := signedIn(t, s, "a@example.com")
	ws := makeWorkspace(t, s, uid)

	mk := func(id, parent, typ, title string, trashed bool) {
		t.Helper()
		var par any
		if parent != "" {
			par = parent
		}
		var tr any
		if trashed {
			tr = now()
		}
		if _, err := s.db.Exec(`INSERT INTO pages (id, parent_id, title, content, position, created_at, updated_at, trashed_at, workspace_id, owner_id, visibility, type)
			VALUES (?, ?, ?, '[]', 0, ?, ?, ?, ?, ?, 'workspace', ?)`,
			id, par, title, now(), now(), tr, ws, uid, typ); err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}
	mk("db1", "", "collection", "Pipeline", false)
	mk("row-kids", "db1", "doc", "PHI Pharma", false)
	mk("row-bare", "db1", "doc", "Other deal", false)
	mk("row-dead-kid", "db1", "doc", "Dead deal", false)
	mk("sub1", "row-kids", "doc", "PHI: Overview", false)
	mk("sub2", "sub1", "doc", "PHI: Approvals", false)
	mk("dead-sub", "row-dead-kid", "doc", "Gone", true)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/pages", nil)
	req.Header.Set("Cookie", cookie)
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/pages: %d", rec.Code)
	}
	var list []struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := map[string]bool{}
	for _, p := range list {
		got[p.ID] = true
	}
	// The row with a live subtree travels, and so does the subtree — the
	// four-level case: DB → row → sub-page → sub-sub-page.
	for _, want := range []string{"db1", "row-kids", "sub1", "sub2"} {
		if !got[want] {
			t.Errorf("%s missing from /api/pages", want)
		}
	}
	// A bare row stays excluded — that is the tens-of-thousands argument.
	if got["row-bare"] {
		t.Errorf("bare row leaked into /api/pages")
	}
	// A row whose only child is trashed stays excluded (it would render an
	// empty chevron)…
	if got["row-dead-kid"] {
		t.Errorf("row with only a trashed child leaked into /api/pages")
	}
	// …while the trashed child itself still travels, so the trash view works.
	if !got["dead-sub"] {
		t.Errorf("trashed sub-page missing — the trash needs it")
	}
}
