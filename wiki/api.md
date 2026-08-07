# The REST API

Everything the Salt.md interface does, it does over an HTTP API that you can
call yourself: create pages, read and write database rows, search, upload files,
export Markdown, watch changes live. This page is for people writing scripts —
a backup job, a nightly import, a small internal tool. It covers how to
authenticate, what an answer and an error look like, the limits you will hit,
and a grouped list of the endpoints worth calling.

**If you are connecting an AI agent, use the MCP endpoint instead.** It speaks
the same data through 33 purpose-built tools, with descriptions the agent reads
before it acts, and it needs no glue code at all — see
[Agents](agents.md) and the [tool reference](mcp-tools.md). The REST API is for
code you write; MCP is for models. Both use the same token.

## Authenticating

Two credentials work: the browser session cookie (`salt_session`, set by
signing in) and an **API token** sent as a bearer header. A script should use a
token.

### Creating a token

1. Open the menu at the bottom of the sidebar — your avatar and name.
2. Choose **API tokens**.
3. Give it a name, for example `backup-script`. The field's placeholder is
   "Token name (e.g. claude-code)".
4. Choose **Read-write** or **Read-only**.
5. Choose **All workspaces** or **Specific workspaces…** and tick the ones it
   may reach. If you pick "Specific workspaces…" and tick nothing, the request
   is refused rather than falling back to all of them.
6. Press **Create token**.

The token appears once, under the line "Copy this token now — it will not be
shown again:". It looks like `salt_` followed by 48 hexadecimal characters. Only
its hash is stored, so a lost token cannot be recovered — create a new one and
press **Revoke** on the old.

The same dialog lists every token you own with its scope, its workspaces, when
it was last used and **the address it was last used from**. That last column is
the point: a token that rides in a URL cannot be kept secret, so the defence is
noticing. An address you do not recognise is worth one click on **Revoke**.

### Using it

```
curl -H "Authorization: Bearer salt_…" https://salt.example.com/api/pages
```

`GET /api/health` and `GET /api/me` are the two calls to start with.
`/api/health` needs no credential and answers `{"status":"ok","version":"…"}`.
`/api/me` answers for anybody, signed in or not, and tells you whether your
token was accepted:

```json
{ "setupRequired": false, "authenticated": true,
  "user": { "id": "…", "name": "Ada Lovelace", "isAdmin": false, "orgRole": "member" },
  "version": "…" }
```

For a cookie session instead, `POST /api/login` with `{"email":…,"password":…}`
(plus `"code"` when two-factor is on) returns the user and sets the cookie.
Sessions last 90 days by default; an admin can set 1–365.

### What a token is, and what it is not

A token is **a second key to the content its human can already reach**. It
carries their full identity and narrows in exactly two ways: read/write, and a
list of workspaces. It is not an administrator's pass.

- A **read-only** token gets `403` with the message "token is read-only" on any
  POST, PUT, PATCH or DELETE. Reads are unaffected.
- A **workspace-scoped** token cannot touch a page outside its list even if you
  name that page's id directly, and it cannot create a workspace at all — the
  new one would not be on its list. That refusal carries the code
  `workspace_scoped`.
- **Administration needs a browser.** Account management, instance settings, the
  instance backup, invitations, two-factor, minting further tokens, workspace
  rules and discarding a page's raw trail all refuse a token with `403` and the
  code `session_required`. Without that rule a token handed to an agent could
  issue itself a wider one.
- A workspace can additionally **refuse agents** — see
  [agent access](agent-access.md). Where it is set to strict, a permanent API
  token is turned away even when it names that workspace; only a credential
  somebody signed in for gets through.
- **Changing an account's password deletes all of its sessions and all of its
  API tokens.** Scripts stop working the moment their owner changes their
  password. This is deliberate and it is the most common cause of a job that
  "suddenly gets 401".

## Answers and errors

Every response is JSON. Failures carry an English sentence and, usually, a
machine-readable code:

```json
{ "error": "This action requires signing in through a browser — an API token is not enough.",
  "code": "session_required" }
```

Read the `code`, never the sentence. The English exists so that curl and scripts
get something readable; the browser ignores it and renders the reader's own
language from the code. The sentence can be reworded at any time. Some failures
carry extra fields beside the two — a `detail` written by an outside provider, or
a count the message needs.

Not every error has a code yet. Where there is none, only `error` is present.

| Status | What it means |
| --- | --- |
| `200` | done — the body is the result |
| `400` | the request was wrong: bad JSON, a value out of range, an impossible move |
| `401` | no credential, or one that was not accepted |
| `403` | recognised, but not allowed — read-only token, session required, not an admin |
| `404` | not there, **or** not yours to see |
| `409` | a conflict: writing to a trashed page, or an email already in use |
| `413` | the upload is over the instance's file limit |
| `429` | too many sign-in attempts from this address |
| `500` | the server failed |

**`404` is also the answer for "you may not".** A page in a workspace you do not
belong to reports "page not found", so nobody can tell an existing private page
from a made-up id.

Codes you are likely to meet: `bad_credentials`, `2fa_required`, `2fa_invalid`,
`account_disabled`, `session_required`, `owner_only`, `workspace_scoped`,
`not_workspace_admin`, `last_admin`, `already_member`.

## Limits

| Limit | Value |
| --- | --- |
| JSON request body | 8 MiB |
| One uploaded file | 50 MB by default; an admin can set 1–2048 MB |
| An imported archive | 100 MB |
| Page title | 2000 characters |
| Comment | 10 000 characters |
| A note in the raw trail | 2000 characters, truncated rather than refused |
| Rows per request | 100 by default, 500 maximum |
| Audit entries per request | 50 by default, 200 maximum |
| Sign-in attempts | 30 per minute per address, burst of 10 |

There is no general rate limit on authenticated REST calls. There is one on
**rejected** tokens: 60 a minute per address, burst 20, fed by failures alone.
A working script never touches it — but while an address is guessing, a correct
token from that same address is also answered `401` until the budget refills a
second later.

## Pages

| Method and path | What it does |
| --- | --- |
| `GET /api/pages` | every page you can see, as metadata — no body content |
| `POST /api/pages` | create a page (`type` `"doc"`, the default) or a database (`"collection"`) |
| `GET /api/pages/{id}` | one page, including its block content |
| `PATCH /api/pages/{id}` | change anything about it |
| `DELETE /api/pages/{id}` | move to the trash; `?permanent=1` deletes for good |
| `POST /api/pages/{id}/restore` | bring it back out of the trash |
| `POST /api/pages/{id}/duplicate` | deep-copy the page and everything under it |
| `GET /api/pages/{id}/backlinks` | the pages that mention this one |
| `GET /api/graph` | every link between pages you can read, as source/target pairs |
| `GET /api/favorites` · `POST`/`DELETE /api/favorites/{id}` | your own favourites |
| `GET /api/tags` · `GET`/`PUT /api/tag-colors` | tags in use, and their colours |

`GET /api/pages` deliberately **leaves out database rows** — there can be tens of
thousands of them, and they belong in the row endpoint below. Rows that carry
sub-pages of their own are the exception and do appear, because otherwise their
children would have no parent in the list. Trashed pages are included, marked
`"trashed": true`.

`PATCH` accepts `title`, `icon`, `cover`, `content`, `props`, `propsPatch`,
`parentId`, `position`, `visibility` (`"workspace"` or `"private"`),
`isTemplate`, `tags`, `description` and `workspaceId`. Four things about it are
worth knowing before you write a script:

- **`propsPatch` merges, `props` replaces.** Send only the keys you changed;
  a key set to `null` is removed. Two scripts editing different properties of
  the same row then do not overwrite each other.
- **What you read back is not all stored.** Rollups, formulas and backrelations
  are computed when a row is read. Do not write the whole props object back.
- **`content` is block JSON, not Markdown.** If you want to write prose, use
  `POST /api/import` (below) or the `write_content` tool over MCP, both of which
  take Markdown. Writing `content` also resets the live editing session, so
  anybody with the page open loses unsaved edits.
- **`parentId` moves within one workspace only.** Moving between workspaces is
  the separate `workspaceId` field, which takes the whole subtree along and
  answers `{"ok":true,"moved":n,"workspaceId":"…"}`.

Trashing takes the whole subtree with it, and restoring brings back exactly the
pages that were trashed in the same act — see
[Trash and recovery](trash-and-recovery.md).

## Databases

The interface calls a database a **collection**, and so do these paths. Only the
MCP surface says database, because that is the word an agent expects. It is one
thing under two names.

| Method and path | What it does |
| --- | --- |
| `GET /api/collections/{id}` | the schema (its properties) and its saved views |
| `PUT /api/collections/{id}` | replace both |
| `GET /api/collections/{id}/rows` | rows, filtered, sorted and paginated |

`PUT` needs **both** `schema` and `views` in the body; sending one alone is a
`400`. Read first, change what you need, send the pair back.

Rows are filtered in the database rather than in your script, so a table with
50 000 rows costs one page of results:

```
GET /api/collections/{id}/rows?filter=status:is:done&sort=due:asc&limit=50
```

`filter` is repeatable and reads `prop:op:value`. The operators are `is`,
`is_not`, `contains`, `gt`, `lt`, `is_empty` and `is_not_empty`; an omitted
operator means `is`, or `is_not_empty` when the value is empty too. `is` matches
a plain value **or** one element of a multi-value property. `sort` is
`prop:asc` or `prop:desc`. The answer is
`{"rows": […], "total": n, "offset": …, "limit": …}`, where `total` counts the
whole filtered set, not the page. Rollups, formulas and backrelations are filled
in per row. Other people's private rows are excluded before the count, so paging
stays honest.

Rows are pages, so you create one with `POST /api/pages` naming the database as
`parentId`, and set its values with `PATCH`. See
[Collections](collections.md) and [Properties](properties.md) for what the
values may contain.

## Search, files and export

| Method and path | What it does |
| --- | --- |
| `GET /api/search?q=…` | full-text search across everything you can read |
| `POST /api/upload?page={id}` | upload a file (multipart, field `file`) |
| `GET /api/files` | the file index; `?workspace=` and `?under={id}` narrow it |
| `GET /api/export/{id}` | one page as Markdown |
| `GET /api/export` | a zip of Markdown files, one per page, in folders |
| `POST /api/import` | a new page from Markdown |
| `POST /api/import-zip` | a zip of Markdown or CSV (multipart, field `file`) |
| `GET /api/workspaces/{id}/export` | a whole workspace as a native archive |
| `POST /api/workspaces/import` | that archive back into a new workspace |

Search returns at most 20 hits as `{id, title, icon, snippet, heading}`. The
`snippet` wraps each match in the control characters U+0001 and U+0002 so a
client can highlight safely without the page's own text injecting markup —
replace them with whatever your output needs. `heading` is the heading path of
the matching passage, for example "Contract › Termination". What is indexed, and
why searching in German finds inflected words, is [Search](search.md).

**Always pass `?page=` when you upload.** The response is
`{"url":"/files/<name>"}`, and that url is only searchable, listable and
attributable once it knows which page it belongs to. A PDF uploaded with a page
id has its text extracted and indexed under that page. The file itself is served
from `/files/<name>` and needs the same credential as everything else.

`GET /api/export/{id}` returns Markdown by default. For a document page,
`?format=html` returns a standalone HTML file, and `?format=html&print=1`
returns it inline for printing instead of as a download. A database always
exports as a Markdown table of its rows. `GET /api/export` without a workspace
covers everything you can read — pass `?workspace={id}` to keep it to one. The
difference between the Markdown zip and the workspace archive is that the
archive is lossless and can be imported back; see
[Import and export](import-export.md).

## Comments, notes and history

| Method and path | What it does |
| --- | --- |
| `GET`/`POST /api/pages/{id}/comments` | read and write comments |
| `POST /api/comments/{id}/resolve` | mark resolved or unresolved (`{"resolved":true}`) |
| `DELETE /api/comments/{id}` | the author or a workspace admin |
| `GET /api/comment-counts?workspaceId={id}` | open comments per page, in one call |
| `GET`/`POST /api/pages/{id}/notes` | the raw, append-only trail |
| `DELETE /api/pages/{id}/notes` | discard the whole trail — browser sign-in only |
| `GET /api/pages/{id}/revisions` | the version list |
| `GET /api/pages/{id}/revisions/{revId}` | one older state, in full |
| `POST /api/pages/{id}/revisions/{revId}/restore` | put the page back to it |
| `GET /api/audit` | the activity log; `?limit=` and `?before=` page through it |

A note can never be edited or removed on its own — correct a wrong one by adding
another. A version snapshot is taken at most once every two minutes per page and
the newest 50 are kept, so a script writing content in a loop will not fill the
history. Restoring snapshots the current state first, which makes the restore
itself reversible. [Comments and notes](comments-and-notes.md) and
[History and audit](history-and-audit.md) go into both.

## Workspaces, members and sharing

| Method and path | What it does |
| --- | --- |
| `GET /api/workspaces` | the workspaces you are in, with your role in each |
| `POST /api/workspaces` | create one, optionally from an existing one as a blueprint |
| `PATCH /api/workspaces/{id}` | name, icon, logo, agent access, sidebar mode |
| `DELETE /api/workspaces/{id}` | delete it |
| `GET`/`POST /api/workspaces/{id}/members` | who is in it; add somebody by email |
| `PATCH`/`DELETE /api/workspaces/{id}/members/{userId}` | change or remove a role |
| `PUT /api/workspaces/{id}/rules` | the workspace's written rules — browser only |
| `POST`/`DELETE /api/pages/{id}/share` | mint or revoke a public link |
| `POST`/`DELETE /api/collections/{id}/form-share` | mint or revoke a public form |
| `GET /api/library` · `POST /api/library/{id}` | the blueprint shelf, and using one |

`POST /api/pages/{id}/share` takes an optional `expiresInDays` and `password`
and answers `{"token":"…","url":"…"}`. There is one read link per page: sharing
again replaces the old token, which is how you rotate a link somebody forwarded.
[Sharing](sharing.md) covers what an anonymous visitor actually sees.

## Watching changes

`GET /api/events` is a Server-Sent Events stream. It opens with
`{"type":"hello","version":"…"}`, sends a comment line every 25 seconds to keep
the connection alive, and then one small message per change. The messages carry
no content — only what changed, so that a browser can ask for it through a route
that checks permissions:

| Message | Meaning |
| --- | --- |
| `{"type":"pages"}` | the page tree changed somewhere |
| `{"type":"rows","collection":"…"}` | that database's rows changed |
| `{"type":"notes","id":"…"}` | that page's raw trail changed |
| `{"type":"presence"}` | somebody or some agent started or finished working |

`GET /api/presence` lists who is working on what right now, which is what agents
announce with `working_on`. `GET /api/ics` returns your calendar subscription
links, and `GET /api/skill` downloads the agent skill this instance generates
for itself ([the skill](skill.md)).

## Instance administration

These exist, and a token cannot use any of them — they all require a browser
sign-in, and most also require the admin or owner role: `/api/users`,
`/api/settings`, `/api/invites`, `/api/webhooks`, `/api/2fa`, `/api/me/prefs`,
`/api/admin/info`, `/api/admin/backup`, `/api/admin/access` and the rest of the
admin endpoints. `/api/tokens` belongs to the same group — the dialog described
at the top of this page is the only way to mint a token, on purpose, because a
key that can mint keys is not a limit.

What they do is described where the feature is:
[Administration](administration.md), [Permissions](permissions.md),
[Account](account.md) and [Webhooks](webhooks.md).

## Two habits worth having

**Check by behaviour, not by version.** `GET /api/health` reports a version
string, and a mislabelled build reports it just as confidently. If your script
depends on something recent, call the endpoint and look at the answer.

**Ids are opaque.** A page id is 32 hexadecimal characters and means nothing;
never build one, never parse one. Get it from a list, a search result or the
response to the call that created the page.

If a call is refused and you cannot see why, [Troubleshooting](troubleshooting.md)
lists the usual causes — most of them turn out to be the workspace scope on the
token or a password that was changed.
