# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Salt.md

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
  public.go          /public/{token} — standalone HTML for anonymous visitors,
                     no SPA and no JS, so no t() reaches it
  oauth.go           OIDC sign-in; errors travel as codes in the query string
  language_test.go   fails the build on German in a .go file
  mcp*.go            MCP tools
web/src/
  i18n.ts            t(), plural(), locale switching
  format.ts          THE ONLY place that formats dates, numbers, sorting
  serverErrors.ts    server error code → translated message
  locales/de.json    German catalog (681 entries)
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

**`go test ./...` enforces the same on the server** (`server/language_test.go`).
It exists because twelve finished German sentences were sitting in login
redirects and two whole emails went out in German — none of which a frontend
check can see, because they never pass through `t()`. A `.go` line reading as
German fails the build. Same escape hatch, same mandatory reason; whole files
whose German IS the subject (the search-folding fixtures) carry
`i18n-ok-file: <reason>`. `pendingTranslation` in that file is a debt list of
files not converted yet — a second test fails if an entry on it is already
clean, so it cannot quietly outlive the problem.

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

## The two servers — do not mix them up

| Address | What it is | Reached via | Version |
| --- | --- | --- | --- |
| `http://172.16.0.115/` | **test** server, LXC 115 | `ssh root@172.16.0.10` → `pct` | 1.4.1-dev |
| `http://10.10.20.20:8420` | **PRODUCTION** — the owner's real instance | `ssh root@10.10.20.20` | 1.4.0 |

The test box answers on **port 80**, production on **8420** — a bare
`10.10.20.20` in a command is a strong hint that something is aimed wrong.

`10.10.20.20` is production and is **never hand-deployed to**. It is built by
`git pull` on the box, on the owner's word, and by nobody else. It holds 659
real pages. Everything below about it is what an accidental deploy taught us —
it is documentation of the terrain, not an invitation.

- Docker container `salt`, named volume `salt-data` → `/data`. Root SSH by key.
- **No DNS, but routing works.** `docker pull`/`docker build` cannot reach a
  registry and `cloudflared` (which lives in the volume at `/data/bin`, not in
  the image) loop-fails — both because the nameserver answers nothing, not
  because the box is offline. Build FROM a locally present image.
- It is **not** the host behind `salt.sevensecure.de` — it cannot be, it has no
  internet. **The test box is**: LXC 115 logs `tunnel: verbunden (token)` on
  start, so anything deployed there is immediately public. "Test server" names
  its role in the workflow, not its reachability.
- Published images `1.0.1`, `1.0.2` and `latest` are present locally, so a
  rollback needs no network.

Back up before anything, restore like this — the container must be stopped for
both, or the WAL is caught mid-write:

```bash
ssh root@10.10.20.20 'docker stop salt
  tar czf /root/salt-backups/salt-data-$(date +%Y%m%d-%H%M%S).tar.gz \
    -C /var/lib/docker/volumes/salt-data/_data .'

# restore:
ssh root@10.10.20.20 'D=/var/lib/docker/volumes/salt-data/_data
  find "$D" -mindepth 1 -delete
  tar xzf /root/salt-backups/<file>.tar.gz -C "$D"
  docker rm -f salt
  docker run -d --name salt --restart unless-stopped \
    -p 8420:8420 -v salt-data:/data ghcr.io/salt-md/salt.md:1.0.2'
```

`tar` restores the recorded `1000:1000` ownership when run as root, so the
files stay readable by the `salt` user. A restore worked cleanly: proof is the
**absence** of a `search index: neu aufgebaut` line at startup — the old binary
recognising its own schema.

**Migrations are one-way and run on start.** Booting a main-based build against
the 1.0.2 database migrated it across three releases at once and rebuilt the
search index (Fassung 3, 659 pages). That is inherent to the version gap, not
to any one branch.

Deploying to `172.16.0.115` is fine and expected — it is the stage before a
GitHub push. It takes **no direct SSH**; that is refused. It is reached through
the Proxmox host:

```bash
ssh root@172.16.0.10          # hostname pve
pct exec 115 -- <cmd>         # LXC container 115
pct push 115 <local> <remote>
```

Inside: binary `/opt/salt/salt`, data `/opt/salt/data`, systemd unit **`salt`**
(the older `blatt` unit is inactive — the project was renamed). Go 1.24.4 is
installed there, so the container builds its own binary from a pushed source
tarball. **No `curl`** in it — use `wget` or `python3 urllib` to smoke-test.

The convention is to keep the outgoing binary as `salt.bak-w<N>` before
swapping (they run from `w84` up), then `systemctl restart salt`.

Frontend and backend must be built with the SAME version string, or the
"reload" banner fires forever (that bug is fixed; do not reintroduce it by
building one side without `SALT_VERSION`).

## State

**Deploy finished work to the test server without asking** — the owner wants to
look at it, not read about it: build, run the gate, roll out, then report.
**Production and pushing to GitHub stay closed** until he says otherwise. Local
commits are fine. Name the address in the report either way — see the table
above for why.

**1.4.0 is the English-first release** and is on GitHub (`origin/main`), on
production and on the test box. Verified on each: search index rebuilt (736
pages on test, 659 on production), login answers `{"code":"bad_credentials"}`
with English text, frontend and server report one version, no console errors,
and the interface comes up in **German** from the catalog while the source is
English — the whole point, proven on real data.

Nothing a user reads is German any more. That took three passes, and the third
found what the first two could not: `/public/{token}` — the password prompt for
a shared page — was a **complete German HTML page served to strangers**, and it
had been missed twice because the German sits inside a long HTML string. The
Go-side check found it, not a person. Also converted: twelve login errors, seven
mailbox-connection errors (both travel as codes in the query string now, see
`loginErrorRedirect`), and both **emails**, which go out in English because an
invitation reaches somebody who has no account and therefore no known language.

Branch `public` is **4 commits ahead of `origin/main`** — the translation work
after 1.4.0. Test box runs `1.4.1-dev`, production stays on `1.4.0`.

**No `v1.4.0` tag has been pushed.** A `v*` tag fires both
`.github/workflows/release.yml` and `docker.yml`, which publish platform
binaries to a GitHub Release (where `install.sh` fetches from) and an image to
GHCR. That is a separate decision from pushing code, so it waits for a word.

Rollback: test server `/opt/salt/salt.bak-w112`, production the 1.0.2 image plus
`/root/salt-backups/salt-data-20260726-073629-vor-1.4.0.tar.gz`. Production
migrated 1.0.2 → 1.4.0 in one jump and came up clean.

Production's Cloudflare tunnel loop-failed for hours and it was **not the
tunnel**: the box's nameserver (`10.10.20.1`, the gateway) answered nothing, so
`cloudflared` could not resolve `region1.v2.argotunnel.com`. Routing was fine
the whole time — `dig @1.1.1.1` worked, `dig @10.10.20.1` timed out. If it
happens again, compare those two before touching anything. The same fault is
why `docker build` cannot pull on that box: not "no internet", no DNS.

## What's next, in order

**1. Finish the comment sweep — 459 German lines in 17 files.** They are listed
by name in `pendingTranslation` in `server/language_test.go`; that list IS the
work queue. Largest: `ingest.go` (63), `mcp_schema.go` (52), `mcp_pages.go`
(49), `mcp.go` (30), `audit.go` (30), `mcp_workspace.go` (28).

The method that worked, one file at a time:

```bash
# see what a file still has
grep -nE "[äöüßÄÖÜ]" server/ingest.go
# translate, then:
go build ./... && go test ./server/ -run TestSourceIsEnglish
```

Rewrite comments with a small Python replace script rather than many Edit
calls — exact-match on the full comment block, and print what did NOT match so
a silent miss is impossible. **Remove the file from `pendingTranslation` in the
same commit**; `TestNoStalePendingTranslation` fails if you forget, which is the
point of it.

Keep German where German is the *subject*: search-folding examples, import
fixtures. Mark those `// i18n-ok: <reason>` on the same line as the German — a
marker one line above does not count.

**2. `docs/suche-und-ki.md`** (289 lines, German prose). Not covered by any
check; it is the design document for search and AI.

**3. Language and time settings — Auto/Manual.** Agreed with the owner and not
started. Today there is **no language picker in the interface at all**: the only
way to switch is the `salt-locale` key in localStorage. Timezone and clock
format are never asked, they come silently from the browser.

His requirement, verbatim in intent: *somebody may not want it to follow their
browser language, or the system clock is wrong* — so **every** value gets
Automatic (today's behaviour, stays the default) or Manual:

| Setting | Automatic | Manual |
| --- | --- | --- |
| Language | `navigator.languages` | pick from `LOCALES` |
| Region format | browser's regional tag | e.g. `de-AT`, `en-GB` |
| Time zone | system zone | any IANA zone |
| Clock | what the region implies | 12 or 24 hours |
| Week starts | what the region implies | Monday / Sunday / Saturday |

Three decisions already taken: settings live **on the account**, not in
localStorage, or the phone and the laptop disagree — which is the thing he
wants gone; localStorage stays as a cache so the first paint is not briefly
wrong. `format.ts` and `i18n.ts` are already the only choke points, so no call
site changes. And **`formatDay` must stay unconverted whatever the timezone
setting says** — a deadline on the 18th is the 18th; that is the one place a
timezone preference can do real damage, and `check-format.mjs` has to grow an
assertion for it.

## Working agreement

Local commits freely. **Test server without asking** — he wants to look at the
result, not read about it. **Production and `git push` only on his word.**
Explain simply, in German, with concrete numbers; when something might break,
say first what *cannot* break. He asks for a plan before anything structural,
and for mechanical work he wants it carried through to the end.
