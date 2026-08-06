package server

import (
	"crypto/sha256"
	"encoding/base64"
	"html"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Signing in to the desktop app through the REAL browser.
//
// The app could show the sign-in page in its own window, and the first version
// did. It works, and it is what several well-known desktop apps do. It is still
// the worse answer, for a reason that has nothing to do with convenience:
//
//   **In your own browser you can see the address bar.** You can check that the
//   password is going to login.microsoftonline.com and not to a window an
//   application drew. That is exactly why Google refuses embedded sign-in
//   flows, and working around that refusal by trimming the user agent evades
//   the rule rather than honouring it.
//
// It also reuses the browser session you already have, and passkeys and
// hardware keys work there reliably.
//
// So: the app sends you to your browser, you sign in normally — password,
// Microsoft, Google, all unchanged — and the browser hands control back.
//
// THE HAND-BACK IS THE WHOLE PROBLEM. A custom protocol (salt://) is not a
// private channel: any program on the machine may register for it, and the one
// that answers is not necessarily ours. So the code that travels over it is
// useless on its own.
//
//	app                              browser                         server
//	 │ verifier = random             │                                │
//	 │ challenge = sha256(verifier)  │                                │
//	 ├── opens /desktop/login?challenge ──────────────────────────────▶ remembers it
//	 │                               │ sign in as usual               │
//	 │                               │ "allow the desktop app?" ──────▶ mints a code
//	 │◀──── salt://auth?code ────────┤                                │
//	 ├── POST /api/desktop/exchange {code, verifier} ─────────────────▶ sha256(verifier) == challenge?
//	 │◀──────────────── a session cookie ──────────────────────────────┤ single use, then gone
//
// Whoever intercepts the code does not have the verifier, which never leaves
// the app. This is PKCE, and it is the same shape Salt.md already uses for
// agents signing in over MCP.
//
// The confirmation step is not ceremony. Without it, ANY page you open could
// send your browser to /desktop/login and silently mint a session for a program
// waiting on salt:// — the classic login-CSRF, with a desktop app as the prize.

const (
	desktopCodeTTL   = 5 * time.Minute
	desktopScheme    = "salt"
	desktopChallenge = 43 // base64url of a 32-byte digest, unpadded
)

// handleDesktopLogin is where the app sends the browser. Unauthenticated: the
// person may well have to sign in first, and that is the normal case.
func (s *Server) handleDesktopLogin(w http.ResponseWriter, r *http.Request) {
	challenge := r.URL.Query().Get("challenge")
	if !validChallenge(challenge) {
		desktopPage(w, http.StatusBadRequest, "That sign-in request is malformed.",
			"Start it again from the Salt.md app.", "")
		return
	}
	s.sweepDesktopPending()

	u := s.currentUser(r)
	if u == nil || u.TokenKind != "" {
		// Not signed in yet — through the normal front door, and back here
		// afterwards. currentUser is used rather than the auth middleware
		// because this route is deliberately outside it.
		http.Redirect(w, r, "/?next="+url.QueryEscape("/desktop/login?challenge="+challenge), http.StatusFound)
		return
	}

	// Signed in. Ask, in a page of its own — see the comment at the top for why
	// this step exists at all.
	desktopApprovalPage(w, challenge, u.Name, u.Email)
}

// handleDesktopApprove mints the one-time code and sends the browser back to
// the app. POST only: a GET would be followable from an image tag.
func (s *Server) handleDesktopApprove(w http.ResponseWriter, r *http.Request) {
	challenge := r.FormValue("challenge")
	if !validChallenge(challenge) {
		desktopPage(w, http.StatusBadRequest, "That sign-in request is malformed.", "", "")
		return
	}
	u := s.currentUser(r)
	if u == nil || u.TokenKind != "" {
		desktopPage(w, http.StatusUnauthorized, "You are not signed in any more.",
			"Start again from the app.", "")
		return
	}
	// randomToken lives in oauth_provider.go — the same generator the agent
	// sign-in uses, so there is one place where the entropy of a credential in
	// this product is decided.
	code := randomToken(32)
	if code == "" {
		desktopPage(w, http.StatusInternalServerError, "Could not create the sign-in.", "", "")
		return
	}
	if _, err := s.db.Exec(`INSERT INTO desktop_auth (challenge, code_hash, user_id, created_at)
		VALUES (?, ?, ?, ?)`, challenge, tokenHash(code), u.ID, now()); err != nil {
		desktopPage(w, http.StatusInternalServerError, "Could not create the sign-in.", "", "")
		return
	}
	s.audit("user", u.ID, u.Name, "desktop_signin", "", "", "")

	// Back to the app. Shown as a link as well as followed, because a browser
	// that has never seen this scheme may refuse to redirect to it silently.
	target := desktopScheme + "://auth?code=" + url.QueryEscape(code)
	desktopPage(w, http.StatusOK, "Signed in.",
		"You can close this tab and go back to the Salt.md app.", target)
}

// handleDesktopExchange turns the code plus the verifier into a session.
func (s *Server) handleDesktopExchange(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code     string `json:"code"`
		Verifier string `json:"verifier"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		httpErrorCode(w, 400, "invalid_json", "invalid JSON")
		return
	}
	s.sweepDesktopPending()

	// The code is looked up by its hash, like every other credential here: a
	// dump of this table must not be a set of usable sign-ins.
	var challenge, userID, createdAt string
	err := s.db.QueryRow(`SELECT challenge, user_id, created_at FROM desktop_auth WHERE code_hash = ?`,
		tokenHash(body.Code)).Scan(&challenge, &userID, &createdAt)
	if err != nil {
		httpErrorCode(w, 400, "bad_code", "that sign-in code is not valid")
		return
	}
	// Single use, whatever happens next.
	s.db.Exec(`DELETE FROM desktop_auth WHERE code_hash = ?`, tokenHash(body.Code))

	if t, e := time.Parse(time.RFC3339Nano, createdAt); e != nil || time.Since(t) > desktopCodeTTL {
		httpErrorCode(w, 400, "expired", "that sign-in code has expired")
		return
	}
	// THE check: only the app that started this knows the verifier.
	if challengeOf(body.Verifier) != challenge {
		httpErrorCode(w, 400, "bad_verifier", "that sign-in code was not issued to this app")
		return
	}
	u := s.userByID(userID)
	if u == nil || u.Disabled {
		httpErrorCode(w, 403, "account_unavailable", "that account can no longer sign in")
		return
	}
	token, err := s.createSession(userID)
	if err != nil {
		httpErrorCode(w, 500, "session_failed", "could not create a session")
		return
	}
	setSessionCookie(w, r, token, s.sessionDays()*24*3600)
	writeJSON(w, map[string]any{"ok": true, "name": u.Name, "email": u.Email})
}

// ---- helpers ---------------------------------------------------------------

func validChallenge(c string) bool {
	if len(c) != desktopChallenge {
		return false
	}
	for _, r := range c {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func challengeOf(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// sweepDesktopPending removes what nobody came back for. A code that outlives
// its window is a credential lying around for no reason.
func (s *Server) sweepDesktopPending() {
	cutoff := time.Now().UTC().Add(-desktopCodeTTL).Format(time.RFC3339Nano)
	s.db.Exec(`DELETE FROM desktop_auth WHERE created_at < ?`, cutoff)
}

// ---- the two pages ---------------------------------------------------------
//
// Served as plain HTML rather than through the app: this runs in a browser that
// may not be signed in, mid-flow, and the single-page app has no business here.

const desktopStyle = `body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#fff;color:#37352f;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.c{width:400px;max-width:calc(100vw - 48px);text-align:center}
.m{font-size:40px;margin-bottom:14px}h1{font-size:21px;margin:0 0 8px}
p{margin:0 0 18px;color:#787774;font-size:14px}
.who{display:inline-block;margin-bottom:18px;padding:7px 13px;border:1px solid #e9e7e4;border-radius:8px;font-size:13.5px}
button,a.b{display:block;width:100%;padding:11px 13px;font:inherit;font-size:14px;font-weight:600;
color:#fff;background:#2f7d4f;border:0;border-radius:8px;cursor:pointer;text-decoration:none;box-sizing:border-box}
a.s{display:inline-block;margin-top:14px;color:#787774;font-size:13px}
@media(prefers-color-scheme:dark){body{background:#191919;color:#d4d4d4}.who{border-color:#2f2f2f}}`

func desktopApprovalPage(w http.ResponseWriter, challenge, name, email string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Salt.md</title><style>%s</style></head><body><div class="c">
<div class="m">🧂</div>
<h1>Sign in to the desktop app?</h1>
<p>The Salt.md app on this computer is asking for a session.</p>
<div class="who">%s%s</div>
<form method="POST" action="/desktop/approve">
<input type="hidden" name="challenge" value="%s">
<button type="submit">Allow</button>
</form>
<a class="s" href="/">Not now</a>
</div></body></html>`, desktopStyle, html.EscapeString(name), escapeOptional(" · ", email), html.EscapeString(challenge))
}

// desktopPage is every other outcome: an error, or the hand-back.
func desktopPage(w http.ResponseWriter, status int, title, detail, jump string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	body := ""
	if jump != "" {
		// Both: the meta refresh does it, the link is there when the browser
		// will not follow an unknown scheme without a click.
		body = fmt.Sprintf(`<meta http-equiv="refresh" content="0;url=%s">`, html.EscapeString(jump))
	}
	link := ""
	if jump != "" {
		link = fmt.Sprintf(`<a class="b" href="%s">Open Salt.md</a>`, html.EscapeString(jump))
	}
	fmt.Fprintf(w, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">%s
<title>Salt.md</title><style>%s</style></head><body><div class="c">
<div class="m">🧂</div><h1>%s</h1><p>%s</p>%s</div></body></html>`,
		body, desktopStyle, html.EscapeString(title), html.EscapeString(detail), link)
}

func escapeOptional(sep, s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	return sep + html.EscapeString(s)
}
