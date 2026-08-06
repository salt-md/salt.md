# What happened, and who did it

Four different records, and they answer four different questions. Reaching for
the wrong one is the usual reason somebody concludes Salt.md does not remember
something it remembers perfectly well.

| Question | Where |
| --- | --- |
| What did this page look like before? | **Page history** |
| Why was it done this way? | **The raw trail** on the page |
| Who did what, across the workspace? | **The audit log** |
| Who looked into a workspace they are not in? | **The emergency access log** |

## Page history

Every save writes a revision; the newest **50 per page** are kept. Open one to
see it, compare, and restore it.

Restoring is itself a change, so it writes a revision of its own and can be
undone the same way. Nothing is lost by trying.

Over MCP: `revisions`.

## The raw trail

Dated, append-only notes somebody wrote **while** working, not afterwards. This
is the one record that can say why an approach was dropped, because it was
written before anybody knew how it would end.

See [Pages](pages.md#the-raw-trail).

## The audit log

Who did what, when, and whether it was a person or an agent. Every write over
MCP is recorded with the agent's name beside the account it came through.

**What you see depends on who you are:**

- **Members** see events in the workspaces they can see.
- **The instance owner and admins** additionally see events that hang off no
  workspace at all — an account deactivated, a workspace handed over or deleted.

That second rule exists because those events were invisible to everybody: they
belong to no workspace, so a workspace filter dropped exactly the events a log is
kept for. Those instance-wide rows name accounts and workspaces — things an
admin administers anyway — and never page titles.

The log pages backwards through the whole history rather than showing only the
tail.

**An API token cannot widen this.** A token scoped to some workspaces sees only
those, even if the human behind it is an admin.

## The emergency access log

The instance owner can look inside a workspace they are not a member of. There is
no way to make that impossible — whoever runs the server has the database — so
Salt.md makes it **visible** instead.

Every such access is recorded and shown to that workspace's admins, in their
workspace settings under *Emergency access log*.

The visibility is the safeguard, not the permission.

## What is not recorded

- **Reads.** Opening a page leaves no trace. A log of every view would be
  enormous, would be its own privacy problem, and nobody would read it.
- **Text as it is typed.** Realtime collaboration is relayed and never
  interpreted; what survives is the saved revision.
- **Deleted comments.** They are gone, not tombstoned.

## Getting it out

The audit log is visible in the interface. For anything beyond that — feeding it
to a SIEM, keeping it longer than the instance — take the database: it is one
SQLite file, and `audit_log` is an ordinary table in it. See
[Self-hosting](self-hosting.md#backup).
