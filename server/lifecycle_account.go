package server

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Kontenlebenszyklus (W105).
//
// Bisher gab es nur "löschen", und das räumte still auf: die Mitgliedschaften
// verschwanden per CASCADE, und war jemand das einzige Mitglied eines
// Workspace, blieb der mit null Mitgliedern zurück — für niemanden mehr
// sichtbar, aber mit allen Seiten, Dateien und Suchindex-Einträgen. Der Schutz
// "letzter Admin" griff nur beim Verlassen eines Workspace, nicht beim Löschen
// des Kontos.
//
// Drei Dinge ändern das:
//
//	Stilllegen    der Normalfall beim Offboarding. Anmeldung zu, Sitzungen und
//	              Token beendet, aber alles bleibt zurechenbar.
//	Folgen zeigen wer löscht, sieht vorher, was daran hängt.
//	Übergeben     geteilte Workspaces fallen an den dienstältesten verbliebenen
//	              Admin, ersatzweise an den Owner. Nie ins Nichts.
//
// Der persönliche Bereich geht mit dem Menschen: ihn still an den Chef
// weiterzureichen wäre genau das, was das Rechtemodell verhindern soll.

// purgeWorkspace löscht einen Workspace samt Inhalt.
//
// `pages.workspace_id` wurde per ensureColumn nachgerüstet und hat KEINEN
// Fremdschlüssel — an `workspaces` hängen per Kaskade nur workspace_members,
// break_glass und tag_colors. Ein blankes `DELETE FROM workspaces` ließ die
// Seiten also stehen: unsichtbar für jede Oberfläche (die Mitgliedschaft, über
// die geprüft wird, ist weg), aber weiterhin in der Datenbank — und ein
// vorhandener öffentlicher Freigabelink funktionierte weiter, ohne dass ihn
// noch jemand hätte widerrufen können.
//
// Alles in einer Transaktion, damit kein Halbzustand entsteht.
func (s *Server) purgeWorkspace(wsID string) error {
	// Erst merken, welche Uploads an diesen Seiten hängen — nach dem DELETE
	// steht es nirgends mehr. Eine Datei unter /files/<name> ist für jedes
	// angemeldete Konto abrufbar; blieb sie liegen, war der Inhalt eines
	// gelöschten persönlichen Bereichs weiter erreichbar, sobald jemand die URL
	// hatte (aus einem Export, einer Kopie, dem Browserverlauf).
	refs := map[string]bool{}
	var pageIDs []string
	if rows, err := s.db.Query(`SELECT id, COALESCE(content,''), COALESCE(props,''), COALESCE(cover,'') FROM pages WHERE workspace_id = ?`, wsID); err == nil {
		for rows.Next() {
			var id, content, props, cover string
			if rows.Scan(&id, &content, &props, &cover) != nil {
				continue
			}
			pageIDs = append(pageIDs, id)
			for _, m := range fileRefPattern.FindAllStringSubmatch(content+"\n"+props+"\n"+cover, -1) {
				refs[m[1]] = true
			}
		}
		rows.Close() // erst leeren, dann weiter (eine DB-Verbindung)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Freigabelinks und Kommentare hängen an pages und verschwinden mit ihnen;
	// pages_fts ist eine virtuelle Tabelle ohne Fremdschlüssel und invites
	// tragen die Workspace-Id ohne Verweis — beide von Hand.
	if _, err := tx.Exec(`DELETE FROM pages_fts WHERE id IN (SELECT id FROM pages WHERE workspace_id = ?)`, wsID); err != nil {
		return err
	}
	// chunks_fts ebenso von Hand: virtuelle Tabellen kennen keine Kaskade.
	// page_chunks selbst haengt am Fremdschluessel und faellt mit den Seiten.
	if _, err := tx.Exec(`DELETE FROM chunks_fts WHERE chunk_id IN
		(SELECT id FROM page_chunks WHERE workspace_id = ?)`, wsID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM page_chunks WHERE workspace_id = ?`, wsID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM pages WHERE workspace_id = ?`, wsID); err != nil {
		return err
	}
	tx.Exec(`DELETE FROM invites WHERE workspace_id = ?`, wsID)
	if _, err := tx.Exec(`DELETE FROM workspaces WHERE id = ?`, wsID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	// Offene Editoren: wer die Seite gerade auf hat, tippt sonst weiter ins
	// Leere — die yjs-Schreibvorgänge scheitern am Fremdschlüssel, der Fehler
	// wird nur geloggt, und der Mensch merkt nichts, bis er neu lädt.
	for _, pid := range pageIDs {
		s.collab.reset(pid)
	}
	s.removeUnreferencedFiles(refs)
	s.pagesChanged()
	return nil
}

// removeUnreferencedFiles löscht Uploads, auf die keine Seite mehr zeigt.
//
// Erst NACH dem Commit: solange die Zeilen noch da sind, wäre jede Datei noch
// referenziert. Und nur, wenn wirklich niemand mehr darauf zeigt — dieselbe
// Datei kann in einer Kopie oder einer verschobenen Seite weiterleben, und ein
// fehlendes Bild in einem fremden Workspace wäre schlimmer als ein Rest auf
// der Platte.
func (s *Server) removeUnreferencedFiles(refs map[string]bool) {
	for name := range refs {
		// Kein Pfadanteil: der Name kommt aus Seiteninhalt und ist damit vom
		// Nutzer beeinflussbar. filepath.Base allein genügt nicht gegen "..",
		// deshalb zusätzlich hart ablehnen.
		if name == "" || strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
			continue
		}
		like := "%/files/" + name + "%"
		var used int
		s.db.QueryRow(`SELECT COUNT(*) FROM pages
			WHERE content LIKE ? OR props LIKE ? OR cover LIKE ?`, like, like, like).Scan(&used)
		if used > 0 {
			continue
		}
		// Nicht nur der AKTUELLE Inhalt zählt. Eine Revision lässt sich
		// wiederherstellen (history.go schreibt sie 1:1 zurück), ein Kommentar
		// kann auf die Datei verlinken, und ein Profilbild liegt im selben
		// Verzeichnis. Ohne diese drei Abfragen hinterließ das Aufräumen ein
		// totes Bild in einer wiederherstellbaren Fassung einer FREMDEN Seite.
		var elsewhere int
		s.db.QueryRow(`SELECT
			(SELECT COUNT(*) FROM page_revisions WHERE content LIKE ?) +
			(SELECT COUNT(*) FROM comments WHERE body LIKE ?) +
			(SELECT COUNT(*) FROM workspaces WHERE image LIKE ?) +
			(SELECT COUNT(*) FROM users WHERE avatar LIKE ?)`,
			like, like, like, like).Scan(&elsewhere)
		if elsewhere > 0 {
			continue
		}
		if err := os.Remove(filepath.Join(s.dataDir, "files", name)); err != nil && !os.IsNotExist(err) {
			log.Printf("remove upload %s: %v", name, err)
		}
	}
}

// deletionImpact beschreibt, was das Löschen eines Kontos nach sich zieht.
type deletionImpact struct {
	UserName string `json:"userName"`
	// Personal: Bereiche, die mit dem Konto verschwinden.
	Personal []impactWorkspace `json:"personal"`
	// Orphaned: geteilte Workspaces, in denen niemand sonst Admin ist — sie
	// werden übergeben, nicht gelöscht.
	Orphaned []impactWorkspace `json:"orphaned"`
	// Shared: persönliche Bereiche, in die das Konto ANDERE eingeladen hat. Sie
	// werden nicht vernichtet — dort liegt fremde Arbeit. Sie werden zu
	// gewöhnlichen Workspaces und gehen an die verbliebenen Mitglieder; die
	// privaten Seiten des gelöschten Kontos verschwinden trotzdem.
	Shared []impactWorkspace `json:"shared"`
	// Pages: Seiten, die dem Konto gehören und in GETEILTEN Workspaces liegen.
	// Sie bleiben stehen; ihre privaten sind danach nur noch für
	// Workspace-Admins lesbar.
	Pages int `json:"pages"`
	// Err: die Bestandsaufnahme ist gescheitert. Dann darf NICHTS ausgeführt
	// werden — ein leerer Plan sähe aus wie "es hängt nichts dran".
	Err error `json:"-"`
}

type impactWorkspace struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Pages   int    `json:"pages"`
	Members int    `json:"members"`
	// Heir: wer den Workspace übernimmt (leer = der Instanz-Owner).
	Heir string `json:"heir,omitempty"`
}

// deletionImpactOf sammelt die Folgen, ohne etwas zu ändern.
func (s *Server) deletionImpactOf(userID string) deletionImpact {
	out := deletionImpact{Personal: []impactWorkspace{}, Orphaned: []impactWorkspace{}, Shared: []impactWorkspace{}}
	if u := s.userByID(userID); u != nil {
		out.UserName = u.Name
	}
	rows, err := s.db.Query(`
		SELECT w.id, w.name, CASE WHEN w.is_personal = 1 AND w.owner_id = ? THEN 1 ELSE 0 END,
		       CASE WHEN w.is_personal = 1 AND w.owner_id != ? THEN 1 ELSE 0 END,
		       (SELECT COUNT(*) FROM pages p WHERE p.workspace_id = w.id AND p.trashed_at IS NULL),
		       (SELECT COUNT(*) FROM workspace_members m2 WHERE m2.workspace_id = w.id)
		FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
		WHERE m.user_id = ? ORDER BY w.created_at`, userID, userID, userID)
	if err != nil {
		// Still zurückzugeben hieße: kein Purge, keine Übergabe, und das Konto
		// wird trotzdem gelöscht — genau der verwaiste Zustand, den W105
		// abschafft. Der Aufrufer erfährt es über Err.
		log.Printf("deletionImpactOf %s: %v", userID, err)
		out.Err = err
		return out
	}
	type row struct {
		id, name        string
		personal        int
		foreignPersonal int
		pages, members  int
	}
	var all []row
	for rows.Next() {
		var x row
		if rows.Scan(&x.id, &x.name, &x.personal, &x.foreignPersonal, &x.pages, &x.members) == nil {
			all = append(all, x)
		}
	}
	rows.Close() // erst leeren, dann weiter abfragen (eine DB-Verbindung)

	for _, x := range all {
		iw := impactWorkspace{ID: x.id, Name: x.name, Pages: x.pages, Members: x.members}
		if x.personal != 0 {
			// Nur wenn wirklich niemand sonst drin ist. Ein persönlicher Bereich
			// darf Gäste haben (sein Mensch lädt sie selbst ein) — und dann liegt
			// dort fremde Arbeit, die ein Kontolöschen nicht mitnehmen darf.
			if x.members <= 1 {
				out.Personal = append(out.Personal, iw)
			} else {
				iw.Heir = s.seniorMemberName(x.id, userID)
				out.Shared = append(out.Shared, iw)
			}
			continue
		}
		// Ein FREMDER persönlicher Bereich, in den das Konto einmal eingeladen
		// wurde: er verschwindet nicht (er gehört jemand anderem) und er wird
		// auch nicht übergeben. Ohne diese Zeile lief er in den Zweig für
		// geteilte Workspaces und landete beim Instanz-Owner, sobald der
		// Eingeladene das letzte verbliebene Mitglied war — der persönliche
		// Bereich eines anderen Menschen, dauerhaft, ohne Notfallzugriff.
		// Die Mitgliedschaft allein fällt beim Löschen per CASCADE weg.
		if x.foreignPersonal != 0 {
			continue
		}
		// Geteilt: gibt es noch einen anderen Admin?
		var heirID, heirName string
		s.db.QueryRow(`SELECT u.id, u.name FROM workspace_members m JOIN users u ON u.id = m.user_id
			WHERE m.workspace_id = ? AND m.role = 'admin' AND m.user_id != ? AND u.disabled = 0
			ORDER BY u.created_at LIMIT 1`, x.id, userID).Scan(&heirID, &heirName)
		if heirID != "" {
			continue // hat einen Nachfolger, keine Folge zu melden
		}
		// Nur wenn NIEMAND sonst mehr Mitglied ist, übernimmt der Owner. Sonst
		// gehört der Workspace weiter denen, die drin sind — fehlt dort ein
		// Verantwortlicher, wird einer von ihnen ernannt. Mit der schwächeren
		// Bedingung hätte das Löschen eines beliebigen Mitglieds gereicht, um
		// den Owner dauerhaft in einen fremden Workspace zu setzen, sobald
		// dessen Admins nur stillgelegt waren.
		if x.members > 1 {
			continue
		}
		iw.Heir = heirName // leer -> Instanz-Owner
		out.Orphaned = append(out.Orphaned, iw)
	}
	s.db.QueryRow(`SELECT COUNT(*) FROM pages p JOIN workspaces w ON w.id = p.workspace_id
		WHERE p.owner_id = ? AND p.trashed_at IS NULL AND w.is_personal = 0`, userID).Scan(&out.Pages)
	return out
}

// handleDeletionImpact zeigt vor dem Löschen, was daran hängt.
func (s *Server) handleDeletionImpact(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if s.userByID(id) == nil {
		httpError(w, 404, "user not found")
		return
	}
	writeJSON(w, s.deletionImpactOf(id))
}

// handleSetUserDisabled legt ein Konto still oder aktiviert es wieder.
func (s *Server) handleSetUserDisabled(w http.ResponseWriter, r *http.Request) {
	me := requestUser(r)
	id := r.PathValue("id")
	var body struct {
		Disabled bool `json:"disabled"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	target := s.userByID(id)
	if target == nil {
		httpError(w, 404, "user not found")
		return
	}
	if id == me.ID {
		httpError(w, 400, "Du kannst dein eigenes Konto nicht stilllegen.")
		return
	}
	// Denselben Schutz wie beim Löschen: ohne Owner steht die Instanz ohne
	// Verantwortlichen da, und die Rolle ist über die App nicht neu vergebbar.
	if body.Disabled && s.isOwner(id) {
		httpError(w, 400, "Der Owner kann nicht stillgelegt werden — übertrage die Owner-Rolle zuerst.")
		return
	}
	v := 0
	action := "enable_user"
	if body.Disabled {
		v = 1
		action = "disable_user"
	}
	if _, err := s.db.Exec(`UPDATE users SET disabled = ? WHERE id = ?`, v, id); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	if body.Disabled {
		// Ein stillgelegtes Konto darf nicht weiterlaufen, nur weil es schon
		// angemeldet war. Sitzungen und Token enden sofort.
		s.db.Exec(`DELETE FROM sessions WHERE user_id = ?`, id)
		s.db.Exec(`DELETE FROM api_tokens WHERE user_id = ?`, id)
		// Der Kalender-Abo-Link liegt nicht in api_tokens, sondern als
		// app_settings-Zeile — er haette sonst unbefristet weiter alle Termine
		// und Datenbanken der Workspaces ausgeliefert, ohne Anmeldung.
		s.db.Exec(`DELETE FROM app_settings WHERE key = ?`, "ics_token_"+id)
		// Und der offene Editor: der Collab-Socket wird nur beim Verbinden
		// geprüft. Ohne das hier schrieb ein gerade stillgelegtes Konto in einem
		// offenen Tab munter weiter — die Sperre hätte erst beim nächsten Laden
		// gewirkt.
		s.collab.dropUser(id)
	}
	s.audit("human", me.ID, me.Name, action, "", "", target.Name)
	writeJSON(w, s.userByID(id))
}

// seniorMemberName nennt das dienstälteste aktive Mitglied außer dem Genannten.
func (s *Server) seniorMemberName(wsID, exceptUser string) string {
	var name string
	s.db.QueryRow(`SELECT u.name FROM workspace_members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = ? AND m.user_id != ? AND u.disabled = 0
		ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.created_at
		LIMIT 1`, wsID, exceptUser).Scan(&name)
	return name
}

// applyDeletion führt aus, was deletionImpactOf ermittelt hat.
//
// Läuft NACH dem DELETE auf users, mit dem vorher aufgenommenen Plan: das
// Konto ist dann sicher weg, und schlägt hier etwas fehl, bleibt schlimmstenfalls
// ein Workspace ohne Verantwortlichen zurück — den die Aufräum-Ansicht zeigt.
// Andersherum (erst vernichten, dann löschen) wäre der schlechteste Ausgang
// gewesen: Inhalte unwiederbringlich weg, Konto weiter angemeldet.
func (s *Server) applyDeletion(impact deletionImpact, userID, actorID, actorName string) {
	// Persönliche Bereiche gehen mit dem Menschen. Der Inhalt hängt per
	// ON DELETE CASCADE an der Workspace-Zeile.
	for _, ws := range impact.Personal {
		if err := s.purgeWorkspace(ws.ID); err != nil {
			log.Printf("purge personal workspace %s: %v", ws.ID, err)
			continue
		}
		// Protokoll erst NACH der Tat — sonst behauptet die Zeile eine Löschung,
		// die nicht stattgefunden hat. Ohne Workspace-Bezug, weil es ihn nicht
		// mehr gibt und Einträge zu verschwundenen Workspaces sonst deren
		// Seitentitel offenlegen würden.
		s.audit("human", actorID, actorName, "delete_workspace", "", "",
			fmt.Sprintf("%s (persönlicher Bereich von %s, %d Seiten)", ws.Name, impact.UserName, ws.Pages))
	}

	// Persönliche Bereiche MIT Gästen: dort liegt fremde Arbeit. Sie werden zu
	// gewöhnlichen Workspaces und bleiben bei denen, die drin sind. Die PRIVATEN
	// Seiten des gelöschten Kontos verschwinden trotzdem — sie waren für die
	// Gäste nie sichtbar, und über den Umweg "Workspace-Admin sieht alles"
	// würden sie es sonst plötzlich.
	for _, ws := range impact.Shared {
		if _, err := s.db.Exec(`DELETE FROM pages_fts WHERE id IN
			(SELECT id FROM pages WHERE workspace_id = ? AND owner_id = ? AND visibility = 'private')`, ws.ID, userID); err != nil {
			log.Printf("shared personal %s: fts: %v", ws.ID, err)
		}
		if _, err := s.db.Exec(`DELETE FROM pages WHERE workspace_id = ? AND owner_id = ? AND visibility = 'private'`, ws.ID, userID); err != nil {
			log.Printf("shared personal %s: private pages: %v", ws.ID, err)
		}
		if _, err := s.db.Exec(`UPDATE workspaces SET is_personal = 0 WHERE id = ?`, ws.ID); err != nil {
			log.Printf("shared personal %s: flag: %v", ws.ID, err)
		}
		// Wer übernimmt: dienstältestes aktives Mitglied, notfalls der Owner.
		var heir string
		s.db.QueryRow(`SELECT m.user_id FROM workspace_members m JOIN users u ON u.id = m.user_id
			WHERE m.workspace_id = ? AND m.user_id != ? AND u.disabled = 0
			ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.created_at
			LIMIT 1`, ws.ID, userID).Scan(&heir)
		if heir != "" {
			s.db.Exec(`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ? AND user_id = ?`, ws.ID, heir)
			s.db.Exec(`UPDATE workspaces SET owner_id = ? WHERE id = ?`, heir, ws.ID)
		}
		s.audit("human", actorID, actorName, "workspace_handover", "", ws.ID,
			fmt.Sprintf("%s (war persönlicher Bereich von %s, hat weitere Mitglieder)", ws.Name, impact.UserName))
	}

	// Geteilte ohne verbleibenden Admin: der Instanz-Owner übernimmt. Ein
	// Workspace ohne Verantwortlichen wäre für niemanden mehr sichtbar, seine
	// Seiten lägen aber weiter in der Datenbank.
	var ownerID string
	s.db.QueryRow(`SELECT user_id FROM org_members WHERE org_id = ? AND role = ?`, s.defaultOrg(), roleOwner).Scan(&ownerID)
	for _, ws := range impact.Orphaned {
		if ownerID == "" || ownerID == userID {
			continue
		}
		s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')
			ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = 'admin'`, ws.ID, ownerID)
		s.db.Exec(`UPDATE workspaces SET owner_id = ? WHERE id = ?`, ownerID, ws.ID)
		s.audit("human", actorID, actorName, "workspace_handover", "", ws.ID,
			fmt.Sprintf("%s übernommen (vorher %s)", ws.Name, impact.UserName))
	}

	// Alle übrigen: Eigentümer war der Gelöschte, aber es gibt noch Admins —
	// der dienstälteste erbt, damit owner_id nicht ins Leere zeigt.
	//
	// is_personal = 0: ein persönlicher Bereich, dessen Löschung oben scheiterte,
	// darf hier nicht hintenherum an den nächsten Admin oder den Instanz-Owner
	// wandern — genau das "still an den Chef weiterreichen", das dieses Modul
	// ausschließt. Er bleibt liegen und taucht in der Aufräum-Ansicht auf.
	rows, err := s.db.Query(`SELECT id FROM workspaces WHERE owner_id = ? AND is_personal = 0`, userID)
	if err != nil {
		return
	}
	var stillOwned []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			stillOwned = append(stillOwned, id)
		}
	}
	rows.Close()
	for _, wsID := range stillOwned {
		var heir string
		s.db.QueryRow(`SELECT m.user_id FROM workspace_members m JOIN users u ON u.id = m.user_id
			WHERE m.workspace_id = ? AND m.role = 'admin' AND m.user_id != ? AND u.disabled = 0
			ORDER BY u.created_at LIMIT 1`, wsID, userID).Scan(&heir)
		if heir == "" {
			heir = ownerID
		}
		if heir != "" && heir != userID {
			s.db.Exec(`UPDATE workspaces SET owner_id = ? WHERE id = ?`, heir, wsID)
		}
	}
}

// ---- Aufräumen: Workspaces ohne Verantwortlichen -------------------------

type strandedWorkspace struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Owner   string `json:"owner"`
	Members int    `json:"members"`
	Admins  int    `json:"admins"`
	Pages   int    `json:"pages"`
	// Adoptable: wirklich niemand mehr da. Bei "Mitglieder ohne Admin" ist der
	// richtige Weg, einen von ihnen zu ernennen — nicht selbst einzuziehen.
	Adoptable bool `json:"adoptable"`
	// Deletable: aufraeumen geht auch bei einem verwaisten PERSOENLICHEN Bereich
	// — das ist genau der Rest, der vor W105 beim Loeschen eines Kontos entstand.
	// Uebernehmen (und damit lesen) waere dort das Falsche, wegwerfen nicht.
	Deletable bool `json:"deletable"`
	Personal  bool `json:"personal"`
}

// handleStrandedWorkspaces listet Workspaces, um die sich niemand mehr kümmern
// kann: ohne Mitglied oder ohne Admin. Solche Reste konnten vor W105 entstehen
// (Konto gelöscht) und waren in keiner Oberfläche mehr zu sehen.
func (s *Server) handleStrandedWorkspaces(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT w.id, w.name, COALESCE(u.name, ''), w.is_personal,
		       (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id),
		       (SELECT COUNT(*) FROM workspace_members m JOIN users mu ON mu.id = m.user_id
		         WHERE m.workspace_id = w.id AND m.role = 'admin' AND mu.disabled = 0),
		       (SELECT COUNT(*) FROM pages p WHERE p.workspace_id = w.id AND p.trashed_at IS NULL)
		FROM workspaces w LEFT JOIN users u ON u.id = w.owner_id
		ORDER BY w.created_at`)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	defer rows.Close()
	list := []strandedWorkspace{}
	for rows.Next() {
		var x strandedWorkspace
		var personal int
		if rows.Scan(&x.ID, &x.Name, &x.Owner, &personal, &x.Members, &x.Admins, &x.Pages) != nil {
			continue
		}
		x.Personal = personal != 0
		// Ein persönlicher Bereich, in dem sein Mensch noch drinsteht, ist kein
		// herrenloser Rest — auch wenn das Konto stillgelegt ist und deshalb
		// kein AKTIVER Admin gezählt wird. Ohne diese Zeile stand nach jedem
		// Stilllegen ein Eintrag in der Liste, für den es keinen Knopf und
		// keinen gangbaren Rat gab: der einzige Vorschlag ("ernenne einen der
		// Mitglieder zum Admin") ist bei persönlichen Bereichen gesperrt.
		// Stilllegen ist der Normalfall beim Offboarding — die Liste wäre
		// dauerhaft zugerauscht und ein echt herrenloser Workspace darin
		// untergegangen.
		if x.Personal && x.Members > 0 {
			continue
		}
		if x.Members > 0 && x.Admins > 0 {
			continue
		}
		x.Adoptable = x.Members == 0 && !x.Personal
		x.Deletable = x.Members == 0
		list = append(list, x)
	}
	writeJSON(w, list)
}

// handleAdoptWorkspace macht den Owner zum Admin eines herrenlosen Workspace.
// Nur für solche ohne Verantwortlichen — sonst wäre es die Selbstzuweisung, die
// W101 ausdrücklich abgeschafft hat (dafür gibt es den Notfallzugriff).
func (s *Server) handleAdoptWorkspace(w http.ResponseWriter, r *http.Request) {
	me := requestUser(r)
	wsID := r.PathValue("id")
	var name string
	if s.db.QueryRow(`SELECT name FROM workspaces WHERE id = ?`, wsID).Scan(&name) != nil {
		httpError(w, 404, "workspace not found")
		return
	}
	// Bedingung ist "kein Mitglied mehr", nicht "kein AKTIVER Admin".
	//
	// Mit der schwächeren Bedingung wäre das hier ein Generalschlüssel gewesen:
	// ein stillgelegtes Konto zählt nicht mehr als Admin, also hätte
	// "stilllegen, dann adoptieren" jeden fremden Bereich geöffnet — dauerhaft,
	// wo der Notfallzugriff nur befristet und für die Betroffenen sichtbar ist.
	// Solange jemand Mitglied ist, gehört der Workspace diesen Menschen; fehlt
	// dort ein Verantwortlicher, ernennt der Owner einen aus ihrer Mitte
	// (Nutzerverwaltung), statt selbst einzuziehen.
	var members, personal int
	s.db.QueryRow(`SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?`, wsID).Scan(&members)
	s.db.QueryRow(`SELECT is_personal FROM workspaces WHERE id = ?`, wsID).Scan(&personal)
	if members > 0 {
		httpError(w, 400, "Dieser Workspace hat noch Mitglieder. Fehlt ein Verantwortlicher, ernenne einen von ihnen in der Nutzerverwaltung — für bloße Einsicht gibt es den Notfallzugriff.")
		return
	}
	if personal != 0 {
		httpError(w, 400, "Ein persönlicher Bereich wird nicht übernommen — er gehört zu einem Konto.")
		return
	}
	if _, err := s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')
		ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = 'admin'`, wsID, me.ID); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	s.db.Exec(`UPDATE workspaces SET owner_id = ? WHERE id = ? AND owner_id = ''`, me.ID, wsID)
	s.audit("human", me.ID, me.Name, "workspace_adopted", "", wsID, name)
	writeJSON(w, map[string]any{"ok": true, "name": name})
}

// handleDeleteStrandedWorkspace entfernt einen herrenlosen Workspace samt
// Inhalt. Verlangt den Namen als Bestätigung, wie beim normalen Löschen.
func (s *Server) handleDeleteStrandedWorkspace(w http.ResponseWriter, r *http.Request) {
	me := requestUser(r)
	wsID := r.PathValue("id")
	var body struct {
		Confirm string `json:"confirm"`
	}
	decodeJSON(w, r, &body)
	var name string
	if s.db.QueryRow(`SELECT name FROM workspaces WHERE id = ?`, wsID).Scan(&name) != nil {
		httpError(w, 404, "workspace not found")
		return
	}
	var members int
	s.db.QueryRow(`SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?`, wsID).Scan(&members)
	if members > 0 {
		httpError(w, 400, "Dieser Workspace hat noch Mitglieder — er lässt sich nur von innen löschen.")
		return
	}
	if strings.TrimSpace(body.Confirm) != name {
		httpError(w, 400, "confirmation does not match the workspace name")
		return
	}
	if err := s.purgeWorkspace(wsID); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	s.audit("human", me.ID, me.Name, "delete_workspace", "", "", name+" (herrenlos)")
	s.pagesChanged()
	writeJSON(w, map[string]bool{"ok": true})
}
