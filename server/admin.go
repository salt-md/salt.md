package server

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

// Instance administration (Welle 21): SMTP config, signup policy (open /
// invite-only / domain-allowlist), deployment info — plus the invite flow and
// domain auto-join that build on them. All settings live in app_settings as
// individual key/value rows so adding one needs no migration.

// ---- settings store ----

func (s *Server) setting(key, fallback string) string {
	var v string
	if s.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, key).Scan(&v) == nil {
		return v
	}
	return fallback
}

func (s *Server) setSetting(key, value string) {
	s.db.Exec(`INSERT INTO app_settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
}

// boolSetting reads a stored flag ("1" = on).
func (s *Server) boolSetting(key string) bool {
	return s.setting(key, "") == "1"
}

// intSetting reads a numeric setting clamped to [min, max]; anything unset or
// unparsable yields the fallback.
func (s *Server) intSetting(key string, fallback, min, max int) int {
	v := s.setting(key, "")
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < min || n > max {
		return fallback
	}
	return n
}

// sessionDays is how long login sessions live (cookie + DB row).
func (s *Server) sessionDays() int {
	return s.intSetting("session_days", 90, 1, 365)
}

// maxUploadBytes is the per-file upload cap.
func (s *Server) maxUploadBytes() int64 {
	return int64(s.intSetting("max_upload_mb", 50, 1, 2048)) << 20
}

// appSettings is the admin-facing view. The SMTP password is never sent back —
// only whether one is set.
type appSettings struct {
	InstanceName    string `json:"instanceName"`
	SignupMode      string `json:"signupMode"`     // invite | open | domain
	AllowedDomains  string `json:"allowedDomains"` // comma-separated, for domain mode
	SMTPHost        string `json:"smtpHost"`
	SMTPPort        string `json:"smtpPort"`
	SMTPUser        string `json:"smtpUser"`
	SMTPFrom        string `json:"smtpFrom"`
	SMTPPassSet     bool   `json:"smtpPassSet"`
	PublicBaseURL   string `json:"publicBaseUrl"`
	TrustProxy      bool   `json:"trustProxy"`
	MaxUploadMB     int    `json:"maxUploadMb"`
	TrashDays       int    `json:"trashDays"`
	SessionDays     int    `json:"sessionDays"`
	HTTPSDomain     string `json:"httpsDomain"`
	HTTPSEnabled    bool   `json:"httpsEnabled"`
	GoogleClientID  string `json:"googleClientId"`
	GoogleSecretSet bool   `json:"googleSecretSet"`
	MSClientID      string `json:"msClientId"`
	MSSecretSet     bool   `json:"msSecretSet"`
	MailProvider    string `json:"mailProvider"`
	MailAddress     string `json:"mailAddress"`
	MailFrom        string `json:"mailFrom"`
	// W97: duerfen Nicht-Admins eigene Workspaces anlegen (und deren Admin
	// werden)? Standard: ja — so war es bisher; der Schalter gibt Kontrolle.
	AllowUserWorkspaces bool `json:"allowUserWorkspaces"`
}

func (s *Server) loadSettings() appSettings {
	res := appSettings{
		InstanceName:        s.setting("instance_name", ""),
		SignupMode:          s.setting("signup_mode", "invite"),
		AllowedDomains:      s.setting("allowed_domains", ""),
		AllowUserWorkspaces: s.setting("allow_user_workspaces", "1") != "0",
		SMTPHost:            s.setting("smtp_host", ""),
		SMTPPort:            s.setting("smtp_port", "587"),
		SMTPUser:            s.setting("smtp_user", ""),
		SMTPFrom:            s.setting("smtp_from", ""),
		SMTPPassSet:         s.setting("smtp_pass", "") != "",
		PublicBaseURL:       s.setting("public_base_url", ""),
		TrustProxy:          s.boolSetting("trust_proxy"),
		MaxUploadMB:         s.intSetting("max_upload_mb", 50, 1, 2048),
		TrashDays:           s.trashRetentionDays(),
		SessionDays:         s.sessionDays(),
		HTTPSDomain:         s.setting("https_domain", ""),
		HTTPSEnabled:        s.boolSetting("https_enabled"),
		GoogleClientID:      s.setting("oauth_google_id", ""),
		GoogleSecretSet:     s.setting("oauth_google_secret", "") != "",
		MSClientID:          s.setting("oauth_ms_id", ""),
		MSSecretSet:         s.setting("oauth_ms_secret", "") != "",
	}
	res.MailProvider, res.MailAddress = s.mailProviderConfigured()
	res.MailFrom = s.setting("mail_from_override", "")
	return res
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	if !requestUser(r).IsAdmin {
		httpError(w, 403, "admin only")
		return
	}
	writeJSON(w, s.loadSettings())
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	if !requestUser(r).IsAdmin {
		httpError(w, 403, "admin only")
		return
	}
	var body struct {
		InstanceName        *string `json:"instanceName"`
		SignupMode          *string `json:"signupMode"`
		AllowedDomains      *string `json:"allowedDomains"`
		SMTPHost            *string `json:"smtpHost"`
		SMTPPort            *string `json:"smtpPort"`
		SMTPUser            *string `json:"smtpUser"`
		SMTPFrom            *string `json:"smtpFrom"`
		SMTPPass            *string `json:"smtpPass"` // "" leaves unchanged; sentinel clears
		PublicBaseURL       *string `json:"publicBaseUrl"`
		TrustProxy          *bool   `json:"trustProxy"`
		MaxUploadMB         *int    `json:"maxUploadMb"`
		TrashDays           *int    `json:"trashDays"`
		SessionDays         *int    `json:"sessionDays"`
		HTTPSDomain         *string `json:"httpsDomain"`
		HTTPSEnabled        *bool   `json:"httpsEnabled"`
		MailFrom            *string `json:"mailFrom"`
		GoogleClientID      *string `json:"googleClientId"`
		GoogleSecret        *string `json:"googleClientSecret"`
		MSClientID          *string `json:"msClientId"`
		MSSecret            *string `json:"msClientSecret"`
		AllowUserWorkspaces *bool   `json:"allowUserWorkspaces"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	set := func(key string, v *string) {
		if v != nil {
			s.setSetting(key, strings.TrimSpace(*v))
		}
	}
	if body.SignupMode != nil {
		mode := *body.SignupMode
		if mode != "open" && mode != "domain" {
			mode = "invite"
		}
		s.setSetting("signup_mode", mode)
	}
	set("instance_name", body.InstanceName)
	set("allowed_domains", body.AllowedDomains)
	set("smtp_host", body.SMTPHost)
	set("smtp_port", body.SMTPPort)
	set("smtp_user", body.SMTPUser)
	set("smtp_from", body.SMTPFrom)
	set("public_base_url", body.PublicBaseURL)
	if body.TrustProxy != nil {
		v := ""
		if *body.TrustProxy {
			v = "1"
		}
		s.setSetting("trust_proxy", v)
	}
	if body.AllowUserWorkspaces != nil {
		// "0" = ausdruecklich aus; sonst erlaubt (Default). Nicht "" schreiben,
		// sonst faellt der Wert auf den Default "1" zurueck.
		v := "1"
		if !*body.AllowUserWorkspaces {
			v = "0"
		}
		s.setSetting("allow_user_workspaces", v)
	}
	set("https_domain", body.HTTPSDomain)
	set("mail_from_override", body.MailFrom)
	set("oauth_google_id", body.GoogleClientID)
	set("oauth_ms_id", body.MSClientID)
	setSecret := func(key string, v *string) {
		if v != nil && *v != "" {
			if *v == "\x00clear" {
				s.setSetting(key, "")
			} else {
				s.setSetting(key, strings.TrimSpace(*v))
			}
		}
	}
	setSecret("oauth_google_secret", body.GoogleSecret)
	setSecret("oauth_ms_secret", body.MSSecret)
	if body.HTTPSEnabled != nil {
		v := ""
		if *body.HTTPSEnabled {
			v = "1"
		}
		s.setSetting("https_enabled", v)
	}
	setInt := func(key string, v *int, min, max int) error {
		if v == nil {
			return nil
		}
		if *v < min || *v > max {
			return fmt.Errorf("%s must be between %d and %d", key, min, max)
		}
		s.setSetting(key, strconv.Itoa(*v))
		return nil
	}
	if err := setInt("max_upload_mb", body.MaxUploadMB, 1, 2048); err != nil {
		httpError(w, 400, err.Error())
		return
	}
	if err := setInt("trash_days", body.TrashDays, 0, 3650); err != nil {
		httpError(w, 400, err.Error())
		return
	}
	if err := setInt("session_days", body.SessionDays, 1, 365); err != nil {
		httpError(w, 400, err.Error())
		return
	}
	if body.SMTPPass != nil && *body.SMTPPass != "" {
		if *body.SMTPPass == "\x00clear" {
			s.setSetting("smtp_pass", "")
		} else {
			s.setSetting("smtp_pass", *body.SMTPPass)
		}
	}
	writeJSON(w, s.loadSettings())
}

// ---- email ----

func (s *Server) baseURL(r *http.Request) string {
	if u := s.setting("public_base_url", ""); u != "" {
		return strings.TrimRight(u, "/")
	}
	proto := "http"
	if isHTTPS(r) {
		proto = "https"
	}
	return proto + "://" + r.Host
}

// publicShareBase returns the best EXTERNAL base URL for user-facing share links
// (public forms, shared pages): an explicit public_base_url wins, else the
// built-in HTTPS domain, else an active Cloudflare tunnel URL, else the
// request's own host. So a share link automatically carries whatever external
// domain is configured — no matter the form (CF tunnel, HTTPS domain, or a
// manually-set base URL) — without the admin pasting it by hand.
// handlePublicBase exposes the resolved external base URL to the frontend so
// user-facing links (MCP connect, …) are built on the public domain instead of
// whatever address the browser happens to use.
func (s *Server) handlePublicBase(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"base": s.publicShareBase(r)})
}

func (s *Server) publicShareBase(r *http.Request) string {
	if u := s.setting("public_base_url", ""); u != "" {
		return strings.TrimRight(u, "/")
	}
	if domain, enabled := s.PublicHTTPSConfig(); enabled && domain != "" {
		return "https://" + strings.TrimRight(domain, "/")
	}
	s.tunnel.mu.Lock()
	turl := s.tunnel.url
	s.tunnel.mu.Unlock()
	if turl != "" {
		return strings.TrimRight(turl, "/")
	}
	proto := "http"
	if isHTTPS(r) {
		proto = "https"
	}
	return proto + "://" + r.Host
}

// sendMail delivers a plain-text message via the configured SMTP server. Returns
// an error if SMTP isn't configured or delivery fails; callers surface the
// invite link regardless so email is a convenience, not a hard dependency.
func (s *Server) sendMail(to, subject, body string) error {
	// Verbundener Google-/Microsoft-Account hat Vorrang vor SMTP.
	if provider, _ := s.mailProviderConfigured(); provider == "google" {
		return s.sendViaGoogle(to, subject, body)
	} else if provider == "microsoft" {
		return s.sendViaMicrosoft(to, subject, body)
	}
	host := s.setting("smtp_host", "")
	if host == "" {
		return fmt.Errorf("Kein Mail-Versand konfiguriert — SMTP eintragen oder Google/Microsoft verbinden.")
	}
	port := s.setting("smtp_port", "587")
	user := s.setting("smtp_user", "")
	pass := s.setting("smtp_pass", "")
	from := s.setting("smtp_from", user)
	if from == "" {
		from = "salt@" + host
	}
	addr := host + ":" + port
	// Kopfzeilen duerfen keine Zeilenumbrueche enthalten: ein Betreff mit
	// "\r\nBcc: ..." wuerde sonst einen zusaetzlichen Empfaenger einschmuggeln
	// oder — mit einer Leerzeile — den ganzen Mailtext ersetzen. Betrifft jeden
	// Betreff, der Nutzereingaben enthaelt (etwa einen Workspace-Namen).
	subject = headerSafe(subject)
	to = headerSafe(to)
	from = headerSafe(from)
	msg := "From: " + from + "\r\nTo: " + to + "\r\nSubject: " + subject +
		"\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body

	var auth smtp.Auth
	if user != "" {
		auth = smtp.PlainAuth("", user, pass, host)
	}
	// Port 465 = implicit TLS; others use STARTTLS via net/smtp.SendMail.
	if port == "465" {
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
		if err != nil {
			return err
		}
		c, err := smtp.NewClient(conn, host)
		if err != nil {
			return err
		}
		defer c.Close()
		if auth != nil {
			if err := c.Auth(auth); err != nil {
				return err
			}
		}
		if err := c.Mail(from); err != nil {
			return err
		}
		if err := c.Rcpt(to); err != nil {
			return err
		}
		wc, err := c.Data()
		if err != nil {
			return err
		}
		if _, err := wc.Write([]byte(msg)); err != nil {
			return err
		}
		wc.Close()
		return c.Quit()
	}
	return smtp.SendMail(addr, auth, from, []string{to}, []byte(msg))
}

// ---- invites ----

func (s *Server) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	u := requestUser(r)
	var body struct {
		Email       string `json:"email"`
		Role        string `json:"role"`
		WorkspaceID string `json:"workspaceId"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	ws := body.WorkspaceID
	if ws == "" {
		ws = s.userDefaultWorkspace(u.ID)
	}
	if !s.isWorkspaceAdmin(u.ID, ws) {
		httpError(w, 403, "workspace admin only")
		return
	}
	b := make([]byte, 18)
	rand.Read(b)
	token := hex.EncodeToString(b)
	expires := time.Now().UTC().AddDate(0, 0, 14).Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`INSERT INTO invites (token_hash, email, role, workspace_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		tokenHash(token), strings.ToLower(strings.TrimSpace(body.Email)), normalizeRole(body.Role), ws, now(), expires); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	// Invitees sit outside the LAN more often than not — public base, not host.
	link := s.publicShareBase(r) + "/invite/" + token
	emailed := false
	if body.Email != "" {
		if err := s.sendMail(body.Email, "Einladung zu Salt.md",
			"Du wurdest zu einem Salt.md-Workspace eingeladen.\n\nÖffne diesen Link, um beizutreten:\n"+link+"\n\nDer Link ist 14 Tage gültig."); err == nil {
			emailed = true
		}
	}
	writeJSON(w, map[string]any{"link": link, "emailed": emailed})
}

// inviteInfo is the public (unauthenticated) preview of an invite.
func (s *Server) handleInviteInfo(w http.ResponseWriter, r *http.Request) {
	var email, ws, expires string
	if s.db.QueryRow(`SELECT email, workspace_id, expires_at FROM invites WHERE token_hash = ?`, tokenHash(r.PathValue("token"))).Scan(&email, &ws, &expires) != nil {
		httpError(w, 404, "invite not found")
		return
	}
	if exp, err := time.Parse(time.RFC3339Nano, expires); err == nil && time.Now().After(exp) {
		httpError(w, 404, "invite expired")
		return
	}
	var wsName string
	s.db.QueryRow(`SELECT name FROM workspaces WHERE id = ?`, ws).Scan(&wsName)
	writeJSON(w, map[string]string{"email": email, "workspace": wsName})
}

// handleAcceptInvite registers a new user (or, if the email already exists and
// matches, just joins them) into the invite's workspace, then logs them in.
func (s *Server) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	var email, role, ws, expires string
	if s.db.QueryRow(`SELECT email, role, workspace_id, expires_at FROM invites WHERE token_hash = ?`, tokenHash(token)).Scan(&email, &role, &ws, &expires) != nil {
		httpError(w, 404, "invite not found")
		return
	}
	if exp, err := time.Parse(time.RFC3339Nano, expires); err == nil && time.Now().After(exp) {
		httpError(w, 404, "invite expired")
		return
	}
	var body struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Code     string `json:"code"` // TOTP, when the existing account has 2FA
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}

	// Already signed in? Then the invite just adds the *current* account to the
	// workspace — the session already proves identity, so no password is asked.
	// A bound invite must still match the signed-in account's address.
	if cur := s.currentUser(r); cur != nil {
		// Auch hier: eine stillgelegte Sitzung tritt keinem Workspace mehr bei.
		// Schwer erreichbar (Stilllegen löscht die Sitzungen), aber es ist die
		// einzige mutierende currentUser-Stelle ohne diese Prüfung.
		if cur.Disabled {
			httpError(w, http.StatusForbidden, "Dieses Konto wurde stillgelegt — wende dich an einen Admin.")
			return
		}
		if email != "" && !strings.EqualFold(email, cur.Email) {
			httpError(w, 403, "this invite is for a different account — sign out to accept it")
			return
		}
		s.joinWorkspace(ws, cur.ID, role)
		s.db.Exec(`DELETE FROM invites WHERE token_hash = ?`, tokenHash(token))
		writeJSON(w, s.userByID(cur.ID))
		return
	}

	useEmail := strings.ToLower(strings.TrimSpace(body.Email))
	if email != "" {
		useEmail = email // invite bound to a specific address
	}

	// Does an account already exist for this address?
	var uid, hash, totpSecret string
	var totpEnabled, disabled int
	err := s.db.QueryRow(`SELECT id, password_hash, totp_secret, totp_enabled, disabled FROM users WHERE email = ?`,
		useEmail).Scan(&uid, &hash, &totpSecret, &totpEnabled, &disabled)
	if err == nil {
		// The account already exists. Joining it and minting a session for it is
		// an AUTHENTICATION event — otherwise anyone with the (shareable, possibly
		// leaked) invite link could log in as an existing user. Require the real
		// password and, if enabled, a valid TOTP code — exactly like handleLogin.
		if !s.loginRate.allow(s.clientIP(r)) {
			httpError(w, http.StatusTooManyRequests, "too many attempts, please wait")
			return
		}
		s.loginSem <- struct{}{}
		defer func() { <-s.loginSem }()
		if !verifyPassword(body.Password, hash) {
			httpError(w, http.StatusUnauthorized, "wrong credentials")
			return
		}
		// Wie bei handleLogin: erst nach der Passwortpruefung ablehnen, damit die
		// Antwort nicht verraet, ob es die Adresse gibt. Ohne das koennte sich ein
		// stillgelegtes Konto ueber einen offenen Einladungslink eine frische
		// Sitzung besorgen.
		if disabled != 0 {
			httpError(w, http.StatusForbidden, "Dieses Konto wurde stillgelegt — wende dich an einen Admin.")
			return
		}
		if totpEnabled != 0 {
			if body.Code == "" {
				httpError(w, http.StatusUnauthorized, "2fa required")
				return
			}
			if !verifyTOTP(totpSecret, body.Code) {
				httpError(w, http.StatusUnauthorized, "invalid 2fa code")
				return
			}
		}
	} else {
		// New account: create it with the supplied credentials.
		if msg := validateAccount(body.Name, useEmail, body.Password); msg != "" {
			httpError(w, 400, msg)
			return
		}
		uid = newID()
		if _, err := s.db.Exec(`INSERT INTO users (id, email, name, color, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`,
			uid, useEmail, strings.TrimSpace(body.Name), s.nextColor(), hashPassword(body.Password), now()); err != nil {
			httpError(w, 500, err.Error())
			return
		}
		s.addOrgMember(uid, false)
		// Auch wer eingeladen wurde, bekommt seinen eigenen Bereich — sonst haengt
		// sein Konto ganz am Wohlwollen des einladenden Teams. Nur bei einem NEUEN
		// Konto: wer schon da ist, hat seinen Bereich laengst.
		s.onboardUser(uid, body.Name)
	}

	s.joinWorkspace(ws, uid, role)
	s.db.Exec(`DELETE FROM invites WHERE token_hash = ?`, tokenHash(token))

	sessTok, err := s.createSession(uid)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	setSessionCookie(w, r, sessTok, s.sessionDays()*24*3600)
	writeJSON(w, s.userByID(uid))
}

// joinWorkspace adds a user to a workspace with the invite's role. If they are
// already a member their existing role is left untouched — accepting an invite
// must never CHANGE (least of all downgrade) an existing member's privileges,
// which also closes the invite-role-rewrite vector from the review.
func (s *Server) joinWorkspace(ws, uid, role string) {
	s.db.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)
		ON CONFLICT(workspace_id, user_id) DO NOTHING`, ws, uid, normalizeRole(role))
}

// domainAllowsSelfSignup reports whether an email may self-register given the
// current signup policy.
//
// Wohin das neue Konto kommt, entscheidet diese Funktion nicht mehr: früher
// lieferte sie den ÄLTESTEN Workspace der Instanz, wer sich also selbst
// registrierte, saß sofort im Hauptbereich samt allen Inhalten. Seit W102
// bekommt jedes Konto seinen eigenen Bereich, und geteilte Workspaces nur, wenn
// der Owner sie ausdrücklich für alle geöffnet hat (siehe onboardUser).
func (s *Server) domainAllowsSelfSignup(email string) bool {
	if s.setting("signup_mode", "invite") != "domain" {
		return false
	}
	at := strings.LastIndexByte(email, '@')
	if at < 0 {
		return false
	}
	domain := strings.ToLower(email[at+1:])
	for _, d := range strings.Split(s.setting("allowed_domains", ""), ",") {
		if strings.ToLower(strings.TrimSpace(d)) == domain && domain != "" {
			return true
		}
	}
	return false
}

// handleSelfSignup registers a user when the instance is open or their email
// domain is allow-listed — no invite needed.
func (s *Server) handleSelfSignup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name, Email, Password string
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	switch s.setting("signup_mode", "invite") {
	case "open":
		// erlaubt
	case "domain":
		if !s.domainAllowsSelfSignup(email) {
			httpError(w, 403, "self-registration is not allowed for this email")
			return
		}
	default:
		httpError(w, 403, "self-registration is disabled — ask an admin for an invite")
		return
	}
	if msg := validateAccount(body.Name, email, body.Password); msg != "" {
		httpError(w, 400, msg)
		return
	}
	var exists int
	if s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE email = ?`, email).Scan(&exists); exists > 0 {
		httpError(w, 409, "an account with this email already exists")
		return
	}
	uid := newID()
	if _, err := s.db.Exec(`INSERT INTO users (id, email, name, color, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`,
		uid, email, strings.TrimSpace(body.Name), s.nextColor(), hashPassword(body.Password), now()); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	s.addOrgMember(uid, false)
	s.onboardUser(uid, body.Name)
	sessTok, err := s.createSession(uid)
	if err != nil {
		httpError(w, 500, err.Error())
		return
	}
	setSessionCookie(w, r, sessTok, s.sessionDays()*24*3600)
	writeJSON(w, s.userByID(uid))
}

// signupPolicy is unauthenticated: tells the login screen whether to show a
// "create account" option.
func (s *Server) handleSignupPolicy(w http.ResponseWriter, r *http.Request) {
	mode := s.setting("signup_mode", "invite")
	g, m := s.oauthEnabled()
	writeJSON(w, map[string]any{
		"mode":           mode,
		"allowedDomains": s.setting("allowed_domains", ""),
		"instanceName":   s.setting("instance_name", ""),
		"oauthGoogle":    g,
		"oauthMicrosoft": m,
	})
}

// ---- two-factor (TOTP) ----

// handle2FASetup generates a fresh secret (not yet active) and returns the
// otpauth URL for a QR code plus the raw secret for manual entry.
func (s *Server) handle2FASetup(w http.ResponseWriter, r *http.Request) {
	u := requestUser(r)
	// Refuse to overwrite an already-active second factor: re-opening the setup
	// screen must not silently flip totp_enabled to 0 and invalidate the working
	// authenticator. The user has to disable it first (which re-verifies a code).
	var enabled int
	s.db.QueryRow(`SELECT totp_enabled FROM users WHERE id = ?`, u.ID).Scan(&enabled)
	if enabled != 0 {
		httpError(w, 409, "2FA is already enabled — disable it first to set up a new device")
		return
	}
	secret := newTOTPSecret()
	if _, err := s.db.Exec(`UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`, secret, u.ID); err != nil {
		httpError(w, 500, err.Error())
		return
	}
	otpauth := otpauthURL(secret, u.Email, "Salt.md")
	// Scannable QR as an inline data URI: authenticator apps expect to scan,
	// and typing a 32-char secret by hand is the step people get wrong.
	// Rendered locally — the secret never leaves the instance.
	qr := ""
	if png, err := qrcode.Encode(otpauth, qrcode.Medium, 320); err == nil {
		qr = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	}
	writeJSON(w, map[string]string{
		"secret":     secret,
		"otpauthUrl": otpauth,
		"qr":         qr,
	})
}

// handle2FAEnable confirms the user can generate a valid code, then activates.
func (s *Server) handle2FAEnable(w http.ResponseWriter, r *http.Request) {
	u := requestUser(r)
	var body struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	var secret string
	s.db.QueryRow(`SELECT totp_secret FROM users WHERE id = ?`, u.ID).Scan(&secret)
	if !verifyTOTP(secret, body.Code) {
		httpError(w, 400, "invalid code")
		return
	}
	s.db.Exec(`UPDATE users SET totp_enabled = 1 WHERE id = ?`, u.ID)
	writeJSON(w, map[string]bool{"enabled": true})
}

// handle2FADisable turns 2FA off after re-verifying a current code.
func (s *Server) handle2FADisable(w http.ResponseWriter, r *http.Request) {
	u := requestUser(r)
	var body struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpError(w, 400, "invalid JSON")
		return
	}
	var secret string
	s.db.QueryRow(`SELECT totp_secret FROM users WHERE id = ?`, u.ID).Scan(&secret)
	if !verifyTOTP(secret, body.Code) {
		httpError(w, 400, "invalid code")
		return
	}
	s.db.Exec(`UPDATE users SET totp_secret = '', totp_enabled = 0 WHERE id = ?`, u.ID)
	writeJSON(w, map[string]bool{"enabled": false})
}

// handle2FAStatus reports whether 2FA is active for the current user.
func (s *Server) handle2FAStatus(w http.ResponseWriter, r *http.Request) {
	var enabled int
	s.db.QueryRow(`SELECT totp_enabled FROM users WHERE id = ?`, requestUser(r).ID).Scan(&enabled)
	writeJSON(w, map[string]bool{"enabled": enabled != 0})
}
