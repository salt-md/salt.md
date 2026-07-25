package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Massenimport, ohne dass der Inhalt durch den Agenten läuft.
//
// Das Problem, das hier gelöst wird: um 654 Trello-Karten anzulegen, musste ein
// Agent bisher jedes Zeichen selbst schreiben — einmal beim Lesen der Quelle,
// einmal beim Schreiben über create_page. Bei ~1,5 Mio. Zeichen Karteninhalt
// bricht jeder Agent unterwegs ab, egal wie geschickt er ist. Das ist keine
// Frage der Sorgfalt, sondern eine harte Grenze seines Kontextfensters.
//
// Die Umkehrung: der Agent nennt nur noch QUELLE und ZUORDNUNG (ein paar
// hundert Zeichen), Salt holt die Daten selbst und legt sie an. Damit ist der
// Import unabhängig von der Größe der Quelle und gelingt auch einem schwachen
// Agenten — er muss lediglich einen Auftrag starten und dessen Stand abfragen.
//
// Sicherheitsgrenze: ein Werkzeug, das den Server beliebige URLs abrufen lässt,
// ist ein klassisches SSRF-Loch. Salt steht in einem privaten Netz und könnte
// darüber Nachbarn erreichen, die von außen unerreichbar sind — Router,
// Hypervisor, Cloud-Metadatendienste. Deshalb prüft safeDial JEDE aufgelöste
// Adresse und wählt genau die geprüfte an (siehe dort).

const (
	ingestMaxBytes = 64 << 20 // Obergrenze für die geholte Quelle
	ingestMaxItems = 20000    // Reißleine gegen Endlos-Quellen
	ingestKeepJobs = 20       // so viele abgeschlossene Aufträge bleiben abrufbar
)

// --- Auftragsverwaltung ------------------------------------------------------

type ingestJob struct {
	ID       string   `json:"job_id"`
	Status   string   `json:"status"` // running | done | failed
	Total    int      `json:"total"`
	Created  int      `json:"created"`
	Failed   int      `json:"failed"`
	Errors   []string `json:"errors,omitempty"`
	Note     string   `json:"note,omitempty"`
	Target   string   `json:"target"`
	Started  string   `json:"started_at"`
	Finished string   `json:"finished_at,omitempty"`
	// OwnerID: die Registry ist prozessweit und die Auftraege enthalten
	// Zielangaben und Zeilentitel. Ohne Eigentuemer konnte jeder mit einer
	// Auftrags-Id den Stand eines fremden Imports lesen.
	OwnerID string `json:"-"`
}

type ingestRegistry struct {
	mu    sync.Mutex
	jobs  map[string]*ingestJob
	order []string
}

func newIngestRegistry() *ingestRegistry {
	return &ingestRegistry{jobs: map[string]*ingestJob{}}
}

func (reg *ingestRegistry) add(j *ingestJob) {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	reg.jobs[j.ID] = j
	reg.order = append(reg.order, j.ID)
	// Nur die letzten N behalten — die Aufträge liegen im Speicher, nicht in der
	// Datenbank. Ein Neustart verliert den STATUS, nicht die Arbeit: bereits
	// angelegte Seiten sind gespeichert.
	for len(reg.order) > ingestKeepJobs {
		delete(reg.jobs, reg.order[0])
		reg.order = reg.order[1:]
	}
}

func (reg *ingestRegistry) get(id string) (ingestJob, bool) {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	j, ok := reg.jobs[id]
	if !ok {
		return ingestJob{}, false
	}
	return *j, true // Kopie: der Aufrufer soll nicht in den laufenden Auftrag greifen
}

func (reg *ingestRegistry) update(id string, fn func(*ingestJob)) {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	if j, ok := reg.jobs[id]; ok {
		fn(j)
	}
}

// --- Abholen der Quelle ------------------------------------------------------

// blockedIP entscheidet, ob eine Adresse für den Server tabu ist. Alles, was
// nicht öffentlich routbar ist, wird abgelehnt: Schleife, private Netze,
// Link-Local (dort liegt 169.254.169.254, der Metadatendienst vieler Anbieter),
// Multicast und die Nulladresse.
// allowPrivateImport oeffnet Importe aus privaten Netzen. Bewusst NUR ueber
// eine Umgebungsvariable beim Start (SALT_IMPORT_ALLOW_PRIVATE=1), nicht ueber
// die API und erst recht nicht ueber MCP: wer den Dienst startet, trifft diese
// Entscheidung — ein Agent kann sie nicht treffen. Gedacht fuer selbst
// gehostete Quellen im eigenen Netz (eigenes Jira, eigenes Wiki).
var allowPrivateImport = os.Getenv("SALT_IMPORT_ALLOW_PRIVATE") == "1"

func blockedIP(ip net.IP) bool {
	if allowPrivateImport {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified()
}

// safeDial löst den Namen auf, prüft JEDE Adresse und verbindet sich dann mit
// genau der geprüften Adresse.
//
// Der zweite Teil ist der wichtige: würde man nach der Prüfung erneut über den
// Namen verbinden, könnte ein Angreifer zwischen Prüfung und Verbindung eine
// andere Adresse ausliefern (DNS-Rebinding) und die Prüfung wäre wertlos. Weil
// der Dialer bei JEDER Weiterleitung erneut greift, deckt das auch Umleitungen
// auf interne Ziele ab.
func safeDial(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("cannot resolve %q", host)
	}
	d := &net.Dialer{Timeout: 10 * time.Second}
	for _, ip := range ips {
		if blockedIP(ip) {
			return nil, fmt.Errorf("refusing to fetch from %s (%s): only public addresses are allowed, "+
				"so an import cannot be used to reach this server's private network", host, ip)
		}
	}
	var lastErr error
	for _, ip := range ips {
		c, err := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return c, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func ingestHTTPClient() *http.Client {
	return &http.Client{
		Timeout:   3 * time.Minute,
		Transport: &http.Transport{DialContext: safeDial},
		CheckRedirect: func(r *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			if r.URL.Scheme != "http" && r.URL.Scheme != "https" {
				return fmt.Errorf("refusing to follow a %s:// redirect", r.URL.Scheme)
			}
			return nil
		},
	}
}

// fetchSource holt die Quelle. headers erlaubt Authentifizierung (Bearer-Token,
// API-Key), ohne dass Salt die Zugangsdaten speichert — sie gelten nur für
// diesen einen Abruf.
func fetchSource(rawURL string, headers map[string]string) ([]byte, error) {
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return nil, fmt.Errorf("url must start with http:// or https://")
	}
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %v", err)
	}
	req.Header.Set("User-Agent", "Salt.md/"+Version+" (import)")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := ingestHTTPClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not fetch the url: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, ingestMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("could not read the response: %v", err)
	}
	if len(body) > ingestMaxBytes {
		return nil, fmt.Errorf("the source is larger than %d MB", ingestMaxBytes>>20)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 300 {
			snippet = snippet[:300] + "…"
		}
		return nil, fmt.Errorf("the source answered %s: %s", resp.Status, snippet)
	}
	return body, nil
}

// --- Feldzuordnung -----------------------------------------------------------

// jsonPath liest einen Wert über einen Pfad wie "name", "card.due" oder
// "labels[].name" (letzteres pflückt das Feld aus jedem Element einer Liste).
// Bewusst klein gehalten: das deckt die Form ab, die REST-Antworten fast immer
// haben, ohne eine ganze Abfragesprache mitzuschleppen.
func jsonPath(v any, path string) any {
	if path == "" || v == nil {
		return v
	}
	seg, rest, _ := strings.Cut(path, ".")
	pluck := strings.HasSuffix(seg, "[]")
	seg = strings.TrimSuffix(seg, "[]")

	cur := v
	if seg != "" {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[seg]
	}
	if pluck {
		arr, ok := cur.([]any)
		if !ok {
			return nil
		}
		out := []any{}
		for _, e := range arr {
			if rest == "" {
				out = append(out, e)
			} else if x := jsonPath(e, rest); x != nil {
				out = append(out, x)
			}
		}
		return out
	}
	if rest == "" {
		return cur
	}
	return jsonPath(cur, rest)
}

// scalarString macht aus einem JSON-Wert Text für Titel und Textfelder.
func scalarString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case []any:
		parts := make([]string, 0, len(t))
		for _, e := range t {
			if s := scalarString(e); s != "" {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, ", ")
	}
	return ""
}

// ingestResolve beschreibt eine Verknüpfung innerhalb derselben Antwort: ein
// Element trägt eine Fremd-Id, der Klartext steht in einer anderen Liste.
// Genau die Form haben Trello (Karte → idList → lists[].name), Jira, Airtable
// und Asana. Ohne das stünde in der Spalte eine nichtssagende Id.
type ingestResolve struct {
	From  string `json:"from"`  // Pfad zur Nachschlageliste, z. B. "lists"
	Match string `json:"match"` // Feld darin, das der Id entspricht, z. B. "id"
	To    string `json:"to"`    // Feld, dessen Wert eingesetzt wird, z. B. "name"
}

type ingestSpec struct {
	URL        string                   `json:"url"`
	Headers    map[string]string        `json:"headers"`
	Items      string                   `json:"items"`
	Title      string                   `json:"title"`
	Markdown   string                   `json:"markdown"`
	Properties map[string]string        `json:"properties"`
	Resolve    map[string]ingestResolve `json:"resolve"`
	DatabaseID string                   `json:"database_id"`
	ParentID   string                   `json:"parent_id"`
	WorkspaceI string                   `json:"workspace_id"`
	Limit      int                      `json:"limit"`
}

// buildResolvers baut aus den Nachschlagelisten Wörterbücher Id → Klartext.
func buildResolvers(doc any, spec ingestSpec) map[string]map[string]string {
	out := map[string]map[string]string{}
	for field, r := range spec.Resolve {
		arr, ok := jsonPath(doc, r.From).([]any)
		if !ok {
			continue
		}
		table := map[string]string{}
		for _, e := range arr {
			k := scalarString(jsonPath(e, r.Match))
			v := scalarString(jsonPath(e, r.To))
			if k != "" && v != "" {
				table[k] = v
			}
		}
		out[field] = table
	}
	return out
}

// applyResolve ersetzt Ids durch Klartext — auch innerhalb von Listen.
func applyResolve(v any, table map[string]string) any {
	if table == nil {
		return v
	}
	if arr, ok := v.([]any); ok {
		out := make([]any, 0, len(arr))
		for _, e := range arr {
			out = append(out, applyResolve(e, table))
		}
		return out
	}
	if s := scalarString(v); s != "" {
		if mapped, ok := table[s]; ok {
			return mapped
		}
	}
	return v
}

// --- Durchführung ------------------------------------------------------------

type ingestItem struct {
	title string
	md    string
	props map[string]any
}

// planIngest holt die Quelle und formt sie in Einträge um — ohne etwas zu
// schreiben. Damit scheitert ein falsch zugeordneter Import, BEVOR halb
// angelegte Seiten herumliegen.
func planIngest(spec ingestSpec) ([]ingestItem, error) {
	body, err := fetchSource(spec.URL, spec.Headers)
	if err != nil {
		return nil, err
	}
	var doc any
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("the source is not valid JSON: %v", err)
	}
	return mapItems(doc, spec)
}

// mapItems formt ein geholtes Dokument in Eintraege um. Getrennt von planIngest,
// damit die Zuordnung ohne Netzzugriff pruefbar ist — sie ist der Teil, in dem
// die Fehler stecken.
func mapItems(doc any, spec ingestSpec) ([]ingestItem, error) {
	raw := doc
	if spec.Items != "" {
		raw = jsonPath(doc, spec.Items)
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("items path %q does not point at a list — pass the path to the array of records (for example \"cards\"), or omit it if the response is a list itself", spec.Items)
	}
	if len(arr) == 0 {
		return nil, fmt.Errorf("the source contains no records at %q", spec.Items)
	}
	if len(arr) > ingestMaxItems {
		return nil, fmt.Errorf("the source has %d records, more than the limit of %d", len(arr), ingestMaxItems)
	}
	limit := spec.Limit
	if limit > 0 && limit < len(arr) {
		arr = arr[:limit]
	}
	resolvers := buildResolvers(doc, spec)

	items := make([]ingestItem, 0, len(arr))
	for i, e := range arr {
		title := strings.TrimSpace(scalarString(jsonPath(e, spec.Title)))
		if title == "" {
			title = fmt.Sprintf("Untitled %d", i+1)
		}
		if len([]rune(title)) > maxTitleLen {
			title = string([]rune(title)[:maxTitleLen])
		}
		it := ingestItem{title: title, props: map[string]any{}}
		if spec.Markdown != "" {
			it.md = scalarString(jsonPath(e, spec.Markdown))
		}
		for prop, path := range spec.Properties {
			v := jsonPath(e, path)
			// Die Zuordnung nennt den QUELLPFAD; nachgeschlagen wird über dessen
			// letzten Abschnitt, damit "idList" und "card.idList" gleich wirken.
			key := path
			if i := strings.LastIndexByte(key, '.'); i >= 0 {
				key = key[i+1:]
			}
			v = applyResolve(v, resolvers[strings.TrimSuffix(key, "[]")])
			if v != nil {
				it.props[prop] = v
			}
		}
		items = append(items, it)
	}
	return items, nil
}

// ensureIngestOptions legt fehlende Auswahloptionen an — EINMAL für den ganzen
// Import, nicht pro Zeile.
//
// Ohne das ist der Import für einen schwachen Agenten unbenutzbar: die 11
// Trello-Listen sind im Salt-Schema erst einmal keine Optionen, jede Zeile
// bekäme einen leeren Status, und der Agent müsste die Lücke selbst bemerken.
// Der Import weiß es besser als er — also macht er es.
func (s *Server) ensureIngestOptions(dbID string, items []ingestItem, nameToID map[string]string) (int, error) {
	schema, views, err := s.loadCollection(dbID)
	if err != nil {
		return 0, err
	}
	// Gewünschte Werte je Auswahl-Property einsammeln, Reihenfolge stabil halten.
	want := map[string][]string{}
	seen := map[string]bool{}
	for _, it := range items {
		for prop, v := range it.props {
			id := nameToID[strings.ToLower(prop)]
			if id == "" {
				continue
			}
			for _, val := range valueStrings(v) {
				k := id + "\x00" + strings.ToLower(val)
				if !seen[k] {
					seen[k] = true
					want[id] = append(want[id], val)
				}
			}
		}
	}
	added := 0
	for i, p := range schema {
		id, _ := p["id"].(string)
		typ, _ := p["type"].(string)
		if typ != "select" && typ != "multiselect" {
			continue
		}
		opts, _ := p["options"].([]any)
		have := map[string]bool{}
		taken := map[string]bool{}
		for _, o := range opts {
			om, _ := o.(map[string]any)
			if n, _ := om["name"].(string); n != "" {
				have[strings.ToLower(n)] = true
			}
			if oid, _ := om["id"].(string); oid != "" {
				taken[oid] = true
			}
		}
		for _, val := range want[id] {
			if have[strings.ToLower(val)] {
				continue
			}
			// Farbe gleich mitgeben: eine Option ohne Farbe erscheint im Board
			// als farbloser Kopf, und ein Kanban lebt davon, dass man die
			// Spalten am Farbton auseinanderhaelt. Reihum aus optionPalette
			// (import_csv.go) — dieselbe Quelle wie beim CSV-Import, damit
			// nicht zwei Wahrheiten entstehen.
			opts = append(opts, map[string]any{
				"id":    slugID(val, taken),
				"name":  val,
				"color": optionPalette[added%len(optionPalette)],
			})
			have[strings.ToLower(val)] = true
			added++
		}
		schema[i]["options"] = opts
	}
	if added > 0 {
		if err := s.saveCollection(dbID, schema, views); err != nil {
			return 0, err
		}
	}
	return added, nil
}

// valueStrings zerlegt einen zugeordneten Wert in einzelne Auswahlwerte.
func valueStrings(v any) []string {
	if arr, ok := v.([]any); ok {
		out := []string{}
		for _, e := range arr {
			if s := strings.TrimSpace(scalarString(e)); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	if s := strings.TrimSpace(scalarString(v)); s != "" {
		return []string{s}
	}
	return nil
}

// startIngest prüft Ziel und Zuordnung, holt die Quelle und startet den Auftrag
// im Hintergrund. Der Aufrufer bekommt sofort eine Auftrags-Id zurück — ein
// Import mit hunderten Einträgen liefe sonst in jede Zeitgrenze.
func (s *Server) startIngest(u *user, spec ingestSpec) (string, error) {
	if strings.TrimSpace(spec.URL) == "" {
		return "", fmt.Errorf("url is required")
	}
	if spec.Title == "" {
		return "", fmt.Errorf("title is required — name the field each record's title comes from (for example \"name\")")
	}

	// Ziel bestimmen und Schreibrecht prüfen, BEVOR irgendetwas geholt wird.
	var parentID, workspaceID, target string
	var nameToID map[string]string
	if spec.DatabaseID != "" {
		// tokenCanReach zusaetzlich: canWrite kennt die Workspace-Grenze eines
		// eingeschraenkten Tokens nicht, sonst schriebe es ausserhalb seines Bereichs.
		if !s.canWrite(u.ID, spec.DatabaseID) || u.TokenScope == "read" || !u.tokenCanReach(s.pageWorkspace(spec.DatabaseID)) {
			return "", fmt.Errorf("database %q not found", spec.DatabaseID)
		}
		schema, _, err := s.loadCollection(spec.DatabaseID)
		if err != nil {
			return "", err
		}
		if err := s.db.QueryRow(`SELECT workspace_id FROM pages WHERE id = ? AND trashed_at IS NULL`,
			spec.DatabaseID).Scan(&workspaceID); err != nil {
			return "", fmt.Errorf("database %q not found", spec.DatabaseID)
		}
		nameToID = map[string]string{}
		known := []string{}
		for _, p := range schema {
			id, _ := p["id"].(string)
			name, _ := p["name"].(string)
			if id != "" {
				nameToID[strings.ToLower(id)] = id
				known = append(known, name)
			}
			if name != "" {
				nameToID[strings.ToLower(name)] = id
			}
		}
		// Eine falsch geschriebene Spalte darf nicht still ins Leere laufen.
		for prop := range spec.Properties {
			if nameToID[strings.ToLower(prop)] == "" {
				return "", fmt.Errorf("the database has no property %q — it has: %s (call get_schema, or add it with update_schema first)",
					prop, strings.Join(known, ", "))
			}
		}
		parentID = spec.DatabaseID
		target = "database " + spec.DatabaseID
	} else if spec.ParentID != "" {
		if !s.canWrite(u.ID, spec.ParentID) || u.TokenScope == "read" || !u.tokenCanReach(s.pageWorkspace(spec.ParentID)) {
			return "", fmt.Errorf("parent page %q not found", spec.ParentID)
		}
		if err := s.db.QueryRow(`SELECT workspace_id FROM pages WHERE id = ? AND trashed_at IS NULL`,
			spec.ParentID).Scan(&workspaceID); err != nil {
			return "", fmt.Errorf("parent page %q not found", spec.ParentID)
		}
		parentID = spec.ParentID
		target = "pages under " + spec.ParentID
	} else {
		ws, err := s.mcpCreateWorkspaceTarget(u, spec.WorkspaceI)
		if err != nil {
			return "", err
		}
		workspaceID = ws
		target = "top-level pages in workspace " + ws
	}

	// Holen und zuordnen passiert VOR dem Hintergrundauftrag: ein Tippfehler im
	// Pfad oder eine unerreichbare Quelle soll sofort als Fehler zurückkommen,
	// nicht erst beim Nachfragen.
	items, err := planIngest(spec)
	if err != nil {
		return "", err
	}

	note := ""
	if spec.DatabaseID != "" {
		added, err := s.ensureIngestOptions(spec.DatabaseID, items, nameToID)
		if err != nil {
			return "", err
		}
		if added > 0 {
			note = fmt.Sprintf("added %d missing select option(s) from the source", added)
		}
	}

	job := &ingestJob{
		ID: newID(), Status: "running", Total: len(items),
		Target: target, Started: now(), Note: note, OwnerID: u.ID,
	}
	s.ingest.add(job)
	go s.runIngest(job.ID, u.ID, parentID, workspaceID, items, nameToID)
	return job.ID, nil
}

// runIngest legt die Einträge an. Läuft im Hintergrund und schreibt den Stand
// fortlaufend in den Auftrag, damit ein Agent zusehen kann.
func (s *Server) runIngest(jobID, userID, parentID, workspaceID string, items []ingestItem, nameToID map[string]string) {
	var pos float64
	if parentID != "" {
		s.db.QueryRow(`SELECT COALESCE(MAX(position), 0) + 1 FROM pages WHERE parent_id = ?`, parentID).Scan(&pos)
	} else {
		s.db.QueryRow(`SELECT COALESCE(MAX(position), 0) + 1 FROM pages WHERE parent_id IS NULL AND workspace_id = ?`, workspaceID).Scan(&pos)
	}
	var parent any
	if parentID != "" {
		parent = parentID
	}

	for _, it := range items {
		content := "[]"
		if it.md != "" {
			if c, err := mdToBlocksJSON(it.md); err == nil {
				content = c
			}
		}
		id := newID()
		ts := now()
		_, err := s.db.Exec(`INSERT INTO pages (id, parent_id, title, content, position, created_at, updated_at, workspace_id, owner_id, visibility)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'workspace')`,
			id, parent, it.title, content, pos, ts, ts, workspaceID, userID)
		if err != nil {
			s.ingest.update(jobID, func(j *ingestJob) {
				j.Failed++
				if len(j.Errors) < 10 {
					j.Errors = append(j.Errors, fmt.Sprintf("%s: %v", it.title, err))
				}
			})
			continue
		}
		pos++
		if len(it.props) > 0 && nameToID != nil {
			patch := map[string]any{}
			for prop, v := range it.props {
				if pid := nameToID[strings.ToLower(prop)]; pid != "" {
					patch[pid] = v
				}
			}
			if len(patch) > 0 {
				b, _ := json.Marshal(patch)
				if _, err := s.mcpSetProperties(id, b); err != nil {
					s.ingest.update(jobID, func(j *ingestJob) {
						if len(j.Errors) < 10 {
							j.Errors = append(j.Errors, fmt.Sprintf("%s: properties: %v", it.title, err))
						}
					})
				}
			}
		}
		s.reindexPage(id)
		s.ingest.update(jobID, func(j *ingestJob) { j.Created++ })
	}

	s.ingest.update(jobID, func(j *ingestJob) {
		j.Status = "done"
		j.Finished = now()
	})
	s.pagesChanged()
}
