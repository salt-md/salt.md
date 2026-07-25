package server

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// Rechtemodell (W101).
//
// Vier Stufen, von außen nach innen:
//
//	Owner            betreibt die Instanz. Hat ohnehin Zugriff auf die
//	                 SQLite-Datei — das ist die ehrliche Grenze. In der App
//	                 heißt das: Instanzkonfiguration, Konten-Lebenszyklus
//	                 (inkl. Passwort-Reset) und Notfallzugriff (break_glass),
//	                 aber jede dieser Handlungen hinterlässt eine Spur.
//	Admin            verwaltet Menschen, nicht Inhalte. Konten anlegen und
//	                 pflegen, einladen, Nutzerliste. Ausdrücklich NICHT:
//	                 fremde Passwörter setzen, sich in fremde Workspaces
//	                 eintragen, fremde Workspaces exportieren. Ohne diese drei
//	                 Verbote wäre die Grenze Theater — wer ein Passwort setzen
//	                 kann, kann sich anmelden und alles lesen.
//	Workspace-Admin  alles im eigenen Workspace, nichts außerhalb.
//	Mitglied/Betrachter
//
// Die Rollen liegen in org_members — bewusst als Spiegel von
// workspace_members. Heute existiert genau eine Organisation (diese Instanz);
// wird daraus eine gehostete Mehrmandanten-Version, ist org_id bereits die
// Schranke.

const (
	roleOwner  = "owner"
	roleAdmin  = "admin"
	roleMember = "member"

	// breakGlassTTL: lang genug für eine Prüfung, kurz genug, dass ein
	// vergessener Zugriff nicht zum Dauerzustand wird.
	breakGlassTTL = 2 * time.Hour
)

// tsFixed ist RFC3339 mit IMMER neun Nachkommastellen. now() nutzt
// RFC3339Nano, das nachlaufende Nullen abschneidet — dadurch ist ein kuerzerer
// Zeitstempel Praefix eines laengeren, und beim Stringvergleich in SQL gewinnt
// faelschlich das 'Z' (90) gegen jede Ziffer (48-57). Ein abgelaufener
// Notfallzugriff koennte so kurz weitergelten. Feste Breite heisst:
// lexikografisch == chronologisch.
const tsFixed = "2006-01-02T15:04:05.000000000Z07:00"

func nowFixed() string { return time.Now().UTC().Format(tsFixed) }

// headerSafe entfernt Zeilenumbrueche aus einem Mail-Kopfzeilenwert.
func headerSafe(v string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(v)
}

// defaultOrg liefert die (heute einzige) Organisation. Der Wert ändert sich
// zur Laufzeit nicht, wird aber bewusst nicht global gecacht: der Aufruf ist
// billig, und ein Cache wäre die erste Stelle, die bei Mehrmandantenfähigkeit
// falsch würde.
func (s *Server) defaultOrg() string {
	var id string
	s.db.QueryRow(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`).Scan(&id)
	return id
}

// migrateOrg legt die Organisation an und leitet die Rollen aus dem Bestand
// ab. Idempotent: läuft bei jedem Start, ändert nach dem ersten Mal nichts.
func (s *Server) migrateOrg() error {
	var userCount int
	s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&userCount)
	if userCount == 0 {
		// Frische Installation: handleSetup legt Organisation und Owner an.
		return nil
	}
	orgID := s.defaultOrg()
	if orgID == "" {
		orgID = newID()
		name := s.setting("instance_name", "")
		if strings.TrimSpace(name) == "" {
			name = "Salt.md"
		}
		if _, err := s.db.Exec(`INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)`,
			orgID, name, now()); err != nil {
			return fmt.Errorf("create organization: %w", err)
		}
	}
	// Gibt es bereits einen Owner, bleibt er es — die Wahl unten greift nur,
	// solange keiner existiert.
	var existingOwner string
	s.db.QueryRow(`SELECT user_id FROM org_members WHERE org_id = ? AND role = ?`, orgID, roleOwner).Scan(&existingOwner)

	// Der dienstälteste Admin wird Owner — er hat die Instanz aufgesetzt.
	// Gibt es keinen Admin (sollte nicht vorkommen), fällt es auf den
	// dienstältesten Nutzer zurück, damit die Instanz nie ownerlos ist.
	var ownerID string
	s.db.QueryRow(`SELECT id FROM users WHERE is_admin = 1 ORDER BY created_at LIMIT 1`).Scan(&ownerID)
	if ownerID == "" {
		s.db.QueryRow(`SELECT id FROM users ORDER BY created_at LIMIT 1`).Scan(&ownerID)
	}
	rows, err := s.db.Query(`SELECT id, is_admin FROM users`)
	if err != nil {
		return err
	}
	type u struct {
		id    string
		admin int
	}
	var users []u
	for rows.Next() {
		var x u
		if rows.Scan(&x.id, &x.admin) == nil {
			users = append(users, x)
		}
	}
	rows.Close()
	for _, x := range users {
		role := roleMember
		if x.admin != 0 {
			role = roleAdmin
		}
		if x.id == ownerID && existingOwner == "" {
			role = roleOwner
		}
		// ON CONFLICT DO NOTHING: eine später von Hand vergebene Rolle darf ein
		// Neustart nicht wieder überschreiben.
		s.db.Exec(`INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
			orgID, x.id, role)
	}
	// Nachwahl: hat die Instanz keinen Owner (etwa weil das Konto außerhalb der
	// App entfernt wurde), wird der dienstälteste Admin dazu befördert — sonst
	// bliebe sie ohne Verantwortlichen, und die Rolle ist über die App nirgends
	// vergebbar. Das UPDATE ist nötig, weil sein DO-NOTHING-Insert oben an der
	// vorhandenen admin-Zeile abprallt.
	if existingOwner == "" && ownerID != "" {
		s.db.Exec(`UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?`, roleOwner, orgID, ownerID)
	}
	// Workspaces ohne Eigentümer: der dienstälteste Workspace-Admin übernimmt,
	// ersatzweise der Instanz-Owner. Ein Workspace ohne Eigentümer wäre genau
	// der herrenlose Zustand, den W101 abschafft.
	wsRows, err := s.db.Query(`SELECT id FROM workspaces WHERE owner_id = ''`)
	if err != nil {
		return err
	}
	var wsIDs []string
	for wsRows.Next() {
		var id string
		if wsRows.Scan(&id) == nil {
			wsIDs = append(wsIDs, id)
		}
	}
	wsRows.Close()
	for _, wsID := range wsIDs {
		var owner string
		s.db.QueryRow(`SELECT m.user_id FROM workspace_members m
			JOIN users u ON u.id = m.user_id
			WHERE m.workspace_id = ? AND m.role = 'admin'
			ORDER BY u.created_at LIMIT 1`, wsID).Scan(&owner)
		if owner == "" {
			owner = ownerID
		}
		if owner != "" {
			s.db.Exec(`UPDATE workspaces SET owner_id = ? WHERE id = ?`, owner, wsID)
		}
	}
	return nil
}

// orgRole liefert die Instanzrolle: owner | admin | member (leer = unbekannt).
func (s *Server) orgRole(userID string) string {
	var role string
	// Mit org_id, obwohl es heute nur eine Organisation gibt: der
	// Primaerschluessel ist (org_id, user_id), ein Nutzer kann also mehrere
	// Zeilen haben. Ohne die Bedingung waehlte QueryRow eine beliebige davon —
	// und genau diese Schranke soll spaeter die Mandanten trennen.
	s.db.QueryRow(`SELECT role FROM org_members WHERE org_id = ? AND user_id = ?`, s.defaultOrg(), userID).Scan(&role)
	if role == "" {
		// Fallback für Konten, die vor der Migration angelegt wurden oder deren
		// Zeile fehlt: die alte is_admin-Spalte entscheidet. Nie mehr Rechte
		// als vorher, nur nie weniger.
		if u := s.userByID(userID); u != nil && u.IsAdmin {
			return roleAdmin
		}
		return roleMember
	}
	return role
}

func (s *Server) isOwner(userID string) bool { return s.orgRole(userID) == roleOwner }

// addOrgMember trägt ein frisch angelegtes Konto in die Organisation ein.
// Ohne die Zeile griffe zwar der is_admin-Rückfall in orgRole, aber die
// Tabelle bliebe lückenhaft — und genau sie ist später die Mandantenschranke.
func (s *Server) addOrgMember(userID string, isAdmin bool) {
	role := roleMember
	if isAdmin {
		role = roleAdmin
	}
	if org := s.defaultOrg(); org != "" {
		s.db.Exec(`INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, org, userID, role)
	}
}

// ownerOnly bewacht Endpunkte, die nur dem Instanz-Owner offenstehen.
func (s *Server) ownerOnly(next http.HandlerFunc) http.HandlerFunc {
	return s.auth(func(w http.ResponseWriter, r *http.Request) {
		if !s.isOwner(requestUser(r).ID) {
			httpError(w, http.StatusForbidden, "owner only")
			return
		}
		next(w, r)
	})
}

// ---- Notfallzugriff -------------------------------------------------------

// hasBreakGlass meldet einen gültigen, unwiderrufenen Notfallzugriff.
func (s *Server) hasBreakGlass(userID, workspaceID string) bool {
	if userID == "" || workspaceID == "" {
		return false
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM break_glass
		WHERE user_id = ? AND workspace_id = ? AND revoked_at IS NULL AND expires_at > ?`,
		userID, workspaceID, nowFixed()).Scan(&n)
	return n > 0
}

// handleBreakGlass verschafft einem Owner befristeten LESE-Zugriff auf einen
// Workspace, dem er nicht angehört — mit Begründung, im Protokoll, und für die
// Verantwortlichen des Workspace sichtbar. Schreiben bleibt echten Mitgliedern
// vorbehalten: der Zweck ist Einsicht (Prüfung, verwaister Workspace), nicht
// Mitarbeit.
func (s *Server) handleBreakGlass(w http.ResponseWriter, r *http.Request) {
	u := requestUser(r)
	wsID := r.PathValue("id")
	var body struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	reason := strings.TrimSpace(body.Reason)
	// Ohne nachvollziehbaren Grund kein Zugriff — das ist der ganze Unterschied
	// zwischen Notfallzugriff und stiller Hintertür.
	if len([]rune(reason)) < 10 {
		httpError(w, 400, "Bitte einen nachvollziehbaren Grund angeben (mindestens 10 Zeichen) — er wird protokolliert und den Verantwortlichen des Workspace angezeigt.")
		return
	}
	if len([]rune(reason)) > 500 {
		reason = string([]rune(reason)[:500])
	}
	var wsName string
	if s.db.QueryRow(`SELECT name FROM workspaces WHERE id = ?`, wsID).Scan(&wsName) != nil {
		httpError(w, 404, "workspace not found")
		return
	}
	if s.isMember(u.ID, wsID) {
		httpError(w, 400, "Du bist bereits Mitglied dieses Workspace — ein Notfallzugriff ist nicht nötig.")
		return
	}
	expires := time.Now().UTC().Add(breakGlassTTL).Format(tsFixed)
	if _, err := s.db.Exec(`INSERT INTO break_glass (id, workspace_id, user_id, reason, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		newID(), wsID, u.ID, reason, now(), expires); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	s.audit("human", u.ID, u.Name, "break_glass", "", wsID, wsName+" — "+reason)
	// Nebenlaeufig: der Versand spricht pro Empfaenger SMTP, sonst haengt die
	// Antwort am Timeout eines nicht erreichbaren Mailservers.
	go s.notifyWorkspaceAdmins(wsID, wsName, u.Name, reason)
	writeJSON(w, map[string]any{"ok": true, "expiresAt": expires, "workspace": wsName})
}

// notifyWorkspaceAdmins informiert die Verantwortlichen per Mail. Schlägt der
// Versand fehl (kein SMTP eingerichtet), bleibt der Protokolleintrag — der
// Zugriff ist trotzdem nachvollziehbar, nur eben nicht zugestellt.
func (s *Server) notifyWorkspaceAdmins(wsID, wsName, actor, reason string) {
	rows, err := s.db.Query(`SELECT u.email FROM workspace_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = ? AND m.role = 'admin'`, wsID)
	if err != nil {
		return
	}
	var mails []string
	for rows.Next() {
		var e string
		if rows.Scan(&e) == nil && e != "" {
			mails = append(mails, e)
		}
	}
	rows.Close()
	body := fmt.Sprintf(
		"%s hat sich als Instanz-Owner befristeten Lesezugriff auf den Workspace %q verschafft.\n\nBegründung:\n%s\n\nDer Zugriff endet automatisch nach 2 Stunden und ist im Aktivitätsprotokoll festgehalten.",
		actor, wsName, reason)
	for _, to := range mails {
		if err := s.sendMail(to, "Notfallzugriff auf "+wsName, body); err != nil {
			log.Printf("break-glass notice to %s: %v", to, err)
		}
	}
}

// handleListBreakGlass zeigt die Notfallzugriffe eines Workspace — für dessen
// Verantwortliche und für Owner. Zugriff, den man nicht nachlesen kann, ist
// kein kontrollierter Zugriff.
func (s *Server) handleListBreakGlass(w http.ResponseWriter, r *http.Request) {
	u := requestUser(r)
	wsID := r.PathValue("id")
	if !s.isWorkspaceAdmin(u.ID, wsID) && !s.isOwner(u.ID) {
		httpError(w, 403, "workspace admin or owner only")
		return
	}
	rows, err := s.db.Query(`SELECT b.id, u.name, b.reason, b.created_at, b.expires_at, b.revoked_at
		FROM break_glass b JOIN users u ON u.id = b.user_id
		WHERE b.workspace_id = ? ORDER BY b.created_at DESC LIMIT 50`, wsID)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	defer rows.Close()
	type entry struct {
		ID        string  `json:"id"`
		User      string  `json:"user"`
		Reason    string  `json:"reason"`
		CreatedAt string  `json:"createdAt"`
		ExpiresAt string  `json:"expiresAt"`
		RevokedAt *string `json:"revokedAt"`
		Active    bool    `json:"active"`
	}
	list := []entry{}
	nowStr := nowFixed()
	for rows.Next() {
		var e entry
		if rows.Scan(&e.ID, &e.User, &e.Reason, &e.CreatedAt, &e.ExpiresAt, &e.RevokedAt) == nil {
			e.Active = e.RevokedAt == nil && e.ExpiresAt > nowStr
			list = append(list, e)
		}
	}
	writeJSON(w, list)
}

// handleRevokeBreakGlass beendet einen laufenden Notfallzugriff sofort. Die
// Verantwortlichen des Workspace können das selbst — sonst wäre die
// Benachrichtigung eine Mitteilung ohne Handhabe.
func (s *Server) handleRevokeBreakGlass(w http.ResponseWriter, r *http.Request) {
	u := requestUser(r)
	wsID := r.PathValue("id")
	if !s.isWorkspaceAdmin(u.ID, wsID) && !s.isOwner(u.ID) {
		httpError(w, 403, "workspace admin or owner only")
		return
	}
	res, err := s.db.Exec(`UPDATE break_glass SET revoked_at = ?
		WHERE workspace_id = ? AND id = ? AND revoked_at IS NULL`, now(), wsID, r.PathValue("grantId"))
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpError(w, 404, "no active grant with that id")
		return
	}
	s.audit("human", u.ID, u.Name, "break_glass_revoked", "", wsID, "")
	writeJSON(w, map[string]bool{"ok": true})
}
