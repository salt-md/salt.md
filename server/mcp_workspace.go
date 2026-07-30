package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// Agent parity, part 4: self-description, workspaces, sharing.
//
// The security boundary — deliberately NOT reachable over MCP, even where a
// human can do it in the interface:
//   • setting up and switching off two-factor authentication
//   • creating or deleting API tokens (an agent could otherwise issue itself
//     permanent access carrying wider permissions)
//   • creating or deleting user accounts, setting passwords
//   • backup, restore, tunnel, SMTP, instance settings
// Those are permissions over the instance, not over content. A compromised or
// misdirected agent should be able to touch content — not the way in.

// mcpWhoami: "an agent has to know who it is and what it may do." Without this
// answer an agent is left guessing whether a failure was missing permissions or
// a wrong id.
func (s *Server) mcpWhoami(u *user) (string, error) {
	scope := u.TokenScope
	if scope == "" {
		scope = "write"
	}
	out := map[string]any{
		"user_id":     u.ID,
		"name":        u.Name,
		"email":       u.Email,
		"token_scope": scope,
		"can_write":   scope != "read",
		// What this access deliberately cannot do — so an agent does not even try
		// and reads a failure correctly. This list used to say "user accounts"
		// although list_users exists, and "backup/restore" although the same token
		// reached the backup through the REST interface. Both are accurate now:
		// administration requires a sign-in in the browser.
		"not_available_via_mcp": []string{
			"two-factor settings", "API tokens", "creating or deleting accounts",
			"backup/restore", "tunnel and instance settings",
			"workspace membership and roles",
			"applying workspace rules (propose_workspace_rules submits a draft; an admin applies it in the browser)",
		},
		"note": "list_users names only the people you share a workspace with; " +
			"account administration needs a signed-in browser session.",
	}
	if u.TokenWorkspaces == nil {
		out["workspace_scope"] = "all workspaces you are a member of"
	} else {
		out["workspace_scope"] = u.TokenWorkspaces
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mcpListWorkspaces: which workspaces this token sees, and in which role. The
// workspace used to hang off the token implicitly and was invisible.
func (s *Server) mcpListWorkspaces(u *user) (string, error) {
	rows, err := s.db.Query(`SELECT w.id, w.name, m.role, w.rules != '' FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id
		WHERE m.user_id = ? ORDER BY w.name`, u.ID)
	if err != nil {
		return "", err
	}
	type ws struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Role    string `json:"role"`
		InScope bool   `json:"in_token_scope"`
		// HasRules says "read them via get_workspace before you write here" —
		// the rules themselves stay out of the list so they are delivered once,
		// with their framing, not scattered through an untrusted-content block.
		HasRules bool `json:"has_rules"`
	}
	out := []ws{}
	for rows.Next() {
		var w ws
		if err := rows.Scan(&w.ID, &w.Name, &w.Role, &w.HasRules); err != nil {
			rows.Close()
			return "", err
		}
		w.InScope = u.tokenCanReach(w.ID)
		out = append(out, w)
	}
	rows.Close()
	b, err := json.Marshal(map[string]any{"workspaces": out})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mcpGetWorkspace returns context and members — needed to fill person fields
// or to assign work. The second return is an addendum for OUTSIDE the
// untrusted-content block: the active rules with their follow-this framing,
// or a server-authored hint about missing/proposed rules. It must never carry
// user-authored text apart from the admin's rules themselves — a member name
// out there would be an injection surface with a server voice.
func (s *Server) mcpGetWorkspace(u *user, wsID string) (string, string, error) {
	if wsID == "" {
		wsID = s.userDefaultWorkspace(u.ID)
	}
	if wsID == "" || !s.isMember(u.ID, wsID) || !u.tokenCanReach(wsID) {
		return "", "", fmt.Errorf("workspace %q not found", wsID)
	}
	var name, rules, proposal string
	if err := s.db.QueryRow(`SELECT name, rules, rules_proposal FROM workspaces WHERE id = ?`, wsID).Scan(&name, &rules, &proposal); err != nil {
		return "", "", fmt.Errorf("workspace %q not found", wsID)
	}
	rows, err := s.db.Query(`SELECT u.id, u.name, u.email, m.role FROM workspace_members m
		JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name`, wsID)
	if err != nil {
		return "", "", err
	}
	type member struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	members := []member{}
	for rows.Next() {
		var m member
		if err := rows.Scan(&m.ID, &m.Name, &m.Email, &m.Role); err != nil {
			rows.Close()
			return "", "", err
		}
		members = append(members, m)
	}
	rows.Close()
	var pages, dbs int
	s.db.QueryRow(`SELECT COUNT(*) FROM pages WHERE workspace_id = ? AND trashed_at IS NULL AND type != 'collection'`, wsID).Scan(&pages)
	s.db.QueryRow(`SELECT COUNT(*) FROM pages WHERE workspace_id = ? AND trashed_at IS NULL AND type = 'collection'`, wsID).Scan(&dbs)

	b, err := json.Marshal(map[string]any{
		"id": wsID, "name": name, "my_role": s.workspaceRole(u.ID, wsID),
		"members": members, "page_count": pages, "database_count": dbs,
		"has_rules": rules != "", "has_pending_rules_proposal": proposal != "",
	})
	if err != nil {
		return "", "", err
	}
	return string(b), rulesAddendum(rules, proposal), nil
}

// rulesAddendum builds what get_workspace appends after the untrusted block:
// the active rules (framed to be followed), or a hint that none exist yet —
// so an agent tells the user and offers to draft some — or that a proposal is
// already waiting, so it does not pile a second one on top unasked.
func rulesAddendum(rules, proposal string) string {
	switch {
	case rules != "" && proposal != "":
		return wrapWorkspaceRules(rules) +
			"\n\nA rules proposal is also waiting for admin review in the browser — do not submit another unless the user asks for changes."
	case rules != "":
		return wrapWorkspaceRules(rules)
	case proposal != "":
		return "\n\nThis workspace has no active rules yet, but a rules proposal is already waiting for admin review in the browser — do not submit another unless the user asks for changes."
	default:
		return "\n\nThis workspace has no rules yet. Mention that to the user; if they want some, draft a short set together (naming, structure, where content goes, what to leave alone) and submit it with propose_workspace_rules — a workspace admin then applies it in the browser."
	}
}

// mcpProposeWorkspaceRules stores a rules DRAFT. It never touches the active
// rules: only a workspace admin can apply the draft, in the browser
// (handleWorkspaceRules) — that is the hard rule the user asked for, enforced
// where the server can actually see the approval. One slot per workspace; a
// newer proposal replaces the older one, and an empty proposal withdraws the
// caller's own pending draft.
func (s *Server) mcpProposeWorkspaceRules(u *user, wsID, rules string) (string, error) {
	if u.TokenScope == "read" {
		// The dispatch's write-gate covers this too; rules deserve the second lock.
		return "", fmt.Errorf("this API token is read-only; proposing rules requires a write token")
	}
	if wsID == "" {
		wsID = s.userDefaultWorkspace(u.ID)
	}
	if wsID == "" || !s.isMember(u.ID, wsID) || !u.tokenCanReach(wsID) {
		return "", fmt.Errorf("workspace %q not found", wsID)
	}
	if s.workspaceRole(u.ID, wsID) == "viewer" {
		return "", fmt.Errorf("you are a viewer in this workspace and cannot propose rules")
	}
	rules = strings.TrimSpace(rules)
	if utf8.RuneCountInString(rules) > 16000 {
		return "", fmt.Errorf("workspace rules are limited to 16000 characters")
	}
	if rules == "" {
		var by string
		s.db.QueryRow(`SELECT rules_proposal_by FROM workspaces WHERE id = ?`, wsID).Scan(&by)
		if by == "" {
			return "There is no pending proposal to withdraw.", nil
		}
		if by != u.ID {
			return "", fmt.Errorf("the pending proposal is not yours to withdraw — an admin can dismiss it in the browser")
		}
		if _, err := s.db.Exec(`UPDATE workspaces SET rules_proposal = '', rules_proposal_by = '', rules_proposal_at = '' WHERE id = ?`, wsID); err != nil {
			return "", err
		}
		return "Withdrew your pending rules proposal.", nil
	}
	var replaced string
	s.db.QueryRow(`SELECT rules_proposal FROM workspaces WHERE id = ?`, wsID).Scan(&replaced)
	if _, err := s.db.Exec(`UPDATE workspaces SET rules_proposal = ?, rules_proposal_by = ?, rules_proposal_at = ? WHERE id = ?`,
		rules, u.ID, now(), wsID); err != nil {
		return "", err
	}
	note := "Proposed — NOT active yet. A workspace admin reviews and applies it in the browser (workspace menu → Workspace rules). Tell the user it is waiting there."
	if replaced != "" {
		note = "Proposed, replacing the previous pending proposal — NOT active yet. A workspace admin reviews and applies it in the browser (workspace menu → Workspace rules). Tell the user it is waiting there."
	}
	b, err := json.Marshal(map[string]any{"ok": true, "workspace_id": wsID, "note": note})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mcpGetPermissions answers up front what is allowed on a page — "check
// first rather than write blind and fail".
func (s *Server) mcpGetPermissions(u *user, pageID string) (string, error) {
	var ws string
	var trashed any
	if err := s.db.QueryRow(`SELECT workspace_id, trashed_at FROM pages WHERE id = ?`, pageID).Scan(&ws, &trashed); err != nil {
		return "", fmt.Errorf("page %q not found", pageID)
	}
	canRead := s.canRead(u.ID, pageID) && u.tokenCanReach(ws)
	if !canRead {
		// Do not give away that the page exists.
		return "", fmt.Errorf("page %q not found", pageID)
	}
	role := s.workspaceRole(u.ID, ws)
	canWrite := s.canWrite(u.ID, pageID) && u.tokenCanReach(ws) && u.TokenScope != "read"
	reason := ""
	switch {
	case u.TokenScope == "read":
		reason = "this API token is read-only"
	case role == "viewer":
		reason = "you are a viewer in this workspace"
	}
	b, err := json.Marshal(map[string]any{
		"page_id": pageID, "workspace_id": ws, "my_role": role,
		"can_read": canRead, "can_write": canWrite, "can_delete": canWrite,
		"in_trash": trashed != nil, "read_only_reason": reason,
	})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// --- Public sharing ---------------------------------------------------------

// mcpSharePage creates a public read link. Deliberately identical to the
// interface: one live share per page, and sharing again replaces the old token
// (otherwise a link believed revoked would stay valid).
func (s *Server) mcpSharePage(r requestBase, pageID string, expiresInDays int, password string) (string, error) {
	var expiresAt any
	if expiresInDays > 0 {
		expiresAt = time.Now().UTC().AddDate(0, 0, expiresInDays).Format(time.RFC3339Nano)
	}
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	var pwHash any
	if password != "" {
		pwHash = tokenHash(token + ":" + password)
	}
	s.db.Exec(`DELETE FROM share_links WHERE page_id = ? AND mode != 'form'`, pageID)
	if _, err := s.db.Exec(`INSERT INTO share_links (token_hash, page_id, created_at, expires_at, password_hash) VALUES (?, ?, ?, ?, ?)`,
		tokenHash(token), pageID, now(), expiresAt, pwHash); err != nil {
		return "", err
	}
	out, err := json.Marshal(map[string]any{
		"page_id": pageID,
		"url":     r.base + "/public/" + token,
		"expires": expiresAt,
		"note":    "Anyone with this link can read the page without signing in. Sharing again replaces this link.",
	})
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// mcpUnsharePage revokes the public link.
func (s *Server) mcpUnsharePage(pageID string) (string, error) {
	res, err := s.db.Exec(`DELETE FROM share_links WHERE page_id = ? AND mode != 'form'`, pageID)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Sprintf("Page %s was not shared publicly", pageID), nil
	}
	return fmt.Sprintf("Revoked the public link for page %s", pageID), nil
}

// requestBase carries the public base URL into the MCP layer. The link has to
// name the same domain the interface hands out (configured domain, Cloudflare
// tunnel or request host) — otherwise an agent would get a link that cannot be
// reached from outside.
type requestBase struct{ base string }
