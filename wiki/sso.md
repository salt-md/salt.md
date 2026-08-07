# Single sign-on

Salt.md can hand sign-in to **Google** or **Microsoft**. People then press a
button on the sign-in screen instead of remembering another password, and you
stop keeping a second set of credentials. This page is for whoever sets that up:
the exact fields, the address to register with the provider, how an account is
matched or created, and every error the flow can produce.

Two providers, and only two. There is no generic OpenID Connect field, no SAML,
and no way to point Salt.md at a different identity provider. Setting it up is
an instance admin's job and takes two values per provider.

## What it does, and what it does not

Single sign-on answers one question: **which email address is this person?**
Everything else stays with Salt.md.

- **It does not decide who may have an account.** That is the registration
  policy — see [Who gets an account](#who-gets-an-account) below.
- **It does not sync groups, roles or workspaces.** An account that arrives this
  way is an ordinary member with its own personal space. Nobody becomes an admin
  through SSO, and no directory group becomes a workspace.
- **It does not deactivate anybody.** Removing a person in your tenant does not
  remove them here; deactivate the account in **Manage users**.
  ([Administration](administration.md))
- **It does not replace password sign-in.** There is no switch that turns
  passwords off. The sign-in screen always shows the email and password fields,
  and the provider buttons underneath.
- **It does not ask for a two-factor code.** Two-factor sign-in in Salt.md
  applies to password sign-in. On this route the second factor is whatever your
  provider enforces. ([Account](account.md))

## What you enter in Salt.md

Account menu (your avatar) → **Instance settings** → the **Access** tab. Admin
only. The section is headed **Sign in with Google / Microsoft (OAuth)** and
holds two cards:

| Card | Field | What goes in it |
| --- | --- | --- |
| Google | **Client ID** | the OAuth client ID, ending in `apps.googleusercontent.com` |
| Google | **Client secret** | the secret created for that client |
| Microsoft | **Client ID (application ID)** | the application (client) ID of the app registration, a UUID |
| Microsoft | **Client secret** | the secret **value**, not its id |

Press **Save**. A toast says *Settings saved* and the dialog closes.

Four things about these fields:

- **Both values are needed before anything appears.** A provider's button shows
  on the sign-in screen only when its client ID *and* its secret are stored. One
  without the other does nothing at all.
- **A stored secret is never sent back to the browser.** The field then shows
  *•••••• (stored)* as its placeholder. Leaving it empty keeps what is stored;
  typing into it replaces it.
- **The two providers are independent.** Configure one, both, or neither.
- **The same client is reused for sending email.** If you later connect a
  mailbox on the **Email** tab, it uses the client ID and secret from here —
  with a different consent, different permissions, and a different address to
  register. See [Sending email](mail.md).

## The address to register with the provider

The provider needs to know where to send the browser back. Salt.md shows both
addresses ready to copy in the same section, under the labels **Google** and
**Microsoft** — click one and it selects itself.

They are your instance's address plus:

```
/api/oauth/google/callback
/api/oauth/microsoft/callback
```

So for an instance at `https://notes.example.com`:

```
https://notes.example.com/api/oauth/google/callback
https://notes.example.com/api/oauth/microsoft/callback
```

Register it **exactly** — scheme, host, port, path. Providers compare this
string literally.

### Which address Salt.md puts in the box

The address shown in the dialog is built from the first of these that exists:

1. the **Public base URL (for links, mail, calendars)** from the **General** tab
2. the URL of a running quick tunnel, if one is up
3. the address you happen to be browsing on right now

Two warnings can appear underneath it, and both are worth reading:

> ⚠ Google and Microsoft accept HTTPS redirect URIs only (localhost aside).
> Start a tunnel (the “Domain & proxy” tab) or enter a public HTTPS base URL
> under “General” — it then appears here on its own.

> ⚠ This is the URL of the running quick tunnel — it changes on every start.
> For OAuth that lasts, use a named tunnel or your own domain and enter it as
> the base URL.

**Set the public base URL.** It is the one setting that makes this predictable:
with it set, Salt.md sends the same address to the provider every time, no
matter which host the browser used. Without it, the address Salt.md sends is
whatever host the browser is on at that moment — which is exactly how a
registration that matches in the dialog fails in practice. See
[Reaching it from outside](domain.md).

### The scopes

Salt.md asks for `openid email profile` and nothing else: who you are, your
address, your name. It cannot read mail, files or calendars with this, and it
never asks for offline access, so it holds nothing after the sign-in is over.

### Where the values come from

The provider consoles rearrange themselves regularly, so this wiki does not
describe their buttons. The dialog carries a one-line reminder for each, and
those are the things to look for:

- **Google** — *console.cloud.google.com → APIs & Services → Credentials →
  “OAuth client ID” (Web application) → enter the redirect URI above.*
- **Microsoft** — *portal.azure.com → App registrations → New (supported account
  types: “Any org + personal accounts”) → Redirect URI (Web): as above but with*
  `/api/oauth/microsoft/callback` *→ Certificates & secrets → client secret.*

One thing about Microsoft is ours to state rather than theirs: **Salt.md talks
to the `common` endpoint**, which accepts work, school and personal accounts
alike. Salt.md does not check which tenant a person came from. If you want one
tenant only, restrict it in the app registration — that is the only place the
restriction can live.

## What people see

Once a provider is configured, the sign-in screen shows a divider reading **or**
below the **Sign in** button, and then **Sign in with Google**, **Sign in with
Microsoft**, or both.

- **Google always asks which account to use**, even when only one is signed in
  in that browser.
- **Microsoft does not.** If exactly one account is signed in there, the round
  trip can complete without a single click. That is the provider's behaviour,
  not a setting here.

After a successful sign-in the browser lands back where it started — normally
the workspace, and the [desktop app](desktop-app.md)'s approval screen when the
sign-in was started from the app.

## Who gets an account

The address the provider returns (lower-cased) is the only key. Salt.md looks
for an account with that address, and takes it **only if the address is
confirmed and the account is not deactivated**.

If there is no such account, the instance's registration policy decides —
the same **Who may register?** setting that governs ordinary sign-up, on the
same **Access** tab:

| Policy | What an unknown address gets |
| --- | --- |
| **By invitation only** (default) | refused: *no account for … — registration here is by invitation* |
| **Email domain allowed** | an account if the domain is on the list, otherwise *this email address may not register here — ask an admin for an invitation* |
| **Open (anyone)** | an account |

Under **By invitation only** — the default — a colleague with a perfectly valid
company account still gets nowhere until they are invited or an admin creates
them. That surprises people, and it is usually what you want.

An invitation and single sign-on combine in the obvious direction: sign in with
Google first, then open the invitation link, and it adds the account you are
signed in as to that workspace.

### What a new account looks like

When the policy does allow it, the account is created immediately:

- **Name** from the provider, or the part of the address before the `@` if the
  provider sent none. Longer than 80 characters is cut.
- **Not an admin**, ever.
- **Its own personal space**, named after the person, plus every workspace
  marked open to every new user. Nothing else. ([Workspaces](workspaces.md))
- **No usable password.** The account is created with a random one that nobody
  knows, and Salt.md has no password-reset flow. Only the instance **owner** can
  give such an account a password, by editing it in **Manage users**. Until then
  the provider button is the only way in.

Two consequences of the address being the key:

- **Whoever controls that mailbox at the provider can sign in as that account.**
  No password is checked, and no two-factor code is asked for.
- **An address the account set on itself does not count.** Changing your own
  email address in Salt.md marks it unconfirmed, and nothing in the product ever
  confirms it again — so the button stops working for you. On an SSO instance,
  have an admin create the account with the right address instead of correcting
  it afterwards. ([Account](account.md))

## Errors, and what each one means

A failed sign-in returns to the sign-in screen with a message above the form. If
the provider supplied wording of its own, it follows in brackets, untranslated —
nobody can translate a sentence somebody else wrote. The error is then cleared
out of the address bar, so a reload does not show it again.

| Message | What actually happened |
| --- | --- |
| *This sign-in method is not configured.* | that provider has no client ID or no secret stored — typically a bookmarked link after the credentials were cleared |
| *Sign-in was cancelled.* | the provider sent an error back: somebody pressed cancel, or consent was refused. The provider's own code is in the brackets |
| *Sign-in expired — please try again.* | the sign-in was not finished within **10 minutes**, or the browser did not send back the cookie Salt.md set when it started |
| *Sign-in could not be verified — please try again.* | the cookie came back but does not fit this attempt — a different provider, a stale tab, a mismatched state |
| *No authorization code received.* | the provider returned neither a code nor an error |
| *Token exchange failed.* | Salt.md could not reach the provider (15-second limit): no outbound internet, DNS, or a firewall |
| *Sign-in failed.* | the provider refused the exchange — wrong client secret, or a redirect address that does not match the registered one. Its explanation is in the brackets |
| *The provider did not supply an email address.* | no address in the token and none from the provider's userinfo endpoint |
| *This Google address is not verified.* | Google only, and Google's own verdict on the address |
| *This address belongs to an account that has not confirmed it. Please sign in with a password or contact your administrator.* | an account holds this address but it is not confirmed — **or the account is deactivated** |
| *This address cannot create an account here.* | no account, and the registration policy refuses. The reason is in the brackets |
| *The session could not be created.* | the sign-in worked and writing the session did not — a database problem, one for the server log |

A link naming a provider that does not exist (anything but `google` and
`microsoft`) does not come back to the sign-in screen at all: it answers a bare
404 with the text *unknown provider*.

**None of this is written to the audit log.** Sign-ins are not recorded there,
successful or not. ([History and audit](history-and-audit.md))

## The one failure that wastes an afternoon

**The whole round trip has to happen on one address.**

When a sign-in starts, Salt.md sets a short-lived cookie in the browser and
checks it when the provider sends the browser back. That cookie belongs to the
host that set it. Start on `https://notes.example.com` and come back on
`http://192.0.2.10:8420` — or the other way round — and the cookie is not there.

The symptom is *Sign-in expired — please try again.* or *Sign-in could not be
verified — please try again.*, on the first attempt, with credentials that are
completely correct.

The fix is always the same three things, in this order:

1. Set the **Public base URL** on the **General** tab to the address people
   actually use.
2. Register exactly that address plus `/api/oauth/google/callback` (or
   `/api/oauth/microsoft/callback`) with the provider.
3. Reach the instance under it.

With a public base URL set, Salt.md helps: starting a sign-in from any other
address sends the browser to the canonical one first, so the round trip runs
where the registration says it does.

## Turning it off

Clear the **Client ID** field for that provider and press **Save**. The button
disappears from the sign-in screen at once — a provider counts as configured
only when both values are there.

The stored secret stays in the database: an empty secret field means *leave it
alone*, and the dialog has no way to erase one. That is harmless without an ID,
and typing a new ID brings the old secret back into use — so replace the secret
too if the point was to retire it.

Accounts created through SSO keep existing, with all their pages. What they lose
is their way in: no usable password, no reset. Before you switch a provider off,
have the owner set passwords for the people who only ever used the button.

## Related

- [Administration](administration.md) — the Access tab in full, users, policies
- [Account](account.md) — sessions, two-factor, changing your address
- [Reaching it from outside](domain.md) — the public base URL and tunnels
- [Sending email](mail.md) — the other thing these credentials are used for
- [Agent access](agent-access.md) — agents signing in, which is a different flow
  with the same word in its name
