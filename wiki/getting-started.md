# Getting started

## Install and open it

```sh
curl -fsSL https://raw.githubusercontent.com/salt-md/salt.md/main/install.sh | sh
salt
```

`http://localhost:8420`. Create the first account — whoever does that becomes the
instance owner. [Self-hosting](self-hosting.md) has Docker, environment
variables and how to put it behind a domain.

## Fifteen minutes that teach you the product

### 1. Write something

Click **New page**. Give it a title, then type. `/` opens the block menu:
headings, lists, code, tables, callouts, images. Drag a file from your desktop
onto the page and it lands there.

Type `@` and pick another page — that is a real link, and the other page will
show it under *Linked references* without anybody maintaining anything.

### 2. Make a collection

The `+` beside a page asks: page or collection? Pick **collection**.

Add a couple of properties — a **select** called Status, a **date** called Due —
and a few rows. You now have a table.

### 3. Look at it a second way

Add a **board** view. It groups by your select: one column per option. Drag a
card between columns and the property changes.

Add a **calendar** view. It places the rows on the date.

Same rows, three windows. Nothing was copied.

### 4. Open a row

Click one. It is a full page: it has a body, it takes files, it can have
sub-pages. A task with its own notes and its own attachments is not a feature you
switch on — it is what a row already is.

### 5. Connect an agent

Workspace menu → **Connect an agent**. Copy the line for your client. Then ask
it to look something up in your workspace.

While you are there, **Download skill** — it teaches the agent how you work here
and writes a short block into your repository so the next session knows it too.
[Agents](agents.md) explains what it can and cannot do.

## Where to go next

You now have the whole model. The rest is detail:

- [Concepts](concepts.md) — the eight words, precisely
- [Properties](properties.md) — including rollups and backrelations, which are
  the reason to use a collection rather than a spreadsheet
- [Workspaces](workspaces.md) — when you add the second person
- [Sharing](sharing.md) — when something has to leave the building

## A shortcut worth learning on day one

`⌘K` / `Ctrl+K` searches everything you can read — page text, property values,
and the contents of uploaded PDFs. It is the fastest way around and it makes
filing much less important than it looks.
