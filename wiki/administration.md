# Administration

The instance owner administers the server itself: who may sign up, how mail
goes out, how the instance is reached from outside, and backups.

Everything here needs a signed-in browser session. **API tokens cannot reach any
of it**, whatever their scope.

## The six sections

### General

Instance name, the data directory, the upload cap (1 MB – 2 GB, default 50 MB),
and how long the trash is kept (default 30 days; 0 disables automatic purging).

### Access

**Who may get an account:**

| Policy | Meaning |
| --- | --- |
| By invitation only | somebody has to invite them |
| Allowed domains | anyone with an email at these domains may sign up |
| Open | anyone may sign up |

**Single sign-on** — Microsoft (Entra ID) or Google. Each needs a client id and
secret from that provider's console. When configured, the login screen offers it
next to the password form; password sign-in stays available.

**Users** — create, invite, disable, delete, change roles. Deleting asks what
should happen to the workspaces that account owns.

**Break-glass** — the instance owner can look inside a workspace they are not a
member of. It is logged, and the log is visible to that workspace's admins.
The visibility is the safeguard, not the permission.

### Email

For invitations and password resets. Either an SMTP server, or a connected
Google/Microsoft account that sends on the instance's behalf.

Email is a **convenience, not a dependency**: an invitation link is always shown
so you can send it yourself if mail is not configured or fails.

Invitations and password resets go out **in English**, because they reach
somebody who has no account yet and therefore no known language.

### Domain and proxy

How the instance is reached from outside. Three shapes:

- **Caddy** — automatic HTTPS for a domain pointing at this machine
- **Cloudflare Tunnel** — no open port at all; the machine dials out. A free
  Cloudflare account is enough.
- **Manual** — you run your own reverse proxy and set the public base URL

The configured address is what public share links, agent connection strings and
the downloadable skill are built from — not whatever address your browser
happens to be using. That distinction matters the moment somebody opens the
interface on a LAN address.

### Webhooks

See [Automation](automation.md#webhooks).

### Maintenance

**Backup** — downloads a consistent snapshot of the whole database plus every
upload, with the restore instructions beside it.

**Rebuild indexes** — search and files. Both are derived from the pages and the
disk, so rebuilding them is safe by construction and is the right first move
when a count looks wrong.

## Things that are deliberately not here

- **No per-page permissions.** Access is per workspace plus a private flag. A
  permission model people cannot hold in their heads is one they misconfigure.
- **No multi-tenancy.** One instance is one organisation.
- **No admin API.** Administrative endpoints are closed to tokens on purpose. If
  an agent could create users, a leaked token would be an account factory.

## Verifying a deployment

After an update, do not trust the version string — a mislabelled build reads
exactly like a correct one. Check something the new code has and the old does
not: a route that answers `401` where an unknown path falls through to the app
with `200`, or a marker in the served bundle.

If you install from the published binaries, the stronger check is the checksum:
compare `sha256sum` of the running binary against `SHA256SUMS.txt` from the
release. That proves you are running the published artefact and not something
hand-built.
