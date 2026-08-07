# Automation

Salt.md connects to things outside itself in four ways: it **calls** an address
of yours when a page changes, your calendar app **subscribes** to a feed of your
dates, content **comes in** from Markdown, Notion exports and JSON sources, and
content **goes out** as Markdown, HTML or a native archive. This page is the map
— each part is summarised here and has its own page or its own section below.

What Salt.md does not have is a rule engine or a scheduler. Nothing inside it
says "when Status becomes Done, send an email". The pieces below are the wires;
the logic lives at the other end — in a script, in Zapier, Make or n8n, or in an
agent working over MCP (see [Agents](agents.md)).

## Webhooks — Salt.md calls you

A webhook is an address Salt.md posts to when a page is created, changed or
thrown away. It is the only thing in the product that reaches **out**; without
it, every integration has to poll.

Set up in the user menu under **Instance settings → Webhooks**. This is an
instance-wide setting and **only an administrator sees it** — a hook belongs to
the server, not to a workspace or a person.

| Event | The checkbox says | Fires when |
| --- | --- | --- |
| `page.created` | a page is created | a page, row or collection is created in the browser, or an agent calls `create_page` |
| `page.updated` | a page is changed | a page's title, content, icon or properties are saved |
| `page.trashed` | a page is thrown away | a page goes to the trash — once **per page in the subtree**, so a receiver watching one page hears about it even when a parent was thrown away |

Bulk work does not announce itself page by page. An import of a Notion archive,
an `import_url` job and an agent creating rows with `create_rows` all write
directly and fire nothing — otherwise a two-thousand-page import would turn into
two thousand outbound calls. Treat webhooks as a signal about everyday edits,
not as a change log you can reconcile against.

Enter the address under **Address to call**, tick at least one box under **When
should we call?**, press **Add**. Salt.md then shows the signing secret once,
under the line *"Copy this secret now — it is shown only once."* There is no way
to see it again; if you lose it, **Remove** the hook and add it back.

Four things about the delivery that shape what you can build on it:

- **The message names a page and never carries it.** You get the id, the title,
  the workspace and a path — never the content. A receiver that is allowed to
  read the page fetches it with its own credential, through the normal
  permission checks.
- **Every delivery is signed**, as `X-Salt-Signature: sha256=…` over the raw
  body. Verify it: without that check, anybody who learns the URL can forge a
  message.
- **A failed delivery never fails your save.** A page that saved correctly is
  not reported as an error because somebody's endpoint is down. The result of
  the last attempt is shown beside the hook instead — `HTTP 200`, `failed: …`,
  or **not called yet**.
- **One attempt, ten seconds, no redirects.** There is no retry queue, and an
  endpoint that answers with a redirect is treated as a failure.

Hooks are not filtered by workspace: every active hook hears about every page on
the instance. Filter on your side, using the workspace id in the message.

**[Webhooks](webhooks.md)** has the exact payload, the signature check in code,
and what a receiver has to do.

## The calendar feed

Every date property, on every row, in every collection you can read, as an
iCalendar feed your calendar app subscribes to. Open it from the user menu:
**Subscribe to calendar**. Every account has this — it is not an admin feature.

One event is written per date value: the summary is the row's title with the
property's name in parentheses — "Kickoff (Due)" — and the description is the
name of the collection it came from. A row with two date properties therefore
produces two events. A plain date becomes an all-day event; a value
that carries a time becomes a timed one, written without a time zone, so it
shows at that clock time wherever the calendar is read. Events have a start and
no end.

The dialog offers a **scope** under *What should the calendar contain?*:

| Scope | What lands in the feed |
| --- | --- |
| **Everything I can see** | every date property in every workspace you are a member of |
| A workspace | the same, narrowed to one workspace |
| A collection | one collection's dates |

Only collections that actually have a date property are listed — otherwise the
dialog would hand out a permanently empty feed. If the list is empty you will
see *"A collection appears here once it has a date property."*

The buttons are **Open in calendar**, which hands a `webcal://` link to Apple
Calendar, Google Calendar or Outlook; **Copy URL**, which copies the same feed
as an ordinary web address for a calendar that wants one; and **Reset the
link**.

```
https://salt.example.com/ics/<token>.ics
https://salt.example.com/ics/<token>.ics?workspace=<id>
https://salt.example.com/ics/<token>.ics?collection=<id>
```

Five things worth knowing before you paste that link anywhere:

- **The token is the credential.** No login, like a share link. Anybody holding
  the URL sees what you see. Do not share it.
- **There is one token per person**, behind every scope. Narrowing the feed is a
  view on what you may read — never a way to see more.
- **Reset the link invalidates every feed at once**, because they all sit behind
  that one token. The button says so on hover: *Invalidates all calendar links*.
  Afterwards you re-subscribe in each calendar app.
- **Permissions are checked on every fetch, not at subscription time.** A
  collection that is moved, made private or trashed simply stops producing
  events. A scope you can no longer read yields an **empty calendar rather than
  an error**, so a stale subscription does not sit there flashing red in
  somebody's calendar app.
- **The feed is read-only and polled on the app's schedule**, which is the app's
  business and usually measured in hours. Editing an event in your calendar
  changes nothing in Salt.md.

## Content coming in

| Source | Where |
| --- | --- |
| A Markdown file or a Notion/Markdown `.zip` | page ⋯ menu → **Import (.md / .zip)**, or the **Import (.md / .zip)** button on an empty instance |
| A native workspace archive from another instance | workspace settings → **Import workspace…** |
| A JSON API, in bulk | the `import_url` tool, for agents |

A `.zip` import rebuilds a tree: folders become parent pages, `.md` files become
pages, Notion's 32-character id suffixes are stripped from the titles, and a
Notion database CSV becomes a real collection — columns turned into typed
properties, rows into rows, and the paired row files filling each row's body.

`import_url` exists because writing several hundred records through
`create_rows` exhausts an agent's context long before the import finishes. The
agent names the source and the mapping, Salt.md fetches and writes the records
itself, and none of the content passes through the agent. It answers with a job
id at once; the agent polls `get_import_status` until it says done.

A Markdown link pointing at a page of this instance becomes a **real page link**
on import, so imported pages show up in backlinks and in the graph instead of
arriving as islands.

**[Import and export](import-export.md)** has the size limits, what the type
guesser does to each column, and what each format keeps and loses.

## Content going out

| Format | Where | What it is |
| --- | --- | --- |
| Markdown | page ⋯ menu → **Markdown (.md)**, or **Export Markdown** in the sidebar menu | one page, readable anywhere |
| Web page | page ⋯ menu → **Web page (.html)** | one page as standalone HTML |
| Print / PDF | page ⋯ menu → **Print / as PDF** | a print view that saves as a PDF, on the phone too |
| Markdown, whole workspace | workspace settings → **Export as Markdown** | a `.zip` mirroring the page tree, *"Readable anywhere, without the databases"* |
| Native archive | workspace settings → **Export workspace** | *"Native archive — importable one to one"* |
| The whole instance | Instance settings → Maintenance → **Download backup (.tar.gz)** | database and uploads, see [Self-hosting](self-hosting.md) |

Two details that decide which of these you want:

- **Exporting a single collection gives you a Markdown table** — one column per
  property, with select options written out as their names and checkboxes as a
  tick. Exporting a whole workspace as Markdown does not: there each row becomes
  its own file under a folder named after the collection, and the properties are
  left behind. That is what *"without the databases"* means. Only the **native
  archive** carries schemas, views, row properties, tags, covers and the
  uploaded files.
- **HTML and the print view are for documents.** A collection has no HTML export;
  **Print / as PDF** on a collection prints the page as it stands on screen,
  while on a document it opens a clean standalone print view in a new tab, which
  also works on a phone where the browser's own print does nothing.

A bulk export contains only what you are allowed to read: private subtrees are
left out of the archive rather than included and hoped over.

## The API, if none of the above fits

Everything the interface does, it does over `/api`, with the same bearer token
an agent carries. That is the door for anything you want to script that has no
tool and no button — see **[The REST API](api.md)** for the routes and
[Agent access](agent-access.md) for what a token may reach.
