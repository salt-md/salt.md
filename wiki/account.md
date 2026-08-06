# Your account

## Signing in

Three ways, and an instance can offer several at once:

- **Email and password.** Always available. Not everyone connects a Microsoft or
  Google tenant, and an instance that only worked with one would be unusable for
  them.
- **Microsoft** (Entra ID / Microsoft 365)
- **Google**

Single sign-on is configured by the instance owner
([Administration](administration.md)). When it is on, the login screen offers it
alongside the password form.

## Two-factor authentication

Time-based codes (TOTP) — the ordinary kind, with any authenticator app. Scan the
code, enter one code to confirm, and from then on sign-in asks for a second
factor.

It can be turned off again from the same place, which needs the password.

## Language, region and time

Five settings, and each has an **automatic** state that is the default:

| Setting | Automatic means |
| --- | --- |
| Language | what your browser asks for |
| Date and number format | your browser's regional tag |
| Time zone | your machine's zone |
| Clock | what the region implies — 12 or 24 hours |
| Week starts on | what the region implies |

Four things about them worth knowing:

**They live on the account, not in the browser.** The point was that your phone
and your laptop agree. The browser keeps a copy so the login screen is not
briefly in the wrong language, but that copy is never the truth.

**Automatic is the absence of a decision.** There is no third state and no "auto"
value — an unset setting and automatic mode are the same thing.

**Changing the language applies on save; the formats preview live.** Switching
language rebuilds the whole interface, which would close the dialog you are
standing in.

**A calendar date is never converted.** A deadline on the 18th is the 18th
whatever time zone you set. Only timestamps — "edited at 14:30" — move with your
zone. This is asserted by tests under six time zones, because getting it wrong
shifts every deadline by a day for anybody west of Greenwich.

## API tokens

You can mint tokens for agents and scripts. A token carries **your** identity and
narrows only by:

- **scope** — read, or read and write
- **workspaces** — all of them, or a named list

It cannot reach administrative endpoints at all: users, tokens, instance
settings, and your own preferences need a signed-in browser session. A key to
content is not an admin pass.

Tokens are listed in your account, and revoking one is immediate. See
[Agents](agents.md#permission-exactly).

## Leaving

**Deactivating** keeps everything you wrote and stops you signing in. Your pages,
comments and history stay exactly where they are.

**Deleting** asks first what should happen to the workspaces you own. Each can be
handed to somebody else or deleted with you — the question is asked before
anything happens, with the number of pages at stake.

A workspace whose owner is gone anyway is **stranded** and shows up in a list of
its own for an admin to adopt or delete. Nothing vanishes quietly, and nothing is
left orphaned in the database.
