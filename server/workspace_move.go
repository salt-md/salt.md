package server

import (
	"fmt"
	"strings"
)

// Seiten zwischen Workspaces umziehen.
//
// Das fehlte bisher ÜBERALL — Oberfläche, REST und MCP. `workspaceId` wurde nur
// beim Anlegen ausgewertet; wer eine Seite im falschen Workspace erzeugt hatte,
// konnte sie nie mehr dorthin bringen, wo sie hingehört. Aufgefallen ist es,
// als ein Agent eine Datenbank im Standard-Workspace anlegte und sie danach
// niemand mehr umziehen konnte.
//
// Warum das mehr ist als ein `UPDATE workspace_id`:
//   • Der GANZE Unterbaum muss mit, sonst liegen die Zeilen einer Datenbank in
//     einem anderen Workspace als die Datenbank selbst.
//   • Die Elternverknüpfung muss fallen: der bisherige Elternteil bleibt im
//     alten Workspace zurück, ein Kind dort wäre unerreichbar verwaist.
//   • Rechte auf BEIDEN Seiten: schreiben dürfen auf der Seite, und im
//     Zielworkspace mehr als nur Leser sein.
// Unberührt bleiben Yjs-Dokument, Kommentare, Versionen, Favoriten und
// Freigabelinks — die hängen alle an der Seiten-Id, und die ändert sich nicht.

// moveSubtreeToWorkspace zieht pageID samt Unterbaum in den Zielworkspace.
// tokenOK meldet, ob ein workspace-beschraenktes API-Token den Zielworkspace
// erreichen darf. Der Aufrufer reicht die Pruefung herein, weil hier nur die
// Nutzer-Id ankommt, die Einschraenkung aber am Token haengt.
func (s *Server) moveSubtreeToWorkspace(userID, pageID, targetWS string, tokenOK func(string) bool) (int, error) {
	var curWS string
	var title string
	if err := s.db.QueryRow(`SELECT workspace_id, title FROM pages WHERE id = ? AND trashed_at IS NULL`, pageID).Scan(&curWS, &title); err != nil {
		return 0, fmt.Errorf("page %q not found", pageID)
	}
	if curWS == targetWS {
		return 0, fmt.Errorf("page %q is already in that workspace", title)
	}
	if !s.isMember(userID, targetWS) {
		return 0, fmt.Errorf("workspace %q not found", targetWS)
	}
	if !tokenOK(targetWS) {
		return 0, fmt.Errorf("workspace %q not found", targetWS)
	}
	if role := s.workspaceRole(userID, targetWS); role == "viewer" {
		return 0, fmt.Errorf("you are a viewer in the target workspace and cannot add pages there")
	}

	ids, err := subtreeIDs(s.db, pageID)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		ids = []string{pageID}
	}
	// Nichts umziehen, was der Umziehende nicht sehen darf. Der Unterbaum kann
	// FREMDE private Seiten enthalten; im Zielworkspace ist er womöglich Admin,
	// und Workspace-Admins sehen private Seiten. Der Umzug wäre damit ein Weg,
	// sich fremde Notizen lesbar zu machen. Zurücklassen geht auch nicht — die
	// Seiten hingen dann an einem Elternteil in einem anderen Workspace. Also
	// abbrechen und den Grund nennen.
	for _, id := range ids {
		if !s.canRead(userID, id) {
			return 0, fmt.Errorf("this subtree contains private pages owned by someone else — they cannot be moved along")
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// Die Wurzel verliert ihren Elternteil — der bleibt im alten Workspace.
	// Ohne das hinge der Unterbaum an einem Elternteil, den im Zielworkspace
	// niemand sehen kann, und wäre in der Seitenleiste unauffindbar.
	var pos float64
	tx.QueryRow(`SELECT COALESCE(MAX(position), 0) + 1 FROM pages WHERE parent_id IS NULL AND workspace_id = ?`, targetWS).Scan(&pos)
	if _, err := tx.Exec(`UPDATE pages SET parent_id = NULL, position = ?, updated_at = ? WHERE id = ?`,
		pos, now(), pageID); err != nil {
		return 0, err
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, len(ids)+2)
	args = append(args, targetWS, now())
	for _, id := range ids {
		args = append(args, id)
	}
	if _, err := tx.Exec(`UPDATE pages SET workspace_id = ?, updated_at = ? WHERE id IN (`+ph+`)`, args...); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	for _, id := range ids {
		s.reindexPage(id)
	}
	s.pagesChanged()
	return len(ids), nil
}

// mcpCreateWorkspace legt einen Workspace an; der Aufrufer wird sein Admin.
func (s *Server) mcpCreateWorkspace(userID, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("name is required")
	}
	// Derselbe Gate wie im REST-Handler: ein Agent soll keine Grenze umgehen,
	// die einem Menschen in der Oberflaeche gesetzt ist.
	if u := s.userByID(userID); (u == nil || !u.IsAdmin) && !s.loadSettings().AllowUserWorkspaces {
		return "", fmt.Errorf("creating workspaces is disabled on this instance")
	}
	if len([]rune(name)) > 80 {
		return "", fmt.Errorf("name is too long")
	}
	id := newID()
	if _, err := s.db.Exec(`INSERT INTO workspaces (id, name, created_at, owner_id) VALUES (?, ?, ?, ?)`, id, name, now(), userID); err != nil {
		return "", err
	}
	// Wie der REST-Handler: workspace_members hat kein created_at.
	if _, err := s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')`,
		id, userID); err != nil {
		return "", err
	}
	return fmt.Sprintf("Created workspace %q with id %s — you are its admin. Use move_page with workspace_id to move existing pages into it.", name, id), nil
}

// mcpMoveToWorkspace ist die MCP-Fassade des Umzugs.
func (s *Server) mcpMoveToWorkspace(u *user, pageID, targetWS string) (string, error) {
	userID := u.ID
	n, err := s.moveSubtreeToWorkspace(userID, pageID, targetWS, u.tokenCanReach)
	if err != nil {
		return "", err
	}
	sub := ""
	if n > 1 {
		sub = fmt.Sprintf(" together with %d sub-page(s)", n-1)
	}
	return fmt.Sprintf("Moved page %s%s to workspace %s. It now sits at the top level there — its previous parent stayed behind.", pageID, sub, targetWS), nil
}
