package server

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Workspace-Transfer: ein Workspace als natives ZIP — 1:1 wieder importierbar.
//
// Der Markdown-Export ist zum Mitnehmen der Inhalte gedacht; beim Wiederimport
// gehen Datenbanken (Schema, Views, Zeilen-Properties), Hierarchie-Metadaten
// und Datei-Anhänge verloren. Dieses Format überträgt einen Workspace
// verlustarm zwischen Instanzen: Seitenbaum, Datenbanken, Tags samt Farben,
// Cover/Icons/Beschreibungen und alle referenzierten Uploads.
//
// Bewusst NICHT enthalten: Nutzer/Rollen (instanzspezifisch), Kommentare und
// Versionshistorie (hängen an Nutzer-IDs), Freigabe-Links (Secrets), Yjs-Live-
// State (der materialisierte Seiteninhalt ist die Quelle; beim ersten Öffnen
// wird das CRDT daraus neu geseedet — derselbe Weg wie bei neuen Seiten).
//
// ZIP-Layout:
//   salt-workspace.json   Manifest (Formatversion, Workspace-Meta, Zähler)
//   pages.json            alle Seiten inkl. Collection-Schema/-Views
//   tags.json             Tag → Farbe
//   files/<name>          referenzierte Uploads

const transferFormat = 1

type transferManifest struct {
	Format      int    `json:"format"`
	SaltVersion string `json:"saltVersion"`
	ExportedAt  string `json:"exportedAt"`
	Workspace   struct {
		Name  string `json:"name"`
		Icon  string `json:"icon"`
		Image string `json:"image"`
	} `json:"workspace"`
	Pages int `json:"pages"`
	Files int `json:"files"`
}

type transferPage struct {
	ID          string          `json:"id"`
	ParentID    *string         `json:"parentId"`
	Type        string          `json:"type"`
	Title       string          `json:"title"`
	Icon        string          `json:"icon"`
	Cover       string          `json:"cover"`
	Description string          `json:"description"`
	Tags        json.RawMessage `json:"tags"`
	Props       json.RawMessage `json:"props"`
	Content     json.RawMessage `json:"content"`
	Position    float64         `json:"position"`
	Visibility  string          `json:"visibility"`
	IsTemplate  bool            `json:"isTemplate"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
	// Nur für type == "collection":
	Schema json.RawMessage `json:"schema,omitempty"`
	Views  json.RawMessage `json:"views,omitempty"`
}

// fileRefPattern findet Upload-Referenzen in Inhalt, Props und Covern.
// Upload-Namen sind newID()+Endung (siehe handleUpload) — keine Leerzeichen.
var fileRefPattern = regexp.MustCompile(`/files/([A-Za-z0-9._%-]+)`)

func (s *Server) handleExportWorkspace(w http.ResponseWriter, r *http.Request) {
	u := requestUser(r)
	wsID := r.PathValue("id")
	// Mitgliedschaft (oder ein laufender, protokollierter Notfallzugriff) ist
	// Pflicht. Früher genügte hier das Instanz-Admin-Flag — damit konnte ein
	// Admin JEDEN fremden Workspace komplett herunterladen, ohne Spur.
	if !s.isMember(u.ID, wsID) && !s.hasBreakGlass(u.ID, wsID) {
		httpError(w, 404, "workspace not found")
		return
	}
	var wsName, wsIcon, wsImage string
	if err := s.db.QueryRow(`SELECT name, icon, image FROM workspaces WHERE id = ?`, wsID).
		Scan(&wsName, &wsIcon, &wsImage); err != nil {
		httpError(w, 404, "workspace not found")
		return
	}

	rows, err := s.db.Query(`
		SELECT p.id, p.parent_id, p.type, p.title, p.icon, p.cover, p.description,
		       p.tags, p.props, p.content, p.position, p.visibility, p.is_template,
		       p.created_at, p.updated_at, c.schema, c.views
		FROM pages p LEFT JOIN collections c ON c.page_id = p.id
		WHERE p.workspace_id = ? AND p.trashed_at IS NULL
		ORDER BY p.position, p.created_at`, wsID)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	var scanned []transferPage
	for rows.Next() {
		var p transferPage
		var tags, props, content []byte
		var schema, views sql.Null[[]byte]
		var isTemplate int
		if err := rows.Scan(&p.ID, &p.ParentID, &p.Type, &p.Title, &p.Icon, &p.Cover,
			&p.Description, &tags, &props, &content, &p.Position, &p.Visibility,
			&isTemplate, &p.CreatedAt, &p.UpdatedAt, &schema, &views); err != nil {
			rows.Close()
			httpError(w, 500, err.Error())
			return
		}
		p.Tags, p.Props, p.Content = tags, props, content
		p.IsTemplate = isTemplate != 0
		if schema.Valid {
			p.Schema = schema.V
		}
		if views.Valid {
			p.Views = views.V
		}
		scanned = append(scanned, p)
	}
	rows.Close() // erst leeren, dann per-Row-Rechte prüfen (eine DB-Verbindung)

	// Private Seiten anderer bleiben draußen — der Export enthält exakt das,
	// was der Exportierende auch in der App sieht.
	var pages []transferPage
	for _, p := range scanned {
		if s.canRead(u.ID, p.ID) {
			pages = append(pages, p)
		}
	}

	// Referenzierte Uploads einsammeln (Inhalt, Props, Cover, Workspace-Bild).
	fileSet := map[string]bool{}
	collect := func(b []byte) {
		for _, m := range fileRefPattern.FindAllSubmatch(b, -1) {
			fileSet[string(m[1])] = true
		}
	}
	for _, p := range pages {
		collect(p.Content)
		collect(p.Props)
		collect([]byte(p.Cover))
	}
	collect([]byte(wsImage))

	tagColors := map[string]string{}
	if tr, err := s.db.Query(`SELECT tag, color FROM tag_colors WHERE workspace_id = ?`, wsID); err == nil {
		for tr.Next() {
			var tag, color string
			if tr.Scan(&tag, &color) == nil {
				tagColors[tag] = color
			}
		}
		tr.Close()
	}

	manifest := transferManifest{Format: transferFormat, SaltVersion: Version, ExportedAt: now()}
	manifest.Workspace.Name = wsName
	manifest.Workspace.Icon = wsIcon
	manifest.Workspace.Image = wsImage
	manifest.Pages = len(pages)
	manifest.Files = len(fileSet)

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition",
		mime.FormatMediaType("attachment", map[string]string{"filename": safeFilename(wsName) + ".salt.zip"}))
	zw := zip.NewWriter(w)
	defer zw.Close()

	writeJSONEntry := func(name string, v any) bool {
		f, err := zw.Create(name)
		if err != nil {
			return false
		}
		enc := json.NewEncoder(f)
		enc.SetEscapeHTML(false)
		return enc.Encode(v) == nil
	}
	if !writeJSONEntry("salt-workspace.json", manifest) ||
		!writeJSONEntry("pages.json", pages) ||
		!writeJSONEntry("tags.json", tagColors) {
		return
	}
	for name := range fileSet {
		// name kommt aus einem Regex ohne Pfadtrenner — kein Traversal möglich.
		src, err := os.Open(filepath.Join(s.dataDir, "files", name))
		if err != nil {
			continue // Referenz auf gelöschte Datei: Seite bleibt nutzbar, Datei fehlt halt
		}
		if f, err := zw.Create("files/" + name); err == nil {
			io.Copy(f, src)
		}
		src.Close()
	}

	s.audit("human", u.ID, u.Name, "export_workspace", "", wsID, wsName)
}

func (s *Server) handleImportWorkspace(w http.ResponseWriter, r *http.Request) {
	u := requestUser(r)
	// Dieselbe Regel wie beim Anlegen eines Workspace.
	if !u.IsAdmin && !s.loadSettings().AllowUserWorkspaces {
		httpError(w, 403, "creating workspaces is disabled on this instance — ask an admin")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImportZip)
	if err := r.ParseMultipartForm(maxImportZip); err != nil {
		httpError(w, 400, "upload too large or invalid")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		httpError(w, 400, "file field is required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		httpError(w, 400, err.Error())
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		httpError(w, 400, "not a valid zip archive")
		return
	}

	readEntry := func(name string) []byte {
		for _, f := range zr.File {
			if f.Name == name {
				rc, err := f.Open()
				if err != nil {
					return nil
				}
				b, _ := io.ReadAll(rc)
				rc.Close()
				return b
			}
		}
		return nil
	}

	var manifest transferManifest
	if b := readEntry("salt-workspace.json"); b == nil || json.Unmarshal(b, &manifest) != nil {
		httpError(w, 400, "not a Salt.md workspace archive (salt-workspace.json missing)")
		return
	}
	if manifest.Format > transferFormat {
		httpError(w, 400, fmt.Sprintf("archive format %d is newer than this instance supports (%d) — update Salt.md", manifest.Format, transferFormat))
		return
	}
	var pages []transferPage
	if b := readEntry("pages.json"); b == nil || json.Unmarshal(b, &pages) != nil {
		httpError(w, 400, "pages.json missing or invalid")
		return
	}
	tagColors := map[string]string{}
	if b := readEntry("tags.json"); b != nil {
		json.Unmarshal(b, &tagColors)
	}

	// Dateien zuerst: alte → neue Namen, damit die ID-Ersetzung in den Inhalten
	// beides in einem Durchgang erledigen kann.
	fileMap := map[string]string{}
	filesWritten := 0
	for _, f := range zr.File {
		name, ok := strings.CutPrefix(f.Name, "files/")
		if !ok || name == "" || strings.Contains(name, "/") {
			continue
		}
		ext := ""
		if i := strings.IndexByte(name, '.'); i >= 0 {
			ext = name[i:]
		}
		newName := newID() + ext
		rc, err := f.Open()
		if err != nil {
			continue
		}
		dst, err := os.Create(filepath.Join(s.dataDir, "files", newName))
		if err != nil {
			rc.Close()
			continue
		}
		if _, err := io.Copy(dst, rc); err == nil {
			fileMap[name] = newName
			filesWritten++
		}
		dst.Close()
		rc.Close()
	}

	// Seiten-IDs neu vergeben. Die Ersetzung läuft als Text über die JSON-Rohfelder:
	// IDs sind 32 Hex-Zeichen aus newID() — als Substring praktisch kollisionsfrei,
	// und genau so referenzieren Mentions/Relationen Seiten im Inhalt.
	idMap := map[string]string{}
	for _, p := range pages {
		idMap[p.ID] = newID()
	}
	replacer := make([]string, 0, (len(idMap)+len(fileMap))*2)
	for old, nw := range idMap {
		replacer = append(replacer, old, nw)
	}
	for old, nw := range fileMap {
		replacer = append(replacer, "/files/"+old, "/files/"+nw)
	}
	remap := strings.NewReplacer(replacer...)

	wsName := strings.TrimSpace(manifest.Workspace.Name)
	if wsName == "" {
		wsName = "Importierter Workspace"
	}
	var exists int
	s.db.QueryRow(`SELECT COUNT(*) FROM workspaces WHERE name = ?`, wsName).Scan(&exists)
	if exists > 0 {
		wsName += " (Import)"
	}

	wsID := newID()
	tx, err := s.db.Begin()
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO workspaces (id, name, created_at, icon, image, owner_id) VALUES (?, ?, ?, ?, ?, ?)`,
		wsID, wsName, now(), manifest.Workspace.Icon, remap.Replace(manifest.Workspace.Image), u.ID); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	if _, err := tx.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')`, wsID, u.ID); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	for tag, color := range tagColors {
		// Tag-Farben sind Palettennamen (siehe handleSetTagColor), keine Hex-Werte.
		if tagColorPalette[strings.ToLower(color)] {
			tx.Exec(`INSERT OR REPLACE INTO tag_colors (workspace_id, tag, color) VALUES (?, ?, ?)`, wsID, tag, strings.ToLower(color))
		}
	}

	// Eltern vor Kindern einfügen (FK auf parent_id): Wurzeln zuerst, dann
	// ebenenweise. Seiten mit unbekanntem Parent (z. B. beim Export gefilterte
	// private Teilbäume) landen auf oberster Ebene statt zu verschwinden.
	inserted := map[string]bool{}
	remaining := append([]transferPage(nil), pages...)
	defaultJSON := func(raw json.RawMessage, def string) string {
		if len(raw) == 0 {
			return def
		}
		return remap.Replace(string(raw))
	}
	for len(remaining) > 0 {
		progressed := false
		var next []transferPage
		for _, p := range remaining {
			parentKnown := p.ParentID == nil || inserted[*p.ParentID] || idMap[*p.ParentID] == ""
			if !parentKnown {
				next = append(next, p)
				continue
			}
			var parent any
			if p.ParentID != nil && idMap[*p.ParentID] != "" {
				parent = idMap[*p.ParentID]
			}
			typ := p.Type
			if typ == "" {
				typ = "doc"
			}
			vis := p.Visibility
			if vis != "private" {
				vis = "workspace"
			}
			created := p.CreatedAt
			if created == "" {
				created = now()
			}
			updated := p.UpdatedAt
			if updated == "" {
				updated = created
			}
			if _, err := tx.Exec(`
				INSERT INTO pages (id, parent_id, title, icon, content, position, created_at, updated_at,
				                   type, props, cover, workspace_id, owner_id, visibility, is_template, tags, description)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				idMap[p.ID], parent, p.Title, p.Icon, defaultJSON(p.Content, "[]"), p.Position,
				created, updated, typ, defaultJSON(p.Props, "{}"), remap.Replace(p.Cover),
				wsID, u.ID, vis, boolToInt(p.IsTemplate), defaultJSON(p.Tags, "[]"), p.Description); err != nil {
				httpError(w, 500, err.Error())
				return
			}
			if typ == "collection" {
				if _, err := tx.Exec(`INSERT INTO collections (page_id, schema, views) VALUES (?, ?, ?)`,
					idMap[p.ID], defaultJSON(p.Schema, "[]"), defaultJSON(p.Views, "[]")); err != nil {
					httpError(w, 500, err.Error())
					return
				}
			}
			inserted[p.ID] = true
			progressed = true
		}
		if !progressed {
			// Zyklus in parent_id — kann nur aus einem manipulierten Archiv
			// kommen; Rest oben einhängen statt endlos zu kreisen.
			for i := range next {
				next[i].ParentID = nil
			}
		}
		remaining = next
	}
	if err := tx.Commit(); err != nil {
		httpError(w, 500, err.Error())
		return
	}

	// Suchindex + Backlink-Graph für die neuen Seiten aufbauen.
	for _, p := range pages {
		id := idMap[p.ID]
		s.reindexPage(id)
		s.updateLinks(id, remap.Replace(string(p.Content)), false)
	}

	s.audit("human", u.ID, u.Name, "import_workspace", "", wsID,
		fmt.Sprintf("%s (%d Seiten, %d Dateien)", wsName, len(pages), filesWritten))
	writeJSON(w, map[string]any{"workspaceId": wsID, "name": wsName, "pages": len(pages), "files": filesWritten})
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
