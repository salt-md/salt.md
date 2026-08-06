# Files

Files live on disk beside the database, not inside it. A backup that copies both
is complete.

## Uploading

Drag from your desktop onto a page — the text, the margins, the title, the empty
space below the last block. Or paste. Or pick from the `/` menu. Or, over MCP,
`upload_file`.

Images, video and audio become players. Everything else becomes a file block with
its name, and previews on click where a preview is possible.

**The default cap is 50 MB per file**, and an admin can change it between 1 MB
and 2 GB ([Administration](administration.md)).

## The file list

The workspace settings have **Files**: every upload in the workspace with its
name, type, size, date and the page carrying it. It can be scoped to one page's
subtree — "every document for this customer".

Over MCP: `list(kind: "files")`, with `under` for a subtree.

Reading it runs the same two permission stages as search: workspace scope, then a
per-page check. The second is what keeps a file on somebody's private page
private.

## How the index works, and why it can be rebuilt

The `files` table is **derived**. The truth is the block on the page and the byte
on disk; the index is a convenience over both, and it can be thrown away and
rebuilt from them.

It is built by matching **a URL pointing into `/files/`**, not by block type.
That matters because the list of block types that can carry a file keeps growing
— the editor writes file, image, video and audio, the MCP upload writes its own
two — and a rule based on types would quietly stop finding new ones.

The rebuild also indexes files **nothing references any more**. Those were
previously invisible while sitting in every backup.

### Uploads carry their page

An upload names the page it belongs to. Without that it reaches neither the
file list nor the search index — which is exactly what happened for a while: a
PDF dropped into a page in the browser stayed invisible to both, while the same
PDF added by an agent did not, because the MCP path had always passed a page id.

## Logos and avatars

Workspace logos and account pictures are uploads too, but they hang off the
workspace or the user rather than off a page. The index counts them as
unreferenced and they never appear in a workspace file list — they have no
workspace id.

Anything that later offers to clean up "unreferenced" files has to exclude them
first.

## PDFs and search

Text is extracted on upload and indexed with the carrying page, up to a limit
sized to the machine. See [Search](search.md#pdfs).

## Deleting

Removing a file block from a page removes the reference, not the byte. The file
stays on disk and shows in the index as unreferenced.

This is deliberate for now: a block removed by accident, or by a collaborative
edit landing badly, would otherwise destroy the only copy.
