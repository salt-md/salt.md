package server

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS pages (
	id TEXT PRIMARY KEY,
	parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
	title TEXT NOT NULL DEFAULT '',
	icon TEXT NOT NULL DEFAULT '',
	content TEXT NOT NULL DEFAULT '[]',
	position REAL NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	trashed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
-- remove_diacritics 2: faltet ä→a, ü→u, ß→ss vor dem Indexieren. Zusammen mit
-- der Praefixsuche faellt damit ein grosser Teil der deutschen Beugung weg
-- ("Verträge" wird zu "vertrage" und ist ueber "vertrag*" erreichbar).
-- Aenderungen hier brauchen eine neue ftsVersion in searchindex.go.
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
	id UNINDEXED, title, body,
	tokenize = "unicode61 remove_diacritics 2"
);
-- Abschnitte einer Seite (W110): die Sucheinheit unterhalb der Seite. Haengt
-- per Kaskade an pages; chunks_fts wird von Hand nachgefuehrt, weil eine
-- virtuelle Tabelle keine Fremdschluessel kennt.
CREATE TABLE IF NOT EXISTS page_chunks (
	id TEXT PRIMARY KEY,
	page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
	workspace_id TEXT NOT NULL DEFAULT '',
	ord INTEGER NOT NULL DEFAULT 0,
	heading TEXT NOT NULL DEFAULT '',
	text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunk_page ON page_chunks(page_id);
CREATE INDEX IF NOT EXISTS idx_chunk_ws ON page_chunks(workspace_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
	chunk_id UNINDEXED, title, heading, text,
	tokenize = "unicode61 remove_diacritics 2"
);
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	color TEXT NOT NULL DEFAULT '#2f7d4f',
	password_hash TEXT NOT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_tokens (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL,
	last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS collections (
	page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
	schema TEXT NOT NULL DEFAULT '[]',
	views TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS yjs_state (
	page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
	snapshot BLOB,
	seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS yjs_updates (
	page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
	seq INTEGER NOT NULL,
	data BLOB NOT NULL,
	PRIMARY KEY (page_id, seq)
);
CREATE TABLE IF NOT EXISTS file_texts (
	file_name TEXT PRIMARY KEY,
	page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
	text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
	position REAL NOT NULL DEFAULT 0,
	PRIMARY KEY (user_id, page_id)
);
CREATE TABLE IF NOT EXISTS links (
	source_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
	target_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
	PRIMARY KEY (source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);
CREATE TABLE IF NOT EXISTS workspaces (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_members (
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role TEXT NOT NULL DEFAULT 'member',
	PRIMARY KEY (workspace_id, user_id)
);
-- Die Organisation ist die Ebene ÜBER den Workspaces: heute genau eine Zeile
-- (diese Instanz), damit "wem gehört die Instanz" eine Abfrage statt einer
-- Annahme ist. org_members spiegelt bewusst workspace_members — wenn daraus
-- einmal eine gehostete Mehrmandanten-Version wird, ist org_id bereits die
-- Schranke und es bleibt beim Zuschneiden der Abfragen statt eines Umbaus.
CREATE TABLE IF NOT EXISTS organizations (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_members (
	org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role TEXT NOT NULL DEFAULT 'member', -- owner | admin | member
	PRIMARY KEY (org_id, user_id)
);
-- Notfallzugriff ("Break-Glass"): ein Owner kann sich bewusst, befristet und
-- protokolliert Lesezugriff auf einen Workspace verschaffen, dem er nicht
-- angehört. Ohne diesen Weg gäbe es nur die stille Hintertür (Passwort
-- zurücksetzen, sich selbst eintragen) — die genau deshalb geschlossen wird.
CREATE TABLE IF NOT EXISTS break_glass (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	reason TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_break_glass_ws ON break_glass(workspace_id);
CREATE TABLE IF NOT EXISTS share_links (
	token_hash TEXT PRIMARY KEY,
	page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tag_colors (
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	tag TEXT NOT NULL,
	color TEXT NOT NULL,
	PRIMARY KEY (workspace_id, tag)
);
CREATE TABLE IF NOT EXISTS audit_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	created_at TEXT NOT NULL,
	actor_type TEXT NOT NULL,
	actor_id TEXT NOT NULL,
	actor_name TEXT NOT NULL,
	action TEXT NOT NULL,
	page_id TEXT,
	workspace_id TEXT,
	detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_ws ON audit_log(workspace_id, id);
CREATE TABLE IF NOT EXISTS idempotency (
	key TEXT PRIMARY KEY,
	result TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
	token_hash TEXT PRIMARY KEY,
	email TEXT NOT NULL DEFAULT '',
	role TEXT NOT NULL DEFAULT 'member',
	workspace_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS page_revisions (
	id TEXT PRIMARY KEY,
	page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL,
	author_id TEXT NOT NULL DEFAULT '',
	author_name TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL DEFAULT '',
	content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rev_page ON page_revisions(page_id, created_at);
CREATE TABLE IF NOT EXISTS comments (
	id TEXT PRIMARY KEY,
	page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
	block_id TEXT NOT NULL DEFAULT '',
	author_id TEXT NOT NULL DEFAULT '',
	author_name TEXT NOT NULL DEFAULT '',
	body TEXT NOT NULL,
	created_at TEXT NOT NULL,
	resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comment_page ON comments(page_id, created_at);
`

// ensureColumn adds a column to an existing table if it is missing
// (SQLite has no ADD COLUMN IF NOT EXISTS).
func ensureColumn(db *sql.DB, table, column, ddl string) error {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	_, err = db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + ddl)
	return err
}

func openDB(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// Single connection: one writer keeps SQLite trivially consistent and is
	// more than fast enough for a personal/team workspace.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err := ensureColumn(db, "pages", "type", `type TEXT NOT NULL DEFAULT 'doc'`); err != nil {
		return nil, fmt.Errorf("migrate pages.type: %w", err)
	}
	if err := ensureColumn(db, "pages", "props", `props TEXT NOT NULL DEFAULT '{}'`); err != nil {
		return nil, fmt.Errorf("migrate pages.props: %w", err)
	}
	if err := ensureColumn(db, "pages", "cover", `cover TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate pages.cover: %w", err)
	}
	if err := ensureColumn(db, "pages", "workspace_id", `workspace_id TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate pages.workspace_id: %w", err)
	}
	if err := ensureColumn(db, "pages", "owner_id", `owner_id TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate pages.owner_id: %w", err)
	}
	if err := ensureColumn(db, "pages", "visibility", `visibility TEXT NOT NULL DEFAULT 'workspace'`); err != nil {
		return nil, fmt.Errorf("migrate pages.visibility: %w", err)
	}
	// Existing tokens predate scoping — default them to full write access so an
	// upgrade never silently downgrades a working integration.
	if err := ensureColumn(db, "api_tokens", "scope", `scope TEXT NOT NULL DEFAULT 'write'`); err != nil {
		return nil, fmt.Errorf("migrate api_tokens.scope: %w", err)
	}
	// Optional expiry on public share links (empty/NULL = never expires).
	if err := ensureColumn(db, "share_links", "expires_at", `expires_at TEXT`); err != nil {
		return nil, fmt.Errorf("migrate share_links.expires_at: %w", err)
	}
	// Pages marked as templates (instantiated via duplicate?fromTemplate=1).
	if err := ensureColumn(db, "pages", "is_template", `is_template INTEGER NOT NULL DEFAULT 0`); err != nil {
		return nil, fmt.Errorf("migrate pages.is_template: %w", err)
	}
	// Page tags: a JSON array of short labels (Obsidian-style, workspace-scoped).
	if err := ensureColumn(db, "pages", "tags", `tags TEXT NOT NULL DEFAULT '[]'`); err != nil {
		return nil, fmt.Errorf("migrate pages.tags: %w", err)
	}
	// Optional Notion-style page description (shown under the title, toggleable).
	if err := ensureColumn(db, "pages", "description", `description TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate pages.description: %w", err)
	}
	// Workspace icon (emoji) + image (uploaded logo URL) for the workspace switcher.
	if err := ensureColumn(db, "workspaces", "icon", `icon TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate workspaces.icon: %w", err)
	}
	if err := ensureColumn(db, "workspaces", "image", `image TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate workspaces.image: %w", err)
	}
	// Optional password on public share links.
	if err := ensureColumn(db, "share_links", "password_hash", `password_hash TEXT`); err != nil {
		return nil, fmt.Errorf("migrate share_links.password_hash: %w", err)
	}
	// Share mode: '' / 'read' = read-only page view (default); 'form' = a public
	// form-submission link on a collection (anyone can create a row, no account).
	if err := ensureColumn(db, "share_links", "mode", `mode TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate share_links.mode: %w", err)
	}
	// Notes-list preview metadata, derived from content on save (notes.go).
	if err := ensureColumn(db, "pages", "snippet", `snippet TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate pages.snippet: %w", err)
	}
	if err := ensureColumn(db, "pages", "thumb", `thumb TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate pages.thumb: %w", err)
	}
	// API token workspace scope (empty = all the user's workspaces; else a
	// comma-separated allow-list of workspace ids the token may reach).
	if err := ensureColumn(db, "api_tokens", "workspace_scope", `workspace_scope TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate api_tokens.workspace_scope: %w", err)
	}
	// TOTP two-factor auth (secret stored on setup, enforced once enabled).
	if err := ensureColumn(db, "users", "totp_secret", `totp_secret TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate users.totp_secret: %w", err)
	}
	if err := ensureColumn(db, "users", "totp_enabled", `totp_enabled INTEGER NOT NULL DEFAULT 0`); err != nil {
		return nil, fmt.Errorf("migrate users.totp_enabled: %w", err)
	}
	// W96: profile picture — an uploaded /files/ path, empty = initial+colour.
	if err := ensureColumn(db, "users", "avatar", `avatar TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate users.avatar: %w", err)
	}
	// W96: is this account's email confirmed? Existing accounts (created by
	// setup, invitation or OAuth) count as confirmed (DEFAULT 1). An email
	// changed BY THE ACCOUNT ITSELF sets this to 0 — and OAuth only signs in
	// over confirmed addresses, or somebody could claim a colleague's future
	// SSO identity by editing their own.
	if err := ensureColumn(db, "users", "email_verified", `email_verified INTEGER NOT NULL DEFAULT 1`); err != nil {
		return nil, fmt.Errorf("migrate users.email_verified: %w", err)
	}
	// W101: a workspace has an owner, not just members with roles — otherwise
	// there is no answer to "who does it fall to when the last one leaves" and
	// it can be left ownerless.
	if err := ensureColumn(db, "workspaces", "owner_id", `owner_id TEXT NOT NULL DEFAULT ''`); err != nil {
		return nil, fmt.Errorf("migrate workspaces.owner_id: %w", err)
	}
	// W102: an account's personal workspace — the place somebody can work
	// without anyone having to grant them access. Kept apart from owner_id,
	// because a shared workspace has an owner too.
	if err := ensureColumn(db, "workspaces", "is_personal", `is_personal INTEGER NOT NULL DEFAULT 0`); err != nil {
		return nil, fmt.Errorf("migrate workspaces.is_personal: %w", err)
	}
	// W102: "every new user gets this one". Until now every arrival landed
	// quietly in the OLDEST workspace — an assumption, not a decision. Now the
	// owner decides which workspaces (none, one, several) stand open to all.
	if err := ensureColumn(db, "workspaces", "auto_join", `auto_join INTEGER NOT NULL DEFAULT 0`); err != nil {
		return nil, fmt.Errorf("migrate workspaces.auto_join: %w", err)
	}
	// W105: deactivate an account instead of deleting it. For offboarding that
	// is the normal case — sign-in closed, sessions ended, but everything stays
	// attributable and nothing is orphaned. Deleting stays the deliberate
	// exception.
	if err := ensureColumn(db, "users", "disabled", `disabled INTEGER NOT NULL DEFAULT 0`); err != nil {
		return nil, fmt.Errorf("migrate users.disabled: %w", err)
	}
	// Record the schema/app version so an operator (and future migrations) can
	// see what a data dir was last written by. Additive, idempotent.
	db.Exec(`INSERT INTO schema_meta (key, value) VALUES ('version', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, Version)
	return db, nil
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

const welcomeContent = `[
 {"type":"paragraph","content":[{"type":"text","text":"Welcome to ","styles":{}},{"type":"text","text":"Salt.md","styles":{"bold":true}},{"type":"text","text":" — a fast, lightweight, open-source workspace for your notes, docs and ideas. 🧂","styles":{}}]},
 {"type":"heading","props":{"level":2},"content":[{"type":"text","text":"Everything is a block","styles":{}}]},
 {"type":"paragraph","content":[{"type":"text","text":"Type ","styles":{}},{"type":"text","text":"/","styles":{"code":true}},{"type":"text","text":" anywhere to insert headings, lists, quotes, code blocks, images, tables and more. Drag blocks by their handle to rearrange them.","styles":{}}]},
 {"type":"checkListItem","props":{"checked":true},"content":[{"type":"text","text":"Install Salt.md","styles":{}}]},
 {"type":"checkListItem","props":{"checked":false},"content":[{"type":"text","text":"Create your first page (button in the sidebar)","styles":{}}]},
 {"type":"checkListItem","props":{"checked":false},"content":[{"type":"text","text":"Press Ctrl/Cmd + K to search everything","styles":{}}]},
 {"type":"heading","props":{"level":2},"content":[{"type":"text","text":"Your data stays yours","styles":{}}]},
 {"type":"bulletListItem","content":[{"type":"text","text":"Single binary, single SQLite file — trivial to back up","styles":{}}]},
 {"type":"bulletListItem","content":[{"type":"text","text":"Export any page — or your whole workspace — as Markdown","styles":{}}]},
 {"type":"bulletListItem","content":[{"type":"text","text":"Clean REST API — build your own clients on top","styles":{}}]}
]`

func (s *Server) seed() error {
	// A persistent marker (not the page count) decides whether to seed, so
	// a user who deletes everything doesn't get the welcome page back on restart.
	var seeded string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = 'seeded'`).Scan(&seeded)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	if _, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES ('seeded', '1')`); err != nil {
		return err
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pages`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	ts := now()
	id := newID()
	_, err = s.db.Exec(
		`INSERT INTO pages (id, parent_id, title, icon, content, position, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, 1, ?, ?)`,
		id, "Welcome to Salt.md", "🧂", welcomeContent, ts, ts,
	)
	if err != nil {
		return err
	}
	return s.reindexPage(id)
}
