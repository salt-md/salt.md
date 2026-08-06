# Sending email

Salt.md sends exactly two kinds of message: **invitations** and **password
resets**. It is not a mailing tool and it never sends anything to your pages'
contents.

**Email is a convenience, not a dependency.** An invitation link is always shown
on screen so you can send it yourself. An instance with no mail configured works
completely; it just makes you copy links.

Both messages go out **in English**, deliberately: they reach somebody who has no
account yet and therefore no known language.

## Two ways

Instance settings → **Email**.

### Through a connected Google or Microsoft account

Salt.md sends **as that account**. One click, a consent screen, done — no server
details, no app password, and it survives your provider turning off basic
authentication.

- **Google** asks for `gmail.send` — permission to send, and nothing else. Not
  read, not delete.
- **Microsoft** asks for `Mail.Send` plus `offline_access`, and delivers through
  the Graph API. `offline_access` is what lets it keep sending tomorrow without
  a human clicking consent again.

Optionally override the **sender address** with an alias the account is allowed
to send as.

**This is a separate consent from single sign-on.** Connecting Microsoft for
*login* grants Salt.md nothing about mail; connecting it for *mail* is its own
flow with its own scope. Doing one does not do the other, and that separation is
the point — a sign-in integration that could also send mail as everybody would
be a much larger thing to trust.

### The classic way: SMTP

Host, port, user, password, and a sender address. Any provider or an internal
relay.

Use this when there is no Google or Microsoft tenant, when the instance has no
outbound internet except your relay, or when you want the mail to come from a
service address rather than a person.

## Test it before you need it

There is a **Send test mail** button beside both. Use it. The moment you find out
mail is broken is otherwise the moment you are inviting somebody, and then you
are debugging in front of an audience.

A failed test says what failed, including the text the provider returned. That
provider text is passed through untranslated on purpose — nobody can translate a
message somebody else wrote, and a mangled version of it helps nobody.

## What can go wrong

**Nothing arrives and there is no error.** Check spam first, then whether the
sender address is one the account may actually send as. Providers accept the
submission and drop the message when it is not.

**It worked and then stopped.** For a connected account, the refresh token was
revoked — a password change, an admin removing consent, or a policy expiring it.
Reconnect. For SMTP, an app password was rotated.

**Microsoft refuses to send.** Basic authentication for SMTP is switched off in
most tenants now. That is the case the Graph connection exists for.

**Links in the mail point at the wrong address.** They are built from the public
base URL, not from the machine's hostname. Instance settings → General. Same
value that matters for [sign-in](sso.md) and the
[downloadable skill](agents.md#the-skill).

## Turning it off

Clear the settings, or disconnect the account. Invitations then show their link
on screen and you send it however you like — which is exactly what happens on an
instance that never configured mail at all.
