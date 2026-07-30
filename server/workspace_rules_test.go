package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The guards on PUT /api/workspaces/{id}/rules, exercised through the real
// router. Rules are instructions agents are told to FOLLOW (get_workspace
// hands them out with a follow-this framing), so the write path is the whole
// security story: admin-only, session-only. If an API token could write them,
// the rules channel would be a prompt-injection channel with official
// packaging.

// makeWorkspace creates a workspace directly, sidestepping setup semantics
// (personal spaces, auto-join) that are not under test here.
func makeWorkspace(t *testing.T, s *Server, adminID string) string {
	t.Helper()
	ws := newID()
	if _, err := s.db.Exec(`INSERT INTO workspaces (id, name, created_at) VALUES (?, 'Rules WS', ?)`, ws, now()); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	if _, err := s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')`, ws, adminID); err != nil {
		t.Fatalf("insert admin: %v", err)
	}
	return ws
}

func putRules(t *testing.T, s *Server, wsID, body string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/api/workspaces/"+wsID+"/rules", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	s.ServeHTTP(rec, req)
	return rec
}

func TestWorkspaceRulesWriteGuards(t *testing.T) {
	s := testServer(t)
	uid, cookie := signedIn(t, s, "a@example.com")
	ws := makeWorkspace(t, s, uid)

	// Anonymous: no.
	if rec := putRules(t, s, ws, `{"rules":"x"}`, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous PUT: got %d, want 401", rec.Code)
	}

	// A write-scoped API token of the admin: still no. That is the sessionOnly
	// gate, and the gate is the feature's security story, not decoration.
	raw := newID()
	if _, err := s.db.Exec(`INSERT INTO api_tokens (id, user_id, name, token_hash, scope, created_at)
		VALUES (?, ?, 'probe', ?, 'write', ?)`, newID(), uid, tokenHash(raw), now()); err != nil {
		t.Fatalf("insert token: %v", err)
	}
	if rec := putRules(t, s, ws, `{"rules":"x"}`, map[string]string{"Authorization": "Bearer " + raw}); rec.Code != http.StatusForbidden {
		t.Errorf("token PUT: got %d, want 403 — an API token may not write rules", rec.Code)
	}

	// A plain member: 403. A stranger: 404, not 403 — the workspace's
	// existence is not the stranger's business.
	member, memberCookie := signedIn(t, s, "b@example.com")
	if _, err := s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')`, ws, member); err != nil {
		t.Fatalf("insert member: %v", err)
	}
	if rec := putRules(t, s, ws, `{"rules":"x"}`, map[string]string{"Cookie": memberCookie}); rec.Code != http.StatusForbidden {
		t.Errorf("member PUT: got %d, want 403", rec.Code)
	}
	_, strangerCookie := signedIn(t, s, "c@example.com")
	if rec := putRules(t, s, ws, `{"rules":"x"}`, map[string]string{"Cookie": strangerCookie}); rec.Code != http.StatusNotFound {
		t.Errorf("stranger PUT: got %d, want 404", rec.Code)
	}

	// Nothing above wrote anything.
	var stored string
	s.db.QueryRow(`SELECT rules FROM workspaces WHERE id = ?`, ws).Scan(&stored)
	if stored != "" {
		t.Fatalf("a refused call wrote anyway: %q", stored)
	}

	// The admin over the session cookie: yes — otherwise everything above
	// passes for the wrong reason (a broken route, say).
	if rec := putRules(t, s, ws, `{"rules":"Invoices go into Finance/Inbox."}`, map[string]string{"Cookie": cookie}); rec.Code != http.StatusOK {
		t.Fatalf("admin PUT: got %d, want 200", rec.Code)
	}
	s.db.QueryRow(`SELECT rules FROM workspaces WHERE id = ?`, ws).Scan(&stored)
	if stored != "Invoices go into Finance/Inbox." {
		t.Errorf("stored = %q", stored)
	}

	// Over the length limit: refused with its own code (the dialog translates
	// it), and the stored text stays as it was.
	long := strings.Repeat("a", 16001)
	rec := putRules(t, s, ws, `{"rules":"`+long+`"}`, map[string]string{"Cookie": cookie})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "rules_too_long") {
		t.Errorf("overlong PUT: got %d %q, want 400 rules_too_long", rec.Code, rec.Body.String())
	}
	s.db.QueryRow(`SELECT rules FROM workspaces WHERE id = ?`, ws).Scan(&stored)
	if stored != "Invoices go into Finance/Inbox." {
		t.Errorf("overlong PUT changed the stored rules: %q", stored)
	}
}

func TestWorkspaceRulesReachAgentsOutsideTheUntrustedBlock(t *testing.T) {
	s := testServer(t)
	uid, cookie := signedIn(t, s, "a@example.com")
	ws := makeWorkspace(t, s, uid)
	if rec := putRules(t, s, ws, `{"rules":"Titles start with the date."}`, map[string]string{"Cookie": cookie}); rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d", rec.Code)
	}

	u := &user{ID: uid}
	out, rules, err := s.mcpGetWorkspace(u, ws)
	if err != nil {
		t.Fatalf("mcpGetWorkspace: %v", err)
	}
	if rules != "Titles start with the date." {
		t.Errorf("rules = %q", rules)
	}
	// has_rules travels inside the JSON; the text itself must not — the JSON
	// ends up inside the untrusted block, and the rules must sit outside it.
	if !strings.Contains(out, `"has_rules":true`) {
		t.Errorf("workspace JSON does not mark has_rules: %s", out)
	}
	if strings.Contains(out, "Titles start with the date.") {
		t.Errorf("rules text leaked into the untrusted JSON: %s", out)
	}

	// The composed tool answer: untrusted block first, the rules after it,
	// with their own frame.
	full := wrapUntrusted(out) + wrapWorkspaceRules(rules)
	endUntrusted := strings.Index(full, "END UNTRUSTED CONTENT")
	beginRules := strings.Index(full, "BEGIN WORKSPACE RULES")
	if endUntrusted == -1 || beginRules == -1 || beginRules < endUntrusted {
		t.Fatalf("rules are not outside the untrusted block:\n%s", full)
	}
	// And no rules means no frame at all — not an empty one.
	if wrapWorkspaceRules("") != "" {
		t.Errorf("empty rules produced a frame")
	}

	// list_workspaces marks the workspace so an agent knows to fetch them.
	lst, err := s.mcpListWorkspaces(u)
	if err != nil {
		t.Fatalf("mcpListWorkspaces: %v", err)
	}
	var listed struct {
		Workspaces []struct {
			ID       string `json:"id"`
			HasRules bool   `json:"has_rules"`
		} `json:"workspaces"`
	}
	if err := json.Unmarshal([]byte(lst), &listed); err != nil {
		t.Fatalf("unmarshal list_workspaces: %v", err)
	}
	found := false
	for _, w := range listed.Workspaces {
		if w.ID == ws {
			found = w.HasRules
		}
	}
	if !found {
		t.Errorf("list_workspaces does not mark has_rules for %s: %s", ws, lst)
	}
}
