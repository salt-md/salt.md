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
| setting up SSO, mail or a domain | [Single sign-on](sso.md), [Sending email](mail.md), [Reaching it from outside](domain.md) |

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
- [History and audit](history-and-audit.md) — four records, four questions

**Working together**

- [Workspaces](workspaces.md) — members, roles, rules, blueprints, agent access
- [Sharing](sharing.md) — public pages, password and expiry, public forms
- [Account](account.md) — sign-in, two-factor, language and time, leaving

**Connecting things**

- [Agents](agents.md) — MCP, the tool catalogue, the skill, presence and notes
- [Automation](automation.md) — webhooks, the calendar feed, import and export

**Running it**

- [Self-hosting](self-hosting.md) — install, update, environment, backup, monitoring
- [Administration](administration.md) — instance settings, users, signup policy
- [Reaching it from outside](domain.md) — Cloudflare Tunnel, Caddy, your own proxy
- [Single sign-on](sso.md) — Microsoft 365 and Google, and the one failure that wastes an afternoon
- [Sending email](mail.md) — a connected account, or SMTP
- [Troubleshooting](troubleshooting.md) — the traps, and what they look like

## What Salt.md is not

Being clear about this saves everyone time.

- **Not a cloud service.** There is no salt.md account. You run the server.
- **Not a spreadsheet.** Formulas do arithmetic over a row's own properties and
  nothing else — see [Properties](properties.md#formula).
- **Not a wiki engine with page-level permissions.** Access is per workspace,
  plus a private flag per page. There is no per-page ACL.
- **Not multi-tenant.** One instance is one organisation.

## Rules for writing in this wiki

**Every example is invented.** No customer, no colleague, no real hostname, no
real address, no real email — not even as a placeholder, and least of all when
the shape came from looking at a live instance while writing.

This is not caution for its own sake. This wiki is published. An example copied
from a real workspace publishes whatever it names, and the person who wrote it
was being helpful rather than careless — which is exactly why a rule is needed
instead of good intentions.

`check-wiki.mjs` catches real-looking addresses, hostnames and email domains. It
**cannot** recognise a company name, so that part is on whoever writes: if the
name came from somewhere real, change it.

Use `example.com`, the documentation IP ranges (`192.0.2.x`), and names that are
obviously made up.

## Conventions in this wiki

- **Bold** marks a term the product uses with a specific meaning.
- `code` marks something you type exactly: a tool name, a property id, a path.
- A table means the list is complete. Prose means it is an example.
- Where the interface and the API disagree on a word, both are given. This
  happens once and it matters: see [Collections](collections.md).
