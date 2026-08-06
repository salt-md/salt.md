# Workspaces

A **workspace** is the unit of access. Membership is per workspace, not per page:
everything in one is readable by its members, except pages marked private.

If you need "these three people and nobody else", the answer is a workspace, not
a permission on a page.

## Roles

| Role | May |
| --- | --- |
| **member** | read and write everything not marked private |
| **admin** | that, plus members, rules, settings, export, delete |
| **owner** | the account the workspace belongs to |

Beyond the workspace there is the **instance owner**, who administers the server
itself. See [Administration](administration.md).

## Settings

One dialog, in five sections. It used to be eighteen buttons in a menu; a menu is
a list of actions you take now, and most of these are settings you look at.

### General

Name and picture.

### Access

**Members** — who is in, and in which role.

**What agents may do here** — the opt-in that lets one workspace be stricter than
the rest:

| Setting | Meaning |
| --- | --- |
| Anything they were granted | any connection given this workspace (default) |
| Only signed-in connections | a permanent token is refused, even one naming it |
| No agents at all | browser sessions only |

Use the middle one for material under a confidentiality obligation: it accepts an
agent that went through the sign-in flow and refuses one carrying a long-lived
key. A workspace an agent may not enter does not appear in its workspace list at
all. See [Agents](agents.md#a-workspace-can-refuse-agents).

**Open to every new user** — every newly created account automatically becomes a
member. Not offered for personal workspaces.

**Emergency access log** — who looked in as the instance owner, and why. Visible
to the owner.

### Layout

**How the sidebar is arranged.** Both readings are right for different work, so
it is asked rather than decided:

- **Documents and collections apart** — two sections. Good when the databases
  are the point.
- **One tree, filed where you put it** — a collection stays under its document.
  Good for documentation, where the databases belong to the document they
  describe.

### Conventions

**Workspace rules** — free text, up to 16 000 characters, written by an admin.
Conventions everyone follows here, especially agents: `get_workspace` returns
them, and agents are told to follow them.

An agent can **propose** rules with `propose_workspace_rules`. A proposal is
inert text until an admin applies or dismisses it — agents are told to follow
the rules, so nothing holding a mere token may write them.

### Data

Files, export as a native archive or as Markdown, import an archive, delete the
workspace.

## Starting from a blueprint

"New workspace" offers a shelf rather than a name prompt. Three are included:

| Blueprint | What you get |
| --- | --- |
| **Software team** | what we run, and what still has to be done to it |
| **Sales pipeline** | companies on one side, deals on the other, a board you can drag |
| **Content calendar** | every channel, every piece, and the date it goes out |

A blueprint brings structure — collections, schemas, views, a few explaining
pages — and no data of yours. The shelf reads its counts out of the blueprint
itself, so it cannot advertise a database that is not in there.

You can also start from an existing workspace's structure
(`workspace(from_workspace: …)`): its rules, databases, schemas and views, with
no rows and no documents.

## Moving between workspaces

A page can be moved to another workspace, and it takes its subtree along. The
previous parent stays behind — the page arrives at the top level of the target.

## Personal workspaces

Every account gets one. It behaves like any other except that it cannot be opened
to every new user, and it has no emergency access log — there is nobody else in
it to protect.

## What happens when somebody leaves

Deactivating an account keeps everything they wrote and stops them signing in.
Deleting one asks first what should happen to the workspaces they own — those can
be handed to somebody else, or deleted with them.

A workspace whose owner is gone is **stranded**: an admin sees it in a list of
its own and can adopt it or delete it. Nothing disappears quietly.
