package server

import (
	"encoding/json"
	"fmt"
)

// Agent parity, part 3: history, comments, graph.
//
// This is the part Notion structurally cannot offer: Salt keeps revisions and
// an audit trail that tells human and agent apart. An agent that can follow
// and undo its own changes is a different colleague from one that writes
// blind.

// mcpPageHistory lists the revisions of a page. On top of author and time, the
// audit trail says whether a HUMAN or an AGENT caused the change — exactly the
// distinction you need in order to trust automated edits.
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
	rows.Close() // drain first — a single DB connection

	for _, it := range list {
		r := it.r
		// The audit trail knows whether the write came in through MCP. Mind the
		// order in time: a revision saves the state BEFORE the change and carries
		// that change's timestamp; the audit entry follows shortly after. So we look
		// for the NEXT entry by the same author, not the previous one — otherwise
		// everything would stay "unknown".
		var actorType string
		err := s.db.QueryRow(`SELECT actor_type FROM audit_log
			WHERE page_id = ? AND actor_id = ? AND created_at >= ?
			ORDER BY created_at ASC LIMIT 1`, pageID, it.authorID, r.CreatedAt).Scan(&actorType)
		if err != nil || actorType == "" {
			r.By = "unknown" // from before the audit trail, or not attributable
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

// mcpGetRevision returns an older state as Markdown — "read yesterday's
// version, compare the changes" — without altering anything.
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

// mcpRestoreRevision puts a page back to an older state. The CURRENT state is
// saved as a new revision first, so that the restore itself stays reversible
// too.
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

// mcpResolveComment ticks a comment off. An agent could already read and
// write them, but not resolve one — so it could never finish a comment
// thread.
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

// mcpDeleteComment removes a comment for good.
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

// commentPage works out which page a comment belongs to, so the permission
// check can bite — otherwise an agent could write into somebody else's
// workspace through a comment id.
func (s *Server) commentPage(commentID string) (string, bool) {
	var pageID string
	if err := s.db.QueryRow(`SELECT page_id FROM comments WHERE id = ?`, commentID).Scan(&pageID); err != nil {
		return "", false
	}
	return pageID, true
}

// --- Graph -----------------------------------------------------------------

// mcpGraph returns every link between the pages of a workspace. With it an
// agent can see connections, find orphaned pages or spot clusters of a topic —
// the view the index gives a human.
func (s *Server) mcpGraph(u *user, wsID string) (string, error) {
	// Like list_tags: by default ALL reachable workspaces (see mcpWorkspaceScope)
	// — otherwise the graph ends at the workspace boundary.
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
		// Both ends have to be visible — otherwise the edge would give away the
		// existence of a private page.
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
