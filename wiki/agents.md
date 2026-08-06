# Agents

Salt.md speaks **MCP**. An AI agent can read, write and search pages, maintain
collections, say what it is working on and leave notes behind — over the same
permission model a person has.

This page is written for both sides: the person connecting an agent, and the
agent itself.

## Connecting

The endpoint is `<your-instance>/mcp`. There are two ways in.

**Signing in (preferred).** Point the client at the plain address. It gets a
`401` that says where to authorize, a browser opens, a person approves once, and
nothing secret ever enters a config file. The grant can be ended later without
touching anything else.

**A token in the address.** `<your-instance>/mcp/<token>` — for clients that have
a URL field and nothing else. Treat that URL like a password.

Both are offered in the workspace menu under **Connect an agent**, which also
gives you the exact configuration line for your client and can mint a token.

### The skill

The same dialog has **Download skill**: a small bundle the instance generates for
itself, carrying its own address, your workspace ids and your workspace rules.

Its first instruction is to write a short block into the repository's
`CLAUDE.md` / `AGENTS.md`. That is the point of it. A skill is loaded when it is
invoked; those files are read at the start of every session by every agent,
without anybody remembering to ask. Rules get forgotten because of where they
are kept, not because agents are careless.

**No token is in the bundle**, deliberately — it gets unpacked into a repository,
and repositories get pushed.

## The tool catalogue

Thirty-three tools. `whoami` always reports what this particular connection may
actually do.

### Finding things

| Tool | For |
| --- | --- |
| `search` | full text across everything you may read — start here |
| `list` | enumerate pages, databases, workspaces, templates, files, tokens, users |
| `get_page` | one page with its content; `include_children` for the subtree |
| `get_collection` | a database's schema and views — call before writing rows |
| `query_rows` | rows with filters and sorting |
| `get_links` | backlinks for one page, or the whole graph with edge kinds |
| `get_workspace` | members and their ids, counts, and the workspace rules |
| `get_permissions` | who may do what with a page |
| `whoami` | scope, reachable workspaces, and what is deliberately unavailable |
| `revisions` | a page's saved versions — and putting one back |

### Writing

| Tool | For |
| --- | --- |
| `create_page` | a new document; `parent_id` files it, `template_id` starts from a template |
| `write_content` | Markdown into a page — `mode`: append, prepend, replace |
| `update_page` | title, icon, tags, parent, favourite |
| `duplicate_page` | a copy, with its subtree |
| `create_database` | a new collection with its schema |
| `create_rows` | many rows in one call — cheaper and safer than one create each |
| `set_properties` | property values on a row |
| `update_schema` | add or change columns, including rollups and backrelations |
| `set_view` / `delete_view` | table, board, calendar, gallery — filters, sorting, grouping |
| `embed_database` | put an existing collection inside a document |
| `upload_file` | a file onto a page; large ones go over HTTP instead |
| `set_trashed` | trash and restore — nothing is destroyed |
| `set_sharing` | mint or revoke a public link |
| `save_as_template` | turn a page into a template |
| `workspace` | create a workspace, or change its name and icon |
| `propose_workspace_rules` | leave a rules draft for an admin — never sets them |
| `import_url` / `get_import_status` | bulk-import from a JSON source, without the content passing through you |

### Saying what you are doing

| Tool | For |
| --- | --- |
| `working_on` | check in before a long task, check out after — shown live to people |
| `note` | one line onto a page's raw trail: append-only, dated, permanent |
| `comments` | add, resolve or read comments — a conversation, aimed at people |
| `delete_comment` | remove one permanently — the author or a workspace admin |

Those first two look alike and are opposites. **Presence is about now and has a
lifetime; a note is a dated fact that never changes.** Use both.

```
working_on(page_id: "…", agent: "claude", label: "Claude Code",
           note: "tidying the file index")
note(page_id: "…", text: "approach A is out — cycles in the parent chain")
working_on(page_id: "…", agent: "claude", done: true)
```

You stay listed until you check out: nothing expires mid-task, and every other
call you make on that page counts as a sign of life. **Checking out leaves your
last note behind as a trail entry** — see [Pages](pages.md#the-raw-trail).

## Rules for agents working here

**Read before you write.** `search` and `get_page` are cheap. A second page about
something that already has one is worse than none.

**Follow the workspace rules.** `get_workspace` returns them. They are written by
the people who work there and they outrank general advice.

**Record the reasoning, including what you rejected.** Nobody ever asks why
something was *not* built, which is exactly why it gets proposed a second time.

**Write notes as things happen, not afterwards.** A note written before you know
how it ends is the only kind of self-report that cannot be tidied into a
coherent story.

## Permission, exactly

An agent has **the permissions of the human whose credential it carries** — no
more, and possibly less.

### Tokens are a second key, not a guest pass

An API token carries the full identity of the person who created it. It narrows
only by **scope** (read or write) and by **which workspaces** it may reach.

Administrative endpoints — users, tokens, instance settings, account preferences
— are closed to tokens entirely. Those need a signed-in browser session. A key
to content is not an admin pass.

### A workspace can refuse agents

Each workspace chooses what credentials may do there:

| Setting | Meaning |
| --- | --- |
| Anything they were granted | any connection that names this workspace (default) |
| Only signed-in connections | a permanent token is refused, even one naming it |
| No agents at all | browser sessions only |

The middle one is for confidential material: it accepts an agent that went
through the sign-in flow and refuses one carrying a long-lived key.

A workspace an agent may not enter is not merely unreadable — it does not appear
in its workspace list at all.

### What is refused, and how to tell

Call `whoami`. It separates "I used the wrong id" from "I am not allowed to do
this", and those two need very different next moves.

## A note about stale tool lists

A connected MCP client keeps the catalogue it fetched when it connected. After a
release that renames or merges tools, the old names linger in a running session
until it reconnects. That is not a failed deployment — and calling an old name to
"check" only proves the client is stale.
