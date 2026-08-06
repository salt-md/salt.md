# Pages

A page has a title, an optional icon and cover, tags, a body of blocks, and
whatever else you hang under it. Rows in a collection are pages too, and
everything here applies to them.

## Writing

Type `/` anywhere for the block menu. The blocks Salt.md has:

**Text** — paragraph, headings, bulleted, numbered and check lists, quote, code
block, divider, table.

**Media** — image, video, audio, file. Drag one in from your desktop, paste it,
or pick it from the block menu.

**Salt's own** —

| Block | What it is |
| --- | --- |
| Callout | a highlighted note with an emoji |
| Bookmark / Embed | a link card, or a YouTube/Vimeo player |
| Table of contents | auto-generated from the headings below it |
| Collection | an existing collection, embedded and fully usable in place |

Blocks drag by their handle, nest, and can be laid out in columns by dropping
one against another's edge.

## Dropping in files

Drag a file from your desktop anywhere onto the page — the text, the margins,
the empty stretch below the last block, even the title. If you drop it on the
text it lands where the pointer is; anywhere else it goes to the end.

Images, video and audio become players. Everything else becomes a file block
with its name, and a click previews it where a preview is possible.

Every upload carries its page, which is what puts it in the workspace's file
list and, for PDFs, into search. See [Files](files.md).

## Linking pages

Two triggers, one result:

- `@` — mention a page
- `[[` — the same thing with wiki-link muscle memory

Either inserts a real **page link**. Real matters: the backlink index and the
graph read page links and nothing else. A Markdown link you paste by hand
pointing at a page of this instance is converted into one on import.

The receiving page shows **Linked references** at the bottom: everything that
mentions it. Nobody has to maintain that.

## Sub-pages

The `+` beside a page in the sidebar asks what to put inside: a **page** or a
**collection**. Both work anywhere, including under a database row — a dossier
under a deal is an ordinary thing to build.

## Favourites

The star in the topbar pins a page to the top of your sidebar. Favourites are
**per person** — starring something does not put it on anybody else's sidebar —
and they can be dragged into the order you want.

Use them for the handful of pages you open every day. Everything else is faster
to reach with `⌘K`.

Over MCP: `update_page(favorite: true)`.

## Tags

Lightweight labels, Obsidian-style. Up to 30 per page, 40 characters each,
deduplicated case-insensitively. A tag can be given a colour, and that colour is
shared by everyone in the workspace.

Tags are for cutting across the tree. If a label wants a value as well as a
name, it wants to be a collection property instead.

## Comments

At the foot of a document, collapsed until you open them. A comment can be
resolved and reopened; its author or a workspace admin can delete it.

Comments are a **conversation**, aimed at people. They are not a record of what
happened — that is the next thing.

## The raw trail

Below the comments, a quiet line: *"14 notes · 14:02 – 17:40"*. It opens.

A **note** is one line, written while you work, with no title and no place to
choose. Anybody can add one, and so can an agent:

```
note(page_id: "…", text: "approach A is out — cycles in the parent chain")
```

Four rules, and each one is the point rather than a policy:

- **Append-only.** A note can never be edited or removed singly — not by
  permission, but because there is no way to. Whoever could touch the 14:02 line
  at 16:00 already knows how it turned out, and then it is the tidy version again
  with timestamps in front. Correct a wrong note by adding another that says so.
- **The same permission as the page.** Not one bit narrower. A trail that looks
  different per reader is worthless as evidence.
- **Nothing expires.** But a person can discard a page's whole trail
  deliberately, and that decision is logged.
- **People as well as agents.** A trail only machines keep leaves out the most
  interesting line — the one where a human drops the approach.

Checking out of `working_on` leaves its last note behind as a trail entry. Those
notes were already exactly this, and were being thrown away.

## History

Every save writes a **revision**; the newest 50 per page are kept. Open the
history to see them, compare, and restore one. Restoring is itself a change, so
it can be undone the same way.

## Working together

Open the same page in two browsers and you see each other's cursors and edits as
they happen. The server relays the changes and never interprets them.

This is separate from the change feed that keeps the sidebar, boards and lists
current when somebody creates, trashes or restores something elsewhere.

## Templates

Any page can be **saved as a template**, with its structure, its blocks and — for
a collection — its schema and views. Creating a page from a template starts from
that copy.

`save_as_template` does it over MCP; `create_page(template_id: …)` uses one.

## Trash

Deleting moves a page and its subtree to the trash, where it can be restored. It
is purged for good after 30 days by default. See
[Sharing](sharing.md#the-trash).
