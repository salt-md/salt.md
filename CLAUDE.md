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
  prefs.go           per-account language/time settings; '' means automatic
  mcp*.go            MCP tools
web/src/
  i18n.ts            t(), plural(), locale switching
  format.ts          THE ONLY place that formats dates, numbers, sorting
  serverErrors.ts    server error code → translated message
  components/LanguageTime.tsx  the settings dialog (language, region, zone,
                     clock, week start)
  locales/de.json    German catalog (701 entries)
  scripts/           check-i18n.mjs, check-format.mjs, translate.mjs
docs/search-and-ai.md  design paper: local semantic search, stages 0-2
```

## Conventions that are easy to break

**English first, always.** Source text is English and doubles as the
translation key: `t('Manage users')`. Comments are English too — they carry the
*why*, and unlike the interface they will never get a translation layer.

**A database is a "collection" to people and a "database" to agents** (W119).
The interface says Collection / Sammlung — it covers table, board, calendar and
gallery alike, promises no SQL, and matches what the code has always called it
(`type: 'collection'`, `/api/collections`). The MCP surface keeps `create_database`,
`embed_database`, `database_id` and its own error texts: renaming a tool breaks
every agent config out there, and an agent reads a schema, not marketing. Do not
"fix" one side into the other. Two words in the interface stay `Database`
literally — the backup section's SQLite file size and its restore note, which
really are about the database file.

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

**`npm run check` enforces all of it** in three sections, and fails the build on
a bare string, a stray `toLocale*`, a catalog that has drifted, or **German
anywhere in `.ts`, `.tsx` or `.css`**. `locales/` is exempt — it IS the German.
A line may opt out with `// i18n-ok: <reason>` — the reason is mandatory, and it
has to sit on the line itself.

`node scripts/check-i18n.mjs --german` lists the German by file, `--bare` the
unwrapped strings. Section 3 exists because the JSX rule structurally cannot see
everything: it tolerates one line break and no `{}` or `<>` inside the text, so
a German paragraph over three lines with a `<code>` in it walked straight past
— twice, and both were on screen.

**`go test ./...` enforces the same on the server** (`server/language_test.go`),
in two tests that catch different things:

- `TestSourceIsEnglish` — a *line* reading as German fails the build. Two German
  words or an umlaut, which suits **prose**; plus `germanStrong`, where ONE
  unambiguous word is enough, because short remarks like
  "laufende Massenimporte (siehe …)" sat in server.go through three passes that
  all reported clean.
- `TestUserFacingStringsAreEnglish` — a *string literal* reading as German
  fails. **One** German word is enough, because that is the shape short
  interface text has. "Nicht gefunden" is one word and no umlaut, so the line
  rule would never see it, and that is precisely the class that reaches users.

Same escape hatch for both, same mandatory reason (`i18n-ok: <reason>` on the
line itself — a bare marker does not count); whole files whose German IS the
subject carry a file-level marker. `pendingTranslation` is the old debt list and
is **empty**; a second test fails if a clean file is put back on it.

**Neither check is a proof, and the word lists will miss things.** When it
matters, audit exhaustively instead: enumerate every string handed to
`httpError`/`httpErrorCode`/`fmt.Errorf`/`errors.New`/`loginErrorRedirect` and
read them (422 calls, 239 unique texts — small enough for a person), and run a
one-German-word pass over comment lines and check the hits by hand. That is how
the last eight German texts were found *after* both tests read clean — and four
more, in server.go, the day the code was about to be pushed in public.

**An error that fails deep can still carry a code.** `coded(code, msg, detail)`
plus `httpErrorFrom(w, status, err)` — for failures that happen several calls
below the handler, like the mail path, where `err.Error()` used to arrive at the
browser as untranslatable English. `detail` carries text the PROVIDER wrote,
which nobody can translate, so it travels beside the sentence.

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

`check-format.mjs` runs `format.ts` under six timezones (228 assertions),
including that the calendar's first weekday agrees with its column headers, and
— since W112 — that **`formatDay` ignores the timezone setting entirely**. That
last one is the load-bearing assertion of the whole settings feature: break it
and a deadline of `2026-01-01` renders as `2025-12-31` for anybody who set a
western zone. Two builders keep it honest: `dtf()` never carries a zone,
`dtfZoned()` always does, and nothing that formats a DAY may call the second.

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

## The release path — fixed, one direction

The repo is public and marketing is coming. This sequence is the whole of it;
**he decides when anything goes live**, and no step runs ahead of its word:

1. **Work locally, together.** Session/worktree branches base on
   `origin/main` — run `git fetch` and CHECK the base first: worktrees branch
   from the local `main` by default, and that has already been a stale,
   rewritten line once (a whole session started on 1.2.0 while GitHub was at
   1.5.2).
2. **Deploy to the test box** `172.16.0.115` without asking — that is where he
   looks at the work. The tunnel makes it publicly reachable; "test" names the
   stage in this path, not the visibility.
3. **`git push` to GitHub only on his word.** Local commits are always fine.
4. **Tag on his word — the tag IS the release act.** A `v*` tag fires
   `release.yml` (platform binaries on a GitHub Release, where `install.sh`
   downloads from) and `docker.yml` (`ghcr.io/salt-md/salt.md:<ver>` +
   `:latest`). Tagging is a separate decision from pushing and waits for its
   own word. **Version numbers move modestly**: patch bump by default
   (1.6.0 → 1.6.1), even for a feature — a minor bump is for something
   genuinely big, and he says when that is (said so on 1.6.1, after a 1.7.0
   was almost stamped for three workspace-rules commits).
5. **Production** (`10.10.20.20:8420`, Proxmox in the Hetzner cloud) **only
   after the tag's build is green**, only from the tagged artefact, never from
   hand-copied source (mechanics and the GHCR-visibility caveat below). The
   final `docker stop` on that box is his — the permission layer refusing it
   is the design.

No shortcuts between stages, no deploy that skips the test box, no tag without
a green conscience about what is on it. When he says "auf GitHub", that means
step 3 — 4 and 5 still wait for their own go.

**Planned, not done: the org may be renamed** — `salt-md/salt.md` →
`salt-labs/salt.md`. If it happens, the `origin` remote, the GHCR image path
in `docker.yml`, `install.sh`'s download URL and the README links all move
together: grep for `salt-md/` and treat it as one public-facing change, on his
word like the rest.

## The two servers — do not mix them up

| Address | What it is | Reached via |
| --- | --- | --- |
| `http://172.16.0.115/` | **test** server, LXC 115 | `ssh root@172.16.0.10` → `pct` |
| `http://10.10.20.20:8420` | **PRODUCTION** — the owner's real instance | `ssh root@10.10.20.20` |

This table used to carry a Version column and it was wrong within a week —
read the version from the startup log on the box itself (`journalctl -u
salt`), never from this file and never from `--version` (see below).

The test box answers on **port 80**, production on **8420** — a bare
`10.10.20.20` in a command is a strong hint that something is aimed wrong.

`10.10.20.20` is production and is **never hand-deployed to**, and **nothing is
built on it**. The path is:

```
local  →  test server (172.16.0.115)  →  git push  →  GitHub Actions
       →  ghcr.io/salt-md/salt.md:<version>  →  docker pull on production
```

Pushing a `v*` tag is what makes the package: `.github/workflows/docker.yml`
builds it and pushes `ghcr.io/salt-md/salt.md:<ver>` **and** `:latest`. It takes
about two minutes — check with `gh run list`. Production then pulls that exact
image. It holds 659 real pages.

**Do not run `docker build` there.** It was done once and it is the wrong shape:
it makes the box a build host, it produces an image nobody else has, and the
resulting tag is a claim rather than a published artefact. If you catch yourself
copying source to production, stop — the answer is a tag.

- Docker container `salt`, named volume `salt-data` → `/data`. Root SSH by key.
- **DNS works** (nameserver `10.10.20.1`; `ghcr.io` resolves, `docker pull`
  succeeds). It did not for a while, and this file claimed for longer that it
  never does — which is what sent one instance down the build-on-production
  road. Check, do not believe the note.
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

The whole production deploy, once the tag's build has gone green:

```bash
ssh root@10.10.20.20 'docker pull ghcr.io/salt-md/salt.md:1.5.2'   # nothing else changes
ssh root@10.10.20.20 'docker stop salt \
  && tar czf /root/salt-backups/salt-data-$(date +%Y%m%d-%H%M%S)-vor-1.5.2.tar.gz \
       -C /var/lib/docker/volumes/salt-data/_data . \
  && docker rm salt \
  && docker run -d --name salt --restart unless-stopped \
       -p 8420:8420 -v salt-data:/data ghcr.io/salt-md/salt.md:1.5.2'
```

The pull is free — it changes nothing until the container is replaced, so it can
always be done ahead of time. The stop is the only moment of downtime and it is
also the only moment a clean volume backup is possible; do both in one command.
**`docker stop` on that box is refused by the permission layer** — the owner
runs that line. That is the design, not an obstacle to route around.

**Verify by behaviour, never by the version string.** A mislabelled image reads
exactly like a correct one. Pick something the new code has and the old does not
— a route that answers `401` instead of the SPA fallback, a marker in the served
bundle — and check that.

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
tarball. **No `curl`** in it — and there is no need: `172.16.0.115:80` answers
from this machine, so smoke-test with `python3 urllib` locally.

**Never run `/opt/salt/salt --version` on that box.** It does not print a
version, it starts a SECOND server as root beside the running service and hangs
the ssh call. It has happened twice. The version is in the startup log
(`journalctl -u salt`) — read it there.

Ship it like this (roughly six minutes end to end):

```bash
cd web && SALT_VERSION=1.5.0-dev npm run build    # the gate runs inside this
cd .. && tar czf /tmp/salt-src.tgz --exclude='web/node_modules' --exclude='.git' \
  main.go go.mod go.sum Makefile server web/dist
scp /tmp/salt-src.tgz root@172.16.0.10:/tmp/
ssh root@172.16.0.10 'pct push 115 /tmp/salt-src.tgz /tmp/salt-src.tgz'
ssh root@172.16.0.10 'pct exec 115 -- sh -c "
  rm -rf /tmp/saltbuild && mkdir -p /tmp/saltbuild
  tar xzf /tmp/salt-src.tgz -C /tmp/saltbuild && cd /tmp/saltbuild
  CGO_ENABLED=0 go build -trimpath \
    -ldflags=\"-s -w -X salt/server.Version=1.5.0-dev\" -o salt .
  cp -a /opt/salt/salt /opt/salt/salt.bak-w115
  systemctl stop salt && cp salt /opt/salt/salt && systemctl start salt"'
```

The macOS `tar` adds `LIBARCHIVE.xattr.com.apple.provenance` headers that GNU
tar complains about on every file — noise, not an error.

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

**The source is English — server, frontend and docs.** `go test` reports zero
German lines and zero German strings; `npm run check` reports no German in
`.ts`, `.tsx` or `.css`; `pendingTranslation` is empty. Deployed on the test box
as `1.4.3-dev` and checked against what is actually served: the German strings
gone from the binary, `tunnel: connected` in the log where it used to say
`verbunden`, and the German catalog chunk still carrying the German — English
source, German interface, proven end to end on a running instance.

That took seven passes, and **each one found what the last could not** — worth
knowing, because it says something about what a check can and cannot do:

1–3. the interface, then the server messages, then the comments.
4. **The check found what people had missed twice**: `/public/{token}`, the
   password prompt for a shared page, was a complete German HTML page served to
   strangers. The German sat inside a long HTML string, which is why reading
   never caught it.
5. **People found what the check could not**: after everything read clean, eight
   German texts were still there — a SECOND German 404 page for anonymous
   visitors, the print bar of the HTML export, the admin test mail, four mail
   errors and one settings message. All below the two-word threshold.
6. **The frontend had no language check at all.** With the server clean, a scan
   of `web/src` found **425 German lines** — and two of them were user-visible
   JSX the string rule could not reach: the index hint and the emergency-access
   dialog. Section 3 of `check-i18n.mjs` closes that.
7. **styles.css**, 238 lines, the last of it.

And the Go check had exempted **itself**: `exemptFile`'s pattern matched its own
source, so `language_test.go` was the one file nobody checked, with two German
lines hiding behind it. The marker is assembled from a constant now. The first
attempt at the comment explaining this re-created the bug by spelling the token
out — so do not name the token in that file.

Also converted earlier: twelve login errors, seven mailbox-connection errors
(both travel as codes in the query string, see `loginErrorRedirect`), and both
**emails**, which go out in English because an invitation reaches somebody who
has no account and therefore no known language.

**One consequence to know about:** five admin-only mail errors are English in
the interface now, where they used to be German. They carry no error code, so
`serverErrors.ts` cannot translate them. Giving them codes is a small, separate
job — not done, deliberately, because it changes API responses.

**1.5.0 is released.** Branch `public` is level with `origin/main`, the tag
`v1.5.0` is pushed, and both workflows went green: platform binaries hang off
the GitHub Release, and `ghcr.io/salt-md/salt.md:1.5.0` and `:latest` are in
GHCR. Test box runs `1.5.0`.

**Production runs `1.5.0`.** Deployed by the owner (the permission gate refuses
`docker stop` on his live instance, which is right). Verified afterwards: the
five `pref_*` columns are there, 1416 pages / 677 active / 4 accounts / 5
workspaces intact, the search index at 677 rows agrees with the active pages,
and no account carries a manual setting — everything automatic, which is the
correct state for a migration that only adds defaults. Startup log is three
lines with no rebuild and no error. Backup before it:
`/root/salt-backups/salt-data-20260726-155337-vor-1.5.0.tar.gz` (21M, gzip
verified); the `salt.md:1.4.0` image is still on the box for a rollback.

**Production runs `1.5.3`** (2026-07-30), for the first time through the whole
fixed path in one line: anonymous `docker pull` from GHCR, stop + volume backup
+ swap in one command — on his explicit word, the permission layer let it
through this time. Verified by behaviour: `.cp-bar`, `color-scheme:dark`,
`scrollbar-width:none`, `asTemplate=1` and the tab menu item all in the served
bundle; three-line startup, no rebuild. Backup:
`/root/salt-backups/salt-data-20260730-085502-vor-1.5.3.tar.gz` (21M, gzip
verified); the `1.5.2` image stays on the box for a rollback.

**Production runs `1.6.1`** (2026-07-30 19:31), on his word ("push live"):
anonymous pull from GHCR, stop + volume backup + swap in one line — the owner
had deployed `1.6.0` himself in between (backup `…-vor-1.6.0` from 16:44), so
this hop was 1.6.0 → 1.6.1. Verified by behaviour: `ws-rules-view`,
`Load into editor` and `has-pending-dot` in the served bundle (workspace
rules, W123–W123c); three-line startup, no rebuild. Backup:
`/root/salt-backups/salt-data-20260730-193133-vor-1.6.1.tar.gz` (22M, gzip
verified); the `1.6.0` image stays on the box for a rollback.

**Production runs `1.6.2`** (2026-07-31 17:30), on his word ("deploy auf pod"):
push → tag → both workflows green → anonymous pull → stop + volume backup +
swap in one line. Verified by behaviour: `/api/health` answers `1.6.2`,
`card-fact-label` and `person-stack-av` in the served CSS, `/api/files` and
`Add sub-page` in the bundle; four-line startup, no search-index rebuild (the
schema was recognised). Backup:
`/root/salt-backups/salt-data-20260731-173053-vor-1.6.2.tar.gz` (23M, gzip
verified); images `1.6.1`, `1.6.0`, `1.5.3` are still on the box.

**Production runs `1.6.3`** (2026-08-01 00:19), on his word ("push live"): the
hotfix for the outage below. Startup proves both halves in two lines — `file
index: built (version 2, 626 files on 248 pages, 0 unreferenced)` and `memory:
… PDF indexing up to 50 MB, 3 extraction(s) at a time`. `/api/health` answers
`1.6.3`. Backup: `/root/salt-backups/salt-data-20260731-221915-vor-1.6.3.tar.gz`
(366M — the first backup that contains the file store).

**The file store is no longer empty** — the paragraph here used to say it was,
and that was true on 2026-07-31 at 17:30. An agent then uploaded ~626 files
(~340 MB) over MCP, and `list_files` reported none of them: the MCP upload path
never called `recordFile`, only the HTTP one did. Fixed in 1.6.3, and
`filesVersion 2` rebuilt the index on start, which is where the 626 above come
from. If a count ever looks wrong again, the index is derived — bumping
`filesVersion` rebuilds it from the blocks and the files directory.

**A 24 MB PDF took production down** (2026-07-31, ~22:00): port open, HTTP
dead, the host so short on memory that sshd could not start a session. Not the
single DB connection — `extractPDFText` parsed any document whole and capped
the text only afterwards, so one large file allocated a multiple of its size.
`recover()` does not help; an OOM kill is not a panic. 1.6.3 refuses before
reading (Content-Length, then the base64 length), caps during extraction rather
than after, and queues extractions. The owner raised the box to 16 GB during
the incident.

**Memory detection under-counts on this box, and it is nested virtualisation.**
`availableMemory()` reads 63413 MB there — the Proxmox host's figure — because
production is an LXC (16 GB, `free` says so) running Docker WITHOUT
`--memory`, so the container's `memory.max` is `max` and `/proc/meminfo` shows
the outermost host. The practical effect today is small: both the 50 MB
extraction cap and the 3-slot ceiling are the same at 16 GB as at 63 GB, so
only `SetMemoryLimit` is too generous. It would matter on a small instance.
The fix is operational, not code — add `--memory=14g` to the `docker run` and
the cgroup file starts telling the truth.

**Reading that database from outside needs the WAL.** `docker cp salt:/data/salt.db`
alone shows a stale schema — the migration sat in `salt.db-wal` and the copy
looked as if it had never run. Copy `salt.db`, `salt.db-wal` and `salt.db-shm`
together, or conclude nothing.

**GHCR is public now** — proven 2026-07-30: production pulled `1.5.3`
anonymously, no `docker login` on the box. This paragraph used to claim the
opposite (and before that, the DNS note was wrong the same way); both claims
sent an instance down the build-on-production road. If a pull fails, diagnose
THAT failure — auth and DNS separately — instead of trusting either note. The
build-from-tag fallback needs `DOCKER_BUILDKIT=1` (the Docker there is too old
for `$BUILDPLATFORM`), but it is the last resort, not the path.

A `v*` tag fires both `.github/workflows/release.yml` and `docker.yml`, which
publish platform binaries to a GitHub Release (where `install.sh` fetches from)
and an image to GHCR, `latest` included. Both take the version from the tag, so
`server.Version` only matters for local builds. Tagging is a separate decision
from pushing code and waits for a word.

Rollback: test server `/opt/salt/salt.bak-w118`, production the 1.0.2 image plus
`/root/salt-backups/salt-data-20260726-073629-vor-1.4.0.tar.gz`. Production
migrated 1.0.2 → 1.4.0 in one jump and came up clean.

Production's Cloudflare tunnel loop-failed for hours and it was **not the
tunnel**: the box's nameserver (`10.10.20.1`, the gateway) answered nothing, so
`cloudflared` could not resolve `region1.v2.argotunnel.com`. Routing was fine
the whole time — `dig @1.1.1.1` worked, `dig @10.10.20.1` timed out. If it
happens again, compare those two before touching anything. The same fault is
why `docker build` cannot pull on that box: not "no internet", no DNS.

## Files and the sidebar tree (W124, W125)

**A database row with sub-pages is part of the tree.** `/api/pages` still
drops database rows — except rows that carry a live sub-page, because without
the row the sub-pages have no parent and the sidebar showed them flat under
Documents. Bare rows stay out (that is the tens-of-thousands argument), and
Documents lists only pages whose ancestry never passes through a database.
Rows also carry the same "+" as pages now: before that, a dossier under a deal
was something an agent could build over MCP and a person could not build at
all.

**The file index is derived, and rebuildable on purpose.** `files` holds one
row per upload (human name, type, size, date, carrier page); the truth remains
the block on the page and the byte on disk, so `filesVersion` forces a rebuild
the way `ftsVersion` does. The rebuild matches on **a url pointing into
`/files/`**, not on block types — BlockNote writes file/image/video/audio, the
MCP upload writes its own two, and that list keeps growing. It also indexes
what no page references any more: those files were previously invisible while
sitting in every backup.

Reading it (`GET /api/files`, `list_files` over MCP) runs the **same two
permission stages as search**: workspace scope, then `canRead` per carrier
page. The second stage is what keeps somebody else's private page private.

Uploads must carry their page id (`/api/upload?page=…`). The editor did not
pass one, so a PDF dropped into a page in the browser never reached the search
index while the same PDF added by an agent did — fixed in W125, and it is the
reason the file index needs no separate "which page was that" guess.

Workspace logos and account avatars are uploads too, but they hang off
`workspaces.image` / the user row rather than a page, so the index counts them
as unreferenced. They never show in a workspace file list (no workspace id);
anything that later offers to delete "unreferenced" files has to exclude them
first.

## What's next

The translation wave (W111) is finished, and so is **W112**, the settings that
came out of it. Since then: **W113**, a Markdown link to a page of this instance
becomes a real `pageLink` on import (see `pageHrefRe` in mdimport.go) — until
then everything an agent wrote was an island in the graph, because the backlink
index and the graph read `pageLink` and nothing else. And **W114**, outbound
webhooks (webhooks.go, admin dialog → Webhooks). Nothing is queued — ask the
owner.

**W114 in one line:** Salt.md had nothing that reaches OUT, which is the single
reason it looked like it had no integration story next to Notion. Three things
about it that must not be undone: the payload names a page and never carries it;
delivery goes through `safeDial`, so a webhook URL cannot be pointed at
169.254.169.254 or the router; every delivery is signed
(`X-Salt-Signature: sha256=…`). The secret is shown exactly once, on creation.

**W112 as built**, since the shape is worth knowing before touching it:

| Setting | Automatic | Manual |
| --- | --- | --- |
| Language | `navigator.languages` | any code in `LOCALES` |
| Date and number format | browser's regional tag | a curated list (`de-AT`, `en-GB`, …) |
| Time zone | system zone | any IANA zone the browser knows |
| Clock | what the region implies | 12 or 24 hours |
| Week starts on | what the region implies | Monday / Sunday / Saturday |

Four things about it that are easy to undo by accident:

- **Automatic is the empty string, everywhere** — column, JSON, `<select>`
  value. The absence of a decision and the automatic mode are one state, so
  there is no third case to handle. Do not introduce an `"auto"` sentinel.
- **They live on the ACCOUNT.** localStorage (`salt-prefs`) is a first-paint
  cache so the login screen is not briefly in the wrong language, and it
  migrates the old `salt-locale` key. It is never the source of truth — the
  whole point was that the phone and the laptop agree.
- **`PUT /api/me/prefs` is its own endpoint**, not a field on
  `PATCH /api/users/{id}`, because that route lets an admin edit somebody else
  and nobody should be able to set another person's clock format. `sessionOnly`:
  an API token is a key to content.
- **The server validates SHAPE only**, including for the timezone: the binary
  carries no tzdata (CGO off), so `time.LoadLocation` would reject valid input.
  The browser is the authority, and `build()` in format.ts drops a zone it
  cannot use rather than letting one bad setting blank out every timestamp.
- **The language applies on SAVE, the formats preview live.** Not cosmetic:
  changing the language remounts the whole tree (`key={locale}` in main.tsx),
  which destroys the open dialog and re-runs App's mount effect — and that
  re-fetches `/api/me` and re-applies the still unsaved value. The first
  version did exactly that and looked like a dropdown that did nothing. Use
  `previewFormat()` for anything that must not remount; `applyPrefs()` only
  once the value is stored.

## Licence

**AGPL-3.0** since 2026-07-26. It replaced PolyForm Noncommercial, which
forbade ALL commercial use — including a company simply running Salt.md for its
own team, which is the exact door the project wants open.

The model the licence is chosen for: small teams self-host for free, and when
they outgrow self-hosting they buy the hosted version. AGPL protects that
crossing — a competitor may host Salt.md, but has to publish their changes,
so running the product against its author is unattractive. It does not forbid
it; the moat is the trademark, being upstream, and whatever is built on top.

Deliberately absent: no CLA (there are no outside contributors, and open-core
work belongs in its own repository under its own terms), and no trademark
filing yet. The README asks for a fork to carry its own name.

Known cost: some large companies ban AGPL outright. Apache-2.0 would reach them
and would also let anyone close the code and sell it — the two cannot be had
together.

Not legal advice, and none was bought. What keeps the risk small is that the
text is a standard one, adopted unchanged.

## Working agreement

The release path above is the law of this repo: local → test box → push →
tag → production, one direction, each public step on his word.

Local commits freely. **Test server without asking** — he wants to look at the
result, not read about it. **Production and `git push` only on his word.**
Explain simply, in German, with concrete numbers; when something might break,
say first what *cannot* break. He asks for a plan before anything structural,
and for mechanical work he wants it carried through to the end.
