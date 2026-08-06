# Signing in with Microsoft or Google

Salt.md can hand sign-in to Microsoft 365 (Entra ID) or Google. People then use
the account they already have, and you stop keeping a second set of passwords.

**Password sign-in stays available.** Not everyone connects a tenant, and an
instance that only worked with one would be unusable for them. The login screen
offers both.

## What Salt.md needs

Exactly two values per provider, entered in Instance settings → **Access** →
*Sign in with Google / Microsoft*:

- a **client ID** (Microsoft calls it the application ID)
- a **client secret**

## What the provider needs from you

One value, and getting it wrong is the usual cause of a failed first attempt.

### The redirect URI

```
https://<your public base URL>/api/oauth/microsoft/callback
https://<your public base URL>/api/oauth/google/callback
```

Register it **exactly**, including the scheme and any port. Providers match this
string literally — a trailing slash or `http` where you meant `https` is a
rejection.

`<your public base URL>` is the one from Instance settings → General. If it is
not set, or does not match the address people actually use, sign-in will fail in
a way that looks like a credential problem and is not — see below.

### The scopes

Salt.md asks for `openid email profile` and nothing else. It wants to know who
you are; it does not read your mail, your files or your calendar. If a consent
screen offers to grant more, it is not because Salt.md asked.

## Where the values come from

The two consoles change their layout regularly, so this wiki does not pretend to
know which button is where this month. What you are looking for is stable:

**Microsoft** — Entra ID → app registrations → a new registration. You need its
application (client) ID, a client secret you create under Certificates &
secrets, and the redirect URI above registered as a **Web** platform.
Salt.md talks to the `common` endpoint, so accounts from any tenant that is
allowed to consent can sign in — restrict that in the registration if you want
one tenant only.

**Google** — Google Cloud Console → APIs & Services → Credentials → an OAuth
client ID of type *Web application*. You need the client ID, the client secret,
and the redirect URI above as an authorised redirect URI.

Each provider's own documentation is the authority on those screens. What this
page pins down is the part that is ours: the URI, the scopes, and the failure
below.

## The failure that wastes an afternoon

**The whole round trip has to run on one origin.**

Salt.md sets a state cookie when the sign-in starts and checks it when the
provider sends the browser back. That cookie is scoped to the host that set it.
So if you start at `https://salt.example.com` and the provider returns to
`http://192.0.2.10:8420` — or the other way round — the cookie is not there and
sign-in fails.

The symptom is an error that reads like the credentials are wrong. They are
fine.

The fix is always the same: set the public base URL, register the redirect URI
under exactly that host, and reach the instance under it.

## Who gets an account

Single sign-on says *who somebody is*. It does not say *whether they may have an
account here*. That is the separate signup policy in the same Access section:

| Policy | Meaning |
| --- | --- |
| By invitation only | somebody has to invite them first |
| Email domain allowed | anyone whose address is at these domains may register |
| Open | anyone may register |

With "by invitation only", a colleague signing in with a perfectly valid
Microsoft account still gets no account until they are invited. That is usually
what you want and it does surprise people.

## Turning it off

Clearing the client ID and secret removes the button from the login screen.
Accounts that were created through it keep working — they just sign in with a
password, after a reset if they never had one.

## Sending mail is a different thing

Connecting Microsoft or Google **for sign-in** does not let Salt.md send email
through them. That is a separate consent with a separate scope, on a separate
tab. See [Sending email](mail.md).
