package server

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// Agent-Parität, Teil 2: Datenbanken.
//
// Bisher konnte ein Agent eine Datenbank ANLEGEN, danach war ihre Struktur für
// ihn eingefroren: keine Spalte ergänzen, keine Select-Option hinzufügen, keine
// Ansicht erstellen. Ein Mensch kann das alles in der Oberfläche.
//
// Bewusste Entwurfsentscheidung: das Schema wird MISCHEND geändert, nicht als
// Ganzes ersetzt (anders als PUT /api/collections/{id}). Ein Agent, der nur
// eine Spalte ergänzen will, soll nicht versehentlich alle anderen löschen,
// weil er sie nicht mitgeschickt hat.

// Schema und Ansichten werden als generische Maps behandelt, NICHT durch einen
// Go-Typ geschleust. Grund: der vorhandene propDef in derived.go kennt kein
// `options`-Feld — ein Hin- und Rückwandeln würde beim Speichern sämtliche
// Select-Optionen löschen. Mit Maps überlebt jedes Feld, auch solche, die
// später dazukommen.

// Die Typen, die die Oberfläche anbietet. Ein Agent, der einen erfindet, würde
// sonst eine Spalte anlegen, die niemand rendern kann.
var validPropTypes = map[string]bool{
	"text": true, "number": true, "select": true, "multiselect": true,
	"date": true, "checkbox": true, "url": true, "person": true,
	"relation": true, "rollup": true, "formula": true,
}

var validViewTypes = map[string]bool{
	"table": true, "board": true, "list": true, "gallery": true,
	"calendar": true, "timeline": true, "form": true,
}

// normalizeSchema bringt eine von einem Agenten gelieferte Eigenschaftsliste in
// die Form, die die Oberfläche erwartet — und ist der Grund, warum es diese
// Funktion überhaupt gibt:
//
// Ein Agent schreibt Auswahlmöglichkeiten naheliegenderweise als
// `"options": ["Ideen", "Geplant"]`. Die Oberfläche erwartet aber Objekte
// `{id, name, color}`. Wurden die rohen Zeichenketten gespeichert, stürzte die
// GANZE Seite beim Öffnen ab (`o.name.toLowerCase()` auf einer Zeichenkette).
// Genau das ist in echt passiert. Statt den Agenten zu tadeln, akzeptieren wir
// beide Formen und wandeln um — die bequeme Schreibweise ist die richtige.
func normalizeSchema(props []map[string]any) ([]map[string]any, error) {
	str := func(m map[string]any, k string) string { v, _ := m[k].(string); return v }
	taken := map[string]bool{}
	for _, p := range props {
		if id := str(p, "id"); id != "" {
			taken[id] = true
		}
	}
	for _, p := range props {
		typ := str(p, "type")
		if typ != "" && !validPropTypes[typ] {
			return nil, fmt.Errorf("unknown property type %q on %q — use one of: text, number, select, multiselect, date, checkbox, url, person, relation, rollup, formula", typ, str(p, "name"))
		}
		if str(p, "name") == "" && str(p, "id") == "" {
			return nil, fmt.Errorf("each property needs a name")
		}
		if str(p, "id") == "" {
			id := slugID(str(p, "name"), taken)
			taken[id] = true
			p["id"] = id
		}
		if typ == "" {
			p["type"] = "text"
		}
		raw, ok := p["options"]
		if !ok || raw == nil {
			continue
		}
		list, ok := raw.([]any)
		if !ok {
			return nil, fmt.Errorf("options on %q must be a list", str(p, "name"))
		}
		optTaken := map[string]bool{}
		out := make([]any, 0, len(list))
		for _, o := range list {
			switch v := o.(type) {
			case string: // bequeme Kurzform: ["Ideen", "Geplant"]
				if v == "" {
					continue
				}
				id := slugID(v, optTaken)
				optTaken[id] = true
				out = append(out, map[string]any{"id": id, "name": v})
			case map[string]any:
				name, _ := v["name"].(string)
				id, _ := v["id"].(string)
				if name == "" && id == "" {
					return nil, fmt.Errorf("each option on %q needs a name", str(p, "name"))
				}
				if name == "" {
					name = id
					v["name"] = name
				}
				if id == "" {
					id = slugID(name, optTaken)
					v["id"] = id
				}
				optTaken[id] = true
				out = append(out, v)
			default:
				return nil, fmt.Errorf("options on %q must be strings or {id?, name, color?} objects", str(p, "name"))
			}
		}
		p["options"] = out
	}
	return props, nil
}

// loadCollection liest Schema und Ansichten einer Datenbank.
func (s *Server) loadCollection(pageID string) ([]map[string]any, []map[string]any, error) {
	var schemaJSON, viewsJSON string
	err := s.db.QueryRow(`SELECT schema, views FROM collections WHERE page_id = ?`, pageID).Scan(&schemaJSON, &viewsJSON)
	if err == sql.ErrNoRows {
		return nil, nil, fmt.Errorf("page %q is not a database", pageID)
	}
	if err != nil {
		return nil, nil, err
	}
	var schema []map[string]any
	if err := json.Unmarshal([]byte(schemaJSON), &schema); err != nil {
		schema = []map[string]any{}
	}
	var views []map[string]any
	if err := json.Unmarshal([]byte(viewsJSON), &views); err != nil {
		views = []map[string]any{}
	}
	return schema, views, nil
}

func (s *Server) saveCollection(pageID string, schema []map[string]any, views []map[string]any) error {
	sb, err := json.Marshal(schema)
	if err != nil {
		return err
	}
	vb, err := json.Marshal(views)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE collections SET schema = ?, views = ? WHERE page_id = ?`,
		string(sb), string(vb), pageID); err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE pages SET updated_at = ? WHERE id = ?`, now(), pageID); err != nil {
		return err
	}
	s.pagesChanged()
	return nil
}

// slugID macht aus einem Namen einen stabilen, lesbaren Bezeichner. Lesbare Ids
// helfen dem Agenten: "faelligkeit" sagt mehr als "p7". Bei Kollision wird
// durchnummeriert.
func slugID(name string, taken map[string]bool) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == 'ä':
			b.WriteString("ae")
		case r == 'ö':
			b.WriteString("oe")
		case r == 'ü':
			b.WriteString("ue")
		case r == 'ß':
			b.WriteString("ss")
		case r == ' ' || r == '-' || r == '_':
			b.WriteRune('-')
		}
	}
	base := strings.Trim(b.String(), "-")
	if base == "" {
		base = "prop"
	}
	id := base
	for i := 2; taken[id]; i++ {
		id = fmt.Sprintf("%s-%d", base, i)
	}
	return id
}

// --- Schema ----------------------------------------------------------------

// mcpGetCollection liefert Schema UND Ansichten. get_schema gibt nur das
// Schema; ohne die Ansichten kann ein Agent kein Board und keinen Kalender
// bearbeiten, weil er ihre Ids nicht kennt.
func (s *Server) mcpGetCollection(pageID string) (string, error) {
	schema, views, err := s.loadCollection(pageID)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(map[string]any{"page_id": pageID, "schema": schema, "views": views})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// mcpUpdateSchema ergänzt oder ändert Eigenschaften — mischend, nie ersetzend.
func (s *Server) mcpUpdateSchema(pageID string, props json.RawMessage, remove []string) (string, error) {
	schema, views, err := s.loadCollection(pageID)
	if err != nil {
		return "", err
	}
	var incoming []map[string]any
	if len(props) > 0 {
		if err := json.Unmarshal(props, &incoming); err != nil {
			return "", fmt.Errorf("properties must be a list of {id?, name, type, options?}: %v", err)
		}
		if incoming, err = normalizeSchema(incoming); err != nil {
			return "", err
		}
	}
	str := func(m map[string]any, k string) string { v, _ := m[k].(string); return v }

	taken := map[string]bool{}
	for _, p := range schema {
		taken[str(p, "id")] = true
	}

	added, changed := []string{}, []string{}
	for _, in := range incoming {
		name, typ, id := str(in, "name"), str(in, "type"), str(in, "id")
		if strings.TrimSpace(name) == "" && id == "" {
			return "", fmt.Errorf("each property needs at least a name")
		}
		if typ != "" && !validPropTypes[typ] {
			return "", fmt.Errorf("unknown property type %q — use one of: text, number, select, multiselect, date, checkbox, url, person, relation, rollup, formula", typ)
		}
		// Vorhandene Eigenschaft? Dann Feld für Feld mischen — was der Agent
		// nicht nennt, bleibt unangetastet.
		idx := -1
		if id != "" {
			for i, p := range schema {
				if str(p, "id") == id {
					idx = i
					break
				}
			}
		}
		if idx >= 0 {
			for k, v := range in {
				if k == "id" {
					continue
				}
				schema[idx][k] = v
			}
			changed = append(changed, id)
			continue
		}
		if typ == "" {
			in["type"] = "text"
		}
		if id == "" {
			id = slugID(name, taken)
			in["id"] = id
		}
		taken[id] = true
		schema = append(schema, in)
		added = append(added, id)
	}

	removed := []string{}
	if len(remove) > 0 {
		keep := schema[:0]
		for _, p := range schema {
			drop := false
			for _, r := range remove {
				if str(p, "id") == r {
					drop = true
					break
				}
			}
			if drop {
				removed = append(removed, str(p, "id"))
			} else {
				keep = append(keep, p)
			}
		}
		schema = keep
	}
	if len(added)+len(changed)+len(removed) == 0 {
		return "", fmt.Errorf("nothing to do: pass properties to add/change or remove_properties")
	}
	if err := s.saveCollection(pageID, schema, views); err != nil {
		return "", err
	}
	// Die Werte gelöschter Spalten bleiben bewusst in den Zeilen stehen: so ist
	// ein versehentliches Entfernen durch erneutes Anlegen der Spalte heilbar.
	parts := []string{}
	if len(added) > 0 {
		parts = append(parts, "added "+strings.Join(added, ", "))
	}
	if len(changed) > 0 {
		parts = append(parts, "changed "+strings.Join(changed, ", "))
	}
	if len(removed) > 0 {
		parts = append(parts, "removed "+strings.Join(removed, ", ")+" (row values kept, re-adding the property brings them back)")
	}
	return "Schema updated: " + strings.Join(parts, "; "), nil
}

// mcpAddSelectOption ergänzt eine Auswahlmöglichkeit. Ohne dieses Tool konnte
// ein Agent set_properties auf einen Wert aufrufen, den es gar nicht gibt.
func (s *Server) mcpAddSelectOption(pageID, propID, name, color string) (string, error) {
	schema, views, err := s.loadCollection(pageID)
	if err != nil {
		return "", err
	}
	for i, p := range schema {
		if id, _ := p["id"].(string); id != propID {
			continue
		}
		if t, _ := p["type"].(string); t != "select" && t != "multiselect" {
			return "", fmt.Errorf("property %q is a %s, not a select", propID, t)
		}
		opts, _ := p["options"].([]any)
		taken := map[string]bool{}
		for _, o := range opts {
			om, _ := o.(map[string]any)
			if n, _ := om["name"].(string); strings.EqualFold(n, name) {
				return "", fmt.Errorf("option %q already exists on %q with id %q", name, propID, om["id"])
			}
			if id, _ := om["id"].(string); id != "" {
				taken[id] = true
			}
		}
		opt := map[string]any{"id": slugID(name, taken), "name": name}
		if color != "" {
			opt["color"] = color
		}
		schema[i]["options"] = append(opts, opt)
		if err := s.saveCollection(pageID, schema, views); err != nil {
			return "", err
		}
		return fmt.Sprintf("Added option %q (id %s) to property %q", name, opt["id"], propID), nil
	}
	return "", fmt.Errorf("property %q not found — call get_schema for the ids", propID)
}

// --- Ansichten -------------------------------------------------------------

// mcpCreateView legt eine Ansicht an — Board, Kalender, Timeline, Galerie,
// Liste, Formular oder Tabelle. „Views sind das, was eine Datenbank von einer
// Tabelle unterscheidet."
func (s *Server) mcpCreateView(pageID, name, viewType, groupBy, dateProp, endDateProp string) (string, error) {
	if !validViewTypes[viewType] {
		return "", fmt.Errorf("unknown view type %q — use table, board, gallery, calendar, timeline, list or form", viewType)
	}
	schema, views, err := s.loadCollection(pageID)
	if err != nil {
		return "", err
	}
	has := func(id string) bool {
		for _, p := range schema {
			if pid, _ := p["id"].(string); pid == id {
				return true
			}
		}
		return false
	}
	// Früh und deutlich scheitern: ein Board ohne Gruppierung oder ein Kalender
	// ohne Datum rendert sonst leer, und der Agent sucht den Fehler woanders.
	if viewType == "board" {
		if groupBy == "" {
			return "", fmt.Errorf("a board needs group_by (a select property id)")
		}
		if !has(groupBy) {
			return "", fmt.Errorf("group_by %q is not a property of this database", groupBy)
		}
	}
	if viewType == "calendar" || viewType == "timeline" {
		if dateProp == "" {
			return "", fmt.Errorf("a %s needs date_prop (a date property id)", viewType)
		}
		if !has(dateProp) {
			return "", fmt.Errorf("date_prop %q is not a property of this database", dateProp)
		}
	}
	if endDateProp != "" && !has(endDateProp) {
		return "", fmt.Errorf("end_date_prop %q is not a property of this database", endDateProp)
	}
	taken := map[string]bool{}
	for _, v := range views {
		if id, ok := v["id"].(string); ok {
			taken[id] = true
		}
	}
	if strings.TrimSpace(name) == "" {
		name = strings.ToUpper(viewType[:1]) + viewType[1:]
	}
	view := map[string]any{"id": slugID(name, taken), "name": name, "type": viewType}
	if groupBy != "" {
		view["groupBy"] = groupBy
	}
	if dateProp != "" {
		view["dateProp"] = dateProp
	}
	if endDateProp != "" {
		view["endDateProp"] = endDateProp
	}
	views = append(views, view)
	if err := s.saveCollection(pageID, schema, views); err != nil {
		return "", err
	}
	return fmt.Sprintf("Created %s view %q (id %s)", viewType, name, view["id"]), nil
}

// mcpDeleteView entfernt eine Ansicht; die letzte bleibt bestehen, sonst hätte
// die Datenbank in der Oberfläche nichts mehr anzuzeigen.
func (s *Server) mcpDeleteView(pageID, viewID string) (string, error) {
	schema, views, err := s.loadCollection(pageID)
	if err != nil {
		return "", err
	}
	if len(views) <= 1 {
		return "", fmt.Errorf("cannot delete the last view — a database needs at least one")
	}
	keep := views[:0]
	found := false
	for _, v := range views {
		if id, _ := v["id"].(string); id == viewID {
			found = true
			continue
		}
		keep = append(keep, v)
	}
	if !found {
		return "", fmt.Errorf("view %q not found — call get_collection for the ids", viewID)
	}
	if err := s.saveCollection(pageID, schema, keep); err != nil {
		return "", err
	}
	return fmt.Sprintf("Deleted view %s", viewID), nil
}

// --- Massenoperationen ------------------------------------------------------

// mcpCreateRows legt mehrere Zeilen in einem Aufruf an. „Bei 40 Zeilen sind das
// 40 Calls" — und jeder einzelne kann fehlschlagen und einen halben Zustand
// hinterlassen.
func (s *Server) mcpCreateRows(userID, pageID string, rows json.RawMessage) (string, error) {
	var list []struct {
		Title      string          `json:"title"`
		Icon       string          `json:"icon"`
		Properties json.RawMessage `json:"properties"`
	}
	if err := json.Unmarshal(rows, &list); err != nil {
		return "", fmt.Errorf("rows must be a list of {title, icon?, properties?}: %v", err)
	}
	if len(list) == 0 {
		return "", fmt.Errorf("rows is empty")
	}
	if len(list) > 200 {
		return "", fmt.Errorf("at most 200 rows per call (got %d) — split into batches", len(list))
	}
	var ws string
	if err := s.db.QueryRow(`SELECT workspace_id FROM pages WHERE id = ? AND trashed_at IS NULL`, pageID).Scan(&ws); err != nil {
		return "", fmt.Errorf("database %q not found", pageID)
	}
	var pos float64
	s.db.QueryRow(`SELECT COALESCE(MAX(position), 0) + 1 FROM pages WHERE parent_id = ?`, pageID).Scan(&pos)

	ids := []string{}
	for _, r := range list {
		if strings.TrimSpace(r.Title) == "" {
			return "", fmt.Errorf("every row needs a title (row %d is empty) — nothing was created", len(ids)+1)
		}
		id := newID()
		ts := now()
		if _, err := s.db.Exec(`INSERT INTO pages (id, parent_id, title, icon, content, position, created_at, updated_at, workspace_id, owner_id, visibility) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, 'workspace')`,
			id, pageID, r.Title, r.Icon, pos, ts, ts, ws, userID); err != nil {
			return "", fmt.Errorf("created %d row(s), then failed on %q: %w", len(ids), r.Title, err)
		}
		pos++
		if len(r.Properties) > 0 {
			if _, err := s.mcpSetProperties(id, r.Properties); err != nil {
				return "", fmt.Errorf("created %d row(s), then failed setting properties on %q: %w", len(ids)+1, r.Title, err)
			}
		}
		s.reindexPage(id)
		ids = append(ids, id)
	}
	s.pagesChanged()
	b, _ := json.Marshal(map[string]any{"created": len(ids), "ids": ids})
	return string(b), nil
}

// mcpBatchSetProperties aktualisiert viele Zeilen in einem Aufruf.
func (s *Server) mcpBatchSetProperties(userID string, updates json.RawMessage) (string, error) {
	var list []struct {
		PageID     string          `json:"page_id"`
		Properties json.RawMessage `json:"properties"`
	}
	if err := json.Unmarshal(updates, &list); err != nil {
		return "", fmt.Errorf("updates must be a list of {page_id, properties}: %v", err)
	}
	if len(list) == 0 {
		return "", fmt.Errorf("updates is empty")
	}
	if len(list) > 200 {
		return "", fmt.Errorf("at most 200 updates per call (got %d)", len(list))
	}
	// Rechte VOR der ersten Änderung für ALLE prüfen — sonst bricht der Aufruf
	// mittendrin ab und hinterlässt eine halb aktualisierte Datenbank.
	for _, u := range list {
		if !s.canWrite(userID, u.PageID) {
			return "", fmt.Errorf("page %q not found (nothing was changed)", u.PageID)
		}
	}
	done := 0
	for _, u := range list {
		if _, err := s.mcpSetProperties(u.PageID, u.Properties); err != nil {
			return "", fmt.Errorf("updated %d row(s), then failed on %q: %w", done, u.PageID, err)
		}
		done++
	}
	s.pagesChanged()
	return fmt.Sprintf("Updated properties on %d row(s)", done), nil
}

// resolveOptionValues übersetzt Auswahlwerte, die als NAME geschrieben wurden,
// in die zugehörige Options-Id.
//
// Der Anlass: ein Agent setzt naheliegenderweise `{"status": "Geplant"}` — den
// Namen, den er selbst beim Anlegen vergeben hat. Gespeichert werden muss aber
// die Id ("geplant"). Ungelöst landeten die Werte zwar in der Datenbank, aber
// keine Board-Spalte und kein Filter fand sie wieder: 51 Werte lagen so als
// stille Karteileichen herum. Die Zuordnung ist case-insensitiv; passt nichts,
// bleibt der Wert unverändert (dann ist es kein Auswahlfeld oder ein neuer
// Wert, den add_select_option ergänzen soll).
func (s *Server) resolveOptionValues(pageID string, patch map[string]json.RawMessage) {
	var parentID string
	if err := s.db.QueryRow(`SELECT COALESCE(parent_id, '') FROM pages WHERE id = ?`, pageID).Scan(&parentID); err != nil || parentID == "" {
		return
	}
	schema, _, err := s.loadCollection(parentID)
	if err != nil {
		return
	}
	byProp := map[string]map[string]string{} // propID -> kleingeschriebener Name/Id -> Id
	for _, p := range schema {
		id, _ := p["id"].(string)
		opts, _ := p["options"].([]any)
		if id == "" || len(opts) == 0 {
			continue
		}
		m := map[string]string{}
		for _, o := range opts {
			om, _ := o.(map[string]any)
			oid, _ := om["id"].(string)
			name, _ := om["name"].(string)
			if oid == "" {
				continue
			}
			m[strings.ToLower(oid)] = oid
			if name != "" {
				m[strings.ToLower(name)] = oid
			}
		}
		byProp[id] = m
	}
	for prop, raw := range patch {
		m, ok := byProp[prop]
		if !ok {
			continue
		}
		// Einzelwert
		var one string
		if json.Unmarshal(raw, &one) == nil {
			if id, hit := m[strings.ToLower(one)]; hit && id != one {
				if b, err := json.Marshal(id); err == nil {
					patch[prop] = b
				}
			}
			continue
		}
		// Mehrfachauswahl
		var many []string
		if json.Unmarshal(raw, &many) == nil {
			out, changed := make([]string, len(many)), false
			for i, v := range many {
				out[i] = v
				if id, hit := m[strings.ToLower(v)]; hit && id != v {
					out[i] = id
					changed = true
				}
			}
			if changed {
				if b, err := json.Marshal(out); err == nil {
					patch[prop] = b
				}
			}
		}
	}
}

// resolveFilterValues bildet Filterwerte, die als Options-NAME geschrieben sind,
// auf die Id ab — dieselbe Kulanz wie beim Schreiben. Ein Agent, der mit
// "In Arbeit" schreibt, sucht auch mit "In Arbeit".
func (s *Server) resolveFilterValues(collectionID string, filters []rowFilter) []rowFilter {
	schema, _, err := s.loadCollection(collectionID)
	if err != nil {
		return filters
	}
	byProp := map[string]map[string]string{}
	for _, p := range schema {
		id, _ := p["id"].(string)
		opts, _ := p["options"].([]any)
		if id == "" || len(opts) == 0 {
			continue
		}
		m := map[string]string{}
		for _, o := range opts {
			om, _ := o.(map[string]any)
			oid, _ := om["id"].(string)
			name, _ := om["name"].(string)
			if oid == "" {
				continue
			}
			m[strings.ToLower(oid)] = oid
			if name != "" {
				m[strings.ToLower(name)] = oid
			}
		}
		byProp[id] = m
	}
	out := make([]rowFilter, len(filters))
	copy(out, filters)
	for i, f := range out {
		if m, ok := byProp[f.Prop]; ok {
			if id, hit := m[strings.ToLower(f.Value)]; hit {
				out[i].Value = id
			}
		}
	}
	return out
}
