# Agent access

An agent reaches Salt.md with a credential that belongs to a person. This page
covers the two kinds of credential — a permanent API token and a connection
somebody signed in for — what each can be narrowed to, what a workspace may say
about agents regardless of who issued the credential, what an agent inherits
from the human it belongs to, and how to take access away again.

If you only want to plug an agent in and start working, see
[Agents](agents.md) and [MCP tools](mcp-tools.md). This page is about the
boundary around that.

## The two ways in

Both end up at the same MCP endpoint and the same REST API. The difference is
what the credential is and how long it lives.

| | API token | Signing in |
| --- | --- | --- |
| What it is | A secret string starting `salt_`, created once and valid until revoked | A short-lived access token the client renews by itself |
| Where it travels | An `Authorization: Bearer` header, or inside the address as `/mcp/<token>` | A header only — nothing secret is ever in the address |
| Lifetime | Until somebody revokes it | The access token lasts one hour; the connection behind it stays until it is ended |
| Who chooses the reach | Whoever creates the token, in a settings dialog | The person, on a consent screen, while looking at what they are granting |
| Set up in | Account menu → **API tokens** | The client asks; you approve in the browser |
| Works with | Every client, including ones with nothing but a URL field | Clients that support OAuth sign-in for MCP |

Neither is a lesser kind of access: both carry the full identity of the account
they belong to, and both can be narrowed the same two ways (see
[What a credential can be narrowed to](#what-a-credential-can-be-narrowed-to)).
What differs is how easy it is to take back, and whether the secret leaks by
sitting in a URL.

## Connecting an agent

1. Open the account menu at the bottom of the sidebar and choose
   **Agents & MCP**. The dialog is titled **Connect an agent**.
2. Pick one of the two cards at the top: **Sign in** ("Nothing secret in the
   address. Expires and can be ended.") or **Token in the address** ("For
   clients that only have a URL field. Treat it like a password.").
3. Pick your agent from the gallery — Claude, Claude Code, ChatGPT, OpenAI
   Codex, Cursor, OpenClaw, Hermes Agent, Gemini CLI, or **Other agent**.
4. Press **Copy** and paste the snippet where that client wants it. The hint
   beside the snippet says where that is for the agent you picked.

With **Sign in** the snippet is the plain address, with no secret in it. The
client discovers on its own that it can sign in — the endpoint answers an
unauthenticated call with a pointer to the sign-in service — and sends you to
the browser to approve. If a client asks for a token instead, it cannot sign in
yet; use the other card.

With **Token in the address** the dialog creates the token for you: choose
**Read & write** or **Read only**, and **Only "<workspace>"** or
**All workspaces**, then press **Create token**. The token appears once and is
filled into the snippet. You can also paste an existing token into the field
below.

The dialog warns you if the address it is offering is a plain-HTTP address that
is not on this machine: a cloud agent cannot reach that. Making the instance
publicly reachable is covered in [Domain and proxy](domain.md).

At the bottom, **Download skill** produces a file that teaches the agent how
your team works here — see [The skill](skill.md).

## Signing in: the consent screen

When a client asks to sign in, the browser lands on a screen headed
**Grant access?**. It shows, in order:

- The instance's name and the host you are on, so you can see *which* server you
  are about to hand something to.
- The client's name, as "*<name>* is asking to work in your account."
- A warning that the name is a claim: "That name was chosen by whoever set up
  the connection. Only continue if you started this yourself." Any client may
  register itself under any name, so the screen does not lend it credibility it
  cannot check.
- **It will be allowed to** — "read and change pages" or "read pages".
- **Where** — either "Every workspace, including ones added later" or "Only the
  ones I pick". The list underneath starts with nothing ticked, and **Allow**
  stays dead until you tick something.

The two answers under **Where** are genuinely different, and the difference
bites later. "Only the ones I pick" is a photograph of today: a workspace made
next week — by a colleague, or by the agent itself — is not in it, and the
connection will not cover it. "Every workspace, including ones added later"
follows along.

**Deny** answers the client properly rather than leaving it hanging.

Approving requires being signed in with a browser session. A credential can
never approve a new credential, so an agent cannot enlarge its own reach by
asking itself for consent.

What the client gets back is an access token good for one hour plus a renewal
token it uses in the background, so nobody signs in again every hour. The
renewal token changes on every use — the previous one stops working at that
moment.

The grant is written to the activity log under your name, with the client's
name and the scope. See [History and audit](history-and-audit.md).

## API tokens

Account menu → **API tokens**.

The list shows each token's name, a badge reading **read-only** or
**read-write**, the workspaces it may reach (or "all workspaces"), when it was
last used, and — this is the useful one — **the address it was last used from**.
A token that rides in a URL cannot be kept secret; it sits in the client's
configuration and in the logs of every proxy between. The defence is noticing.
An address you do not recognise beside a token is a question worth asking, and
the answer is the ✕ button (**Revoke**) on the same row.

To create one, fill in the row at the bottom:

1. A name — the placeholder suggests something like the agent's own name.
2. **Read-write** or **Read-only**.
3. **All workspaces** or **Specific workspaces…**, which unfolds a list of
   tick-boxes.
4. **Create token**.

The token is shown exactly once, with **Copy token** beside it and a
ready-to-paste connect command under **Copy MCP command**. It is stored hashed;
nobody, including the owner of the instance, can read it back. Lose it and you
make a new one.

Two rules worth knowing:

- A token can only name workspaces you are a member of. Ids that are not yours
  are dropped.
- If you asked for specific workspaces and none of them survive that filter, the
  token is **refused** rather than created. Storing an empty list would read back
  as "all workspaces", and a deliberately narrow token must never quietly become
  the widest one.

Tokens can only be created, listed and revoked from a browser session. An agent
cannot mint itself a second, wider key.

## What a credential can be narrowed to

Exactly two dimensions, and they are the same for a token and for a signed-in
connection.

### Scope: reading or reading and writing

A read-only credential is refused at two places. Over the REST API every
POST, PUT, PATCH and DELETE comes back as `token is read-only`. Over MCP the
writing tools are refused by name — `create_page` and the rest answer "this API
token is read-only; … requires a write token" — while the reading tools work
normally.

Tools that do both, like page history and comments, are judged per action:
reading a revision is a read, restoring one is a write.

When a client asks for something the server does not recognise, the unknown
words are ignored rather than refused, and what is left decides. A request that
names nothing recognisable lands on read-only, never on read-and-write.

### Workspaces: all of them, or a fixed list

A credential is either unrestricted (every workspace the account is a member of,
including ones created later) or bound to a list.

For a bound credential:

- Every listing shows only the granted workspaces.
- Naming a page in a workspace outside the list answers "not found" — the same
  answer as for a page that does not exist, because saying "you may not" would
  confirm it exists.
- Asking for a workspace by id gives a clearer message, since the account
  already knows that workspace exists: "…is outside what this connection was
  granted — ask for it to be added, or name one it can reach."
- The workspace list an agent gets back says how many further workspaces were
  withheld, without naming them.
- **Creating a workspace is refused**: "This connection is limited to particular
  workspaces, so it cannot create new ones — it would not be able to open them."
  Adding the new workspace to the list automatically would be a credential
  widening its own reach.

## What a workspace decides

Everything above is decided by whoever issues the credential. A workspace
holding confidential material had no say in that — it could only hope that every
token ever minted happened to leave it out. It has a say now, and it is opt-in:
the default is exactly the behaviour that existed before, so a workspace nobody
configures behaves as it always did.

A workspace admin sets it in the workspace menu → **Workspace settings** →
**Access** → **What agents may do here**:

| Option | Hint in the dialog | What it does |
| --- | --- | --- |
| **Anything they were granted** | "Any connection that was given this workspace." | The default. Any credential that names this workspace gets in. |
| **Only signed-in connections** | "A permanent token is refused, even one naming this workspace. For confidential material." | A permanent API token is turned away here whatever it says. A connection somebody signed in for is let in. |
| **No agents at all** | "Browser sessions only." | No credential of any kind reaches this workspace. |

Three things about it:

- **People in browsers are never affected.** The setting is about agents; the
  person who sets it is not the one it is aimed at.
- **An unrecognised value reads as the default.** A typo in the setting takes
  nothing offline.
- To an agent, a workspace it may not enter is not there at all: it drops out of
  the workspace list, and pages inside it answer "not found".

Changing the setting is recorded in the activity log, because "why can the agent
suddenly not read this" is a question somebody asks weeks later.

Note that "Only signed-in connections" is usually the better answer than "No
agents at all" for confidential material: closed keeps agents out entirely,
while strict lets them in on terms you can revoke in one click.

## What an agent inherits from its human

A credential carries the **full identity** of the account it belongs to, and can
only ever narrow it. That means:

- The same workspaces, the same role in each, the same private pages. A viewer
  stays a viewer; an agent belonging to a viewer cannot write anywhere in that
  workspace. See [Permissions](permissions.md).
- Pages that are private to somebody else are as invisible to the agent as they
  are to its human.
- Everything the agent does is attributed to that person. The activity log marks
  each entry as **human** or **agent**, so a page changed by an agent is not
  mistaken for a colleague's edit.

And it can never do more. Administration is deliberately out of reach of every
credential, however wide, because a key to content must not be a pass for
running the instance. These need a browser sign-in and are refused with "This
action requires signing in through a browser — an API token is not enough.":

- creating, changing, deactivating or deleting accounts, and the account list
  (`/api/users`)
- API tokens themselves — listing, creating, revoking (`/api/tokens`)
- ending signed-in connections (`/api/oauth/grants`)
- two-factor settings (`/api/2fa`)
- the instance backup (`/api/admin/backup`), instance settings, mail settings,
  the tunnel, invitations, webhooks
- workspace membership and roles
- **applying** workspace rules (`/api/workspaces/{id}/rules`) — an agent may
  submit a draft, but the rules it is told to follow must not be writable by
  whatever holds a key, or the rules channel becomes the injection channel
- personal language and time settings (`/api/me/prefs`) — otherwise an admin's
  token could set another person's clock format

An agent can ask what it has: the `whoami` tool reports the account, the scope,
which workspaces the credential may reach, and the list of things deliberately
unavailable over MCP. `get_permissions` answers the same question for one page,
including *why* writing is refused when it is.

## Ending access

**An API token**: account menu → **API tokens** → the ✕ on its row. It stops
working immediately.

**A signed-in connection**: most clients have a disconnect of their own, which
calls the revocation endpoint and takes the connection and every token minted
from it at once. On the Salt.md side the connections on your account are
readable at `/api/oauth/grants` and can be ended with a DELETE on
`/api/oauth/grants/{id}` — both from a signed-in browser session only. (The
consent screen promises this lives in your account settings; today it is the
API, not a screen.)

Two consequences of other actions:

- **Changing your password** ends every session and every API token on the
  account at once.
- **Deactivating an account** ends its sessions and tokens, and every credential
  belonging to it is refused at the door from that moment — over REST and over
  MCP alike.

Guessing at tokens is throttled per address, and only failures count: an agent
making hundreds of calls a minute with a good token is never slowed by it.

## The desktop app is not an agent

The desktop app signs in through your real browser and ends up with an ordinary
browser session, not an agent credential — so none of the workspace rules above
apply to it, and it can do everything you can do.

The flow: the app opens your browser, you sign in as usual (password, or your
company sign-in — see [Signing in with your company account](sso.md)), and a
page appears headed **Sign in to the desktop app?** showing which account it
would use. Press **Allow** and the browser hands control back; **Not now**
cancels. The confirmation step is not ceremony: without it, any page you open
could send your browser through this flow and mint a session for a program
waiting on the other end.

The code that travels back is single use, expires after five minutes, and is
worthless to anybody but the app that started the request. Details in
[The desktop app](desktop-app.md).

## Messages you may see

| What the agent gets | What it means |
| --- | --- |
| `missing or invalid API token` | No credential, or one that is not valid any more. The answer also tells a capable client where to sign in. |
| `token is read-only` | A read-only credential tried to change something over the REST API. |
| "this API token is read-only; … requires a write token" | The same, over MCP, naming the tool. |
| "page … not found" | Either it does not exist, or it is outside what this credential may reach. The two answers are deliberately identical. |
| "workspace … is outside what this connection was granted" | The account has that workspace; this credential was not given it. |
| "This action requires signing in through a browser — an API token is not enough." | Administration. No credential reaches it. |
| "this account has been deactivated" | The person behind the credential can no longer sign in. |

## See also

- [Agents](agents.md) — what an agent does once it is in
- [MCP tools](mcp-tools.md) — the catalogue
- [The API](api.md) — the same permissions over REST
- [Permissions](permissions.md) — roles, private pages, emergency access
- [Workspaces](workspaces.md) — members, rules, settings
- [Your account](account.md) — tokens, two-factor, the activity log
