package server

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Audit trail + MCP rate limiting + idempotency (audit questions Q14/16/17).

// ---- audit log ----

// audit records a mutation. actorType is "human" or "agent" (MCP).
func (s *Server) audit(actorType, actorID, actorName, action, pageID, workspaceID, detail string) {
	s.db.Exec(`INSERT INTO audit_log (created_at, actor_type, actor_id, actor_name, action, page_id, workspace_id, detail)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		now(), actorType, actorID, actorName, action, nullIfEmpty(pageID), nullIfEmpty(workspaceID), detail)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Server) pageWorkspace(pageID string) string {
	var ws string
	s.db.QueryRow(`SELECT workspace_id FROM pages WHERE id = ?`, pageID).Scan(&ws)
	return ws
}

type auditEntry struct {
	ID        int64  `json:"id"`
	CreatedAt string `json:"createdAt"`
	ActorType string `json:"actorType"`
	ActorName string `json:"actorName"`
	Action    string `json:"action"`
	PageID    string `json:"pageId"`
	Detail    string `json:"detail"`
}

// handleAudit returns recent audit entries for the caller's workspaces.
// Keyset pagination: ?before=<id> returns older entries, ?limit caps the page
// (default 50, max 200) — so the whole history is reachable, not just the tail.
func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	ws := scopeWorkspaces(requestUser(r), s.visibleWorkspaces(requestUser(r).ID))
	if len(ws) == 0 {
		writeJSON(w, []auditEntry{})
		return
	}
	args := make([]any, len(ws))
	for i, v := range ws {
		args[i] = v
	}
	limit := 50
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	cursor := int64(0)
	if v, err := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64); err == nil && v > 0 {
		cursor = v
	}

	// Der Workspace-Filter allein genügt nicht: `detail` enthält Seitentitel
	// (etwa beim Anlegen), und über die Seitenweise ließ sich so die Titelliste
	// ALLER je angelegten Seiten lesen — auch der privaten Teilbäume anderer,
	// die /api/pages und /api/search korrekt verbergen.
	//
	// Gefiltert wird nachträglich, also muss NACHGELADEN werden, bis die Seite
	// voll ist: die Oberfläche erkennt das Ende der Historie daran, dass
	// weniger als `limit` Einträge zurückkommen. Würde einfach gekürzt, wäre
	// nach dem ersten ausgefilterten Eintrag die gesamte ältere Historie
	// unerreichbar.
	uid := requestUser(r).ID
	list := []auditEntry{}
	for round := 0; len(list) < limit && round < 20; round++ {
		qArgs := append([]any{}, args...)
		beforeSQL := ""
		if cursor > 0 {
			beforeSQL = " AND id < ?"
			qArgs = append(qArgs, cursor)
		}
		rows, err := s.db.Query(`SELECT id, created_at, actor_type, actor_name, action, COALESCE(page_id,''), detail
			FROM audit_log WHERE workspace_id IN (`+placeholders(len(ws))+`)`+beforeSQL+`
			ORDER BY id DESC LIMIT `+strconv.Itoa(limit), qArgs...)
		if err != nil {
			httpError(w, 500, err.Error())
			return
		}
		batch := []auditEntry{}
		for rows.Next() {
			var e auditEntry
			if rows.Scan(&e.ID, &e.CreatedAt, &e.ActorType, &e.ActorName, &e.Action, &e.PageID, &e.Detail) == nil {
				batch = append(batch, e)
			}
		}
		rows.Close() // erst leeren, dann per-Zeile prüfen (eine DB-Verbindung)
		if len(batch) == 0 {
			break // Historie erschöpft
		}
		cursor = batch[len(batch)-1].ID
		for _, e := range batch {
			if len(list) == limit {
				break
			}
			// Verweist der Eintrag auf eine Seite, die es NICHT MEHR gibt, bleibt
			// er stehen: sonst verschwänden genau die Vorgänge, für die ein
			// Protokoll da ist — endgültiges Löschen, und mit der automatischen
			// Papierkorb-Räumung nach und nach von selbst.
			if e.PageID != "" && s.pageExists(e.PageID) && !s.canRead(uid, e.PageID) {
				continue
			}
			list = append(list, e)
		}
		if len(batch) < limit {
			break // letzte Seite der Historie
		}
	}
	writeJSON(w, list)
}

// ---- MCP rate limiting (token bucket per token) ----

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   float64
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(perMinute float64, burst float64) *rateLimiter {
	return &rateLimiter{buckets: map[string]*bucket{}, rate: perMinute / 60.0, burst: burst}
}

// allow reports whether a request for key may proceed, consuming one token.
func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	b := rl.buckets[key]
	nowT := time.Now()
	if b == nil {
		b = &bucket{tokens: rl.burst, last: nowT}
		rl.buckets[key] = b
	}
	b.tokens += nowT.Sub(b.last).Seconds() * rl.rate
	if b.tokens > rl.burst {
		b.tokens = rl.burst
	}
	b.last = nowT
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// ---- idempotency ----

// idempotentResult returns a cached result for key if present.
func (s *Server) idempotentResult(key string) (string, bool) {
	if key == "" {
		return "", false
	}
	var res string
	if s.db.QueryRow(`SELECT result FROM idempotency WHERE key = ?`, key).Scan(&res) == nil {
		return res, true
	}
	return "", false
}

func (s *Server) storeIdempotent(key, result string) {
	if key == "" {
		return
	}
	s.db.Exec(`INSERT INTO idempotency (key, result, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`, key, result, now())
}
