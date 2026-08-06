# Automation

Three ways Salt.md talks to things outside itself: it can call you, you can
subscribe to it, and you can move data in and out.

## Webhooks

Salt.md calls a URL of yours when something happens. This is the only thing in
the product that reaches **out**.

**Events**

| Event | When |
| --- | --- |
| `page.created` | a page is created |
| `page.updated` | a page changes |
| `page.trashed` | a page goes to the trash |

Configured per instance in the admin dialog under **Webhooks**.

Three properties of the delivery are deliberate and should not be undone:

- **The payload names a page and never carries it.** You get an id and enough to
  know what happened; you fetch the content yourself, with a credential, through
  the normal permission checks. A webhook is not a side door around them.
- **Every delivery is signed.** `X-Salt-Signature: sha256=…` over the body, with
  a secret shown exactly once when the webhook is created. Verify it — an
  unsigned-but-plausible POST is trivial to forge.
- **The target is checked before it is called.** Deliveries go through the same
  guard the bulk importer uses, so a webhook URL cannot be pointed at
  `169.254.169.254`, at your router, or at anything else on the private network
  the server sits in.

## The calendar feed

Every date property across the collections you can read, as an iCalendar feed
your calendar app subscribes to.

```
https://<your-instance>/ics/<token>.ics
```

- **The token is the credential**, like a share link. No login, and anybody with
  the URL sees what you see.
- One token per person, always. Narrowing is a **view** on what that person may
  read, never a way to see more.
- The feed takes a **scope**: everything, one workspace, or one collection.
- An id you cannot read yields an **empty calendar rather than an error**, so a
  collection that is moved or made private does not leave a broken subscription
  sitting in somebody's calendar app.

Apple Calendar, Google Calendar and Outlook all poll it on their own schedule —
which is theirs, not yours, and is usually measured in hours.

## Import and export

### In

| From | How |
| --- | --- |
| Markdown | one file or a folder — links between the files become real page links |
| CSV | columns become properties, types guessed |
| A Salt archive | a whole workspace, one to one, from another instance |
| A JSON API | `import_url` — Salt fetches and writes it itself |

`import_url` exists for agents. For more than about twenty records, looping
`create_rows` exhausts your context long before the import finishes; this way
**none of the content passes through you**. It returns a job id immediately;
poll `get_import_status`. Only public hosts can be fetched.

A Markdown link pointing at a page of this instance becomes a real **page link**
on import. Until that existed, everything an agent wrote was an island in the
graph — the backlink index and the graph read page links and nothing else.

### Out

| Format | What it is |
| --- | --- |
| Markdown | readable anywhere; documents, without the databases |
| HTML | one page, print-styled — "Save as PDF" produces something presentable |
| Native archive | a whole workspace, importable one to one |
| The data directory | the SQLite file plus the uploads — see [Self-hosting](self-hosting.md#backup) |

Export is per workspace or per page, from the workspace settings and the page
menu.

## The REST API

Everything the interface does, it does over `/api`, with the same bearer token an
agent uses. If you want to script something that has no tool, that is the door —
and [Agents](agents.md) explains what a token may and may not reach.
