# Import and export

Getting content into Salt.md and back out again. There are five ways in — a
single Markdown file, a folder or archive of them, a Notion export, a JSON
source an agent points Salt.md at, and a native workspace archive — and four
ways out: Markdown, a self-contained HTML page, a whole workspace as a ZIP, and
an iCalendar feed your calendar app subscribes to. This page covers each one:
what it accepts, what it produces, and what does not survive the trip.

Everything here works on the content you can already read. An import writes
where you have write access; an export contains what you would see in the app
and nothing more.

## The paths at a glance

| Way | Direction | Format | Where you find it |
| --- | --- | --- | --- |
| Markdown file | in | `.md` | page menu **⋯ → Import (.md / .zip)** |
| Archive of Markdown | in | `.zip` | the same menu item |
| Notion export | in | `.zip` with CSVs | the same menu item |
| JSON source | in | any HTTP JSON API | `import_url` over MCP |
| Workspace archive | in | `.salt.zip` | workspace settings → **Import workspace…** |
| One page | out | `.md` | **⋯ → Markdown (.md)** |
| One page | out | `.html` | **⋯ → Web page (.html)** |
| One page | out | print / PDF | **⋯ → Print / as PDF** |
| One workspace | out | ZIP of `.md` files | workspace settings → **Export as Markdown** |
| One workspace | out | `.salt.zip` | workspace settings → **Export workspace** |
| Every date property | out | iCalendar feed | user menu → **Subscribe to calendar** |

## Importing Markdown

### A single file

Open any page, press **⋯** in the top right, choose **Import (.md / .zip)** and
pick a `.md` or `.markdown` file. The file becomes one new page and you are
taken to it.

Two things about this are worth knowing before you use it on twenty files:

- **The new page lands at the top level**, not under the page whose menu you
  used. The menu is where the item lives; it is not the destination.
- **The workspace is your default one** — the first workspace you are a member
  of, which is not necessarily the one currently open in the sidebar. Move the
  page afterwards if it landed in the wrong place.

The title comes from the first Markdown heading in the file. A file with no
heading at all produces a page called **Imported**.

The API behind it is a POST to `/api/import` with `{parentId, title, markdown}`, and
that one does take a parent: a script or an agent can put the page exactly where
it belongs. See [the API](api.md).

**Dragging a `.md` file onto an open page does something different.** A drop
attaches the file to the page as a download block — it does not import it. Use
the menu item to turn a file into a page.

### An archive of Markdown files

The same menu item accepts a `.zip`. The archive is unpacked into a page tree:

- Every folder becomes a page.
- Every `.md` file becomes a page under the folder it sat in.
- A file that pairs with a same-named folder — `Handbook.md` next to
  `Handbook/` — fills that folder's page instead of creating a second page
  beside it.
- Nested `.zip` files inside the archive are opened and their contents treated
  as if they had been at the top level, up to five levels deep.

Everything again lands at the top level of your default workspace, and when it
is done a message says how many pages were created and how many entries were
skipped: *"Imported 42 pages, 7 skipped"*.

**Skipped means not imported.** Anything that is not a `.md` or a `.csv` file is
counted as skipped and left behind — images, PDFs and every other attachment in
the archive. A Notion export's images do not come along; the pages that
referenced them keep the text and lose the picture.

The limits, all of them enforced server-side:

| Limit | Value | What happens past it |
| --- | --- | --- |
| Whole upload | 100 MB | the upload is rejected |
| One Markdown file | 2 MB | that file is skipped |
| One CSV file | 16 MB | that file is skipped |
| Pages created | 2000 | the import stops there |
| Entries in the archive | 20000 | the rest are not looked at |
| Nested archives | 5 levels | deeper archives stay unopened |

Files whose name starts with a dot are ignored silently and are not counted as
skipped.

### What Markdown is understood

The importer covers the common subset. Anything it does not recognise becomes a
paragraph rather than being dropped.

| Markdown | Becomes |
| --- | --- |
| `# ` to `###### ` | a heading — levels 4 to 6 collapse to level 3 |
| `- `, `* `, `+ ` | a bullet item |
| `1. `, `1) ` | a numbered item |
| `- [ ] `, `- [x] ` | a checklist item, unticked or ticked |
| two spaces of indent | one level of list nesting (a tab counts as two spaces) |
| `> ` | a quote |
| ` ``` ` with a language | a code block in that language |
| `![alt](url)` | an image block |
| a table of `\| … \|` rows | a table; the `\| --- \|` separator row is dropped |
| `**bold**`, `__bold__` | bold |
| `*italic*`, `_italic_` | italic |
| `~~strike~~` | struck through |
| `` `code` `` | inline code |
| `[text](url)` | a link |

`__bold__` and `_italic_` only take effect when the underscores are flanked by
non-word characters, so `my_var_name` stays literal.

There is no divider on import: a line of `---` arrives as a paragraph
containing three hyphens, even though the export writes a divider that way.

### A Markdown link to a page of this instance becomes a real page link

This is the one rule worth memorising, because it is invisible until it is
missing.

A link whose target is `/p/<id>` — where `<id>` is the 32-character page id —
becomes a **page link**, not an ordinary link. An absolute URL that ends the
same way works too, which is the form a share link takes.

| You write | You get |
| --- | --- |
| `[Handbook](/p/8f3c…d1)` | a page link: it appears in backlinks and in the graph |
| `[Handbook](https://salt.example.com/p/8f3c…d1)` | the same |
| `[Handbook](https://example.com/handbook)` | an ordinary link — navigates, and nothing else |

The difference matters because the backlink index and the [library
graph](library.md) read page links and nothing else. A page reached only by
ordinary links is an island: it opens when clicked and shows up nowhere in the
structure. Everything an agent writes goes through this same converter, which is
why `create_page` and `write_content` both say so in their descriptions.

It also closes a round trip. The Markdown export writes a page link back as
`[label](/p/id)`, so exporting a page and importing it again keeps its internal
links.

## Importing a Notion database

Notion's **Export → Markdown & CSV** writes each database twice: a
`<Name> <id>.csv` holding every row and column, and a `<Name> <id>/` folder
holding one `.md` per row with that row's body. Salt.md reads both and builds a
real [collection](collections.md) out of them, rather than a pile of loose
pages.

What it does:

- **The 32-character Notion id is stripped** from every page and folder name, so
  titles read as they did in Notion.
- **The first CSV column becomes the title.** Every other column becomes a
  property, its type inferred from the values in it.
- **A `_all.csv` twin is ignored** when the plain CSV beside it exists. Notion
  writes both; importing both would produce the database twice.
- **Row bodies are matched by title** to the `.md` files in the paired folder,
  even when Notion truncated or sanitised the filename. A matched file is used
  once and never claimed by a second row.
- **Notion's repeated preamble is stripped** from each row body — the `# Title`
  heading and the run of `Property: value` lines under it. Those values are the
  row's properties and are shown by the property panel; repeating them as body
  text is duplication. Whatever real content follows is kept.

### How a column's type is guessed

| The column's non-empty values | Type |
| --- | --- |
| all parse as numbers | `number` |
| all parse as dates | `date` |
| at most 12 distinct values, and either some value repeats or there are at most 6 distinct ones | `select` |
| anything else | `text` |

A comma is read as a decimal point, so `1,5` imports as 1.5 — and `1,234`
imports as 1.234, not as one thousand two hundred and thirty-four.

Dates are recognised in these forms, and always stored as a plain calendar day.
**A time of day in a CSV column is dropped.** A Notion date range written
`Start → End` keeps the start.

`2026-07-18` · `2026-07-18T14:30:00` · `2026-07-18 14:30` · RFC 3339 ·
`July 18, 2026` · `Jul 18, 2026` · `18.07.2026` · `7/18/2026` · `18.7.2026`

Note that the slash form is read as **month/day**, the way Notion writes it.

Every value of a `select` column becomes an option, in the order the values
first appear, with colours taken in turn from a fixed palette.

### The views you get

The imported collection comes with a **Table** view. If any column was inferred
as a select, it also comes with a **Board** grouped by it — a column literally
named `Status` if there is one, otherwise the first select column found.

### Cleaning up an older import

Instances that imported from Notion before the preamble was stripped have that
duplicated header sitting in every row body. With the server stopped:

```
./salt fix-notion-rows
```

It removes the repeated title and property lines from existing rows and reports
how many it changed. Blocks it does not remove are left byte for byte as they
are, so real content is never rewritten.

## Importing from a JSON source

`import_url` is for agents, and it exists because of a hard limit rather than a
convenience: writing 654 records through `create_page` means the agent typing
every character of them, which exhausts its context long before the import
finishes. Here the agent sends only the address and the mapping — a few hundred
characters — and Salt.md fetches the data and writes the pages itself. None of
the content passes through the agent.

| Field | Meaning |
| --- | --- |
| `url` | an `http://` or `https://` address returning JSON. Required. |
| `title` | the field each record's title comes from. Required. |
| `items` | path to the array of records, e.g. `cards` or `data.results`. Omit when the response *is* the array. |
| `markdown` | a field to use as the page body |
| `properties` | database property name → source path, e.g. `{"Due": "due"}` |
| `resolve` | turn a foreign id into readable text using another array in the same response |
| `headers` | request headers for this one fetch, e.g. an authorization header. Never stored. |
| `database_id` | import as rows of this database |
| `parent_id` | or: as pages under this page |
| `workspace_id` | or: as top-level pages in this workspace |
| `limit` | import only the first N records — a trial run before the real thing |

A path may reach into a list: `labels[].name` picks that field out of every
element and joins the results.

`resolve` handles the shape almost every REST answer has, where a record carries
a foreign id and the readable name sits in a second list:

```json
{ "url": "https://api.example.com/board/42?cards=all&lists=all",
  "items": "cards", "title": "name", "markdown": "desc",
  "database_id": "…",
  "properties": { "Status": "idList", "Labels": "labels[].name" },
  "resolve": { "idList": { "from": "lists", "match": "id", "to": "name" } } }
```

Four behaviours to rely on:

- **Nothing is written until the mapping works.** The source is fetched and
  shaped into records before the job starts, so a wrong path or an unreachable
  address comes back as an error immediately instead of leaving half-created
  pages behind.
- **A misspelled property is refused**, with the list of properties the database
  actually has. It does not quietly write nothing.
- **Missing select options are created**, once for the whole import and with a
  colour each, so a board does not come out as one grey column.
- **Only public addresses can be fetched.** Every resolved address is checked
  and then connected to directly, so an import cannot be used to reach the
  server's own network — a router, a hypervisor, a cloud metadata service. The
  refusal names the address. Whoever runs the server can open this up for
  self-hosted sources with `SALT_IMPORT_ALLOW_PRIVATE=1`; it is deliberately not
  a setting an agent can change.

The call returns a `job_id` at once. Poll `get_import_status` with it every few
seconds until the status reads `done`; the answer carries how many records were
written, how many failed, and up to ten error messages. Job status lives in
memory, the last 20 jobs are kept, and only the account that started a job can
read it. A restart loses the status — never the pages already created.

Limits: 64 MB for the fetched source, 20000 records, three minutes for the
fetch, at most five redirects.

An import of this kind writes directly and fires no [webhooks](webhooks.md) —
two thousand records would otherwise be two thousand outbound calls.

## Moving a workspace between instances

The Markdown export is for taking your text with you. It is not a way to move a
workspace: databases lose their schema, views and row properties on the way
back. For that there is a native archive.

**Export workspace** in the workspace settings downloads
`<name>.salt.zip`. **Import workspace…** in the same dialog takes one and
creates a new workspace from it — you become its administrator, and the sidebar
switches to it when it is done.

| In the archive | Not in the archive |
| --- | --- |
| the page tree, with positions and timestamps | accounts, members and roles |
| databases with their schema and views | comments and version history |
| row properties | share links |
| icons, covers, descriptions, tags with their colours | anything in the trash |
| templates and the private flag | other people's private pages |
| the workspace's rules, icon and image | files nobody references any more |
| every upload referenced by a page | |

Inside the ZIP: `salt-workspace.json` (a manifest with the format version and
the counts), `pages.json`, `tags.json`, and a `files/` folder.

On import every page and every file is given a new id, and references inside the
content are rewritten to match — page links, mentions and relations keep
pointing at the right thing. If the name is already taken on this instance, the
new workspace gets **(Import)** appended.

| What can go wrong | The message |
| --- | --- |
| the file is not a ZIP | *not a valid zip archive* |
| it is a ZIP but not ours | *not a Salt.md workspace archive (salt-workspace.json missing)* |
| written by a newer Salt.md | *archive format 2 is newer than this instance supports (1) — update Salt.md* |
| the instance does not let you create workspaces | *creating workspaces is disabled on this instance — ask an admin* |

The same reader is used for the ready-made workspaces on the shelf in
[the library](library.md) — those are the same format, shipped inside the
binary, with rows and documents left out.

## Exporting

### One page as Markdown

**⋯ → Markdown (.md)** on an open page, or **Export Markdown** in the page's
sidebar menu. You get a file named after the page. It starts with the title as a
level-1 heading, the icon in front of it if the page has one.

Over MCP the same thing is `get_page`; with `include_children` it returns the
whole sub-tree in one answer, each page separated by a rule and pushed one
heading level deeper.

In the [library](library.md) each row has a small **md** button that copies the
export URL to the clipboard rather than downloading — useful for feeding a page
to something else.

### A database as Markdown

Exporting a collection page produces a Markdown table: one column per property,
one row per row, in view order. Three limits follow from it being a plain table:

- **Computed columns are empty.** Rollups, formulas and backrelations are worked
  out when a view is read, and the export writes what is stored. The column
  headings appear; the cells under them do not.
- **Relation and person columns write ids**, not the names behind them.
- Sub-pages of rows are not included. Only the rows.

A checkbox writes `✓` when ticked and nothing when not. A select writes the
option's name. A number keeps four decimal places unless it is a whole number.

### One page as a web page

**⋯ → Web page (.html)** downloads a complete, self-contained HTML document —
no stylesheet to fetch, no script, real headings, lists and tables. It is the
format to hand to something that cannot read Markdown.

Links in it are cleaned first: anything that is not `http`, `https` or `mailto`
becomes `#`, so a planted URL in a block cannot run a script in whatever opens
the file.

Databases are not offered as HTML. A table is the faithful shape of their rows,
and that is what Markdown gives.

### Print, or a PDF

**⋯ → Print / as PDF** opens the same HTML in a new tab, in a print-first layout
with page margins and no application chrome, and starts the print dialog. A bar
at the top of that page — hidden when printing — offers **Print / Save as PDF**
and reminds you that on a phone the route is *Share → Print, or "Save to
Files"*.

For a collection this instead prints the view you are looking at, so what you
get is the table, board or calendar as it stands on screen.

### A whole workspace as Markdown

Workspace settings → **Export as Markdown** downloads `salt-export.zip`: one
`.md` file per page, in folders that mirror the page tree. Two pages with the
same name in the same folder get a `(2)` suffix.

Databases come out as a folder of rows in this export, one `.md` per row,
containing the row's title and body. **Row properties are not in it** — that is
what the dialog means by "Readable anywhere, without the databases". Use the
native archive when the properties matter.

The archive holds only pages you can read, and nothing from the trash.

### What each block becomes

| Block | Markdown | HTML |
| --- | --- | --- |
| heading | `#`, `##`, `###` | `<h1>`–`<h3>` |
| bullet / numbered / checklist | `- `, `1. `, `- [x] ` | `<ul>`, `<ol>`, with a disabled checkbox |
| toggle list | a bullet, children below it | `<details>` |
| quote | `> ` | `<blockquote>` |
| callout | `> ` with the emoji in front | a tinted box |
| code | a fenced block with its language | `<pre><code>` |
| divider | `---` | `<hr>` |
| image | `![name](url)` | `<img>` |
| file, video, audio | `[name](url)` | a link |
| bookmark | the URL as a link | a link with a 🔖 |
| table | a Markdown table; `\|` in a cell is escaped | `<table>` |
| columns | flattened, side by side | side-by-side `<div>`s |
| table of contents | nothing — it is built while reading | nothing |
| embedded database | `[Datenbank](/p/<id>)` | a link to the database page |
| page link | `[label](/p/<id>)` | a link to `/p/<id>` |
| underline | `<u>text</u>` — Markdown has none | `<u>` |

An embedded database exports as a **link to the database page**, never as a copy
of its rows: a copy would be stale the moment somebody edited a row.

### What does not survive a Markdown round trip

Export to Markdown and import the result, and these change:

- A divider becomes a paragraph containing `---`.
- A callout becomes a plain quote; the emoji stays as text.
- A toggle list becomes a normal bullet list.
- Columns are flattened into one column of blocks.
- Underlined text arrives as literal `<u>` tags.
- Database rows arrive as pages, with their properties gone.

Page links, headings, lists, checklists, quotes, code, images, tables and every
inline style come back unchanged.

## The calendar feed

Every `date` property, on every row, in every collection you can read, as an
iCalendar feed. Apple Calendar, Google Calendar and Outlook can subscribe to it
and re-poll it on their own schedule.

Open the user menu and choose **Subscribe to calendar**. The dialog offers a
scope under *What should the calendar contain?*:

| Scope | The feed holds |
| --- | --- |
| **Everything I can see** | every date property in every workspace you are a member of |
| a workspace | the same, limited to that workspace |
| a collection | the dates of that collection's rows |

A collection is only offered once it has a date property — the dialog says
*"A collection appears here once it has a date property."* — because a feed that
can never contain anything is worse than no feed.

**Open in calendar** hands the `webcal://` link to your calendar app; **Copy
URL** copies the `https://` form for anything that wants to fetch it.

What lands in the calendar:

- **One event per date value.** A row with two date properties produces two
  events. The summary is the row's title with the property's name in
  parentheses — *Kickoff (Due)* — and the description is the collection's name.
- **A plain date becomes an all-day event.** A value carrying a time becomes a
  timed event written without a time zone, so it shows at that clock time
  wherever it is read.
- **Events have a start and no end.** There is no duration to derive.
- The calendar's name in your app is *Salt.md*, or *Salt.md · <name>* for a
  scoped feed, so several subscriptions stay distinguishable.

**The link is the credential.** It needs no sign-in — anyone holding it sees
what you see, which is why the dialog says not to share it. There is one token
behind every scope, so **Reset the link** invalidates *all* your calendar links
at once; that is what people mean by revoking them, and the button says so.

The feed always reflects the permissions of the account it belongs to. A
collection that is moved into a private area, or a workspace you are removed
from, simply stops producing events — the subscription keeps working and goes
quiet, rather than breaking in somebody's calendar app.

## Backups are a different thing

None of the above is a backup. An export holds what one person can read, in a
format meant for reading elsewhere; a backup holds the database and every
uploaded file and can be restored onto an empty instance. It is a separate
button in the instance settings and a separate command on the server — see
[Administration](administration.md) and [Self-hosting](self-hosting.md).

## Related

- [Collections](collections.md) and [Properties](properties.md) — what a CSV
  import builds
- [Agents](agents.md) and [MCP tools](mcp-tools.md) — `import_url` in context
- [Automation](automation.md) — the map of everything that crosses the boundary
