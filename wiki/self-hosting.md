# Self-hosting

Salt.md is **one binary**. The frontend is compiled into it, there is no CGO, and
there are no runtime dependencies. Nothing to install alongside it, no database
server, no Node.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/salt-md/salt.md/main/install.sh | sh
salt
```

Then open `http://localhost:8420` and create the first account — whoever does
that becomes the instance owner.

The installer picks the right build for your machine (Linux and macOS, x86-64 and
arm64). `BIN_DIR=/path` changes where it goes; `SALT_VERSION=v1.6.0` pins a
version instead of taking the latest. Windows and other platforms build from
source.

### Docker

```sh
docker run -d --name salt --restart unless-stopped \
  -p 8420:8420 -v salt-data:/data \
  ghcr.io/salt-md/salt.md:latest
```

The image sets `SALT_ADDR=:8420` and `SALT_DATA=/data`, and `/data` is a volume.

**Give the container a memory limit** (`--memory=…`). Without one, its cgroup
reports no cap and the process reads the host's figure instead — which on a
nested setup is the outermost host and is not a promise anybody made.

## Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `SALT_ADDR` | `:8420` | listen address |
| `SALT_DATA` | `./data` | data directory — database and uploads |
| `SALT_MEMORY_MB` | detected | how much memory to assume (see below) |
| `SALT_TRASH_DAYS` | 30 | days before trashed pages are purged; 0 disables |
| `SALT_TLS_CERT` / `SALT_TLS_KEY` | — | serve HTTPS directly from a certificate pair |
| `SALT_RESTORE_FORCE` | — | allow a restore over a non-empty data directory |
| `SALT_IMPORT_ALLOW_PRIVATE` | — | let the importer reach private addresses (development only) |

The prefix is not optional. A bare `DATA=…` is silently ignored and the server
writes into `./data`.

### About memory

Expensive work is sized to the machine: the PDF extraction cap and how many
extractions run at once come from how much memory the process believes it has —
the cgroup limit first, then `/proc/meminfo`.

**A container with no cap is treated as a small machine (2 GB)** rather than as
large as its host. That is deliberate: the host figure is not a promise, and
assuming it is how a 512 MB container talks itself into work that gets it
killed.

`SALT_MEMORY_MB` overrides everything, and it is the only answer for nested
setups — Docker inside LXC, where neither source knows the truth.

Getting this wrong only ever changes how much text reaches the search index,
never whether an upload succeeds.

## Reaching it from outside

Three shapes, all configured in the admin dialog under **Domain & proxy**:

- **Caddy** — automatic HTTPS for a domain pointing at this machine
- **Cloudflare Tunnel** — no open port at all; the machine dials out. A free
  Cloudflare account is enough, and this is the easiest way to put an instance
  behind a name without touching a firewall.
- **Your own reverse proxy** — then set the public base URL by hand, so share
  links and agent connection strings carry the right address.

## Backup

Everything is two things: **the SQLite database and the uploads directory**, both
under `SALT_DATA`.

The admin dialog downloads a consistent snapshot of both. From the shell, stop
the server first:

```sh
systemctl stop salt
tar czf salt-backup-$(date +%F).tar.gz -C /opt/salt/data .
systemctl start salt
```

**Stop it first.** SQLite runs in WAL mode: copying `salt.db` while the server is
writing gives you a stale schema, because the recent changes are still in
`salt.db-wal`. If you must copy live, copy `salt.db`, `salt.db-wal` and
`salt.db-shm` together — or conclude nothing.

Restoring is the reverse: stop, empty the directory, unpack, start.

## Updating

Fetch the new binary, verify it, swap it, restart:

```sh
wget https://github.com/salt-md/salt.md/releases/download/v1.6.13/salt-linux-amd64
wget https://github.com/salt-md/salt.md/releases/download/v1.6.13/SHA256SUMS.txt
grep linux-amd64 SHA256SUMS.txt | sha256sum -c -
systemctl stop salt
tar czf /root/backup-before-update.tar.gz -C /opt/salt/data .
install -m 755 salt-linux-amd64 /opt/salt/salt
systemctl start salt
```

**Verify the checksum before the swap and keep the old binary beside the new
one.** That is the whole rollback plan, and it takes one line to use.

**Migrations run on start and are one-way.** Take the backup first — the command
above does it in the same breath as the stop, which is also the only moment a
clean copy is possible.

Skipping versions is fine. An instance can migrate across several releases in one
start.

## Monitoring

```
GET /api/health
{"status":"ok","version":"v1.6.13"}
```

It **pings the database**, so it distinguishes a live-but-broken instance from a
healthy one — a process that is up but cannot read its own data answers `503`
with `{"status":"unavailable"}`. That is the difference between a useful probe
and one that only proves a port is open.

Point your orchestrator, your uptime monitor or your Docker health check at it.
It needs no credential.

## Verifying an update landed

Do not trust the version string; a mislabelled build reads exactly like a correct
one. Compare the running binary against the published artefact:

```sh
sha256sum /opt/salt/salt
```

and check it against `SHA256SUMS.txt` from the release. That proves you are
running the published build and not something hand-compiled that happens to
claim the same number.
