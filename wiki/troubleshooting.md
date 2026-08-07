# Troubleshooting

Real failures, what they look like from the outside, and what actually fixes
them. Every entry names a symptom first, because that is all you have when
something goes wrong. If you know which area you are in, the other pages go
deeper: [Agent access](agent-access.md), [Sharing](sharing.md),
[Search](search.md), [Files](files.md), [Single sign-on](sso.md),
[Self-hosting](self-hosting.md).

## How Salt.md tells you something failed

Three places, and it is worth knowing which one you are looking at.

- **Toasts** — a line at the bottom of the window, prefixed with ⚠, gone after
  four seconds. This is the app's only feedback for a failed save, a failed
  upload or a failed background call. If you looked away, you missed it.
- **The line above the sign-in form** — everything that goes wrong while
  signing in, including failures handed back by Google or Microsoft.
- **The text an agent gets back** — over MCP a failure comes back as the tool's
  result, marked as an error, in English.

**Every server message carries a machine-readable code as well as an English
sentence.** The browser shows the sentence in your language; a script, `curl` or
an agent sees the English. The code is the stable part: it does not change when
the wording does, and it is what to quote when asking for help. The table at the
end of this page lists the ones you are most likely to meet.

**"Not found" often means "not allowed".** A page you may not read and a page
that does not exist answer identically, on purpose — otherwise guessing ids
would reveal what exists. So *page not found* from an agent is as often a
permission problem as a typo. `whoami` separates the two.

## Signing in

### Wrong email or wrong password

Code `bad_credentials`. It is deliberately one message for both cases, so the
answer does not reveal whether an address has an account here. Passwords are at
least 8 characters; nothing else about them is enforced.

### It asks for a 6-digit code

Code `2fa_required`. Two-factor sign-in is on for that account. The form grows a
**2FA code (6 digits)** field and keeps the password you already typed. A wrong
code is `2fa_invalid`.

### You lost the authenticator app

This is the one to plan for, because there is no way out through the interface.
There are no recovery codes, and **nobody — not an admin, not the instance
owner — can clear somebody else's second factor.** Turning it off requires a
valid code from the app that is gone.

Two things still work:

- **Signing in with Google or Microsoft**, if that is configured and the
  account's address is one of them. The provider route does not ask for the
  second factor.
- **Direct access to the database on the server**, which means someone with a
  shell on the machine.

Before turning two-factor on, save the secret shown next to the QR code
somewhere safe. See [Your account](account.md).

### "This account has been deactivated — talk to an admin"

Code `account_disabled`. Deactivation is immediate and total: it ends every
session, deletes every API token belonging to that account, invalidates its
calendar link, and closes its open editors on the spot. Nothing that account had
open keeps working. An admin reactivates it in user management; the tokens do
not come back. See [Administration](administration.md).

### "too many login attempts, please wait"

A 429. Sign-in is throttled per client address: 30 attempts a minute with a
burst of 10.

The trap is a reverse proxy. Without **Run behind a reverse proxy (trust
`X-Forwarded-For`)** switched on, every request appears to come from the proxy,
so the whole organisation shares one bucket and a single person retyping their
password locks out everybody. The switch is on **Instance settings → Domain &
proxy**, and the same tab's **Your IP (as the server sees it)** tells you at a
glance whether it is working — it shows *proxy headers active* when the header
is being trusted.

Only switch it on when there really is a proxy in front. Without one, the header
is set by whoever is calling and an attacker can invent a new address per
attempt.

### Signing in with Google or Microsoft fails

[Single sign-on](sso.md) has the full table of messages. The one that catches
people out and is not obviously an SSO problem:

**"This address belongs to an account that has not confirmed it."** — code
`oauth_email_squatter`. An account holds that address but it does not count as
confirmed. Changing your own email address in the profile is what un-confirms
it, and **changing it again does not restore it**: an address edited from inside
the account stays unconfirmed. Sign in with a password instead. The same message
also appears for a deactivated account.

### Signed out for no reason

Sessions last as long as **Sign-in session length (days)** on the **General**
tab — 90 days by default, 1 to 365 allowed. Beyond expiry, a session ends when
you sign out, when an admin deactivates the account, or when the server's
database is replaced under it.

Any request that comes back unauthorised sends the whole interface back to the
sign-in screen at once. That is deliberate: an expired session used to mean an
upload landing as an error in the middle of a document while the app went on
pretending you were signed in.

## Agents that cannot connect

### The client asks for a token, but you wanted it to sign in

Paste the address without a token — the plain `/mcp` form. A client that can
sign in discovers the authorization server from the refusal itself and sends you
to a consent screen in the browser. A client that asks for a token instead
cannot sign in yet; use **Token in the address** in the **Connect an agent**
dialog and give it `/mcp/<token>`.

### "missing or invalid API token"

The credential is absent, mistyped, revoked, or belongs to a deactivated
account. Note that **wrong tokens are throttled by address**: about twenty bad
attempts in quick succession from one address make the server stop looking
tokens up at all for a moment, and during that moment a *correct* token is
refused too. It refills within seconds. A working token never feeds the limit.

### A cloud agent cannot reach the instance

The **Connect an agent** dialog says so itself when the address is a plain
`http://` LAN address:

> ⚠ Cloud agents (claude.ai, say) cannot reach `http://192.0.2.10:8420` — make
> the instance public for that (Instance settings → Domain & proxy) and connect
> through the public URL. Local CLIs on the same network work directly.

Give the instance a public address — a Cloudflare tunnel, built-in HTTPS, or
your own proxy — and set **Public base URL** so every generated link uses it.
See [Reaching your instance from outside](domain.md).

### A workspace is missing from the agent's list

Three separate gates, in this order:

1. **The account** is not a member of it. Nothing else can help.
2. **The credential** was narrowed to particular workspaces. A workspace-scoped
   token or an OAuth grant where somebody ticked specific workspaces sees only
   those; the agent is told how many it cannot see, never which.
3. **The workspace itself** decides what agents may do there — **Workspace
   settings → What agents may do here**. *Only signed-in connections* refuses a
   permanent token even when the token names that workspace. *No agents at all*
   refuses every credential, browser sessions only.

`whoami` answers the first two: it reports the token scope, the workspaces the
credential may reach, and what is deliberately closed to agents. See
[Agent access](agent-access.md).

### A write is refused

- *"this API token is read-only; … requires a write token"* — the credential is
  read-only. Create a new one with **Read & write**, or approve the connection
  with write scope on the consent screen.
- *"This action requires signing in through a browser — an API token is not
  enough."* (`session_required`) — account management, backups, tokens,
  emergency access and the instance settings are closed to every credential on
  purpose. An API token is a second key to content, not an admin pass.
- *"This connection is limited to particular workspaces, so it cannot create new
  ones"* (`workspace_scoped`) — a narrowed credential cannot make a workspace it
  would then be unable to open.

### "rate limit exceeded — too many requests, slow down"

240 tool calls a minute per account, with a burst of 60. It comes back as a tool
error rather than a transport failure, so a well-behaved agent can simply wait
and retry.

### "request is 84 MB — the limit is 68 MB"

An MCP request is refused before it is read, by its declared size. Base64
inflates a file by a third, so the ceiling for a tool call is the instance's
upload limit plus that overhead. The message says what to do instead: use the
HTTP upload at `/api/upload` for a file that big.

### The agent insists a tool does not exist

Or calls one that was renamed and gets *unknown tool*. **A connected client keeps
the catalogue it fetched when it connected.** Salt.md does not announce
catalogue changes, so a session that has been open across an update is working
from the old list. Reconnect the client. Calling the old name again only proves
the client is stale.

## Share links that do not work

### "This link is invalid or has expired"

A visitor gets a plain page with that sentence. Four things produce it:

- the link was revoked with **Stop sharing**;
- its expiry passed — an expired link is deleted the first time it is opened;
- the page was moved to the trash, or deleted;
- **the page was shared again**. There is only ever one live read link per page.
  Changing the expiry or setting a password mints a new token and kills the old
  one, so a link already sent out stops working.

### The link points at an address nobody outside can open

A share link is built from the instance's external address: an explicit **Public
base URL** first, then the built-in HTTPS domain, then a running Cloudflare
tunnel, and only if none of those exist, whatever address your own browser
happens to be using. If the link you copied contains a LAN address, none of the
first three is configured. See [Reaching your instance from outside](domain.md).

### Images and attachments do not show for a visitor

A shared page renders as standalone HTML with no sign-in required, but the files
it references are served from a path that **does** require one. A visitor
without an account therefore sees the text and layout of the page and broken
images where the pictures are. Where the pictures matter, export the page
instead of sharing it. See [Import and export](import-export.md).

### A password-protected page keeps saying "Wrong password."

The password is checked against the token in the link, so it only works through
the exact link it was set with. If the link was re-created, its password went
with it.

### "Form not found" on a public form

The link resolves, but the collection has no `form` view any more, or the
collection is in the trash. A form link needs a form view on that collection to
render — add one and the same link works again. See [Forms](forms.md).

### A collection shared to the web shows a plain text table

That is what it is: a shared database renders as its Markdown table, rows only.
Sub-pages of rows are never included. Shared pages also carry a *noindex*
header, so search engines are asked not to list them. See
[Sharing](sharing.md).

## Search that finds nothing

Work through this in order.

1. **Is the page in the trash?** Trashed pages are removed from the index
   immediately, including everything under them. Restoring puts them back at
   once.
2. **Is it private to somebody else?** Search checks the workspace first and
   then every single hit again. The second check is what hides other people's
   private pages inside a workspace you are in.
3. **Are you in the right workspace?** Only workspaces you are a member of are
   searched at all.
4. **Is this an agent?** An agent is narrowed further, by its credential and by
   each workspace's agent rule.
5. **Edit the page.** Any write re-indexes it. If a page really did fall out of
   the index, typing a character and waiting a moment puts it back — the editor
   saves 1.5 seconds after you stop typing and again when you leave the page.

**The text inside a PDF is a separate matter.** It is only indexed when the file
is attached to a page, and only up to a size limit derived from the memory the
server believes it has. Exceeding it costs indexing and nothing else: the file
is still stored, listed and downloadable. The server log names the file when it
skips one. [Search](search.md) has the table of limits.

## Uploads that fail

### "File too large (…) — 50 MB max."

This one comes from the browser, before anything is sent, and **the 50 MB in it
is fixed**. The instance's own limit — **Max. file size per upload (MB)** on the
**General** tab — can be set anywhere from 1 to 2048 MB, but raising it above 50
does not raise what the browser will attempt. Files over 50 MB have to go
through an agent or the API (`/api/upload`) instead.

### "The file is too large for this instance."

This one comes from the server, or from a proxy in front of it. Two causes:

- the instance limit is set lower than the file;
- **a reverse proxy has its own body limit.** The nginx configuration Salt.md
  generates writes `client_max_body_size` from the limit as it stood when you
  copied it. Raise the limit later and the proxy still refuses at the old size —
  and it answers with its own HTML error page, which is why this message is a
  fallback rather than the server's own words.

### "Upload failed" or "…" was not uploaded

Anything else: a lost connection, a full disk, a write that failed on the
server. Dropping several files at once uploads them one at a time and a failure
does not stop the rest, so four out of five landing plus one named failure is
the expected shape rather than a bug.

### The file uploaded but its contents are not searchable

An upload is indexed under the page it was attached to. A file with no page —
a cover image, a workspace logo, an avatar — has nowhere to be indexed and
counts as unreferenced in the file list. See [Files](files.md).

### A count in the file list looks wrong

The file index is derived: the truth is the block on the page and the byte on
disk. It is rebuilt from scratch at startup whenever a release changes how it is
built, and the startup log says so. There is no button for it — being derived is
what makes the rebuild safe, not something you have to ask for.

## "A new version is available — reload the page"

The server was updated while your tab was open. The message arrives twice over:
once from the first request the page makes, and once from the live change feed,
so a tab that has been open for days still learns about a deploy. It is a toast,
so it disappears after four seconds — reload when you see it.

**If it appears on every load and never stops**, the frontend and the server
were built with different version strings. That is a build problem, not a
browser problem; the two are stamped from one value on purpose. See
[Self-hosting](self-hosting.md).

**If the interface stays old across reloads**, the browser is holding a cached
copy of the document that names the previous build's files. The document itself
is served as `no-cache`, so this should resolve on the next load; a hard reload
forces it. The service worker keeps only the app shell — no API responses, no
files, no shared pages — so nothing you see as *data* can be stale that way.

## Live editing

**The faces of your colleagues vanished.** That is your connection, not theirs.
Editing continues into your own copy and is pushed across when the socket comes
back — automatically, with a backoff that starts inside a second and tops out at
thirty. The one way to lose that work is closing the tab while it is
disconnected.

**The editor reloaded itself in the middle of a sentence.** Something replaced
the page rather than merging into it: a restored version, an agent writing the
whole body with `write_content`, an import, or the page being trashed. An edit
typed in the same second can be lost. `working_on` exists so a person can see an
agent coming. See [Working at the same time](collaboration.md).

**"Page content not saved."** The debounced save failed. It is retried on the
next change and when the editor closes; the live document in the browser is
unaffected. Repeated occurrences mean the server is refusing writes — check
whether you are still signed in.

**"Something went wrong. This view hit an error."** A render error inside the
interface, caught so it does not take the whole window down. **Try again** keeps
your place; **Reload** starts over. The message ends with the technical detail,
which is what to quote in a report. Nothing is lost — the data is on the server.

**"Cannot reach the server."** The full-screen state with a **Retry** button:
the very first request failed. The server is down, or the address is wrong, or a
proxy is between you and it and is not forwarding. `/api/health` answers
`{"status":"ok"}` and the version when the server is alive, without a sign-in.

## When the server itself is the problem

**Read the startup log first.** It is a handful of lines and it says what the
server decided about its memory, whether it rebuilt the search index, whether it
rebuilt the file index, and what address it is listening on. Most answers are
there.

**A restore refuses to run.** `salt restore` will not overwrite an existing
database. Empty the data directory, or set `SALT_RESTORE_FORCE=1`. The guard is
deliberate — restoring over a live instance is the mistake it exists to prevent.

**A backup restored, but did the schema survive?** The proof is the *absence* of
a search-index rebuild line at the next start: the binary recognising its own
schema. A rebuild line means it migrated the data forward, which is normal after
an upgrade and suspicious after a plain restore.

**You copied the database out and the schema looks old.** SQLite runs in WAL
mode. The `.db` file alone is stale; recent changes are in the `-wal` file next
to it. Copy all three, or stop the server first. `salt backup` does this
properly — it takes a transactionally consistent snapshot, so it is safe against
a running instance.

**The process gets killed under load.** A container with no memory limit is
treated as a small machine on purpose, because the host's figure is not a
promise about what the container will be given. Set `--memory=` on the container
or `SALT_MEMORY_MB` to tell it the truth. Getting this wrong only ever changes
how much text reaches the search index, never whether an upload succeeds.

**Do not ask the binary for its version with a flag.** `salt version` prints it.
An unrecognised flag is not a subcommand, so the binary starts a second server
instead — beside the one already running.

**And do not trust the version string to prove a deploy.** A mislabelled build
reads exactly like a correct one. Check for something the new code has and the
old does not: a route that answers, a marker in the served files, a behaviour
you changed.

## Error codes you may meet

The code is the same in every language; the sentence is what you see in yours.

| Code | What it means |
| --- | --- |
| `bad_credentials` | Wrong email or wrong password — deliberately one message for both |
| `2fa_required` | The account has two-factor sign-in; enter the 6-digit code |
| `2fa_invalid` | That code was wrong or has already rolled over |
| `account_disabled` | The account was deactivated; sessions and tokens are already gone |
| `signup_not_allowed` | Self-registration is off for that address; ask for an invitation |
| `oauth_email_squatter` | An account holds the address but it counts as unconfirmed — or it is deactivated |
| `oauth_expired` / `oauth_bad_state` | The sign-in round trip did not stay on one address ([SSO](sso.md)) |
| `session_required` | Administration; a credential of any kind is refused, browser sign-in only |
| `owner_only` | Reserved to the instance owner |
| `owner_only_backup` | Only the owner may download an instance backup — it contains every workspace |
| `owner_only_credentials` | Only the owner may change another account's password or email |
| `workspace_scoped` | A credential tied to particular workspaces cannot create new ones |
| `file_too_large` | Over the upload limit — see above for which of the two limits bit |
| `last_admin` / `last_admin_other` | The last admin of a workspace cannot be removed; appoint another first |
| `no_self_grant` | You cannot grant yourself access to a workspace; emergency access is the logged route |
| `personal_no_break_glass` | A personal space cannot be looked into, even in an emergency |
| `private_pages_left_self` / `private_pages_left_other` | Removing a member would leave private pages behind; the count travels with the message |
| `mail_not_configured` | No mail delivery is set up — SMTP, or a connected Google or Microsoft account |
| `mail_refresh_failed` | The connected mailbox needs connecting again; the provider's own words follow in brackets |
| `rules_too_long` | Workspace rules are capped at 16,000 characters |
| `reason_too_short` | Emergency access needs a reason of at least 10 characters — it is logged and shown |

A code with no translation falls back to the server's English sentence. That is
the intended behaviour, not a fault: a correct sentence in the wrong language
beats a broken one.

## See also

- [Agent access](agent-access.md) — credentials, scopes, what a workspace allows
- [Sharing](sharing.md) — public links, passwords, expiry, forms
- [Search](search.md) — what is indexed and when
- [Files](files.md) — uploads, limits, the file index
- [Single sign-on](sso.md) — the full table of provider failures
- [Self-hosting](self-hosting.md) — the startup log, backups, updating
- [Working at the same time](collaboration.md) — losing and regaining the connection
