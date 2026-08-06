# Collections

A **collection** is a set of pages that share a schema. The interface calls it a
Collection; the tools call it a `database`. Same thing — see
[Concepts](concepts.md#collection--which-the-tools-call-a-database) for why both
words exist and stay.

Use one when you have many of something and want to ask questions about them:
customers, tasks, sites, invoices, incidents. Use a document when you have one
of something and want to explain it.

## What a collection is made of

- a **schema** — the typed properties every row can carry
  ([Properties](properties.md))
- **rows** — pages that carry values for them
- **views** — saved ways of looking at them ([Views](views.md))

## Creating one

In the interface: the `+` on the Collections section, or the `+` beside any page,
which asks whether you want a page or a collection. A collection can live at the
top level, under a document, or inside another collection.

Over MCP:

```
create_database(title: "Sites", schema: [
  { id: "status", name: "Status", type: "select",
    options: [{ id: "active", name: "Active" }, { id: "planned", name: "Planned" }] },
  { id: "opened", name: "Opened", type: "date" }
])
```

Then rows, many at a time:

```
create_rows(page_id: "<collection>", rows: [
  { title: "Neuwied", properties: { status: "active" } },
  { title: "Koblenz", properties: { status: "planned" } }
])
```

`create_rows` takes `page_id`, not `database_id`, and it is required. One call
for up to 200 rows beats one call per row on every axis that matters.

## Rows are pages

A row has a title, an icon, tags, a body of blocks, comments, files, a history
and sub-pages — everything on [Pages](pages.md). Open one and you are in a
document that happens to carry property values.

This is why a task can hold its own notes, and why a deal can hold a folder of
documents without anybody inventing an attachment system.

### Rows and the sidebar

**Bare rows are not in the page tree.** A collection with fifty thousand rows
would flood every listing, so `/api/pages` leaves them out.

A row **does** appear once it has live sub-pages, because otherwise those
sub-pages would have no parent to hang under and would show up loose. Expanding a
collection in the sidebar loads its rows on demand.

## Reading rows

```
get_collection(page_id: "<collection>")   → schema, views, property ids
query_rows(page_id: "<collection>", filter: [...], sort: "...")
```

Always `get_collection` first. It gives you the property **ids** and the option
**ids**, which is what you have to write — see
[Properties](properties.md#the-one-thing-that-goes-wrong-most-often).

## Collections inside documents

A collection can be **embedded** in a page's body and is fully usable there —
filter it, add rows, drag cards. The same collection can be embedded in several
documents; there is one collection and many windows onto it.

```
embed_database(page_id: "<the document>", database_id: "<the collection>")
```

This is the shape behind "the customer page shows that customer's open tickets":
one collection of tickets, embedded and filtered per customer page.

## Importing

| From | How |
| --- | --- |
| CSV | drop it in; columns become properties, types are guessed |
| Markdown | one file or a folder; links between them are preserved |
| A Salt archive | a whole workspace, one to one |
| A JSON API | `import_url` — Salt fetches and writes it itself |

`import_url` matters for agents: **none of the content passes through you.** For
more than about twenty records, looping `create_rows` would exhaust your context
long before the import finished. It returns a job id; poll `get_import_status`.

## Exporting

Markdown for the readable form, a native archive for the exact one. See
[Automation](automation.md#import-and-export).

## Deriving instead of duplicating

Before adding a property somebody has to keep up to date by hand, check whether
it is one of these:

- **backrelation** — "which tasks point at this system?" No second list to
  maintain.
- **rollup** — "how many of them are done?" Aggregates over the relation, with a
  condition.
- **formula** — arithmetic over this row's own numbers.

All three are computed when a row is read and never stored, so they cannot go
stale. [Properties](properties.md#derived-types) has the details, including what
formulas deliberately cannot do.
