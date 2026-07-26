# Salt.md

Self-hosted Notion alternative. One Go binary serves the API, the MCP endpoint,
the Yjs collab relay, an SSE change feed and the embedded React frontend.

Go 1.25 · `modernc.org/sqlite` + FTS5 · **CGO_ENABLED=0** · React 18 / Vite /
BlockNote / Yjs. ~18k lines Go, ~21k lines TypeScript.

## Build and run

```bash
make build      # frontend (npm) + backend, embeds web/dist via go:embed
./salt          # → http://localhost:8420
```

`make frontend` runs `npm run build`, which runs `npm run check` first — that
gate is load-bearing (see i18n below), so do not bypass it with a bare
`vite build`.

Env: `SALT_DATA` (data dir), `SALT_ADDR` (listen address).

## Layout

```
main.go              go:embed all:web/dist
server/*.go          51 files, one concern each
  db.go              schema, migrations, now()
  roles.go           permission model, sessionOnly/ownerOnly, break-glass
  lifecycle_account.go  deactivate / delete / hand over, stranded workspaces
  workspaces.go      membership, canRead/canWrite
  users.go           auth, sessions, API tokens
  pages.go           CRUD + search
  searchindex.go     FTS5 tokenizer, query folding, German stemming
  chunks.go          page → passage splitting for search
  collab.go          Yjs WebSocket relay (binary, never interprets CRDT data)
  mcp*.go            MCP tools
web/src/
  i18n.ts            t(), plural(), locale switching
  format.ts          THE ONLY place that formats dates, numbers, sorting
  serverErrors.ts    server error code → translated message
  locales/de.json    German catalog (658 entries)
  scripts/           check-i18n.mjs, check-format.mjs, translate.mjs
```

## Conventions that are easy to break

**English first, always.** Source text is English and doubles as the
translation key: `t('Manage users')`. Comments are English too — they carry the
*why*, and unlike the interface they will never get a translation layer.

**All formatting goes through `format.ts`.** Nothing else may call
`toLocale*`, `Intl.*`, `localeCompare` or `new Date(someString)`. Two functions,
never mix them:

- `formatMoment(iso)` — an instant. Stored UTC, shown in the viewer's timezone.
- `formatDay('2026-07-18')` — a calendar date. **Never** converted; a deadline
  on the 18th is the 18th everywhere.

`new Date('2026-07-18')` parses as UTC midnight, so west of Greenwich it renders
as the 17th. Every date bug here has been a variant of that.

**`t()` is never called at module level.** A module constant resolves once at
import and keeps that language forever. Build option lists, role labels and
colour palettes as functions called during render.

**Watch for `t` shadowing.** `array.map((t) => …)` hides the translate function
from every label in the loop. Three of those got caught by the compiler; name
loop variables anything else.

**`npm run check` enforces all of it** and fails the build on a bare string, a
stray `toLocale*` or a catalog that has drifted. A line may opt out with
`// i18n-ok: <reason>` — the reason is mandatory.

**Server messages carry a code, not a language.** `httpErrorCode(w, status,
"code", "English sentence")`. The English is for curl and MCP agents; browsers
translate from the code via `serverErrors.ts`. Use `httpErrorData` when a value
(a count) has to travel too, so plural rules can run on the other side.

**`db.SetMaxOpenConns(1)`.** A query issued inside an open cursor or
transaction blocks the entire server. Drain rows (`rows.Close()`) before doing
per-row work.

**Search permission checks are two-stage, both mandatory.** First
`WHERE workspace_id IN (…)` from `scopeWorkspaces`, then `canRead` per hit —
the second catches other people's private pages and is the one people forget.

**API tokens are a second key to content, not an admin pass.** They carry the
full identity of their human and narrow only by scope (read/write) and
workspace. Administrative endpoints are wrapped in `sessionOnly`.

## Testing

```bash
go test ./...
cd web && npm run check          # tsc + i18n check + timezone check
```

Shell suites live in the session scratchpad, not the repo: `token.sh` (18),
`suche.sh` (17), `login.sh` (12), `w105.sh` (67). They run a real binary on a
throwaway port. **Assert on error codes, never on message text** — the text is
English now and translated in the browser.

`check-format.mjs` runs `format.ts` under six timezones (84 assertions),
including that the calendar's first weekday agrees with its column headers.

## Adding a language

```bash
cd web
node scripts/translate.mjs --list
node scripts/translate.mjs fr          # or --dry to just print what is missing
```

Only fills gaps, never overwrites human corrections, records machine-written
entries in `<locale>.machine.json`. Plural categories come from
`Intl.PluralRules`. Add the code to `LOCALES` in `i18n.ts` so it appears in the
picker.

## Test server

`http://10.10.20.20:8420` — the home test box, the stage **before** a GitHub
push. Deploying here is fine and expected; pushing and production are not.

Runs as a Docker container `salt` on the named volume `salt-data` (→ `/data`).
Root SSH by key. The box has **no internet**, so `docker build` cannot pull a
base image — build FROM an image already present locally.

```bash
V=1.4.0-i18n
cd web && SALT_VERSION=$V npm run build && cd ..
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath \
  -ldflags="-s -w -X salt/server.Version=$V" -o /tmp/salt-linux .
scp /tmp/salt-linux root@10.10.20.20:/root/salt-build/salt

ssh root@10.10.20.20 'cd /root/salt-build
  printf "FROM ghcr.io/salt-md/salt.md:1.0.2\nCOPY salt /usr/local/bin/salt\n" > Dockerfile
  docker build -t salt.md:'$V' .
  docker rm -f salt
  docker run -d --name salt --restart unless-stopped -p 8420:8420 -v salt-data:/data salt.md:'$V
```

**Back up the volume first** — migrations are one-way:

```bash
ssh root@10.10.20.20 'docker stop salt
  tar czf /root/salt-backups/salt-data-$(date +%F-%H%M).tar.gz \
    -C /var/lib/docker/volumes/salt-data/_data .
  docker start salt'
```

Rollback is the old published image: `docker run … ghcr.io/salt-md/salt.md:1.0.2`.

Frontend and backend must be built with the SAME version string, or the
"reload" banner fires forever (that bug is fixed; do not reintroduce it by
building one side without `SALT_VERSION`).

## State

Production runs 1.3.1 on a Proxmox container, public via a Cloudflare tunnel.
**Nothing is rolled out to production or pushed without the user saying so.**
Local commits are fine.

Branch `i18n-groundwork` holds the English-first conversion. Frontend, server
messages and the four permission files (`roles`, `lifecycle_account`, `users`,
`workspaces`) are done.

Still German: ~740 comment lines in 31 Go files — largest are `ingest.go` (76),
`mcp_pages.go` (59), `mcp_schema.go` (58), `searchindex.go` (50), `pages.go`
(40). Plus `docs/suche-und-ki.md` (148 lines). Mechanical work: one file at a
time, `go build ./...` after each.

Startup log lines are still German too ("search index: neu aufgebaut",
"tunnel: autostart (gespeicherter Token)") — they live in `searchindex.go` and
`tunnel.go` and go with those files. Logs are read by whoever runs the server,
so they belong in the English sweep.

Deployed to the test box as `1.4.0-i18n` and verified there: the 1.0.2 → this
migration path runs clean (search index rebuilt, 659 pages), login returns
`bad_credentials` with English text, and both sides report the same version.
