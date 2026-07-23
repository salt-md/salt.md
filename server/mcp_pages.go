package server

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// Agent-Parität, Teil 1: Seiten und Inhalte.
//
// Leitsatz für den ganzen MCP-Ausbau: was ein Mensch in der Oberfläche kann,
// muss ein Agent über MCP auch können. Alles hier spiegelt einen bestehenden
// REST-Endpunkt und benutzt dieselben Prüfungen — der MCP-Zugang ist keine
// Hintertür (siehe die zentrale Rechteprüfung in mcpCall).

// --- Seiten-Metadaten vollständig setzen -----------------------------------

// mcpUpdatePageMeta setzt Titel, Icon, Cover, Beschreibung, Tags und
// Sichtbarkeit — dieselben Felder wie PATCH /api/pages/{id}. Vorher konnte ein
// Agent nur Titel und Icon ändern und war damit von Tags, Cover und
// Sichtbarkeit ausgeschlossen, obwohl die Oberfläche sie anbietet.
func (s *Server) mcpUpdatePageMeta(pageID, title, icon, cover, description, visibility string, tags *[]string) (string, error) {
	sets := []string{"updated_at = ?"}
	sqlArgs := []any{now()}
	changed := []string{}

	add := func(col, val, label string) {
		sets = append(sets, col+" = ?")
		sqlArgs = append(sqlArgs, val)
		changed = append(changed, label)
	}
	if title != "" {
		add("title", title, "title")
	}
	if icon != "" {
		add("icon", icon, "icon")
	}
	if cover != "" {
		add("cover", cover, "cover")
	}
	if description != "" {
		add("description", description, "description")
	}
	if visibility != "" {
		if visibility != "workspace" && visibility != "private" {
			return "", fmt.Errorf("visibility must be %q or %q", "workspace", "private")
		}
		add("visibility", visibility, "visibility")
	}
	if tags != nil {
		// Dieselbe Normalisierung wie die REST-Schicht: '#' weg, Leerzeichen zu
		// '-', Dubletten raus. Sonst entstünden über den Agenten Tag-Varianten,
		// die die Oberfläche nie erzeugen würde.
		sets = append(sets, "tags = ?")
		sqlArgs = append(sqlArgs, string(normalizeTags(*tags)))
		changed = append(changed, "tags")
	}
	if len(changed) == 0 {
		return "", fmt.Errorf("nothing to update: pass at least one of title, icon, cover, description, visibility, tags")
	}

	sqlArgs = append(sqlArgs, pageID)
	res, err := s.db.Exec(`UPDATE pages SET `+strings.Join(sets, ", ")+` WHERE id = ? AND trashed_at IS NULL`, sqlArgs...)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return "", fmt.Errorf("page %q not found", pageID)
	}
	s.reindexPage(pageID)
	s.pagesChanged()
	return fmt.Sprintf("Updated %s on page %s", strings.Join(changed, ", "), pageID), nil
}

// --- Inhalt ersetzen --------------------------------------------------------

// mcpReplaceContent ersetzt den GESAMTEN Seiteninhalt durch das Markdown.
//
// Bisher konnte ein Agent nur anhängen — einen Tippfehler korrigieren oder
// einen Absatz umschreiben war unmöglich. Ehrliche Einschränkung, dieselbe wie
// bei append_markdown: der Schreibweg geht über SQL + Reset des Yjs-Dokuments,
// nicht durch das CRDT. Wer die Seite in genau diesem Moment offen im Editor
// hat, verliert seine ungespeicherten Änderungen. Deshalb steht das auch in der
// Tool-Beschreibung, damit ein Agent es abwägen kann.
func (s *Server) mcpReplaceContent(u *user, pageID, md string) (string, error) {
	content, err := mdToBlocksJSON(md)
	if err != nil {
		return "", err
	}
	// Erst den ALTEN Stand sichern, dann überschreiben. Ohne das wäre eine
	// Agentenänderung unwiederbringlich — und get_page_history bliebe leer,
	// obwohl der Agent gerade die halbe Seite ersetzt hat.
	s.snapshotRevision(pageID, u.ID, u.Name)
	res, err := s.db.Exec(`UPDATE pages SET content = ?, updated_at = ? WHERE id = ? AND trashed_at IS NULL`,
		content, now(), pageID)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return "", fmt.Errorf("page %q not found", pageID)
	}
	s.resetYjsDoc(pageID)
	s.reindexPage(pageID)
	s.pagesChanged()
	return fmt.Sprintf("Replaced content of page %s", pageID), nil
}

// mcpPrependMarkdown stellt Markdown VOR den bestehenden Inhalt. Notion kann
// das ("insert at start"), Salt konnte es bisher nicht.
func (s *Server) mcpPrependMarkdown(u *user, pageID, md string) (string, error) {
	blocks := mdToBlocks(md)
	if len(blocks) == 0 {
		return "", fmt.Errorf("markdown is empty")
	}
	s.snapshotRevision(pageID, u.ID, u.Name) // alten Stand sichern, siehe mcpReplaceContent
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var content string
	if err := tx.QueryRow(`SELECT content FROM pages WHERE id = ? AND trashed_at IS NULL`, pageID).Scan(&content); err != nil {
		return "", fmt.Errorf("page %q not found", pageID)
	}
	var existing []json.RawMessage
	if err := json.Unmarshal([]byte(content), &existing); err != nil {
		existing = []json.RawMessage{}
	}
	head := make([]json.RawMessage, 0, len(blocks)+len(existing))
	for _, b := range blocks {
		raw, err := json.Marshal(b)
		if err != nil {
			return "", err
		}
		head = append(head, raw)
	}
	merged, err := json.Marshal(append(head, existing...))
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(`UPDATE pages SET content = ?, updated_at = ? WHERE id = ?`, string(merged), now(), pageID); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	s.resetYjsDoc(pageID)
	s.reindexPage(pageID)
	s.pagesChanged()
	return fmt.Sprintf("Prepended %d block(s) to page %s", len(blocks), pageID), nil
}

// --- Lesen: Backlinks, Tags, Export ----------------------------------------

// mcpBacklinks: welche Seiten verweisen hierher. Der Zettelkasten-Aspekt, den
// Obsidian-Nutzer erwarten — und den Notions MCP gar nicht hat.
func (s *Server) mcpBacklinks(userID, pageID string) (string, error) {
	rows, err := s.db.Query(`
		SELECT p.id, p.title, p.icon FROM links l
		JOIN pages p ON p.id = l.source_id
		WHERE l.target_id = ? AND p.trashed_at IS NULL
		ORDER BY p.updated_at DESC`, pageID)
	if err != nil {
		return "", err
	}
	type ref struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		Icon  string `json:"icon"`
	}
	var cand []ref
	for rows.Next() {
		var r ref
		if err := rows.Scan(&r.ID, &r.Title, &r.Icon); err != nil {
			rows.Close()
			return "", err
		}
		cand = append(cand, r)
	}
	rows.Close() // erst leeren, dann prüfen — eine einzige DB-Verbindung
	out := []ref{}
	for _, r := range cand {
		if s.canRead(userID, r.ID) { // private Teilbäume bleiben unsichtbar
			out = append(out, r)
		}
	}
	b, err := json.Marshal(map[string]any{"page_id": pageID, "backlinks": out})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mcpListTags liefert alle Tags des Workspace mit Häufigkeit — damit ein Agent
// vorhandene Tags wiederverwendet, statt bei jedem Schreiben neue anzulegen.
func (s *Server) mcpListTags(u *user, wsID string) (string, error) {
	// Standardmäßig ALLE erreichbaren Workspaces, nicht nur der erste. Vorher
	// hing das Tool am Standard-Workspace: sobald Inhalte woanders lagen, war
	// ein Agent blind, obwohl sein Token Zugriff hatte.
	ws, err := s.mcpWorkspaceScope(u, wsID)
	if err != nil {
		return "", err
	}
	wargs := make([]any, len(ws))
	for i, v := range ws {
		wargs[i] = v
	}
	rows, err := s.db.Query(`SELECT id, tags FROM pages WHERE workspace_id IN (`+placeholders(len(ws))+`) AND trashed_at IS NULL AND tags IS NOT NULL AND tags != ''`, wargs...)
	if err != nil {
		return "", err
	}
	type row struct{ id, tags string }
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.tags); err != nil {
			rows.Close()
			return "", err
		}
		all = append(all, r)
	}
	rows.Close()

	counts := map[string]int{}
	for _, r := range all {
		if !s.canRead(u.ID, r.id) {
			continue
		}
		var list []string
		if json.Unmarshal([]byte(r.tags), &list) != nil {
			continue
		}
		for _, t := range list {
			counts[t]++
		}
	}
	type tagCount struct {
		Tag   string `json:"tag"`
		Count int    `json:"count"`
	}
	out := []tagCount{}
	for t, n := range counts {
		out = append(out, tagCount{t, n})
	}
	// Häufigste zuerst; bei Gleichstand alphabetisch, damit die Ausgabe stabil ist.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && (out[j].Count > out[j-1].Count ||
			(out[j].Count == out[j-1].Count && out[j].Tag < out[j-1].Tag)); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	b, err := json.Marshal(map[string]any{"tags": out})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mcpExportMarkdown gibt eine Seite als Markdown zurück, auf Wunsch samt
// Unterbaum. „Salt heißt salt.md — das sollte sich in der API zeigen."
func (s *Server) mcpExportMarkdown(userID, pageID string, recursive bool) (string, error) {
	var out strings.Builder
	var walk func(id string, depth int) error
	walk = func(id string, depth int) error {
		var title, content string
		if err := s.db.QueryRow(`SELECT title, content FROM pages WHERE id = ? AND trashed_at IS NULL`, id).Scan(&title, &content); err != nil {
			return fmt.Errorf("page %q not found", id)
		}
		if depth > 0 {
			out.WriteString("\n\n---\n\n")
		}
		out.WriteString(strings.Repeat("#", min(depth+1, 6)) + " " + title + "\n\n")
		out.WriteString(blocksToMarkdown([]byte(content)))
		if !recursive {
			return nil
		}
		kids, err := s.db.Query(`SELECT id FROM pages WHERE parent_id = ? AND trashed_at IS NULL ORDER BY position`, id)
		if err != nil {
			return err
		}
		var ids []string
		for kids.Next() {
			var k string
			if err := kids.Scan(&k); err != nil {
				kids.Close()
				return err
			}
			ids = append(ids, k)
		}
		kids.Close() // drainen, bevor der rekursive Aufruf die Verbindung braucht
		for _, k := range ids {
			if !s.canRead(userID, k) {
				continue
			}
			if err := walk(k, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(pageID, 0); err != nil {
		return "", err
	}
	return out.String(), nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// --- Papierkorb und Favoriten ----------------------------------------------

// mcpRestorePage holt eine Seite aus dem Papierkorb zurück. Gegenstück zu
// trash_page: ohne dieses Tool konnte ein Agent die Folgen seines Löschens
// nicht einschätzen und nicht rückgängig machen.
func (s *Server) mcpRestorePage(pageID string) (string, error) {
	var trashed sql.NullString
	if err := s.db.QueryRow(`SELECT trashed_at FROM pages WHERE id = ?`, pageID).Scan(&trashed); err != nil {
		return "", fmt.Errorf("page %q not found", pageID)
	}
	if !trashed.Valid {
		return "", fmt.Errorf("page %q is not in the trash", pageID)
	}
	if _, err := s.db.Exec(`UPDATE pages SET trashed_at = NULL, updated_at = ? WHERE id = ?`, now(), pageID); err != nil {
		return "", err
	}
	s.reindexPage(pageID)
	s.pagesChanged()
	return fmt.Sprintf("Restored page %s from the trash", pageID), nil
}

// mcpSetFavorite markiert eine Seite als Favorit (pro Benutzer) oder entfernt
// die Markierung.
func (s *Server) mcpSetFavorite(userID, pageID string, on bool) (string, error) {
	if on {
		// Dieselbe Einfügung wie der REST-Handler: die Tabelle hat position,
		// kein created_at, und der Favorit landet ans Ende der Liste.
		var pos float64
		s.db.QueryRow(`SELECT COALESCE(MAX(position), 0) + 1 FROM favorites WHERE user_id = ?`, userID).Scan(&pos)
		if _, err := s.db.Exec(`INSERT INTO favorites (user_id, page_id, position) VALUES (?, ?, ?)
			ON CONFLICT(user_id, page_id) DO NOTHING`, userID, pageID, pos); err != nil {
			return "", err
		}
		return fmt.Sprintf("Page %s added to favourites", pageID), nil
	}
	if _, err := s.db.Exec(`DELETE FROM favorites WHERE user_id = ? AND page_id = ?`, userID, pageID); err != nil {
		return "", err
	}
	return fmt.Sprintf("Page %s removed from favourites", pageID), nil
}

// mcpEmbedDatabase hängt einen Datenbank-Block an ein Dokument.
//
// Der Anlass: bisher musste ein Agent ein Einleitungsdokument UND eine
// Datenbank getrennt anlegen, weil eine Datenbankseite keinen Textkörper haben
// kann. Mit diesem Block gehört beides in EIN Dokument — genau wie Notions
// „inline database". Gespeichert wird nur die Referenz; die Datenbank bleibt
// ein Objekt an einem Ort und kann in mehreren Dokumenten auftauchen.
func (s *Server) mcpEmbedDatabase(u *user, pageID, databaseID string) (string, error) {
	var typ, title string
	if err := s.db.QueryRow(`SELECT type, title FROM pages WHERE id = ? AND trashed_at IS NULL`, databaseID).Scan(&typ, &title); err != nil {
		return "", fmt.Errorf("database %q not found", databaseID)
	}
	if typ != "collection" {
		return "", fmt.Errorf("page %q is a document, not a database — embed only works with databases", title)
	}
	if !s.canRead(u.ID, databaseID) {
		return "", fmt.Errorf("database %q not found", databaseID)
	}
	block := fmt.Sprintf(`{"id":%q,"type":"database","props":{"collectionId":%q},"content":[],"children":[]}`,
		newID(), databaseID)
	s.snapshotRevision(pageID, u.ID, u.Name)
	if err := s.appendBlockJSON(pageID, block); err != nil {
		return "", err
	}
	s.resetYjsDoc(pageID)
	s.pagesChanged()
	return fmt.Sprintf("Embedded database %q into page %s. The database itself stays where it is — this is a view, not a copy.", title, pageID), nil
}

// mcpWorkspaceScope liefert die Workspaces, über die ein Lesewerkzeug gehen
// soll: entweder den ausdrücklich genannten (wenn erreichbar) oder ALLE, die
// der Token erreicht.
//
// Warum nicht der Standard-Workspace: Werkzeuge, die stillschweigend nur dort
// suchten, machten Multi-Workspace-Aufbauten halb blind — Inhalte in einem
// zweiten Workspace waren für den Agenten unsichtbar, obwohl sein Token sie
// hätte lesen dürfen. Aufgefallen ist das, als eine Datenbank nach „Privat"
// umgezogen war und list_tags danach nichts mehr fand.
func (s *Server) mcpWorkspaceScope(u *user, wsID string) ([]string, error) {
	if wsID != "" {
		if !s.isMember(u.ID, wsID) || !u.tokenCanReach(wsID) {
			return nil, fmt.Errorf("workspace %q not found", wsID)
		}
		return []string{wsID}, nil
	}
	ws := scopeWorkspaces(u, s.visibleWorkspaces(u.ID))
	if len(ws) == 0 {
		return nil, fmt.Errorf("no workspace available")
	}
	return ws, nil
}

// mcpSetTagColor setzt die Farbe eines Tags (pro Workspace). Bisher konnte ein
// Agent Tags vergeben, aber nicht einfärben — die Oberfläche kann das. Palette
// und Normalisierung sind bewusst dieselben wie im REST-Handler (tags.go),
// sonst könnte ein Agent eine Farbe setzen, die niemand darstellen kann.
func (s *Server) mcpSetTagColor(u *user, wsID, tag, color string) (string, error) {
	ws, err := s.mcpCreateWorkspaceTarget(u, wsID)
	if err != nil {
		return "", err
	}
	tag = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(tag), "#")))
	if tag == "" {
		return "", fmt.Errorf("tag is required")
	}
	color = strings.ToLower(strings.TrimSpace(color))
	if color == "" || color == "default" {
		if _, err := s.db.Exec(`DELETE FROM tag_colors WHERE workspace_id = ? AND tag = ?`, ws, tag); err != nil {
			return "", err
		}
		return fmt.Sprintf("Reset colour of tag %q to automatic", tag), nil
	}
	if !tagColorPalette[color] {
		return "", fmt.Errorf("unknown colour %q — use gray, brown, orange, yellow, green, blue, purple, pink, red, or \"default\" to reset", color)
	}
	if _, err := s.db.Exec(`INSERT INTO tag_colors (workspace_id, tag, color) VALUES (?, ?, ?)
		ON CONFLICT(workspace_id, tag) DO UPDATE SET color = excluded.color`, ws, tag, color); err != nil {
		return "", err
	}
	return fmt.Sprintf("Tag %q is now %s in workspace %s", tag, color, ws), nil
}

// mcpCreateWorkspaceTarget bestimmt den Workspace für etwas NEUES ohne
// Elternseite. Anders als mcpWorkspaceScope muss hier genau einer herauskommen,
// und Schreibrecht ist Pflicht — Lesezugriff genügt zum Anlegen nicht.
func (s *Server) mcpCreateWorkspaceTarget(u *user, wsID string) (string, error) {
	if wsID == "" {
		wsID = s.userDefaultWorkspace(u.ID)
		if wsID == "" {
			return "", fmt.Errorf("no workspace available")
		}
		if !u.tokenCanReach(wsID) {
			return "", fmt.Errorf("this token cannot create top-level pages in the default workspace; pass workspace_id (see list_workspaces) or a parent_id inside an allowed workspace")
		}
		return wsID, nil
	}
	if !s.isMember(u.ID, wsID) || !u.tokenCanReach(wsID) {
		return "", fmt.Errorf("workspace %q not found", wsID)
	}
	if s.workspaceRole(u.ID, wsID) == "viewer" {
		return "", fmt.Errorf("you are a viewer in that workspace and cannot create pages there")
	}
	return wsID, nil
}
