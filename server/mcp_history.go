package server

import (
	"encoding/json"
	"fmt"
)

// Agent-Parität, Teil 3: Historie, Kommentare, Graph.
//
// Das ist der Teil, den Notion strukturell nicht bieten kann: Salt führt
// Versionsstände und einen Prüfpfad, der Mensch und Agent unterscheidet. Ein
// Agent, der seine eigenen Änderungen nachvollziehen und zurücknehmen kann,
// ist ein anderer Mitarbeiter als einer, der blind schreibt.

// mcpPageHistory listet die Versionsstände einer Seite. Zusätzlich zu Autor und
// Zeitpunkt wird aus dem Prüfpfad ermittelt, ob ein MENSCH oder ein AGENT die
// Änderung ausgelöst hat — genau die Unterscheidung, die man für Vertrauen in
// automatisierte Änderungen braucht.
func (s *Server) mcpPageHistory(pageID string, limit int) (string, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.db.Query(`SELECT id, created_at, author_id, author_name, title, LENGTH(content)
		FROM page_revisions WHERE page_id = ? ORDER BY created_at DESC LIMIT ?`, pageID, limit)
	if err != nil {
		return "", err
	}
	type rev struct {
		ID        string `json:"id"`
		CreatedAt string `json:"created_at"`
		Author    string `json:"author"`
		Title     string `json:"title"`
		Size      int    `json:"content_bytes"`
		By        string `json:"by"` // "human" | "agent" | "unknown"
	}
	var out []rev
	type raw struct {
		r        rev
		authorID string
	}
	var list []raw
	for rows.Next() {
		var r rev
		var authorID string
		if err := rows.Scan(&r.ID, &r.CreatedAt, &authorID, &r.Author, &r.Title, &r.Size); err != nil {
			rows.Close()
			return "", err
		}
		list = append(list, raw{r, authorID})
	}
	rows.Close() // erst leeren — eine einzige DB-Verbindung

	for _, it := range list {
		r := it.r
		// Der Prüfpfad weiß, ob der Schreibvorgang über MCP kam.
		// Zeitliche Reihenfolge beachten: eine Version sichert den Stand VOR der
		// Änderung und trägt deren Zeitstempel; der Prüfpfad-Eintrag folgt kurz
		// danach. Gesucht wird deshalb der NÄCHSTFOLGENDE Eintrag desselben
		// Autors, nicht der vorherige — sonst bliebe alles "unknown".
		var actorType string
		err := s.db.QueryRow(`SELECT actor_type FROM audit_log
			WHERE page_id = ? AND actor_id = ? AND created_at >= ?
			ORDER BY created_at ASC LIMIT 1`, pageID, it.authorID, r.CreatedAt).Scan(&actorType)
		if err != nil || actorType == "" {
			r.By = "unknown" // vor Einführung des Prüfpfads oder nicht zuzuordnen
		} else {
			r.By = actorType
		}
		out = append(out, r)
	}
	if out == nil {
		out = []rev{}
	}
	b, err := json.Marshal(map[string]any{"page_id": pageID, "revisions": out})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mcpGetRevision liefert einen alten Stand als Markdown — „Stand von gestern
// lesen, Änderungen vergleichen", ohne etwas zu verändern.
func (s *Server) mcpGetRevision(pageID, revID string) (string, error) {
	var title, content, createdAt, author string
	err := s.db.QueryRow(`SELECT title, content, created_at, author_name FROM page_revisions
		WHERE id = ? AND page_id = ?`, revID, pageID).Scan(&title, &content, &createdAt, &author)
	if err != nil {
		return "", fmt.Errorf("revision %q not found on page %s", revID, pageID)
	}
	md := "# " + title + "\n\n" + blocksToMarkdown([]byte(content))
	b, err := json.Marshal(map[string]any{
		"page_id": pageID, "revision_id": revID, "created_at": createdAt,
		"author": author, "title": title, "markdown": md,
	})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mcpRestoreRevision setzt eine Seite auf einen alten Stand zurück. Vorher wird
// der AKTUELLE Stand als neue Version gesichert, damit auch das Zurücksetzen
// selbst umkehrbar bleibt.
func (s *Server) mcpRestoreRevision(u *user, pageID, revID string) (string, error) {
	var title, content string
	if err := s.db.QueryRow(`SELECT title, content FROM page_revisions WHERE id = ? AND page_id = ?`,
		revID, pageID).Scan(&title, &content); err != nil {
		return "", fmt.Errorf("revision %q not found on page %s", revID, pageID)
	}
	var curTitle, curContent string
	if err := s.db.QueryRow(`SELECT title, content FROM pages WHERE id = ?`, pageID).Scan(&curTitle, &curContent); err != nil {
		return "", fmt.Errorf("page %q not found", pageID)
	}
	if _, err := s.db.Exec(`INSERT INTO page_revisions (id, page_id, created_at, author_id, author_name, title, content)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, newID(), pageID, now(), u.ID, u.Name, curTitle, curContent); err != nil {
		return "", err
	}
	if _, err := s.db.Exec(`UPDATE pages SET title = ?, content = ?, updated_at = ? WHERE id = ?`,
		title, content, now(), pageID); err != nil {
		return "", err
	}
	s.resetYjsDoc(pageID)
	s.reindexPage(pageID)
	s.pagesChanged()
	return fmt.Sprintf("Restored page %s to revision %s (the previous state was saved as a new revision first, so this is reversible)", pageID, revID), nil
}

// --- Kommentare ------------------------------------------------------------

// mcpResolveComment hakt einen Kommentar ab. Lesen und Schreiben konnte ein
// Agent schon, abschließen nicht — er konnte einen Kommentarfaden also nie
// beenden.
func (s *Server) mcpResolveComment(commentID string, resolved bool) (string, error) {
	var val any
	verb := "Resolved"
	if resolved {
		val = now()
	} else {
		val = nil
		verb = "Reopened"
	}
	res, err := s.db.Exec(`UPDATE comments SET resolved_at = ? WHERE id = ?`, val, commentID)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return "", fmt.Errorf("comment %q not found", commentID)
	}
	return fmt.Sprintf("%s comment %s", verb, commentID), nil
}

// mcpDeleteComment entfernt einen Kommentar endgültig.
func (s *Server) mcpDeleteComment(commentID string) (string, error) {
	res, err := s.db.Exec(`DELETE FROM comments WHERE id = ?`, commentID)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return "", fmt.Errorf("comment %q not found", commentID)
	}
	return fmt.Sprintf("Deleted comment %s", commentID), nil
}

// commentPage ermittelt die Seite eines Kommentars, damit die Rechteprüfung
// greifen kann — sonst könnte ein Agent über eine Kommentar-Id in einen
// fremden Workspace hineinschreiben.
func (s *Server) commentPage(commentID string) (string, bool) {
	var pageID string
	if err := s.db.QueryRow(`SELECT page_id FROM comments WHERE id = ?`, commentID).Scan(&pageID); err != nil {
		return "", false
	}
	return pageID, true
}

// --- Graph -----------------------------------------------------------------

// mcpGraph liefert alle Verlinkungen zwischen Seiten des Workspace. Damit kann
// ein Agent Zusammenhänge sehen, verwaiste Seiten finden oder Themencluster
// erkennen — die Sicht, die die Index-Ansicht dem Menschen bietet.
func (s *Server) mcpGraph(u *user, wsID string) (string, error) {
	// Wie list_tags: standardmäßig ALLE erreichbaren Workspaces (siehe
	// mcpWorkspaceScope) — sonst endet der Graph an der Workspace-Grenze.
	ws, err := s.mcpWorkspaceScope(u, wsID)
	if err != nil {
		return "", err
	}
	wargs := make([]any, len(ws))
	for i, v := range ws {
		wargs[i] = v
	}
	rows, err := s.db.Query(`
		SELECT l.source_id, l.target_id, s.title, t.title
		FROM links l
		JOIN pages s ON s.id = l.source_id
		JOIN pages t ON t.id = l.target_id
		WHERE s.workspace_id IN (`+placeholders(len(ws))+`) AND s.trashed_at IS NULL AND t.trashed_at IS NULL`, wargs...)
	if err != nil {
		return "", err
	}
	type edge struct {
		From      string `json:"from"`
		To        string `json:"to"`
		FromTitle string `json:"from_title"`
		ToTitle   string `json:"to_title"`
	}
	var cand []edge
	for rows.Next() {
		var e edge
		if err := rows.Scan(&e.From, &e.To, &e.FromTitle, &e.ToTitle); err != nil {
			rows.Close()
			return "", err
		}
		cand = append(cand, e)
	}
	rows.Close()
	out := []edge{}
	for _, e := range cand {
		// Beide Enden müssen sichtbar sein — sonst verriete die Kante die
		// Existenz einer privaten Seite.
		if s.canRead(u.ID, e.From) && s.canRead(u.ID, e.To) {
			out = append(out, e)
		}
	}
	b, err := json.Marshal(map[string]any{"edges": out, "count": len(out)})
	if err != nil {
		return "", err
	}
	return string(b), nil
}
