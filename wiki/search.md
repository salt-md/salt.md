# Search

`⌘K` / `Ctrl+K` anywhere, or `search` over MCP. Full text across everything you
may read.

## What is indexed

- page titles and body text
- property values on rows
- **text extracted from uploaded PDFs**

A page is cut into **passages** rather than indexed as one lump. The cut follows
block boundaries, not a character count, so a passage is a whole thought and a
hit points at the part of the page that actually matched. Each passage remembers
the headings above it, so a result can say where in a long document it sits.

## Why German words find each other

Search folds diacritics and strips German inflection before indexing.

`Verträge` → `vertrage` → `vertrag`

So *Vertrag*, *Verträge* and *Verträgen* all find each other, which is the
difference between a search that works in German and one that only appears to.
Umlaut folding also means `Muller` finds `Müller`.

This costs nothing for English and needs no configuration.

## Permission

Two stages, both mandatory:

1. only workspaces you are a member of
2. then a per-page check on every hit

The second stage is the one that matters: it catches other people's private
pages, which the workspace filter alone would happily return.

The same two stages run for the file list, the calendar feed and the graph.

## What is not found

- pages in the trash
- pages private to somebody else
- workspaces you are not in — or, for an agent, workspaces its credential may
  not reach
- text inside images (there is no OCR)
- text inside PDFs that are larger than the extraction limit — see below

## PDFs

Text is pulled out of a PDF when it is uploaded and goes into the index with the
page carrying it.

There is a **size limit**, and it is sized to the machine rather than fixed: the
server reads how much memory it believes it has and derives both the cap and how
many extractions run at once. On a 16 GB machine that is 50 MB and three at a
time; on a small container it is less.

Exceeding it costs indexing, never the upload. The file is stored, shown and
downloadable either way — it simply is not searchable by its contents.

The reason for the limit is not theoretical: a 24 MB PDF once took an instance
down, because extraction parsed the whole document before capping the text. It
now refuses before reading and caps during extraction.

## Search for agents

`search` is the cheapest thing in the catalogue and the correct first move. A
second page about something that already has one is worse than no page, and the
only way to know is to look.

`list(kind: …)` enumerates instead of searching, when you want everything of a
sort rather than whatever matches.
