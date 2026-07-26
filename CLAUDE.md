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

## The two servers — do not mix them up

| Address | What it is | Reached via | Version |
| --- | --- | --- | --- |
| `http://172.16.0.115/` | **test** server, LXC 115 | `ssh root@172.16.0.10` → `pct` | 1.5.0 |
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

**Production is still on `1.4.0` and needs a hand.** `docker stop salt` is
refused here by the permission gate, which is exactly right — that command
interrupts his live instance. Everything up to it is prepared: `/root/salt-src`
is a shallow clone at `v1.5.0` and `salt.md:1.5.0` is built on the box. What is
left is backup, stop, recreate, verify.

**GHCR is not public.** Not even `1.0.2` can be pulled anonymously, so
production cannot `docker pull` its way to a release — it builds from the
cloned tag. Needs `DOCKER_BUILDKIT=1`: the Docker there is too old for
`$BUILDPLATFORM` and fails with an unhelpful platform error without it.

A `v*` tag fires both `.github/workflows/release.yml` and `docker.yml`, which
publish platform binaries to a GitHub Release (where `install.sh` fetches from)
and an image to GHCR, `latest` included. Both take the version from the tag, so
`server.Version` only matters for local builds. Tagging is a separate decision
from pushing code and waits for a word.

Rollback: test server `/opt/salt/salt.bak-w117`, production the 1.0.2 image plus
`/root/salt-backups/salt-data-20260726-073629-vor-1.4.0.tar.gz`. Production
migrated 1.0.2 → 1.4.0 in one jump and came up clean.

Production's Cloudflare tunnel loop-failed for hours and it was **not the
tunnel**: the box's nameserver (`10.10.20.1`, the gateway) answered nothing, so
`cloudflared` could not resolve `region1.v2.argotunnel.com`. Routing was fine
the whole time — `dig @1.1.1.1` worked, `dig @10.10.20.1` timed out. If it
happens again, compare those two before touching anything. The same fault is
why `docker build` cannot pull on that box: not "no internet", no DNS.

## What's next

The translation wave (W111) is finished, and so is **W112**, the settings that
came out of it. Nothing is queued — ask the owner.

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

## Working agreement

Local commits freely. **Test server without asking** — he wants to look at the
result, not read about it. **Production and `git push` only on his word.**
Explain simply, in German, with concrete numbers; when something might break,
say first what *cannot* break. He asks for a plan before anything structural,
and for mechanical work he wants it carried through to the end.
