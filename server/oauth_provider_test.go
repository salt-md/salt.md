package server

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// The five rules from the top of oauth_provider.go, each with a test that fails
// without it. Built wrong, an authorization server is WORSE than none — it
// looks like security. So these are not "does the happy path work" tests; each
// one is an attack that has to bounce.

func oauthClientFixture(t *testing.T, s *Server, redirect string) string {
	t.Helper()
	body := `{"client_name":"Claude","redirect_uris":["` + redirect + `"]}`
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("POST", "/oauth/register", strings.NewReader(body)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		ClientID string `json:"client_id"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out.ClientID == "" {
		t.Fatal("no client_id")
	}
	return out.ClientID
}

func pkce(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// approve walks the part a human does in the browser and returns the code.
func approve(t *testing.T, s *Server, cookie, clientID, redirect, challenge, scope string, ws []string) string {
	t.Helper()
	payload, _ := json.Marshal(map[string]any{
		"clientId": clientID, "redirectUri": redirect, "codeChallenge": challenge,
		"codeChallengeMethod": "S256", "scope": scope, "workspaces": ws,
	})
	r := httptest.NewRequest("POST", "/api/oauth/approve", strings.NewReader(string(payload)))
	r.Header.Set("Cookie", cookie)
	r.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Code string `json:"code"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	return out.Code
}

func tokenCall(s *Server, form url.Values) (int, map[string]any) {
	r := httptest.NewRequest("POST", "/oauth/token", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, r)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// The whole point, end to end: a human consents in a browser, the client
// exchanges a code, and the resulting token reaches the API — with nothing ever
// travelling in a URL.
func TestSigningInGivesAWorkingShortLivedToken(t *testing.T) {
	s := testServer(t)
	uid, cookie := signedIn(t, s, "oauth@example.test")
	ws := s.firstWorkspaceOf(t, uid)
	redirect := "https://claude.ai/api/mcp/auth_callback"
	client := oauthClientFixture(t, s, redirect)

	verifier := "a-verifier-long-enough-to-be-real-0123456789"
	code := approve(t, s, cookie, client, redirect, pkce(verifier), "write", []string{ws})

	status, out := tokenCall(s, url.Values{
		"grant_type": {"authorization_code"}, "code": {code},
		"client_id": {client}, "redirect_uri": {redirect}, "code_verifier": {verifier},
	})
	if status != http.StatusOK {
		t.Fatalf("token: %d %v", status, out)
	}
	access, _ := out["access_token"].(string)
	refresh, _ := out["refresh_token"].(string)
	if access == "" || refresh == "" {
		t.Fatalf("missing tokens: %v", out)
	}
	if out["expires_in"] == nil {
		t.Error("no expiry — the token would be as permanent as the thing it replaces")
	}

	// It works as a credential.
	r := httptest.NewRequest("GET", "/api/pages", nil)
	r.Header.Set("Authorization", "Bearer "+access)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("the access token was refused by the API: %d", rec.Code)
	}

	// And the connection SURVIVES: refreshing keeps it alive without anybody
	// signing in again. A design that made you re-authorize hourly on a phone
	// would simply not be used.
	status, out = tokenCall(s, url.Values{
		"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {client},
	})
	if status != http.StatusOK {
		t.Fatalf("refresh: %d %v", status, out)
	}
	if out["access_token"] == access {
		t.Error("refreshing handed back the same access token — nothing rotated")
	}
	// The old refresh token is dead: rotation, or the long-lived secret is back.
	if status, _ := tokenCall(s, url.Values{
		"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {client},
	}); status == http.StatusOK {
		t.Error("the previous refresh token still works — it never rotates out")
	}
}

// Rule 1: PKCE, S256, mandatory.
func TestPKCEIsRequiredAndMustBeS256(t *testing.T) {
	s := testServer(t)
	uid, cookie := signedIn(t, s, "pkce@example.test")
	_ = uid
	redirect := "https://claude.ai/cb"
	client := oauthClientFixture(t, s, redirect)

	// The authorize endpoint refuses to even start without a challenge.
	for _, q := range []string{
		"response_type=code&client_id=" + client + "&redirect_uri=" + url.QueryEscape(redirect),
		"response_type=code&client_id=" + client + "&redirect_uri=" + url.QueryEscape(redirect) + "&code_challenge=x&code_challenge_method=plain",
	} {
		r := httptest.NewRequest("GET", "/oauth/authorize?"+q, nil)
		r.Header.Set("Cookie", cookie)
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, r)
		loc := rec.Header().Get("Location")
		if !strings.Contains(loc, "error=invalid_request") {
			t.Errorf("authorize accepted %q — it went to %q", q, loc)
		}
	}
	// And a wrong verifier never becomes a token.
	code := approve(t, s, cookie, client, redirect, pkce("the-real-verifier"), "read", nil)
	if status, out := tokenCall(s, url.Values{
		"grant_type": {"authorization_code"}, "code": {code},
		"client_id": {client}, "redirect_uri": {redirect}, "code_verifier": {"a-different-verifier"},
	}); status == http.StatusOK {
		t.Errorf("a wrong code_verifier was accepted: %v", out)
	}
}

// Rule 2: exact redirect_uri. A prefix match is the classic way to have codes
// delivered to somebody else's server.
func TestRedirectURIIsComparedExactly(t *testing.T) {
	s := testServer(t)
	_, cookie := signedIn(t, s, "redir@example.test")
	redirect := "https://claude.ai/cb"
	client := oauthClientFixture(t, s, redirect)

	for _, evil := range []string{
		"https://claude.ai/cb/../evil",
		"https://claude.ai/cb.evil.example",
		"https://claude.ai/cb?x=1",
		"https://evil.example/cb",
		"https://claude.ai/cb/",
	} {
		r := httptest.NewRequest("GET", "/oauth/authorize?response_type=code&client_id="+client+
			"&redirect_uri="+url.QueryEscape(evil)+"&code_challenge=abc&code_challenge_method=S256", nil)
		r.Header.Set("Cookie", cookie)
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, r)
		// Refused WITHOUT redirecting: bouncing an error to an unverified target
		// would make this endpoint an open relay.
		if rec.Code == http.StatusFound {
			t.Errorf("%q was redirected to instead of refused", evil)
		}
	}
	// The exchange checks it a second time, against the one used to authorize.
	code := approve(t, s, cookie, client, redirect, pkce("v"), "read", nil)
	if status, _ := tokenCall(s, url.Values{
		"grant_type": {"authorization_code"}, "code": {code},
		"client_id": {client}, "redirect_uri": {"https://evil.example/cb"}, "code_verifier": {"v"},
	}); status == http.StatusOK {
		t.Error("the token endpoint accepted a redirect_uri that was never authorized")
	}
}

// Rule 3: a code is single use.
func TestACodeCannotBeUsedTwice(t *testing.T) {
	s := testServer(t)
	_, cookie := signedIn(t, s, "replay@example.test")
	redirect := "https://claude.ai/cb"
	client := oauthClientFixture(t, s, redirect)
	code := approve(t, s, cookie, client, redirect, pkce("v"), "read", nil)

	form := url.Values{"grant_type": {"authorization_code"}, "code": {code},
		"client_id": {client}, "redirect_uri": {redirect}, "code_verifier": {"v"}}
	if status, out := tokenCall(s, form); status != http.StatusOK {
		t.Fatalf("first exchange failed: %d %v", status, out)
	}
	if status, out := tokenCall(s, form); status == http.StatusOK {
		t.Errorf("the same code was exchanged twice: %v", out)
	}
}

// Rule 5: a token can never approve a grant. That is a key minting a better
// key, and it is the one escalation this whole design would otherwise open.
func TestATokenCannotApproveAGrant(t *testing.T) {
	s := testServer(t)
	uid, _ := signedIn(t, s, "escalate@example.test")
	secret := "an-api-token"
	if _, err := s.db.Exec(`INSERT INTO api_tokens (id, user_id, name, token_hash, scope, created_at)
		VALUES (?, ?, 'agent', ?, 'write', ?)`, newID(), uid, tokenHash(secret), now()); err != nil {
		t.Fatalf("insert: %v", err)
	}
	client := oauthClientFixture(t, s, "https://claude.ai/cb")
	payload, _ := json.Marshal(map[string]any{
		"clientId": client, "redirectUri": "https://claude.ai/cb",
		"codeChallenge": pkce("v"), "codeChallengeMethod": "S256", "scope": "write",
	})
	r := httptest.NewRequest("POST", "/api/oauth/approve", strings.NewReader(string(payload)))
	r.Header.Set("Authorization", "Bearer "+secret)
	r.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, r)
	if rec.Code == http.StatusOK {
		t.Fatal("an API token approved an OAuth grant — a key just minted itself a better key")
	}
}

// The consent screen decides the reach, and the server does not take its word
// for the part it can check: a workspace the person is not in cannot be granted
// however the browser was tampered with.
func TestConsentCannotGrantAWorkspaceYouAreNotIn(t *testing.T) {
	s := testServer(t)
	_, cookie := signedIn(t, s, "member@example.test")
	otherUID, _ := signedIn(t, s, "stranger@example.test")
	foreign := makeWorkspace(t, s, otherUID)

	redirect := "https://claude.ai/cb"
	client := oauthClientFixture(t, s, redirect)
	code := approve(t, s, cookie, client, redirect, pkce("v"), "write", []string{foreign})

	status, out := tokenCall(s, url.Values{
		"grant_type": {"authorization_code"}, "code": {code},
		"client_id": {client}, "redirect_uri": {redirect}, "code_verifier": {"v"},
	})
	if status != http.StatusOK {
		t.Fatalf("token: %d %v", status, out)
	}
	access, _ := out["access_token"].(string)
	u := s.userForAccessToken(access, "1.2.3.4")
	if u == nil {
		t.Fatal("no user for the access token")
	}
	for _, w := range u.TokenWorkspaces {
		if w == foreign {
			t.Fatal("consent granted a workspace the person is not a member of")
		}
	}
}

// Discovery has to work unauthenticated, and the 401 has to point at it —
// without the pointer a client never learns signing in is possible and falls
// back to asking for a permanent token.
func TestTheUnauthorizedAnswerAdvertisesTheWayIn(t *testing.T) {
	s := testServer(t)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("POST", "/mcp", strings.NewReader("{}")))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("/mcp without a credential answered %d", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("WWW-Authenticate"), "resource_metadata=") {
		t.Errorf("the 401 does not point at the metadata: %q", rec.Header().Get("WWW-Authenticate"))
	}
	for _, path := range []string{
		"/.well-known/oauth-protected-resource",
		"/.well-known/oauth-authorization-server",
	} {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s answered %d — a client cannot discover the flow", path, rec.Code)
		}
	}
	// S256 only: advertising "plain" as well would let a client pick the version
	// that protects nothing.
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("GET", "/.well-known/oauth-authorization-server", nil))
	if strings.Contains(rec.Body.String(), "plain") {
		t.Error("the metadata advertises PKCE method \"plain\"")
	}
}

// Registration must not accept redirect targets that are dangerous by shape —
// a bad one would sit there waiting until somebody used it.
func TestRegistrationRefusesDangerousRedirects(t *testing.T) {
	for _, bad := range []string{
		"http://evil.example/cb", // plain http to a remote host
		"https://claude.ai/cb#x", // a fragment is dropped on redirect
		"not-a-uri",
	} {
		if err := validRedirectURI(bad); err == nil {
			t.Errorf("%q was accepted as a redirect_uri", bad)
		}
	}
	for _, ok := range []string{
		"https://claude.ai/api/mcp/auth_callback",
		"http://localhost:6274/callback", // native apps receive codes here
		"http://127.0.0.1:1410/cb",
		"myapp://auth",
	} {
		if err := validRedirectURI(ok); err != nil {
			t.Errorf("%q was refused: %v", ok, err)
		}
	}
}
