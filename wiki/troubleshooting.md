# Troubleshooting

Symptoms, and what they actually are. Most of these have bitten somebody
already.

## Writing data

**A value I set does not match any filter and no board column shows it.**
You wrote a label where an id belongs. A select option shown as "In Arbeit" may
have the id `in-arbeit`. `get_collection` returns both.

**Setting a relation fails, or silently does nothing.**
A relation is **always a list**: `["<id>"]`, never `"<id>"`, even for one target.

**`create_rows` says the database was not found.**
The argument is `page_id`, not `database_id`. The schema says so and requires it.

**A rollup says 100 % when nothing is done.**
An unrecognised `rollupWhereOp` compares for equality rather than matching
everything — check the operator spelling. And if the condition is "not done",
remember that *discarded* rows are also not done: use `rollupWhereValues` with
both.

## Seeing data

**A page is missing from the sidebar but the count includes it.**
Almost always a filter that is right in one mode and wrong in another. If it is a
database filed under a document, check the workspace's sidebar mode
([Workspaces](workspaces.md#layout)).

**A row does not appear in the tree at all.**
Bare rows are deliberately not in the page tree — a collection with fifty
thousand rows would flood it. A row appears once it has live sub-pages. Open the
collection to see its rows.

**A search finds nothing although the words are on the page.**
Check in order: is the page in the trash, is it private to somebody else, are you
in that workspace, and — for an agent — may this credential reach that workspace?
For text inside a PDF, see below.

**A PDF's contents are not searchable.**
It was over the extraction limit, which is sized to the machine's memory. The
file itself is fine and downloadable; only indexing was skipped. Raise
`SALT_MEMORY_MB` if the machine really has more than the process thinks.

**A count in the file list looks wrong.**
The file index is derived. Rebuild it from the admin dialog — it is reconstructed
from the pages and the disk, so it cannot make things worse.

## Agents

**The agent says a tool does not exist, but it does.**
A connected MCP client keeps the catalogue it fetched at connect time. Reconnect
the client. Calling the old name to "check" only proves the client is stale.

**The agent cannot see a workspace it used to.**
Check that workspace's agent access setting. "Only signed-in connections" refuses
a permanent token even when the token names the workspace, and a refused
workspace does not appear in the agent's list at all.

**A write is refused and the error is not clear.**
Call `whoami`. It separates "wrong id" from "not allowed", which need very
different next moves. Administrative things are closed to tokens on purpose.

**Cloud agents cannot reach my instance.**
`http://192.168.x.x` is not reachable from the internet. Configure a domain or a
Cloudflare tunnel and connect through the public address
([Administration](administration.md#domain-and-proxy)).

## Dates

**A deadline shows one day early.**
If it is a **date property**, this should be impossible — dates are never
converted. If it is a timestamp ("edited at…"), that is correct behaviour: those
are instants and move with your time zone.

## Running it

**The interface is old after an update.**
A stale tab. Reload once. If it persists across reloads, verify the deployment
actually landed: compare the running binary's `sha256sum` against
`SHA256SUMS.txt` from the release rather than trusting the version string.

**I copied the database out and the schema looks old.**
SQLite runs in WAL mode. `salt.db` alone is stale; the recent changes are in
`salt.db-wal`. Copy all three files, or stop the server first.

**The container gets killed under load.**
It has no memory limit, so it reads the host's figure and sizes expensive work
for a machine it does not have. Add `--memory=…` to the run command.

**A restore refuses because the data directory is not empty.**
That guard is deliberate. Empty it, or set `SALT_RESTORE_FORCE`.

**A backup restored, but did the schema survive?**
The proof is the **absence** of a "search index: rebuilt" line at startup — the
binary recognising its own schema. A rebuild line means it migrated.

## When something is genuinely wrong

The startup log is three or four lines and says what the server thinks about its
memory, its data directory, and whether it rebuilt an index. That is usually
where the answer is.
