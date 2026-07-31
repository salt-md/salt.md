<p align="center">
  <img src=".github/banner.png" alt="salt.md" width="100%">
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
- **Running the instance ≠ reading it** — one *owner* holds the instance;
  everyday admins manage accounts and workspaces without gaining access to
  anyone's content. Each account gets a private space nobody else can be added
  to, and the owner can only reach a workspace through time-boxed, written,
  audited emergency access its admins are told about. Offboarding disables an
  account by default; deleting one shows what hangs off it first and hands
  shared workspaces to a named successor.
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
docker run -d -p 8420:8420 -v salt-data:/data --memory=4g ghcr.io/salt-md/salt.md
# or: docker compose up
```

`--memory` is worth setting: a container cannot see how much the host means to
give it, so without a limit Salt.md assumes a small machine and indexes fewer
large PDFs than it could. It never affects whether an upload succeeds — only
how much of a document's text reaches the search index. If you cannot set a
limit (nested containers, for instance), `SALT_MEMORY_MB` says it directly.

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

## 🌍 Languages

Salt.md is written in English and translated from there. English source text
*is* the key, so a missing translation shows correct English rather than a
broken identifier.

Ships with English and German. Adding a language is one file:

```bash
cd web
node scripts/translate.mjs --list     # what exists, how complete
node scripts/translate.mjs fr         # write or top up src/locales/fr.json
node scripts/translate.mjs fr --dry   # just print what is missing
```

No API key needed for the `--dry` path — it prints the untranslated keys and a
ready-made prompt you can hand to a translator or paste into any chat. Set
`ANTHROPIC_API_KEY` and it fills them in itself, recording which lines nobody
has read yet in `<locale>.machine.json`. Re-running never overwrites a line a
human corrected.

Plural forms come from `Intl.PluralRules`, so Polish gets its three and Arabic
its six without anyone hardcoding a rule. Dates, times, numbers and sorting all
follow the reader's region — a British user reading English gets `18/07/2026`,
not `07/18/2026`.

`npm run build` fails if a user-visible string is not translatable or a catalog
has drifted, so this cannot quietly rot.

## 📄 License

Salt.md is free software under the
**[GNU Affero General Public License v3.0](LICENSE)**.

- ✅ **Use it, including at work.** Run it for yourself, for your team or for
  your whole company. No fee, no separate licence, no conversation with us
  required. Modify it, self-host it, hand it to a colleague.
- 🔁 **If you change it and let others use it over a network, publish your
  changes.** That is the one condition, and it is what the AGPL adds over the
  GPL. Running an unmodified Salt.md for your own people asks nothing of you.
- 🏷️ **The name is ours.** Redistribute it as Salt.md and you are welcome. If
  you fork it into something of your own, please give that something its own
  name — the licence covers the code, not the identity.

### Why this licence

Two goals, and they are in tension. We want Salt.md in as many hands as
possible, which rules out anything a company's legal review rejects on sight —
the previous licence forbade all commercial use, including a company simply
running it internally, which is exactly the wrong door to close.

And we would rather not hand a competitor a finished product to close up and
sell. The AGPL does not forbid that; it just means their version has to be as
open as ours. That removes the incentive without shutting anybody out.

Anything we later build *on top* — hosted convenience, assistant features —
lives in its own repository under its own terms. The core stays this.

Copyright © 2026 Jeremia Arslan. Salt.md comes with no warranty, to the extent
permitted by law; see [`LICENSE`](LICENSE) for the terms that actually govern.
