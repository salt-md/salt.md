# History and audit

Salt.md keeps four separate records, and they answer four different questions.
Reaching for the wrong one is the usual reason somebody concludes that Salt.md
does not remember something it remembers perfectly well. This page says what
each record contains, who may read it, how long it survives, and how to put an
old version of a page back.

| Question | Record | Where you read it |
| --- | --- | --- |
| What did this page look like before? | **Version history** | the page's ⋯ menu |
| Who did what across my workspaces? | **The activity log** | the account menu |
| Who looked into a workspace they are not in? | **The emergency access log** | workspace settings |
| Who is knocking on the sign-in? | **Rejected sign-ins** | the server's own log |

A fifth thing looks like a record and is not quite one: the **raw trail** on a
page — dated, append-only notes somebody wrote *while* working. It is the only
one that can say why an approach was dropped. See
[Comments and notes](comments-and-notes.md).

## Version history

A revision is a whole copy of the page's **title and body** at one moment, not a
diff. Salt.md writes one whenever a page's body is written: your own editing
saved from the browser, a write over the API, or an agent writing over MCP.

Three rules decide what ends up in the list:

- **At most one snapshot per page every two minutes.** A save inside that window
  adds nothing — twenty minutes of typing leaves ten revisions, not hundreds.
- **The newest 50 per page are kept.** When a fifty-first arrives, the oldest
  goes.
- **An empty body is never snapshotted**, so a page you have just created does
  not start its history with a blank.

The dialog says the same thing in one line: *Snapshots are taken on save (at
most every 2 minutes, the latest 50).*

**Properties are not part of a revision.** Changing a row's status or its due
date writes no snapshot, because the body did not change. Version history is for
the text of a page; see [Collections](collections.md) for what a row's
properties are.

### Reading and restoring

1. Open the page and click the ⋯ button in the topbar (*More*).
2. Choose **Version history**.
3. The dialog lists every kept revision, newest first: the time it was taken, who
   wrote it (or *unknown* when nobody was attributable — an imported page records
   its author as `agent`), and a **Restore** button.
4. Click **Restore**. Salt.md asks first: *Restore the version from …? The
   current state is saved as a version first.*
5. On success a *Version restored* message appears, the dialog closes, and the
   live document is reset — anybody with that page open in an editor gets the
   restored text rather than carrying on from the old one.

If a page has no revisions yet the dialog says *No versions yet.*

Two things about restoring that are easy to be surprised by:

- **Restoring is itself undoable.** The state you are leaving is written as a new
  revision before the old one is put back, so a restore can be restored. The one
  exception is the two-minute rule above: if a snapshot of this page was already
  taken less than two minutes ago, no new one is written and the state you are
  leaving is the one already in the list.
- **Restoring from the browser puts back the body, not the title.** The page
  keeps whatever title it has now. Restoring over MCP puts back both.

**Who may do what.** Anyone who can read the page can open its history. Restoring
needs write access — the same permission as editing. The Restore button is shown
to viewers as well, and the server refuses it, so the click ends in an error
rather than a change. See [Permissions](permissions.md).

**How long it survives.** As long as the page does. A page in the trash keeps its
full history and gets it back on restore; when the trash empties itself — after
30 days by default — the page and its revisions go together. See
[Trash and recovery](trash-and-recovery.md).

### Over MCP

The `revisions` tool covers all three moves on one page:

| Action | What it does |
| --- | --- |
| list (the default) | every kept revision with author, time, size, and whether a **human** or an **agent** caused it |
| get | one older state, rendered as Markdown, without changing anything |
| restore | put the page back to it |

`list` takes a limit (20 by default, 100 at most). Both other actions need the
revision id from the list. A **read-only** API token may list and get but is
refused a restore. The human/agent column comes from the activity log below: a
revision written before that trail existed, or one that cannot be attributed,
reads as *unknown*.

The same three steps are HTTP routes if you prefer them:
`/api/pages/{id}/revisions`, `/api/pages/{id}/revisions/{revId}` and
`/api/pages/{id}/revisions/{revId}/restore`. See the [API](api.md).

## The activity log

Who did what, when, and whether it was a person or an agent. Open the **account
menu** — your name at the bottom of the sidebar — and choose **Activity log**.
Every signed-in account has it; there is no admin switch.

Each row carries a badge reading *human* or *agent*, the name of whoever acted,
what they did in plain words, the first 60 characters of the detail in quotation
marks, and the time. The list loads 50 entries and offers **Load more…** until
the history is exhausted; it pages backwards through everything, not just the
tail. An instance where nothing has happened says *Nothing has happened yet.*

![The activity log: who did what, and when.](img/activity-log.png)

### What is recorded

| Wording in the log | What happened |
| --- | --- |
| created | a page was created — the detail is its title |
| changed / added to | a page was written to over MCP |
| uploaded a file to | a file was attached over MCP |
| moved to trash / permanently deleted | a page was trashed or deleted for good |
| started working on: / finished working on: | an agent checked in or out of a page, with its own note as the detail |
| deactivated the account: / reactivated the account: / deleted the account: | account administration |
| deleted the workspace: / took over the workspace: / adopted the ownerless workspace: | workspace lifecycle |
| handed the instance to: | the owner role moved to another account |
| took emergency access: / ended the emergency access: | see below |

Beyond those, more events are recorded than have wording of their own: importing
a Markdown file or an archive, exporting or importing a whole workspace,
creating a workspace from a blueprint, signing in from the desktop app,
approving an agent over OAuth, creating and deleting webhooks, changing a
workspace's agent access or its rules, and discarding a page's raw trail. Those
rows show the raw action name instead of a sentence.

**Every mutating call an agent makes is one entry**, filed under the tool's own
name, with the account's name and *(MCP)* after it, and the tool's reply as the
detail. Two tools are deliberately not double-recorded: an agent's check-in
writes its own entry with the note as the detail, and `note` writes nothing here
because the raw trail on the page already is the record.

A [form](forms.md) submitted by somebody with no account appears as *public
form* creating a page — the form is the actor.

### What is not recorded

**Editing a page's body in the browser is not an activity-log event.** That is
what version history is for, and duplicating every keystroke-driven save into a
second list would drown everything else. The log answers "what happened to this
workspace", the history answers "what did this page say".

Reads are not recorded either — opening a page leaves no trace anywhere.

### Who sees what

- **Anybody signed in** sees events from the workspaces they can see, and only
  those. Within a workspace, entries pointing at a page they may not read are
  filtered out one by one — the detail of a *created* entry is the page title,
  and a private sub-tree must not leak its titles through a log.
- **The instance owner and instance admins** additionally see events that hang
  off no workspace at all: an account deactivated, a workspace handed over or
  deleted. Those events belong to no workspace, so the ordinary filter made them
  invisible to everybody — precisely the events a log is kept for. They name
  accounts and workspaces, never page titles.
- **An API token cannot widen this.** A token restricted to certain workspaces
  sees those workspaces only, and never the instance-wide rows, even when the
  person behind it is an admin.

An entry whose page has since been deleted **stays**. Otherwise the permanent
deletions would be the first thing to vanish from the record.

**Nothing prunes this log.** It grows for the life of the instance.

## The emergency access log

The instance owner can look into a workspace they are not a member of. There is
no way to make that impossible — whoever runs the server has the database file —
so Salt.md makes it deliberate and **visible** instead.

**Taking it.** In *Manage users*, the owner opens their own account, finds a
workspace they have no access to under *Workspace access*, and clicks **Emergency
access**. Salt.md asks *Emergency access to “…” — why?* and will not proceed on
less than 10 characters of reason. The reason is stored (up to 500 characters),
written to the activity log, shown to that workspace's admins, and mailed to
them. The confirmation names the end time: *Read access to “…” until … — the
people in charge have been told.*

**What it grants.** Reading, for **two hours**. Not writing, not trashing, not
exporting as a member would. The workspace does not join the sidebar switcher
either — that list is memberships only — so the access shows up through
[search](search.md) and direct page links.

**What it refuses.** A workspace you are already a member of (you do not need
it), and a **personal space**, which cannot be looked into at all: it belongs to
exactly one account, and an exception there would make the whole promise hollow.

**Ending it.** It expires on its own after two hours. It can be ended early from
the log. Handing the instance to another owner ends every running grant of the
outgoing one immediately.

**Reading the record.** The workspace menu → **Workspace settings** → **Emergency
access log**. Each row names the person, when they looked in, the reason they
gave, and its state: *runs until …* while it is live, then *ended early* or
*expired*. A live one carries an **End it now** button. The newest 50 are shown,
and nothing removes them afterwards. The dialog states the rule at the top:
emergency access allows reading only, expires after two hours, and can be ended
early at any time.

Two limits worth knowing. Workspace settings opens for **workspace admins**, and
the *Emergency access log* row inside it is shown to the **instance owner**. So a
workspace admin who gets the email cannot open that dialog; the record and the
early revocation are reachable for them through
`/api/workspaces/{id}/break-glass` instead. And the owner who took the access on
a workspace they do not belong to has no workspace settings there either — for
them the entry in the [activity log](#the-activity-log) is the readable copy.

The visibility is the safeguard, not the permission.

## Rejected sign-ins

The fourth record does not live in the database and is not reachable from the
interface. Salt.md writes **one line to its own log for every rejected
credential**:

```
auth: rejected password from 203.0.113.9
auth: rejected token from 203.0.113.9
```

Under systemd that means the journal. The line carries the address, because that
is what gets banned, and the kind of credential, so a wrong password can be
weighed differently from a wrong API token. It deliberately carries **neither the
email address nor the token**: this log ends up in journald, in log shipping and
in backups, and "who did what" belongs in the activity log behind a sign-in.

A wrong **second factor** is not one of these lines — the password was right, and
that attempt is throttled but not written.

Salt.md throttles by itself as well: 30 sign-in attempts a minute per address,
and a separate budget for rejected API tokens that only failures pay into, so an
agent working with a valid token is never slowed by it. The log line exists for
the layer above that — a firewall ban costs an attacker a TCP connection instead
of a request. A ready-made fail2ban filter and jail ship in the repository under
`docs/fail2ban/`.

**Behind a proxy or a tunnel, turn on "Run behind a reverse proxy (trust
`X-Forwarded-For`)"** in *Instance settings* → *Domain & proxy* first. Without it
every visitor arrives as the proxy, every line reads the same local address, and
a ban would lock out everybody. Only turn it on when the proxy is the only way in
— see [Domain and proxy](domain.md) and [Administration](administration.md).

## What none of them keep

- **Reads.** Nobody is told that you opened a page.
- **Text as it is typed.** Live editing is relayed between browsers and never
  interpreted on the way through; what survives a session is the saved revision.
  See [Collaboration](collaboration.md).
- **Deleted comments.** They are removed, not tombstoned.
- **Property changes.** Neither the history nor the activity log records that a
  status moved from *In progress* to *Done* in the browser.

## Taking the records with you

The activity log is readable in the interface and at `/api/audit`, newest first,
with `?before=` and `?limit=` for paging. The version history of one page is
readable per page over the API and over MCP.

For anything beyond that — feeding the trail to a SIEM, keeping it after the
instance is gone, running your own queries over it — take the database. It is one
SQLite file, and the revisions, the log and the emergency grants are ordinary
tables in it. See [Self-hosting](self-hosting.md).
