# Reaching your instance from outside

Out of the box Salt.md listens on `:8420` and is reachable from your own
network. Getting it a name and a certificate is one setting, and there are three
routes to it.

**Whichever you pick, set the public base URL** (Instance settings → General).
Public share links, agent connection strings, invitation mails, the calendar
feed and the downloadable skill are all built from it — not from whatever
address your browser happens to be using. Get this wrong and the skill you hand
somebody says `http://192.0.2.10`, which no cloud agent can reach.

## 1. Cloudflare Tunnel — no open port

The machine dials out to Cloudflare; nothing has to accept connections from the
internet. This works behind NAT, behind a firewall you do not control, and on a
home connection.

### Trying it in one click

Instance settings → **Domain & proxy** → **Start quick tunnel**.

Salt.md downloads the official `cloudflared` itself on first use and brings up a
throwaway `*.trycloudflare.com` address. Good for showing somebody; the address
changes every time and is not meant to last.

### Permanently, with your own domain

1. A free Cloudflare account, with your domain in it.
2. In the Cloudflare dashboard, create a **tunnel** and give it a public
   hostname — that is where you decide `salt.example.com` points at this
   machine, and Cloudflare's own documentation is the authority on those screens
   because they change.
3. Copy the tunnel **token** (a long `eyJhIjoi…` string).
4. Paste it into **Domain & proxy** and start the tunnel.

The status line says `Tunnel connected` once it is up. The hostname is the one
you set in the dashboard — Salt.md does not choose it and cannot see it.

Then set the public base URL to `https://salt.example.com`.

**What the tunnel does and does not do.** It gets traffic to you and terminates
TLS. It is not authentication: anybody who reaches the address still meets the
sign-in screen, and that is the thing protecting your data. If you want a second
gate in front, Cloudflare Access is where that lives — but be aware it will also
sit in front of `/mcp`, and an agent cannot click through a login page.

## 2. Caddy — automatic HTTPS

For a machine that *can* accept connections and has a domain pointing at it.
Caddy fetches and renews a certificate on its own.

Instance settings → **Domain & proxy** → **Caddy**. The examples there are filled
in with the domain from your public base URL, so set that first.

Requirements: ports 80 and 443 reachable from the internet, and an A/AAAA record
for the domain pointing at this machine.

## 3. Your own reverse proxy

nginx, Traefik, HAProxy, an existing Caddy — anything. Salt.md needs nothing
special:

- proxy to `http://127.0.0.1:8420`
- forward `X-Forwarded-Proto` so it knows the outside is HTTPS
- **let WebSockets through** — realtime collaboration and the change feed both
  use them, and a proxy that quietly drops the upgrade produces an editor where
  other people's cursors never appear
- do not buffer `/api/events`; it is a streaming endpoint

Then set the public base URL by hand.

## Serving HTTPS directly

If you have a certificate already, skip the proxy:

```sh
SALT_TLS_CERT=/path/fullchain.pem SALT_TLS_KEY=/path/key.pem salt
```

## Checking it worked

```sh
curl https://salt.example.com/api/health
{"status":"ok","version":"v1.6.13"}
```

That endpoint pings the database, so it tells a live-but-broken instance from a
healthy one. It answers `503` with `{"status":"unavailable"}` when the database
is not reachable, which is what you point a monitor or an orchestrator at.

## The mistake that costs an afternoon

**Sign-in has to happen on one origin.** The state cookie set at the start of an
OAuth round trip is scoped to the host that set it, so if the flow starts on
`https://salt.example.com` and comes back on `http://192.0.2.10:8420`, the
cookie is not there and the sign-in fails with nothing useful in the error.

Set the public base URL, use that address, and the problem does not exist.
