# Concepts

Eight words. Everything else in Salt.md is built out of them, and most confusion
comes from mixing two of them up.

## Page

**Everything is a page.** A document is a page. A database is a page. A row
inside a database is a page. A page has a title, an optional icon and cover,
tags, a body of blocks, comments, a history and — if it is a row — property
values.

This is not a slogan, it is the data model, and it has a practical consequence
you will meet constantly: **a row can do everything a document can.** It can
have its own text, its own sub-pages, its own files. A task in a board is not a
record in a table; it is a page that happens to sit in one.

## Block

The body of a page is a list of **blocks**: paragraph, heading, list, quote,
code, table, image, video, audio, file, callout, bookmark, table of contents,
and an embedded collection. You add one with `/` in the editor. Blocks can be
dragged, nested, and laid out in columns.

See [Pages](pages.md).

## Collection — which the tools call a database

A **collection** is a set of pages that share a **schema**. Its pages are called
**rows**. You look at it through one or more **views**.

Here is the one place where the interface and the API use different words on
purpose, and you need both:

| The interface says | The tools say |
| --- | --- |
| Collection | `database` |

The interface says *Collection* because the word covers a table, a board, a
calendar and a gallery equally, and because it promises no SQL to somebody who
does not want any. The MCP tools say `database` — `create_database`,
`embed_database`, `database_id` — because renaming a tool breaks every agent
configuration in existence, and an agent reads a schema rather than a brochure.

**Use the tool names when you write code and the word "collection" when you
write to a person.** Do not try to fix one side into the other.

See [Collections](collections.md).

## Row

A page inside a collection. It carries **property values** in addition to
everything a page has.

One rule that explains a lot of behaviour: **bare rows are not in the page
tree.** A collection with fifty thousand rows would otherwise flood the sidebar
and every listing. A row appears in the tree only when it has live sub-pages of
its own — because then those sub-pages need a parent to hang under.

## Property

A typed field on a schema: `Status`, `Due`, `Owner`. Thirteen types, three of
which are **derived** — computed when a row is read, never stored. See
[Properties](properties.md).

Every property has an **id** and a **name**. The name is what people see; the id
is what you write.

```
set_properties(page_id: "...", properties: { "status": "in-progress" })
                                              ^ id        ^ option id
```

Writing the *label* instead of the id silently produces a value nothing matches.
`get_collection` returns both. This is the single most common mistake against
the API.

## View

A saved way of looking at one collection: which type (table, board, …), which
columns, which filters, which sort, what it groups by. A collection can have
many, and they are independent. See [Views](views.md).

## Workspace

The unit of access. **Membership is per workspace, not per page.** Everything in
a workspace is readable by its members, except pages explicitly marked private,
which only their owner sees.

A workspace also carries its own **rules** (conventions written for the people
and agents working there), a layout preference, and a setting for what agents
may do in it. See [Workspaces](workspaces.md).

## Link

Two pages become connected in two different ways, and Salt keeps them apart
because they mean different things:

- **Filed under** — a page's parent. Structure. This is what the sidebar shows.
- **Mentioned** — a `@`-mention or `[[wiki link]]` in one page's text pointing at
  another. This is what backlinks and the graph show, and it is the connection
  nobody filed anywhere.

A relation **property** is a third kind, and it belongs to collections rather
than to text. See [Properties](properties.md#relation).

## How they fit together

```
Workspace  "Documentation"
├── Page   "AWO Bezirksverband"            ← a document
│   ├── Collection "Sites"                 ← a database, filed under the document
│   │   ├── Row "Neuwied"                  ← a page with property values
│   │   │   └── Page "Network & uplink"    ← a sub-page of a ROW
│   │   └── Row "Koblenz"
│   └── Page "VPN concept"
└── Page   "Phonekom AG"
```

The sidebar can show this as one tree, or split into Documents and Collections —
a per-workspace setting, because both readings are right for different work. See
[Workspaces](workspaces.md#how-the-sidebar-is-arranged).
