package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// Agent-Parität, Teil 4: Selbstauskunft, Workspaces, Freigabe.
//
// Sicherheitsgrenze — bewusst NICHT über MCP erreichbar, auch wenn ein Mensch
// es in der Oberfläche kann:
//   • Zwei-Faktor-Einrichtung und -Abschaltung
//   • API-Tokens anlegen oder löschen (ein Agent könnte sich sonst selbst
//     dauerhafte Zugänge mit weiteren Rechten ausstellen)
//   • Benutzerkonten anlegen/löschen, Passwörter setzen
//   • Backup, Restore, Tunnel, SMTP, Instanzeinstellungen
// Das sind Rechte über die Instanz, nicht über Inhalte. Ein kompromittierter
// oder fehlgeleiteter Agent soll Inhalte anfassen können — nicht die Zugänge.

// mcpWhoami: „Ein Agent muss wissen, wer er ist und was er darf."
// Ohne diese Auskunft rät ein Agent, ob ein Fehlschlag an fehlenden Rechten
// oder an einer falschen Id lag.
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
		// Was diesem Zugang bewusst verwehrt ist — damit ein Agent es gar nicht
		// erst versucht und den Fehlschlag richtig deutet.
		// Was dieser Zugang NICHT kann. Hier stand frueher "user accounts",
		// obwohl list_users existiert — und "backup/restore", obwohl dasselbe
		// Token die Sicherung ueber die REST-Schnittstelle erreichte. Beides
		// stimmt jetzt: Verwaltung verlangt eine Anmeldung im Browser.
		"not_available_via_mcp": []string{
			"two-factor settings", "API tokens", "creating or deleting accounts",
			"backup/restore", "tunnel and instance settings",
			"workspace membership and roles",
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

// mcpListWorkspaces: welche Workspaces sieht dieses Token, und mit welcher
// Rolle. Bisher hing der Workspace implizit am Token und war unsichtbar.
func (s *Server) mcpListWorkspaces(u *user) (string, error) {
	rows, err := s.db.Query(`SELECT w.id, w.name, m.role FROM workspaces w
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
	}
	out := []ws{}
	for rows.Next() {
		var w ws
		if err := rows.Scan(&w.ID, &w.Name, &w.Role); err != nil {
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

// mcpGetWorkspace liefert Kontext und Mitglieder — nötig, um Person-Felder zu
// füllen oder Arbeit zuzuordnen.
func (s *Server) mcpGetWorkspace(u *user, wsID string) (string, error) {
	if wsID == "" {
		wsID = s.userDefaultWorkspace(u.ID)
	}
	if wsID == "" || !s.isMember(u.ID, wsID) || !u.tokenCanReach(wsID) {
		return "", fmt.Errorf("workspace %q not found", wsID)
	}
	var name string
	if err := s.db.QueryRow(`SELECT name FROM workspaces WHERE id = ?`, wsID).Scan(&name); err != nil {
		return "", fmt.Errorf("workspace %q not found", wsID)
	}
	rows, err := s.db.Query(`SELECT u.id, u.name, u.email, m.role FROM workspace_members m
		JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name`, wsID)
	if err != nil {
		return "", err
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
			return "", err
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
	})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mcpGetPermissions beantwortet vorab, was auf einer Seite erlaubt ist —
// „vorher prüfen statt blind zu schreiben und zu scheitern".
func (s *Server) mcpGetPermissions(u *user, pageID string) (string, error) {
	var ws string
	var trashed any
	if err := s.db.QueryRow(`SELECT workspace_id, trashed_at FROM pages WHERE id = ?`, pageID).Scan(&ws, &trashed); err != nil {
		return "", fmt.Errorf("page %q not found", pageID)
	}
	canRead := s.canRead(u.ID, pageID) && u.tokenCanReach(ws)
	if !canRead {
		// Nicht verraten, dass es die Seite gibt.
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

// --- Öffentliche Freigabe ---------------------------------------------------

// mcpSharePage erzeugt einen öffentlichen Lese-Link. Bewusst identisch zur
// Oberfläche: eine lebende Freigabe pro Seite, ein erneutes Teilen ersetzt den
// alten Token (sonst bliebe ein vermeintlich widerrufener Link gültig).
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

// mcpUnsharePage widerruft den öffentlichen Link.
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

// requestBase trägt die öffentliche Basis-URL in die MCP-Schicht. Der Link muss
// dieselbe Domain nennen, die auch die Oberfläche ausgibt (eingerichtete
// Domain, Cloudflare-Tunnel oder Anfrage-Host) — sonst bekäme ein Agent einen
// Link, der von außen nicht erreichbar ist.
type requestBase struct{ base string }
