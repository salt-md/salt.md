<p align="center">
  <img src=".github/banner.svg" alt="Salt.md" width="100%">
</p>

<p align="center">
  <b>A fast, self-hosted workspace for notes, docs &amp; databases.</b><br>
  Notion-style block editing — one Go binary, one SQLite file, no external services.
</p>

<p align="center">
  <a href="#-quickstart">Quickstart</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-mcp-server-for-ai-agents">AI / MCP</a> ·
  <a href="#-license">License</a>
</p>

---

Salt.md is built on one conviction: your knowledge base shouldn't need a
Kubernetes cluster. **One process, one database file, zero external
services** — and still a modern, collaborative block editor that feels great
to use. It's **AI-native**: an agent can read and write everything you can,
over the built-in Model Context Protocol.

## ✨ Features

- **Notion-style block editor** — slash menu, drag &amp; drop, nested lists,
  checklists, quotes, code, tables, images, callouts (via [BlockNote](https://www.blocknotejs.org/)).
- **Databases with Kanban &amp; table views** — turn any page into a database:
  typed properties, a drag-and-drop board, colored columns, filters &amp; sorts.
- **Real-time collaboration** — live cursors and presence, powered by
  [Yjs](https://yjs.dev/) CRDTs; offline edits merge on reconnect. No external
  sync server.
- **Built-in MCP server for AI agents** — a `/mcp` endpoint lets agents search,
  read, write, and bulk-import pages and databases. AI-native out of the box.
- **Workspaces, roles &amp; sharing** — multi-user workspaces (admin / member /
  viewer), private pages, read-only public links, an activity log that
  distinguishes humans from agents, 2FA, argon2id passwords.
- **Everything portable** — Markdown import/export (single page or the whole
  workspace as a ZIP), PDF full-text search, instant `Ctrl/Cmd + K` search
  (SQLite FTS5), cover images, emoji icons, dark mode, trash &amp; restore.

## 🚀 Quickstart

**One line — prebuilt binary (macOS / Linux):**

```bash
curl -fsSL https://raw.githubusercontent.com/salt-md/salt.md/main/install.sh | sh
salt          # → http://localhost:8420
```

The installer grabs the right prebuilt binary for your OS/arch from the
[latest release](https://github.com/salt-md/salt.md/releases/latest). The
binary is fully self-contained — frontend embedded, no CGO, no runtime deps.
Data lives in `./data` (one SQLite file + uploads). On first run, open Salt.md
in your browser and create the admin account.

### Docker

```bash
docker run -d -p 8420:8420 -v salt-data:/data ghcr.io/salt-md/salt.md
# or: docker compose up
```

### Build from source

```bash
make build          # needs Go ≥ 1.25 and Node ≥ 20 — embeds the frontend
./salt              # → http://localhost:8420
```

### Configuration

| Env var         | Default  | Description                        |
| --------------- | -------- | ---------------------------------- |
| `SALT_ADDR`     | `:8420`  | Listen address                     |
| `SALT_DATA`     | `./data` | Data directory (SQLite + uploads)  |
| `SALT_TLS_CERT` | _empty_  | TLS cert file → serves HTTPS       |
| `SALT_TLS_KEY`  | _empty_  | TLS key file (with the cert)       |

### Backup

Everything lives under `SALT_DATA`. The built-in commands make a
transactionally-consistent snapshot, safe against a live instance:

```bash
./salt backup salt-backup.tar.gz     # snapshot DB (VACUUM INTO) + files
./salt restore salt-backup.tar.gz    # into an empty SALT_DATA
```

## 🤖 MCP server (for AI agents)

Salt.md speaks the [Model Context Protocol](https://modelcontextprotocol.io) at
`POST /mcp` (Streamable HTTP). Create an API token in the user menu, then:

```bash
claude mcp add --transport http salt https://<host>/mcp \
  --header "Authorization: Bearer <your-token>"
```

Agents get the full surface: search, read/write pages, manage databases and
views, set properties, comment, and **bulk-import** from any JSON API (e.g. a
Trello board) without the content ever passing through the agent's context.

## 🧱 Architecture

```
┌─────────────────────────────────────┐
│  salt  (single Go binary)           │
│  ├── REST API (net/http)            │
│  ├── MCP server (/mcp, JSON-RPC)    │
│  ├── Yjs relay (WebSocket)          │
│  ├── SSE change feed                │
│  ├── SQLite + FTS5 (pure Go, no CGO)│
│  └── embedded React frontend        │
│      (Vite + BlockNote + Yjs)       │
└─────────────────────────────────────┘
```

Page content is stored as BlockNote's open block JSON — no proprietary format.
The Yjs relay only replays opaque CRDT updates; it never interprets your data.

**Design goals, in order: easy to run, easy to love, easy to extend.**

## 📄 License

Salt.md is released under the
**[PolyForm Noncommercial License 1.0.0](LICENSE)**.

- ✅ **Free** for personal, hobby, research, educational and other
  **non-commercial** use — run it, self-host it, modify it, share it.
- 💼 **Commercial use requires a license.** Using Salt.md to make money —
  internally at a for-profit company, as a paid/hosted service, or bundled
  into a commercial product — needs a separate commercial license. Get in
  touch.

The source is public and auditable, but this is **not** an OSI open-source
license. See [`LICENSE`](LICENSE) for the exact terms.
