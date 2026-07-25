package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strings"
	"time"
)

// Workspaces are the isolation boundary: every page belongs to exactly one
// workspace, and a user only ever sees pages in workspaces they are a member
// of. Within a workspace a page is visibility='workspace' (all members) or
// 'private' (owner + workspace admins only); private-ness is inherited by the
// whole subtree. Public read-only sharing is a separate token (share_links).

// migrateWorkspaces runs once: if any page lacks a workspace, create a default
// workspace, assign every existing page/user to it, and make admins its admins.
// Idempotent and additive — safe on an already-migrated DB.
func (s *Server) migrateWorkspaces() error {
	var orphan int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pages WHERE workspace_id = ''`).Scan(&orphan); err != nil {
		return err
	}
	var userCount int
	s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&userCount)
	var wsCount int
	s.db.QueryRow(`SELECT COUNT(*) FROM workspaces`).Scan(&wsCount)
	// Fresh install (no users yet): handleSetup creates the first workspace and
	// membership. Don't pre-create an ownerless empty workspace here.
	if userCount == 0 && wsCount == 0 {
		return nil
	}
	// Upgrade path: users/pages exist but no workspace — create the default one.
	if wsCount == 0 {
		wsID := newID()
		if _, err := s.db.Exec(`INSERT INTO workspaces (id, name, created_at) VALUES (?, 'Workspace', ?)`, wsID, now()); err != nil {
			return err
		}
		// All existing users become members; admins become workspace admins.
		rows, err := s.db.Query(`SELECT id, is_admin FROM users`)
		if err != nil {
			return err
		}
		type u struct {
			id    string
			admin int
		}
		var users []u
		for rows.Next() {
			var x u
			rows.Scan(&x.id, &x.admin)
			users = append(users, x)
		}
		rows.Close()
		for _, x := range users {
			role := "member"
			if x.admin != 0 {
				role = "admin"
			}
			s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, wsID, x.id, role)
		}
		// Assign all pages to this workspace, owned by the first admin.
		var firstAdmin string
		s.db.QueryRow(`SELECT id FROM users WHERE is_admin = 1 ORDER BY created_at LIMIT 1`).Scan(&firstAdmin)
		s.db.Exec(`UPDATE pages SET workspace_id = ?, owner_id = COALESCE(NULLIF(owner_id,''), ?) WHERE workspace_id = ''`, wsID, firstAdmin)
	} else if orphan > 0 {
		// Workspaces exist but some pages are orphaned (shouldn't normally
		// happen): attach them to the oldest workspace.
		var wsID string
		s.db.QueryRow(`SELECT id FROM workspaces ORDER BY created_at LIMIT 1`).Scan(&wsID)
		s.db.Exec(`UPDATE pages SET workspace_id = ? WHERE workspace_id = ''`, wsID)
	}
	return nil
}

// defaultWorkspace returns the workspace a new page from this user should land
// in (their first membership). Empty string if the user has none.
func (s *Server) userDefaultWorkspace(userID string) string {
	var ws string
	s.db.QueryRow(`SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY workspace_id LIMIT 1`, userID).Scan(&ws)
	return ws
}

func (s *Server) isMember(userID, workspaceID string) bool {
	if workspaceID == "" {
		return false
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM workspace_members WHERE user_id = ? AND workspace_id = ?`, userID, workspaceID).Scan(&n)
	return n > 0
}

// workspaceRole returns the caller's role in a workspace ("admin"|"member"|
// "viewer"), or "" if they are not a member.
func (s *Server) workspaceRole(userID, workspaceID string) string {
	var role string
	s.db.QueryRow(`SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?`, userID, workspaceID).Scan(&role)
	return role
}

func (s *Server) isWorkspaceAdmin(userID, workspaceID string) bool {
	return s.workspaceRole(userID, workspaceID) == "admin"
}

// forbiddenPrivateAncestor reports whether any ancestor-or-self of pageID is
// private and owned by someone other than userID (making the subtree off-limits
// unless the user is a workspace admin).
func (s *Server) forbiddenPrivateAncestor(userID, pageID, ws string) bool {
	if s.isWorkspaceAdmin(userID, ws) {
		return false
	}
	var n int
	s.db.QueryRow(`
		WITH RECURSIVE anc(id, parent_id, visibility, owner_id) AS (
			SELECT id, parent_id, visibility, owner_id FROM pages WHERE id = ?
			UNION
			SELECT p.id, p.parent_id, p.visibility, p.owner_id
			FROM pages p JOIN anc ON p.id = anc.parent_id
		) SELECT COUNT(*) FROM anc WHERE visibility = 'private' AND owner_id != ?`, pageID, userID).Scan(&n)
	return n > 0
}

// pageExists meldet, ob die Seite (auch im Papierkorb) noch in der Datenbank
// steht. canRead unterscheidet nicht zwischen "gibt es nicht" und "darfst du
// nicht" — für das Protokoll ist der Unterschied aber wesentlich.
func (s *Server) pageExists(pageID string) bool {
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM pages WHERE id = ?`, pageID).Scan(&n)
	return n > 0
}

// canRead reports whether userID may read pageID.
func (s *Server) canRead(userID, pageID string) bool {
	var ws string
	if err := s.db.QueryRow(`SELECT workspace_id FROM pages WHERE id = ?`, pageID).Scan(&ws); err != nil {
		return false
	}
	if !s.isMember(userID, ws) && !s.hasBreakGlass(userID, ws) {
		return false
	}
	return !s.forbiddenPrivateAncestor(userID, pageID, ws)
}

// canWrite reports whether userID may modify pageID: they must be able to read
// it AND not be a read-only ("viewer") member of its workspace. Workspace admins
// and regular members can write; viewers cannot.
func (s *Server) canWrite(userID, pageID string) bool {
	if !s.canRead(userID, pageID) {
		return false
	}
	var ws string
	if err := s.db.QueryRow(`SELECT workspace_id FROM pages WHERE id = ?`, pageID).Scan(&ws); err != nil {
		return false
	}
	// Echte Mitgliedschaft verlangen, nicht nur "kein Betrachter": ein
	// Notfallzugriff (break_glass) kommt durch canRead, hat aber gar keine
	// Rolle — und "" wäre ungleich "viewer" und damit versehentlich
	// schreibberechtigt. Notfallzugriff heißt ausdrücklich nur lesen.
	role := s.workspaceRole(userID, ws)
	return role != "" && role != "viewer"
}

// canReadReq / canWriteReq are canRead / canWrite PLUS the request's API-token
// workspace scope. Every REST handler that reaches a page by an id taken from
// the request MUST use these (not the bare canRead/canWrite), otherwise a
// workspace-scoped token could name an out-of-scope page's id directly and
// bypass the scope that the enumeration endpoints already enforce. The token
// check is skipped for session / unrestricted-token callers (TokenWorkspaces
// == nil) so it costs no extra query in the common case.
func (s *Server) canReadReq(r *http.Request, pageID string) bool {
	if !s.canRead(requestUser(r).ID, pageID) {
		return false
	}
	u := requestUser(r)
	return u.TokenWorkspaces == nil || u.tokenCanReach(s.pageWorkspace(pageID))
}

func (s *Server) canWriteReq(r *http.Request, pageID string) bool {
	if !s.canWrite(requestUser(r).ID, pageID) {
		return false
	}
	u := requestUser(r)
	return u.TokenWorkspaces == nil || u.tokenCanReach(s.pageWorkspace(pageID))
}

// scopeWorkspaces intersects a workspace list with a request user's token
// workspace restriction (a workspace-scoped API token). Cookie/session auth and
// unrestricted tokens (TokenWorkspaces == nil) pass everything through.
func scopeWorkspaces(u *user, ws []string) []string {
	if u == nil || u.TokenWorkspaces == nil {
		return ws
	}
	allow := map[string]bool{}
	for _, w := range u.TokenWorkspaces {
		allow[w] = true
	}
	out := make([]string, 0, len(ws))
	for _, w := range ws {
		if allow[w] {
			out = append(out, w)
		}
	}
	return out
}

// tokenReachesWorkspace enforces an API token's workspace scope on a
// workspace-id-keyed REST endpoint: a workspace-scoped token must not act on
// (or read) a workspace outside its allow-list even when the user is a member/
// admin of it. Session auth and unrestricted tokens always pass.
func (s *Server) tokenReachesWorkspace(r *http.Request, wsID string) bool {
	u := requestUser(r)
	return u.TokenWorkspaces == nil || u.tokenCanReach(wsID)
}

// tokenCanReach reports whether a workspace-scoped token may touch a workspace.
func (u *user) tokenCanReach(ws string) bool {
	if u == nil || u.TokenWorkspaces == nil {
		return true
	}
	for _, w := range u.TokenWorkspaces {
		if w == ws {
			return true
		}
	}
	return false
}

// visibleWhere returns a SQL fragment + args that restrict a `pages` query
// (aliased `p`) to pages the user may read. It handles workspace membership and
// filters out private subtrees the user doesn't own. Private inheritance is
// approximated at the SQL layer by checking the page and NOT having any private
// ancestor owned by someone else; the exact per-page check is canRead.
func (s *Server) visibleWorkspaces(userID string) []string {
	// Mitgliedschaften plus laufende Notfallzugriffe — sonst käme ein Owner
	// zwar durch canRead, sähe die Seiten aber in keiner Liste.
	rows, err := s.db.Query(`SELECT workspace_id FROM workspace_members WHERE user_id = ?
		UNION
		SELECT workspace_id FROM break_glass
		WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`, userID, userID, nowFixed())
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var w string
		if rows.Scan(&w) == nil {
			out = append(out, w)
		}
	}
	return out
}

// filterReadable keeps only the pages the user may read (workspace + private
// subtree rules), computed in-memory from the already-workspace-scoped set.
func (s *Server) filterReadable(userID string, all []pageMeta) []pageMeta {
	byID := map[string]*pageMeta{}
	for i := range all {
		byID[all[i].ID] = &all[i]
	}
	adminOf := map[string]bool{}
	isAdmin := func(ws string) bool {
		if v, ok := adminOf[ws]; ok {
			return v
		}
		v := s.isWorkspaceAdmin(userID, ws)
		adminOf[ws] = v
		return v
	}
	// A page is hidden if ANY ancestor-or-self is private and owned by someone
	// else (unless the user is a workspace admin).
	blocked := func(p *pageMeta) bool {
		if isAdmin(p.WorkspaceID) {
			return false
		}
		cur := p
		guard := 0
		for cur != nil && guard < 1000 {
			guard++
			if cur.Visibility == "private" && cur.OwnerID != userID {
				return true
			}
			if cur.ParentID == nil {
				break
			}
			cur = byID[*cur.ParentID]
		}
		return false
	}
	out := make([]pageMeta, 0, len(all))
	for i := range all {
		if !blocked(&all[i]) {
			out = append(out, all[i])
		}
	}
	return out
}

// ---- HTTP: workspaces & members ----

type workspaceJSON struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Role  string `json:"role"`
	Icon  string `json:"icon"`
	Image string `json:"image"`
}

func (s *Server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT w.id, w.name, m.role, w.icon, w.image FROM workspace_members m
		JOIN workspaces w ON w.id = m.workspace_id
		WHERE m.user_id = ? ORDER BY w.created_at`, requestUser(r).ID)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	defer rows.Close()
	list := []workspaceJSON{}
	for rows.Next() {
		var x workspaceJSON
		rows.Scan(&x.ID, &x.Name, &x.Role, &x.Icon, &x.Image)
		list = append(list, x)
	}
	writeJSON(w, list)
}

// handleUpdateWorkspace lets a workspace admin rename it or set its icon (emoji)
// / image (an uploaded logo URL). Empty-string fields clear that attribute.
func (s *Server) handleUpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	if !s.tokenReachesWorkspace(r, wsID) {
		httpError(w, 404, "workspace not found")
		return
	}
	if !s.isWorkspaceAdmin(requestUser(r).ID, wsID) {
		httpError(w, 403, "workspace admin only")
		return
	}
	var body struct {
		Name  *string `json:"name"`
		Icon  *string `json:"icon"`
		Image *string `json:"image"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	var sets []string
	var args []any
	if body.Name != nil {
		n := strings.TrimSpace(*body.Name)
		if n == "" {
			httpError(w, 400, "name is required")
			return
		}
		sets = append(sets, "name = ?")
		args = append(args, n)
	}
	if body.Icon != nil {
		icon := strings.TrimSpace(*body.Icon)
		if r := []rune(icon); len(r) > 8 { // an emoji or two, not arbitrary text
			icon = string(r[:8])
		}
		sets = append(sets, "icon = ?")
		args = append(args, icon)
	}
	if body.Image != nil {
		img := strings.TrimSpace(*body.Image)
		// Only accept an internal upload path or clearing it — never an external
		// URL (which would leak requests / act as a tracking beacon).
		if img != "" && !strings.HasPrefix(img, "/files/") {
			httpError(w, 400, "image must be an uploaded file")
			return
		}
		sets = append(sets, "image = ?")
		args = append(args, img)
	}
	if len(sets) == 0 {
		httpError(w, 400, "nothing to update")
		return
	}
	args = append(args, wsID)
	if _, err := s.db.Exec(`UPDATE workspaces SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// handleDeleteWorkspace removes a workspace and everything inside it. This is
// irreversible, so it is fenced in three ways: workspace-admin only, never the
// caller's last workspace (nobody may strand themselves), and the client must
// echo the exact workspace name back in `confirm`.
//
// pages.workspace_id came from a migration and therefore has NO foreign key, so
// pages must be deleted explicitly — everything hanging off a page (collections,
// comments, revisions, links, share links, favourites, file texts) then cascades
// on its own. pages_fts is a virtual table without FKs and is cleared by hand.
func (s *Server) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	uid := requestUser(r).ID
	if !s.tokenReachesWorkspace(r, wsID) {
		httpError(w, 404, "workspace not found")
		return
	}
	if !s.isWorkspaceAdmin(uid, wsID) {
		httpError(w, 403, "workspace admin only")
		return
	}
	var body struct {
		Confirm string `json:"confirm"`
	}
	decodeJSON(w, r, &body)

	var name string
	if err := s.db.QueryRow(`SELECT name FROM workspaces WHERE id = ?`, wsID).Scan(&name); err != nil {
		httpError(w, 404, "workspace not found")
		return
	}
	if strings.TrimSpace(body.Confirm) != name {
		httpError(w, 400, "confirmation does not match the workspace name")
		return
	}
	// Refuse to leave the admin without any workspace at all.
	var mine int
	s.db.QueryRow(`SELECT COUNT(*) FROM workspace_members WHERE user_id = ?`, uid).Scan(&mine)
	if mine <= 1 {
		httpError(w, 409, "this is your last workspace — create another one first")
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM pages_fts WHERE id IN (SELECT id FROM pages WHERE workspace_id = ?)`, wsID); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	if _, err := tx.Exec(`DELETE FROM pages WHERE workspace_id = ?`, wsID); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	// invites carry a workspace_id without a foreign key.
	tx.Exec(`DELETE FROM invites WHERE workspace_id = ?`, wsID)
	// workspace_members and tag_colors cascade from this one.
	if _, err := tx.Exec(`DELETE FROM workspaces WHERE id = ?`, wsID); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	// The audit entry deliberately outlives the workspace it describes.
	s.audit("human", uid, requestUser(r).Name, "delete_workspace", "", wsID, name)
	s.pagesChanged()
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		httpError(w, 400, "name is required")
		return
	}
	// W97: Nicht-Admins nur, wenn die Instanz es erlaubt.
	if !requestUser(r).IsAdmin && !s.loadSettings().AllowUserWorkspaces {
		httpError(w, 403, "creating workspaces is disabled on this instance — ask an admin")
		return
	}
	id := newID()
	// Wer ihn anlegt, gehört er — nicht nur als Rolle, sondern als Eigentümer.
	// Damit ist auch dann beantwortbar, wer zuständig ist, wenn Rollen wegfallen.
	if _, err := s.db.Exec(`INSERT INTO workspaces (id, name, created_at, owner_id) VALUES (?, ?, ?, ?)`,
		id, strings.TrimSpace(body.Name), now(), requestUser(r).ID); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')`, id, requestUser(r).ID)
	writeJSON(w, workspaceJSON{ID: id, Name: strings.TrimSpace(body.Name), Role: "admin"})
}

// handleAddWorkspaceMember lets a workspace admin add an existing user.
func (s *Server) handleAddWorkspaceMember(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	if !s.tokenReachesWorkspace(r, wsID) {
		httpError(w, 404, "workspace not found")
		return
	}
	if !s.isWorkspaceAdmin(requestUser(r).ID, wsID) {
		httpError(w, 403, "workspace admin only")
		return
	}
	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	var uid string
	if err := s.db.QueryRow(`SELECT id FROM users WHERE email = ?`, strings.ToLower(strings.TrimSpace(body.Email))).Scan(&uid); err != nil {
		httpError(w, 404, "user not found")
		return
	}
	s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)
		ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role`, wsID, uid, normalizeRole(body.Role))
	writeJSON(w, map[string]bool{"ok": true})
}

// normalizeRole clamps an arbitrary role string to a known value.
func normalizeRole(r string) string {
	switch r {
	case "admin", "viewer":
		return r
	default:
		return "member"
	}
}

type memberJSON struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Role   string `json:"role"`
}

// handleListMembers lists a workspace's members. Any member may view the roster.
func (s *Server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	if !s.tokenReachesWorkspace(r, wsID) || !s.isMember(requestUser(r).ID, wsID) {
		httpError(w, 404, "workspace not found")
		return
	}
	rows, err := s.db.Query(`
		SELECT u.id, u.name, u.email, m.role FROM workspace_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = ? ORDER BY m.role, u.name`, wsID)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	defer rows.Close()
	list := []memberJSON{}
	for rows.Next() {
		var m memberJSON
		rows.Scan(&m.UserID, &m.Name, &m.Email, &m.Role)
		list = append(list, m)
	}
	writeJSON(w, list)
}

// workspaceAdminCount counts admins so we never orphan a workspace.
func (s *Server) workspaceAdminCount(wsID string) int {
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ? AND role = 'admin'`, wsID).Scan(&n)
	return n
}

// handleUpdateMember changes a member's role (workspace admin only). It refuses
// to demote the last admin so a workspace can't be left without one.
func (s *Server) handleUpdateMember(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	target := r.PathValue("userId")
	if !s.tokenReachesWorkspace(r, wsID) {
		httpError(w, 404, "workspace not found")
		return
	}
	if !s.isWorkspaceAdmin(requestUser(r).ID, wsID) {
		httpError(w, 403, "workspace admin only")
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	role := normalizeRole(body.Role)
	if role != "admin" && s.workspaceRole(target, wsID) == "admin" && s.workspaceAdminCount(wsID) <= 1 {
		httpError(w, 400, "cannot demote the last admin")
		return
	}
	res, err := s.db.Exec(`UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?`, role, wsID, target)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpError(w, 404, "member not found")
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// handleRemoveMember removes a member from a workspace. A workspace admin may
// remove anyone; a non-admin may remove only themselves (leave). The last admin
// cannot be removed.
func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	target := r.PathValue("userId")
	if !s.tokenReachesWorkspace(r, wsID) {
		httpError(w, 404, "workspace not found")
		return
	}
	me := requestUser(r).ID
	isAdmin := s.isWorkspaceAdmin(me, wsID)
	if !isAdmin && target != me {
		httpError(w, 403, "you can only remove yourself")
		return
	}
	if !s.isMember(target, wsID) {
		httpError(w, 404, "member not found")
		return
	}
	if s.workspaceRole(target, wsID) == "admin" && s.workspaceAdminCount(wsID) <= 1 {
		httpError(w, 400, "cannot remove the last admin")
		return
	}
	s.db.Exec(`DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?`, wsID, target)
	writeJSON(w, map[string]bool{"ok": true})
}

// ---- HTTP: public share links (read-only, no auth) ----

func (s *Server) handleSharePage(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	if !s.canWriteReq(r, pageID) {
		httpError(w, 403, "forbidden")
		return
	}
	// Optional expiry (expiresInDays<=0 = never) and optional password.
	var body struct {
		ExpiresInDays int    `json:"expiresInDays"`
		Password      string `json:"password"`
	}
	decodeJSON(w, r, &body)
	var expiresAt any
	if body.ExpiresInDays > 0 {
		expiresAt = time.Now().UTC().AddDate(0, 0, body.ExpiresInDays).Format(time.RFC3339Nano)
	}
	b := make([]byte, 18)
	rand.Read(b)
	token := hex.EncodeToString(b)
	// Password is stored as sha256(token:password) — salted by the 144-bit
	// random token, verifiable from the URL-supplied token without keeping the
	// raw password. (Casual protection on top of an already-unguessable link,
	// not a substitute for real accounts.)
	var pwHash any
	if body.Password != "" {
		pwHash = tokenHash(token + ":" + body.Password)
	}
	// One live read-share per page: replace any existing read link so a re-share
	// with a new expiry/password doesn't leave the old token valid. Form-shares
	// (mode='form') are independent and left untouched.
	s.db.Exec(`DELETE FROM share_links WHERE page_id = ? AND mode != 'form'`, pageID)
	if _, err := s.db.Exec(`INSERT INTO share_links (token_hash, page_id, created_at, expires_at, password_hash) VALUES (?, ?, ?, ?, ?)`, tokenHash(token), pageID, now(), expiresAt, pwHash); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"token": token, "url": s.publicShareBase(r) + "/public/" + token})
}

func (s *Server) handleUnsharePage(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	if !s.canWriteReq(r, pageID) {
		httpError(w, 403, "forbidden")
		return
	}
	s.db.Exec(`DELETE FROM share_links WHERE page_id = ? AND mode != 'form'`, pageID)
	writeJSON(w, map[string]bool{"ok": true})
}

// handlePublicPage serves a shared page read-only WITHOUT auth. It returns ONLY
// that page (title/icon/content) — never children or linked/related pages — so
// a share cannot leak the rest of the workspace.
// resolveShare validates a share token: existence, expiry (expired links are
// deleted on sight) and password. Returns the page id, whether a password is
// required, and whether the supplied password matches.
func (s *Server) resolveShare(token, password string) (pageID string, needPW, pwOK bool, found bool) {
	var expiresAt, pwHash sql.NullString
	if err := s.db.QueryRow(`SELECT page_id, expires_at, password_hash FROM share_links WHERE token_hash = ? AND mode != 'form'`, tokenHash(token)).Scan(&pageID, &expiresAt, &pwHash); err != nil {
		return "", false, false, false
	}
	if expiresAt.Valid && expiresAt.String != "" {
		if exp, err := time.Parse(time.RFC3339Nano, expiresAt.String); err == nil && time.Now().After(exp) {
			s.db.Exec(`DELETE FROM share_links WHERE token_hash = ?`, tokenHash(token))
			return "", false, false, false
		}
	}
	needPW = pwHash.Valid && pwHash.String != ""
	pwOK = !needPW || (password != "" && tokenHash(token+":"+password) == pwHash.String)
	return pageID, needPW, pwOK, true
}

func (s *Server) handlePublicPage(w http.ResponseWriter, r *http.Request) {
	pageID, needPW, pwOK, found := s.resolveShare(r.PathValue("token"), r.Header.Get("X-Share-Password"))
	if !found {
		httpError(w, 404, "not found")
		return
	}
	if needPW && !pwOK {
		httpError(w, 403, "password required")
		return
	}
	p, err := s.getPage(pageID)
	if err != nil || p.Trashed {
		httpError(w, 404, "not found")
		return
	}
	writeJSON(w, map[string]any{
		"title":   p.Title,
		"icon":    p.Icon,
		"cover":   p.Cover,
		"content": p.Content,
		"type":    p.Type,
	})
}

// handleAccessOverview: fuer die Nutzerverwaltung — welcher Nutzer ist in
// welchem Workspace und mit welcher Rolle.
//
// Der Owner sieht alle Workspaces der Instanz; ein Admin nur die, die er
// selbst verwaltet. Sonst stünden hier die Namen aller privaten Workspaces
// samt Mitgliederlisten — Kenntnisse, mit denen ein Admin ohnehin nichts
// anfangen darf, seit er dort keine Rollen mehr ändern kann.
func (s *Server) handleAccessOverview(w http.ResponseWriter, r *http.Request) {
	me := requestUser(r)
	query := `SELECT id, name FROM workspaces ORDER BY name`
	args := []any{}
	if !s.isOwner(me.ID) {
		query = `SELECT w.id, w.name FROM workspaces w
			JOIN workspace_members m ON m.workspace_id = w.id
			WHERE m.user_id = ? AND m.role = 'admin' ORDER BY w.name`
		args = append(args, me.ID)
	}
	wsRows, err := s.db.Query(query, args...)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	type ws struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	workspaces := []ws{}
	for wsRows.Next() {
		var x ws
		if wsRows.Scan(&x.ID, &x.Name) == nil {
			workspaces = append(workspaces, x)
		}
	}
	wsRows.Close()

	mRows, err := s.db.Query(`SELECT user_id, workspace_id, role FROM workspace_members`)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	type mem struct {
		UserID      string `json:"userId"`
		WorkspaceID string `json:"workspaceId"`
		Role        string `json:"role"`
	}
	// Nur Mitgliedschaften der oben sichtbaren Workspaces — sonst verriete die
	// Liste, wer in den nicht gezeigten Workspaces sitzt.
	shown := map[string]bool{}
	for _, x := range workspaces {
		shown[x.ID] = true
	}
	memberships := []mem{}
	for mRows.Next() {
		var m mem
		if mRows.Scan(&m.UserID, &m.WorkspaceID, &m.Role) == nil && shown[m.WorkspaceID] {
			memberships = append(memberships, m)
		}
	}
	mRows.Close()
	writeJSON(w, map[string]any{"workspaces": workspaces, "memberships": memberships})
}

// handleAdminMembership setzt die Rolle eines Nutzers in EINEM Workspace —
// der Weg der Nutzerverwaltung, im Gegensatz zu den
// /api/workspaces/{id}/members-Endpunkten. role "none" = Mitgliedschaft
// entfernen. Wer hier was darf, steht in den Prüfungen unten: der Owner
// überall, ein Admin nur in den Workspaces, die er selbst verwaltet — und
// niemand für sich selbst.
func (s *Server) handleAdminMembership(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID      string `json:"userId"`
		WorkspaceID string `json:"workspaceId"`
		Role        string `json:"role"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	if s.userByID(body.UserID) == nil {
		httpError(w, 404, "user not found")
		return
	}
	var wsName string
	if s.db.QueryRow(`SELECT name FROM workspaces WHERE id = ?`, body.WorkspaceID).Scan(&wsName) != nil {
		httpError(w, 404, "workspace not found")
		return
	}
	// Wer hier Mitgliedschaften vergibt, verwaltet ANDERE. Zwei Grenzen:
	//
	//  1. Niemand verschafft sich über diesen Weg selbst Zugriff. Sonst wäre
	//     "Admin darf keine fremden Inhalte lesen" mit einem Aufruf ausgehebelt.
	//     Der ehrliche Weg für einen Owner heißt Notfallzugriff — befristet,
	//     begründet, protokolliert, den Verantwortlichen angezeigt.
	//  2. Ein Admin (kein Owner) darf nur dort zuweisen, wo er selbst
	//     Workspace-Admin ist — sonst könnte er einen Strohmann in einen
	//     fremden Workspace setzen.
	me := requestUser(r)
	if body.UserID == me.ID {
		httpError(w, 403, "Du kannst dir hier keinen Zugriff selbst geben — nutze den Notfallzugriff, er wird protokolliert.")
		return
	}
	if !s.isOwner(me.ID) && !s.isWorkspaceAdmin(me.ID, body.WorkspaceID) {
		httpError(w, 403, "Nur der Owner oder ein Admin dieses Workspace kann seine Mitglieder ändern.")
		return
	}
	// Den letzten Admin eines Workspace nie entfernen oder degradieren — sonst
	// steht ein Workspace ohne Verantwortlichen da.
	demoting := body.Role != "admin" && s.workspaceRole(body.UserID, body.WorkspaceID) == "admin"
	if demoting && s.workspaceAdminCount(body.WorkspaceID) <= 1 {
		httpError(w, 400, "cannot remove the last admin of "+wsName)
		return
	}
	if body.Role == "none" {
		s.db.Exec(`DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?`, body.WorkspaceID, body.UserID)
	} else {
		s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)
			ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role`,
			body.WorkspaceID, body.UserID, normalizeRole(body.Role))
	}
	writeJSON(w, map[string]bool{"ok": true})
}
