# The Salt.md wiki

Salt.md is a self-hosted workspace for documents and structured data. One binary
serves the interface, a REST API, an MCP endpoint for AI agents, a realtime
collaboration relay and a change feed. Your data is one SQLite file and a
folder of uploads, on a machine you control.

This wiki is written to be read two ways. A person reads it top to bottom and
learns the product. An agent connected over MCP reads the page it needs and gets
exact names, exact limits and exact behaviour — no marketing, no "should", no
invented options.

**Everything here is derived from the code and checked against it.**
`web/scripts/check-wiki.mjs` runs in the build: every tool this wiki names must
exist, every tool that exists must be documented, and every `/api/` path
mentioned must be a real route. Documentation that drifts fails the build.

## Start here

| If you are | Read |
| --- | --- |
| new to Salt.md | [Getting started](getting-started.md), then [Concepts](concepts.md) |
| writing documents | [Pages](pages.md) |
| building a database | [Collections](collections.md) → [Properties](properties.md) → [Views](views.md) |
| an AI agent, or connecting one | [Agents](agents.md) |
| running the server | [Self-hosting](self-hosting.md), [Administration](administration.md) |

## Everything

**Using it**

- [Getting started](getting-started.md) — install, sign in, first page
- [Concepts](concepts.md) — the eight words this product is made of
- [Pages](pages.md) — blocks, links, tags, sub-pages, history, comments, notes
- [Collections](collections.md) — databases: rows, schema, what they are for
- [Properties](properties.md) — all 13 types, including rollups, formulas and backrelations
- [Views](views.md) — table, board, calendar, gallery, list, timeline, form
- [Search](search.md) — what is indexed, and why German words find each other
- [Files](files.md) — uploads, the file index, PDFs in search

**Working together**

- [Workspaces](workspaces.md) — members, roles, rules, blueprints, agent access
- [Sharing](sharing.md) — public pages, password and expiry, public forms
- [Account](account.md) — sign-in, two-factor, language and time, leaving

**Connecting things**

- [Agents](agents.md) — MCP, the tool catalogue, the skill, presence and notes
- [Automation](automation.md) — webhooks, the calendar feed, import and export

**Running it**

- [Self-hosting](self-hosting.md) — install, update, environment, backup
- [Administration](administration.md) — instance settings, users, mail, domain
- [Troubleshooting](troubleshooting.md) — the traps, and what they look like

## What Salt.md is not

Being clear about this saves everyone time.

- **Not a cloud service.** There is no salt.md account. You run the server.
- **Not a spreadsheet.** Formulas do arithmetic over a row's own properties and
  nothing else — see [Properties](properties.md#formula).
- **Not a wiki engine with page-level permissions.** Access is per workspace,
  plus a private flag per page. There is no per-page ACL.
- **Not multi-tenant.** One instance is one organisation.

## Conventions in this wiki

- **Bold** marks a term the product uses with a specific meaning.
- `code` marks something you type exactly: a tool name, a property id, a path.
- A table means the list is complete. Prose means it is an example.
- Where the interface and the API disagree on a word, both are given. This
  happens once and it matters: see [Collections](collections.md).
