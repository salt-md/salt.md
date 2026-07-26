package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Server struct {
	db          *sql.DB
	mux         *http.ServeMux
	dataDir     string
	addr        string
	tunnel      tunnelState
	loginMu     sync.Mutex
	loginSem    chan struct{}
	events      *eventHub
	collab      *collabHub
	mcpRate     *rateLimiter
	mcpIcon     string          // data URI of the logo for serverInfo.icons (see mcp.go)
	ingest      *ingestRegistry // laufende Massenimporte (siehe ingest.go)
	loginRate   *rateLimiter
	formRate    *rateLimiter
	stopCleanup chan struct{}
}

// Close stops background maintenance and releases the database. Call on
// graceful shutdown so WAL is checkpointed and the sole connection is returned
// cleanly.
func (s *Server) Close() error {
	// NOT StopTunnel: that is the admin's deliberate "off" switch and therefore
	// clears `tunnel_autostart`. Close() however runs on EVERY orderly shutdown
	// — so a configured tunnel switched itself off on every restart and had to
	// be re-enabled by hand. Stop yes, disable permanently no.
	s.SignalTunnelStop()
	s.AwaitTunnelStop(3 * time.Second)
	select {
	case <-s.stopCleanup:
	default:
		close(s.stopCleanup)
	}
	return s.db.Close()
}

// DBFile ist der Name der SQLite-Datei.
const DBFile = "salt.db"

func New(dataDir string, dist fs.FS) (*Server, error) {
	if err := os.MkdirAll(filepath.Join(dataDir, "files"), 0o755); err != nil {
		return nil, err
	}
	db, err := openDB(filepath.Join(dataDir, DBFile))
	if err != nil {
		return nil, err
	}

	// The logo is read ONCE at startup out of the embedded build and kept as a
	// data URI. A data URI rather than a link, because some MCP clients will
	// not fetch foreign images (strict CSP) — a link would be silently empty
	// there.
	iconURI := ""
	if b, err := fs.ReadFile(dist, "favicon.svg"); err == nil && len(b) < 64<<10 {
		iconURI = "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString(b)
	}

	s := &Server{
		mcpIcon:     iconURI,
		ingest:      newIngestRegistry(),
		db:          db,
		mux:         http.NewServeMux(),
		dataDir:     dataDir,
		loginSem:    make(chan struct{}, 4),
		events:      newEventHub(),
		collab:      newCollabHub(),
		mcpRate:     newRateLimiter(240, 60), // 240 writes/min per token, burst 60
		loginRate:   newRateLimiter(30, 10),  // 30 login attempts/min per IP, burst 10
		formRate:    newRateLimiter(20, 8),   // 20 public form submits/min per IP, burst 8
		stopCleanup: make(chan struct{}),
	}
	if err := s.seed(); err != nil {
		return nil, err
	}
	if err := s.migrateWorkspaces(); err != nil {
		return nil, err
	}
	// After the workspaces: derive organisation, instance roles and workspace
	// owners from what is already there (idempotent, see roles.go).
	if err := s.migrateOrg(); err != nil {
		return nil, err
	}
	// Volltextindex auf die aktuelle Fassung bringen (Tokenizer, siehe
	// searchindex.go). Baut bei Bedarf einmalig neu auf.
	if err := s.migrateSearchIndex(); err != nil {
		return nil, err
	}
	s.backfillSnippets()
	s.deleteExpiredSessions()
	s.startCleanup()

	m := s.mux
	m.HandleFunc("GET /api/health", s.handleHealth)
	m.HandleFunc("GET /api/me", s.handleMe)
	m.HandleFunc("POST /api/setup", s.handleSetup)
	m.HandleFunc("POST /api/login", s.handleLogin)
	m.HandleFunc("POST /api/logout", s.handleLogout)
	m.HandleFunc("POST /api/signup", s.handleSelfSignup)
	m.HandleFunc("GET /api/signup-policy", s.handleSignupPolicy)
	m.HandleFunc("GET /api/oauth/{provider}/start", s.handleOAuthStart)
	m.HandleFunc("GET /api/oauth/{provider}/callback", s.handleOAuthCallback)

	// Instance administration (admin-gated inside the handlers).
	m.HandleFunc("GET /api/settings", s.auth(s.handleGetSettings))
	m.HandleFunc("PUT /api/settings", s.auth(s.sessionOnly(s.handlePutSettings)))
	m.HandleFunc("GET /api/admin/info", s.auth(s.handleAdminInfo))
	// Die Instanz-Sicherung enthaelt JEDEN Workspace samt Passwort-Hashes. Als
	// GET kam frueher sogar ein NUR-LESE-Token durch — Lesen war ja erlaubt.
	m.HandleFunc("GET /api/admin/backup", s.auth(s.sessionOnly(s.handleAdminBackup)))
	m.HandleFunc("GET /api/admin/public-access", s.auth(s.handlePublicAccess))
	m.HandleFunc("GET /api/public-base", s.auth(s.handlePublicBase))
	m.HandleFunc("POST /api/admin/tunnel", s.auth(s.sessionOnly(s.handleTunnelAction)))
	m.HandleFunc("GET /api/admin/mail-oauth/{provider}/start", s.auth(s.handleMailOAuthStart))
	m.HandleFunc("GET /api/admin/mail-oauth/{provider}/callback", s.auth(s.handleMailOAuthCallback))
	m.HandleFunc("POST /api/admin/mail-oauth/disconnect", s.auth(s.sessionOnly(s.handleMailOAuthDisconnect)))
	m.HandleFunc("POST /api/admin/mail-test", s.auth(s.sessionOnly(s.handleMailTest)))
	// Einladen ist Kontenverwaltung, nicht Inhalt.
	m.HandleFunc("POST /api/invites", s.auth(s.sessionOnly(s.handleCreateInvite)))
	m.HandleFunc("GET /api/invites/{token}", s.handleInviteInfo)
	m.HandleFunc("POST /api/invites/{token}/accept", s.handleAcceptInvite)
	m.HandleFunc("GET /api/ics", s.auth(s.handleICSInfo))
	m.HandleFunc("GET /ics/{token}", s.handleICSFeed)
	m.HandleFunc("GET /api/2fa", s.auth(s.sessionOnly(s.handle2FAStatus)))
	m.HandleFunc("POST /api/2fa/setup", s.auth(s.sessionOnly(s.handle2FASetup)))
	m.HandleFunc("POST /api/2fa/enable", s.auth(s.sessionOnly(s.handle2FAEnable)))
	m.HandleFunc("POST /api/2fa/disable", s.auth(s.sessionOnly(s.handle2FADisable)))

	m.HandleFunc("GET /api/users", s.adminOnly(s.handleListUsers))
	m.HandleFunc("GET /api/admin/access", s.adminOnly(s.handleAccessOverview))
	m.HandleFunc("PUT /api/admin/membership", s.adminOnly(s.handleAdminMembership))
	m.HandleFunc("POST /api/users", s.adminOnly(s.handleCreateUser))
	m.HandleFunc("PATCH /api/users/{id}", s.auth(s.sessionOnly(s.handleUpdateUser)))
	// ownerOnly, not adminOnly: deleting destroys the account's personal area
	// for good. That is precisely the control over data an admin does NOT have
	// under the permission model — admins manage accounts, they do not throw
	// away other people's content. For offboarding there is deactivation, which
	// every admin may do and which loses nothing.
	m.HandleFunc("DELETE /api/users/{id}", s.ownerOnly(s.handleDeleteUser))
	// Lifecycle: show the consequences, deactivate, clean up stranded
	// workspaces. ownerOnly: the answer names the id, the name and the page
	// count of personal areas — things the access overview deliberately hides.
	m.HandleFunc("GET /api/users/{id}/deletion-impact", s.ownerOnly(s.handleDeletionImpact))
	m.HandleFunc("PUT /api/users/{id}/disabled", s.adminOnly(s.handleSetUserDisabled))
	m.HandleFunc("POST /api/admin/transfer-owner", s.ownerOnly(s.handleTransferOwner))
	m.HandleFunc("GET /api/admin/stranded-workspaces", s.ownerOnly(s.handleStrandedWorkspaces))
	m.HandleFunc("POST /api/admin/stranded-workspaces/{id}/adopt", s.ownerOnly(s.handleAdoptWorkspace))
	m.HandleFunc("DELETE /api/admin/stranded-workspaces/{id}", s.ownerOnly(s.handleDeleteStrandedWorkspace))

	m.HandleFunc("GET /api/tokens", s.auth(s.sessionOnly(s.handleListTokens)))
	m.HandleFunc("POST /api/tokens", s.auth(s.sessionOnly(s.handleCreateToken)))
	m.HandleFunc("DELETE /api/tokens/{id}", s.auth(s.sessionOnly(s.handleDeleteToken)))

	m.HandleFunc("GET /api/pages", s.auth(s.handleListPages))
	m.HandleFunc("POST /api/pages", s.auth(s.handleCreatePage))
	m.HandleFunc("GET /api/pages/{id}", s.auth(s.handleGetPage))
	m.HandleFunc("PATCH /api/pages/{id}", s.auth(s.handleUpdatePage))
	m.HandleFunc("DELETE /api/pages/{id}", s.auth(s.handleDeletePage))
	m.HandleFunc("POST /api/pages/{id}/restore", s.auth(s.handleRestorePage))
	m.HandleFunc("POST /api/reindex-siblings", s.auth(s.handleReindexSiblings))
	m.HandleFunc("GET /api/pages/{id}/backlinks", s.auth(s.handleBacklinks))
	m.HandleFunc("GET /api/graph", s.auth(s.handleGraph))
	m.HandleFunc("GET /api/tags", s.auth(s.handleListTags))
	m.HandleFunc("GET /api/comment-counts", s.auth(s.handleCommentCounts))
	m.HandleFunc("GET /api/tag-colors", s.auth(s.handleTagColors))
	m.HandleFunc("PUT /api/tag-colors", s.auth(s.handleSetTagColor))
	m.HandleFunc("GET /api/search", s.auth(s.handleSearch))
	m.HandleFunc("POST /api/upload", s.auth(s.handleUpload))
	m.HandleFunc("GET /api/export/{id}", s.auth(s.handleExportPage))
	m.HandleFunc("GET /api/export", s.auth(s.handleExportAll))

	m.HandleFunc("GET /api/collections/{id}", s.auth(s.handleGetCollection))
	m.HandleFunc("PUT /api/collections/{id}", s.auth(s.handlePutCollection))
	m.HandleFunc("GET /api/collections/{id}/rows", s.auth(s.handleCollectionRows))

	m.HandleFunc("GET /api/favorites", s.auth(s.handleListFavorites))
	m.HandleFunc("POST /api/favorites/{id}", s.auth(s.handleAddFavorite))
	m.HandleFunc("DELETE /api/favorites/{id}", s.auth(s.handleRemoveFavorite))

	m.HandleFunc("GET /api/audit", s.auth(s.handleAudit))
	m.HandleFunc("GET /api/workspaces", s.auth(s.handleListWorkspaces))
	m.HandleFunc("POST /api/workspaces", s.auth(s.handleCreateWorkspace))
	// Native 1:1 transfer (registered before the {id} routes so that "import"
	// is not parsed as a workspace id).
	m.HandleFunc("POST /api/workspaces/import", s.auth(s.handleImportWorkspace))
	m.HandleFunc("GET /api/workspaces/{id}/export", s.auth(s.handleExportWorkspace))
	// Break-glass: only the owner may request it; the people responsible for
	// the workspace concerned may view and end it too.
	m.HandleFunc("POST /api/workspaces/{id}/break-glass", s.ownerOnly(s.handleBreakGlass))
	m.HandleFunc("GET /api/workspaces/{id}/break-glass", s.auth(s.handleListBreakGlass))
	m.HandleFunc("DELETE /api/workspaces/{id}/break-glass/{grantId}", s.auth(s.handleRevokeBreakGlass))
	m.HandleFunc("PATCH /api/workspaces/{id}", s.auth(s.handleUpdateWorkspace))
	m.HandleFunc("DELETE /api/workspaces/{id}", s.auth(s.handleDeleteWorkspace))
	m.HandleFunc("GET /api/workspaces/{id}/members", s.auth(s.handleListMembers))
	m.HandleFunc("POST /api/workspaces/{id}/members", s.auth(s.handleAddWorkspaceMember))
	m.HandleFunc("PATCH /api/workspaces/{id}/members/{userId}", s.auth(s.handleUpdateMember))
	m.HandleFunc("DELETE /api/workspaces/{id}/members/{userId}", s.auth(s.handleRemoveMember))
	m.HandleFunc("POST /api/pages/{id}/share", s.auth(s.handleSharePage))
	m.HandleFunc("DELETE /api/pages/{id}/share", s.auth(s.handleUnsharePage))
	// Public form sharing: mint/revoke/status (auth) + anonymous config+submit.
	m.HandleFunc("GET /api/collections/{id}/form-share", s.auth(s.handleFormShareStatus))
	m.HandleFunc("POST /api/collections/{id}/form-share", s.auth(s.handleShareForm))
	m.HandleFunc("DELETE /api/collections/{id}/form-share", s.auth(s.handleUnshareForm))
	m.HandleFunc("GET /api/public/form/{token}", s.handlePublicFormConfig)
	m.HandleFunc("POST /api/public/form/{token}/submit", s.handlePublicFormSubmit)
	m.HandleFunc("GET /api/public/{token}", s.handlePublicPage)
	m.HandleFunc("GET /public/{token}", s.handlePublicView)
	m.HandleFunc("POST /public/{token}", s.handlePublicView)

	m.HandleFunc("GET /api/pages/{id}/revisions", s.auth(s.handleListRevisions))
	m.HandleFunc("GET /api/pages/{id}/revisions/{revId}", s.auth(s.handleGetRevision))
	m.HandleFunc("POST /api/pages/{id}/revisions/{revId}/restore", s.auth(s.handleRestoreRevision))

	m.HandleFunc("POST /api/pages/{id}/duplicate", s.auth(s.handleDuplicatePage))
	m.HandleFunc("POST /api/import", s.auth(s.handleImport))
	m.HandleFunc("POST /api/import-zip", s.auth(s.handleImportZip))

	m.HandleFunc("GET /api/pages/{id}/comments", s.auth(s.handleListComments))
	m.HandleFunc("POST /api/pages/{id}/comments", s.auth(s.handleCreateComment))
	m.HandleFunc("POST /api/comments/{id}/resolve", s.auth(s.handleResolveComment))
	m.HandleFunc("DELETE /api/comments/{id}", s.auth(s.handleDeleteComment))

	m.HandleFunc("GET /api/events", s.auth(s.handleEvents))
	m.HandleFunc("GET /collab/{id}", s.auth(s.handleCollab))
	m.HandleFunc("/mcp", s.handleMCP)
	// Token-in-URL variant: many MCP clients (claude.ai/Desktop connectors,
	// ChatGPT developer mode, …) only accept a plain URL and offer no way to
	// set an Authorization header — one link makes Salt work everywhere.
	// Same trade-off as the ICS feed: the token rides in the URL.
	m.HandleFunc("/mcp/{token}", s.handleMCP)

	filesInner := http.StripPrefix("/files/", http.FileServer(http.Dir(filepath.Join(dataDir, "files"))))
	m.HandleFunc("GET /files/", s.auth(func(w http.ResponseWriter, r *http.Request) {
		// For a directory without an index.html, http.FileServer serves a
		// listing — here that would be a table of contents of EVERY upload on
		// the instance, across workspaces, for any signed-in user. The random
		// names only protect as long as nobody can enumerate them.
		if strings.HasSuffix(r.URL.Path, "/") {
			httpError(w, 404, "not found")
			return
		}
		// Uploads are user-controlled: sandbox them so an uploaded .html/.svg
		// can never run scripts on the app origin (stored XSS).
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		filesInner.ServeHTTP(w, r)
	}))

	m.Handle("/", spaHandler(dist))
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

const maxJSONBody = 8 << 20 // 8 MiB is plenty for one page of block JSON

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	return json.NewDecoder(r.Body).Decode(v)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON: %v", err)
	}
}

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// httpErrorCode is httpError with a machine-readable reason.
//
// The sign-in screen has to know WHY an attempt failed: on "2fa_required" it
// reveals the code field, otherwise it says the credentials were wrong. Both
// are a 401, so the status alone does not carry it. The interface used to
// compare the English message text character by character — a rewording or a
// translation would have made the code field vanish without a word and locked
// out every account with two-factor sign-in.
//
// It is also what makes the server translatable at all. The message travels in
// English so curl, scripts and MCP agents get something readable; the browser
// looks at `code` and renders the reader's own language. The server never has
// to know what language anybody speaks.
func httpErrorCode(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg, "code": code})
}

// httpErrorData is httpErrorCode carrying the values its message needs.
//
// "You have 3 private pages here" cannot be rebuilt from the code alone: the
// browser has to know the 3 to put it through its own plural rules. So the
// number travels beside the code instead of baked into a sentence.
func httpErrorData(w http.ResponseWriter, status int, code, msg string, data map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	body := map[string]any{"error": msg, "code": code}
	for k, v := range data {
		body[k] = v
	}
	json.NewEncoder(w).Encode(body)
}
