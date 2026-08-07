# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Salt.md

Self-hosted Notion alternative. One Go binary serves the API, the MCP endpoint,
the Yjs collab relay, an SSE change feed and the embedded React frontend.

Go 1.25 · `modernc.org/sqlite` + FTS5 · **CGO_ENABLED=0** · React 18 / Vite /
BlockNote / Yjs.

(Line and file counts used to stand here and were wrong within weeks — 51 files
when there were 70, 701 catalog entries when there were 814. Same failure as the
version column that was removed from the server table below: a number nobody
updates is worse than no number. Count it when you need it.)

## Build and run

```bash
make build      # frontend (npm) + backend, embeds web/dist via go:embed
./salt          # → http://localhost:8420
```

`make frontend` runs `npm run build`, which runs `npm run check` first — that
gate is load-bearing (see i18n below), so do not bypass it with a bare
`vite build`.

Env: `SALT_DATA` (data dir), `SALT_ADDR` (listen address), `SALT_MEMORY_MB`
(how much memory to assume — see below).

**Expensive work is sized to the machine** (`server/memlimit.go`). The PDF
extraction limit and how many extractions run at once come from the memory the
process believes it has: the cgroup cap first, then `/proc/meminfo`. A
container with **no** cap is treated as a small machine (2 GB) rather than as
large as its host — the host figure is not a promise, and assuming it is how a
512 MB container talks itself into work that gets it killed. `SALT_MEMORY_MB`
overrides everything and is the only answer for nested setups (Docker inside
LXC), where neither source knows the truth. Getting this wrong only ever
changes how much text reaches the search index, never whether an upload
succeeds.

## Layout

```
main.go              go:embed all:web/dist
server/*.go          one concern per file
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
  locales/de.json    German catalog
  cardLayout.ts      which zone a property gets on a board card (W126)
  scripts/           check-i18n.mjs, check-format.mjs, check-cardlayout.mjs
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

**Derived properties are computed on read, never stored** (`server/derived.go`).
Rollups, formulas and — since 1.6.6 — backrelations are filled into each row's
props by `computeDerived`, in that order: a backrelation produces an id array
shaped exactly like a relation's, so a rollup can aggregate over it. That order
is what makes "how many of the tasks pointing at this system are done"
expressible at all.

A **backrelation** is the reverse of a relation somebody else declared
("`backrelationCollection` + `backrelationProp`"). Storing the reverse side
would mean keeping two lists in step on every write from both directions, and
the first missed update leaves them disagreeing with no way to tell which is
right. It costs one query plus a scan instead. **Permission checks are per row,
same as a forward relation** — without them the column reveals that rows exist
in collections the caller may not read.

A **rollup may carry a condition** (`rollupWhereProp/Op/Value`). No condition
means every related row counts, so rollups written before this existed keep
their meaning. An unrecognised operator compares for equality rather than
matching everything: the convenient reading would turn a typo into 100 % done.

**A board card is zones, not a field list** (`web/src/cardLayout.ts`, W126), and
`check-cardlayout.mjs` holds the mapping. A relation is a chip there; its
reverse is `hidden`, because on a system row that would be every task pointing
at it. The property a board groups by is dropped from its own cards, so showing
a relation never repeats its column heading.

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
go test ./server/ -run TestExtractPDFText -v   # one test, or a prefix
go test ./server/ -run 'TestRollup|TestBackrelation' -v

cd web && npm run check          # tsc + i18n + timezone + card layout
node scripts/check-i18n.mjs --missing de       # what still needs translating
node scripts/check-i18n.mjs --german           # German that slipped into code
node scripts/check-cardlayout.mjs              # just the card zones
```

`npm run check` is what `npm run build` runs first, so a failing check fails the
build — that is deliberate, do not reach for a bare `vite build` to get around
it.

**Running the thing while developing**: the backend on its own port and Vite in
front of it, which proxies `/api`, `/files` and `/collab`:

```bash
SALT_DATA=/tmp/salt-dev SALT_ADDR=:8420 go run .
cd web && npx vite                             # SALT_PROXY if the port differs
```

The env names carry a `SALT_` prefix (`server.Env` prepends it). A bare
`DATA=…` is silently ignored and the server writes into `./data` — which is how
a stray `data/` directory once appeared inside the repo.

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

   **And they move rarely.** Several pieces of work go into ONE release; a
   finished fix is not a reason to tag. Said on 1.6.8: "wenn ich das erste mal
   marketing für salt mache sind wir bei version 10 — wir müssen kompakter
   werden, mehr in eine version". The project goes public, and a high number
   after a short time reads as thrashing. Commit locally and deploy to the test
   box as `<next>-dev` as often as you like — that costs no number. Propose a
   tag only when a release's worth is in it.
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

**And the history will not survive the launch.** At the real public launch the
repo is reset and started again from a single initial commit, with the company
behind it changing at the same time (his words, 2026-08-02; the details are for
later). Two consequences worth knowing now: German commit messages in an
English-first repo are not a defect to fix — they do not outlive the reset — and
no work that only tidies the history (rebasing, rewriting messages, unifying
authors) is worth doing.

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

**Production runs `1.6.15`** (2026-08-07 08:12), on his word ("push live" /
"und auf prod ausrollen"): comments as a side panel, the two right-hand panels
made one thing, and a database no longer offers a comment button it cannot
honour.

**Always `wget -O`, and never trust a `sha256sum -c` you did not aim.** This
deploy briefly put **1.6.10** on production and reported success on the way.
`wget` does not overwrite: `/tmp/salt-linux-amd64` from the 1.6.10 deploy (Aug
2) was still there, so the download landed as `salt-linux-amd64.1` — and
`SHA256SUMS.txt` did exactly the same. The verification then compared the OLD
binary against the OLD sums and said `OK`, which is the part worth remembering:
a checksum check passes just as happily on a matched pair of stale files. It
was caught by comparing the INSTALLED binary against the checksum read from
GitHub *locally*, which is the check that cannot be fooled this way — do that
one, on both sides of every swap. Damage was none: an older binary sees a newer
schema and simply ignores the columns it does not know (migrations only run
forward), so the log was three lines with no rebuild, and the volume backup had
already been taken before the wrong start. Download into a fresh per-version
directory now.

Checksums on both sides: `ff93f2e4…` (published `v1.6.14`) before,
`0da9a08a…` (published `v1.6.15`) after. Verified by behaviour: `.trail-wrap`,
`--panel-w: 340px`, `.structure-scroll` and the panels' `border-top` all in the
served CSS. Four startup lines, no index rebuild, 649 files, 480 MB of data.
Backup: `/root/salt-backups/salt-data-20260807-081122-vor-1.6.15.tar.gz`
(385M); `/opt/salt/salt.bak-1.6.14` sits beside it and its checksum is the
published one too. 22G free.

**Production runs `1.6.14`** (2026-08-07 05:57), on his word ("ja push auf
prod"): documentation for people, a desktop app, and a sign-in that goes
through the real browser.

The **wiki** (`wiki/`, 21 pages, English) is the big one, and the rule it was
written under matters more than the pages: derived from the code, never from
memory and never from the Vorgänge — the workspace only knows what somebody has
written down, the code knows everything. `check-wiki.mjs` holds the mechanical
half in the gate. Asked whether it covered the whole system, a one-second
measurement against the route table found thirteen unmentioned families, three
of them genuinely missing (favourites, the audit log, `/api/health`).

He caught what no check could: the first draft named three of his customers in a
tree diagram, written while looking at his live instance and headed for a public
website. The check now refuses real IPs, hostnames and mail domains; the company
name half is a written rule. The same pass found "e.g. VIICO Notes" — his own
company — shipping as the instance-name placeholder to everyone who installs.

A **desktop app** (`desktop/`, Electron, a shell around a server) and with it
`/desktop/login`: signing in through the REAL browser, PKCE, an approval page
against login-CSRF. The app carries its own window CSS rather than expecting the
server to have it — that lesson cost two rounds, and the same mistake then
repeated itself when the sign-in ran against a route his instance did not have
yet. It probes first now.

Plus **right-click** everywhere the ⋯ menu exists.

**The tag was moved once, deliberately.** Docker failed on the first v1.6.14:
`npm run build` runs the whole gate, and check-wiki.mjs reads files outside
`web/`, which the image did not copy. Rather than burn a version number on a
one-line CI fix, the tag was deleted and re-cut on the fixed commit —
`softprops/action-gh-release` overwrites assets, so a second run is safe. Ten
minutes old, nobody had consumed it.

Checksums on both sides: `7919f22a…` (published `v1.6.13`) before,
`ff93f2e4…` (published `v1.6.14`) after. Verified by behaviour:
`/desktop/login?challenge=probe` answers `400` where an unknown path falls
through with `200`. Four startup lines, no index rebuild. Backup:
`/root/salt-backups/salt-data-20260807-055723-vor-1.6.14.tar.gz` (402M, gzip
verified); `/opt/salt/salt.bak-1.6.13` sits beside it. 22G free.

**Production runs `1.6.13`** (2026-08-06 16:01), on his word ("ja bring es
live"): a regression, a picture and two handles.

The regression was mine, shipped in 1.6.12 and reported the same afternoon:
in **mixed** tree mode a database filed under a document vanished from the
sidebar while the page count went on counting it. The split-mode filter kept
running where there is no second section to show it. The rule now lives alone in
`web/src/treeMode.ts` with `check-treemode.mjs` in the gate — the same decision
had gone wrong twice, in opposite directions, and neither time did anything
fail, because a tree that quietly omits a page still looks like a tree.

Then the **graph** (a tab in the library): every page a dot, every connection a
line, canvas and no library, ~40 lines of force simulation. Two edge kinds kept
apart — where a page is FILED (thin, the sidebar says it too) and where a page
MENTIONS another (bright, the thing no tree can show). Coloured by ROOT, not by
workspace: by workspace was the obvious choice and useless in the common case,
where everything lives in one and the whole picture came out one shade of green.
Colours go to the biggest family first so the house green lands on what the
instance is about.

Plus a **workspace picker** in the library — it was the only screen in the
product that spanned all workspaces at once, while the sidebar has always been
scoped. Filtered in ONE place that the shelves, the tab counts, the tree view
and the graph all read from. And the library's controls got a frame; chasing
that surfaced an inherited `width: 100%` from the table-cell classes, which had
been breaking that bar into three rows invisibly.

One skill fix worth knowing: it wrote its address with `publicBase`, which falls
back to the Host header — downloading the skill from `http://192.168.x.x` would
have put THAT in the file, unreachable for a cloud agent. It uses
`publicShareBase` now, the same resolver the connect dialog shows.

The Release workflow failed once on GitHub's own infrastructure ("Failed to
resolve action download info: Service Unavailable") and was green on a plain
rerun — worth recognising, since it looks nothing like a code failure.

Checksums on both sides again: `3c662cc9…` (published `v1.6.12`) before,
`7919f22a…` (published `v1.6.13`) after. Verified by behaviour: `/api/graph` and
`/api/skill` answer `401` where an unknown path falls through with `200`, and
`.graph-canvas`, `.index-ws` and `.tree-actions:has(.menu)` are in the served
CSS. Four startup lines, no index rebuild. Backup:
`/root/salt-backups/salt-data-20260806-160119-vor-1.6.13.tar.gz` (402M, gzip
verified); `/opt/salt/salt.bak-1.6.12` sits beside it. 23G free.

**Production runs `1.6.12`** (2026-08-06 14:57), on his word ("dann kannst du
deployen"): the whole fixed path in one go, **24 commits in one release** — the
cadence rule working rather than a tag per fix.

The big ones: agents can sign in with OAuth instead of carrying a permanent key,
and a workspace decides per workspace what a credential may do there
(open / signed-in only / no agents). `note()` — a raw trail of dated,
**append-only** notes beside the edited version of a page, with the check-out of
`working_on` leaving its last note behind as one. A **downloadable skill** the
instance generates for itself, whose first instruction is to write a short block
into the repository's CLAUDE.md/AGENTS.md — because rules were being forgotten
for where they were kept, not for carelessness. Files dropped from the desktop
land on the page instead of the browser navigating away and throwing the
application out. Plus fail2ban, the workspace settings dialog, the mixed sidebar
tree, live updates for trash/restore/schema, and the last four database gaps.

Two checksum proofs, one on each side of the swap: the running binary matched
the published `v1.6.11` asset exactly before (`9c1192a5…`) and the `v1.6.12`
asset after (`3c662cc9…`). Verified by behaviour on top: `/api/skill` and
`/api/pages/{id}/notes` answer `401` where an unknown path falls through to the
SPA with `200`. Four startup lines, no search-index rebuild, 478 MB of data,
648 files. Backup:
`/root/salt-backups/salt-data-20260806-145747-vor-1.6.12.tar.gz` (402M, gzip
verified); `/opt/salt/salt.bak-1.6.11` sits beside it and its checksum is the
published one too. 23G free.

**Production runs `1.6.11`** (2026-08-04 18:44), on his word ("du kannst pushen
und auf produktiv deployen"): the whole fixed path in one go, **13 commits in
one release** — which is the cadence rule working rather than a tag per fix.

The blueprint library (a shelf of ready-made workspaces where "New workspace"
used to be a name prompt), plus three defects reported from real use in one
day, all of the "looks right, is not" kind: IP addresses read as phone numbers
and replaced by a receiver icon (version numbers too); a database filed under a
document drawn in the Documents section and missing from Collections while both
counts read correctly; and a database inside another database with no way out —
`/api/pages` excludes a database's children (right for rows, tens of thousands
possible), a nested database fell under the same rule and was therefore drawn
as a row, which has no ⋯ menu and so no action at all.

Two checksum proofs, one on each side of the swap: the running binary matched
the published `v1.6.10` asset exactly before, and the `v1.6.11` asset after —
that is how you know production runs the artefact. Verified by behaviour on top:
`/api/library` answers `401` where an unknown path falls through to the SPA with
`200`, and the served bundle carries the shelf, `New collection inside`,
`Move to top level` and the IPv4 test while the emoji trash label is gone. Four
startup lines, no search-index rebuild, 468 MB of data, 645 files. Backup:
`/root/salt-backups/salt-data-20260804-184414-vor-1.6.11.tar.gz` (378M, gzip
verified); `/opt/salt/salt.bak-1.6.10` sits beside it and its checksum is the
published one too. 23G free.

**Production ran `1.6.10`** (2026-08-02 22:45). The big one for agents: the MCP
catalogue went **55 → 31 tools** (the seven `list_*` became `list(kind:)`, seven
duplicates folded into the tools they belonged to, and pairs like
share/unshare, trash/restore, create_view/update_view merged), views became
configurable over MCP at all, `get_graph` learned edge kinds and orphans, and
agents can announce what they are working on (`working_on`, shown live with the
agent's own logo). Verified by behaviour: `agent-presence` and `agent-work` in
the served bundle, `/api/presence` answering `401` where an unknown path falls
through to the SPA with `200`, and — the neat one — `batch_set_properties`
reporting "unknown tool" through the connector, which is the consolidation
proving itself from the outside. Backup:
`/root/salt-backups/salt-data-20260802-224517-vor-1.6.10.tar.gz` (376M, gzip
verified); rollback binary `/opt/salt/salt.bak-1.6.9`.

**A note for the next agent session:** a connected MCP client keeps the tool
list it fetched at connect time. After a release that renames tools, the old
names linger in a running session until it reconnects — that is not a failed
deploy, and calling the old name to "check" only proves the client is stale.

**Production ran `1.6.9`** (2026-08-02 19:35), the first release deployed the
systemd way rather than by image swap: `wget` the release asset, `sha256sum -c`
against `SHA256SUMS.txt`, then stop + volume backup + `install -m 755` + start
in one command. Verified by behaviour — `relation-icon` and `page-icon-lucide`
in the served bundle, and an `update_schema` carrying a `backrelation`, which
the previous build refused. Startup is four lines, `16000 MB available`, no
index rebuild. Backup:
`/root/salt-backups/salt-data-20260802-193532-vor-1.6.9.tar.gz` (376M, gzip
verified); rollback binary `/opt/salt/salt.bak-1.6.8` sits beside it.

Two things worth keeping from that deploy: the running binary's sha256 matched
the published `v1.6.8` asset exactly, which is how you PROVE production runs
the artefact and not something hand-built — do that check before every swap.
And disk is no longer tight: **25G free of 32G** after the owner grew it, so the
"two more deploys and it is tight" warning that used to stand here is gone.

**Production ran `1.6.8` and stopped being Docker** (2026-08-01 00:17). On his
word ("mach das") it was moved from the container to an `install.sh`-style
systemd service: binary at `/opt/salt/salt`, data at `/opt/salt/data`, still
port 8420. The reason was the memory reading below — a container in an LXC
cannot see the LXC's cap, a binary on the system just sees what is there, and
the startup line now says `16000 MB available` with no configuration at all.

**That changes the deploy path for production**: fetch the release binary,
verify it against `SHA256SUMS.txt`, `systemctl stop salt`, back up
`/opt/salt/data`, `install -m 755`, start. No `docker pull`, no image swap. The
stopped container and its volume are still there as a rollback
(`systemctl stop salt && docker start salt` → 1.6.4) and should be cleaned up
once systemd has held for a few days — there is a Vorgang for it.

**Production ran `1.6.4`** (2026-08-01 00:38), on his word ("auf prod
pushen"): the structure panel and the PDF preview, rebased onto the 1.6.3
hotfix. Verified by behaviour, not by the version string — `structure-panel`,
`file-preview-frame`, `structure-ext` and `structure-from` all appear in the
served JS **and** CSS, and `/api/health` answers `1.6.4`. No index rebuild at
startup (filesVersion unchanged), 636 files in the volume, backup
`/root/salt-backups/salt-data-20260731-223838-vor-1.6.4.tar.gz` (392M); images
`1.6.3`, `1.6.2`, `1.6.1` remain for rollback.

**Disk is the next thing to run out** — 3.1G free (59% used) with backups at
975M and each new one weighing ~390M now that the file store is full. Two more
deploys and it is tight. Prune the oldest backups before the next one, or move
them off the box.

**Production ran `1.6.3`** (2026-08-01 00:19), on his word ("push live"): the
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

## The wiki

`wiki/` is the user-facing documentation, English, ~17 pages, destined for
salt.md/wiki. Two rules, both learned the hard way:

**It is derived from the code, never from memory or from the Vorgänge.** The
workspace only knows what has been written down since somebody started writing
things down; the code knows everything. `check-wiki.mjs` runs in the gate and
holds the mechanical half — every tool named exists, every tool that exists is
named, every `/api/` path is a route, every property and view type has a
section, every internal link resolves. It cannot check whether a sentence is
TRUE; nothing can.

**Every example is invented.** The first draft named three of his customers in a
tree diagram — written while looking at his live instance, and headed for a
public website. He caught it, not a test. The check now refuses real-looking IPs,
hostnames and email domains, but it cannot recognise a company name, so that half
is a written rule: if the name came from somewhere real, change it.

The same applies outside the wiki. The instance-name placeholder in the admin
dialog said "e.g. VIICO Notes" — his own company, shipped to everyone who
installs Salt.md. It is "Acme Notes" now.

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

<!-- salt-entwicklung:start -->
## Arbeit in salt.md dokumentieren

Workspace **Entwicklung** (`70bbc4e36728b79862e92aa14979f037`), Stand 2026-08-03.
Neu holen mit `/salt-entwicklung`, wenn sich die Regeln geändert haben.

### Melde deine Arbeit an

Bevor du länger als einen Moment an einer Seite oder einem Vorgang arbeitest:

```
working_on(page_id: "<id>", agent: "claude", label: "Claude Code",
           note: "was du tust, in wenigen Worten")
```

Am Ende dasselbe mit `done: true`. Die Notiz ist der wertvolle Teil — „räumt den
Datei-Index auf" beantwortet die Frage, die ein Mensch hat, „arbeitet" nicht.

Dazwischen musst du nichts tun: Jeder weitere Aufruf auf derselben Seite gilt als
Lebenszeichen, und die Anmeldung läuft nicht ab, während du woanders sitzt.

**Den Status trotzdem setzen.** Die Anmeldung sagt „ich bin gerade dran", der
Status sagt „so weit ist es". Auf *In Arbeit*, BEVOR du anfängst — nicht danach.

### Die zwei Datenbanken

| Datenbank | Id | Beantwortet |
| --- | --- | --- |
| Systeme | `85f32056708b3b4d4f769aadfd8f5751` | „was gibt es?" |
| Vorgänge | `50bc601cbae16834bbc3fcbe4d45c542` | „was ist zu tun?" |

Salt.md selbst ist die System-Zeile `36c00d134d506320e6b21af7806d44ec`.

**Eigenschaften von Vorgänge**, damit niemand rät — es sind die IDs, nicht die
Namen, die geschrieben werden:

- `status`: `eingang` · `als-naechstes` · `in-arbeit` · `wartet-auf-andere` ·
  `erledigt` · `verworfen`
- `art`: `feature` · `fehler` · `update--sicherheit` · `wartung` · `recherche`
- `prio`: `dringend` · `normal` · `irgendwann`
- `aufwand`: `s--unter-1-tag` · `m--wenige-tage` · `l--wochen`
- `system` — Relation auf Systeme, **immer als Liste**: `["<id>"]`, nie `"<id>"`
- `meilenstein` (Text), `faellig` (Datum)

### Die Regeln des Workspace

Sie stehen im Wortlaut im Workspace selbst (`get_workspace`) und gelten dort.
Das Wesentliche für die Arbeit an diesem Repo:

- **Jeder Vorgang hängt an einem System.** Ohne Verknüpfung sieht das System
  seine Arbeit nicht und der Fortschritt zählt sie nicht.
- **Der Titel benennt das Symptom, nicht die Lösung** — „Ein 24-MB-PDF legte die
  Instanz lahm", nicht „PDF-Limit einbauen".
- **Entscheidungen mit Begründung** in den Seitenkörper, auch die verworfenen.
  Warum etwas NICHT gebaut wurde, fragt später niemand nach — und genau das wird
  dann ein zweites Mal vorgeschlagen.
- **Technische Doku bleibt im Repo.** Im Workspace steht, was man ohne Repo
  wissen will: Status, Version, wo es läuft, Entscheidungen, offene Vorgänge.
  Nichts doppelt pflegen.
- **Große Vorhaben** bündeln sich über denselben Meilenstein-Text auf mehreren
  Vorgängen, nie über Ordner oder Unterseitenketten.
<!-- salt-entwicklung:end -->
