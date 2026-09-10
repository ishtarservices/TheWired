# Deploying The Wired

How production is put together and what a deploy actually touches. Host
addresses, credentials and account details are deliberately not in this file;
they live in the private ops runbook.

## Shape

- **Images.** Every push to `main` that passes tests runs
  `.github/workflows/build-images.yml`, which publishes
  `ghcr.io/ishtarservices/thewired-{backend,gateway,relay,landing,proxy}:latest`.
  Application code — and the Caddyfile, which is baked into `thewired-proxy` —
  only reaches production through these images.
- **Host.** One Docker host running `docker-compose.prod.yml`. Three things
  live on it and are edited by hand: that compose file, `.env`, and
  `deploy/deploy-all.sh`. They are **not** updated by pulling images.
- **Edge.** Caddy (the `proxy` image) terminates TLS for the apex, `api.`,
  `relay.` and `livekit.` hostnames and routes to the containers over the
  compose network. If DNS is behind Cloudflare it must be DNS-only (grey
  cloud): the relay and LiveKit are WebSockets/UDP, and LiveKit media never
  goes through Caddy at all.

## Routine deploy (code change only)

```bash
./deploy/deploy-all.sh
```

That validates the compose file, pulls the new images and recreates changed
containers. Wait for the `build-images` run on `main` to finish first, or you
pull the previous build.

## When `docker-compose.prod.yml` or `.env` changes

Compose forwards only the variables named under each service's
`environment:`. A new backend setting therefore needs **two** things: the
variable added to the compose file, and a value in `.env`. Because the file
on the host is edited in place, the flow is:

1. Make the change in the repo (this file is the reference copy).
2. Apply the same edit on the host — copy the file over or edit it there.
3. Add any new values to `.env` on the host.
4. `docker compose -f docker-compose.prod.yml config > /dev/null` — a missing
   required variable or a YAML mistake is reported here.
5. `./deploy/deploy-all.sh`.

Keep the repo copy identical to the host copy; drift between them is how
settings silently stop reaching containers.

## Required variables

Compose refuses to start without these (`${VAR:?}`):

| Variable | Generate with |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `MEILI_MASTER_KEY` | `openssl rand -base64 32` |
| `RELAY_SECRET_KEY` | `openssl rand -hex 32` |
| `MEDIA_TOKEN_SECRET` | `openssl rand -hex 32` — signs protected-music playback tokens; the backend will not mint without it |
| `LIVEKIT_NODE_IP` | the host's public IP — advertised to WebRTC clients; a loopback or container IP breaks every call |
| `LIVEKIT_API_KEY` | any name (e.g. `thewired`) — the token-signing key id, shared by the backend and LiveKit |
| `LIVEKIT_API_SECRET` | `openssl rand -base64 32` — the LiveKit signaling endpoint is public, so this is what stops strangers minting room tokens |

Everything else has a default in the compose file; `.env.example` lists them
all with notes. Nothing secret has a default.

## Host firewall

Inbound, from anywhere:

| Port | Used by |
|---|---|
| 80, 443 TCP | Caddy (HTTP → HTTPS, TLS, all WebSocket signaling) |
| 7881 TCP | LiveKit ICE over TCP (UDP-blocked networks) |
| 7882 UDP | LiveKit media |
| 3478 UDP | LiveKit embedded TURN (symmetric-NAT clients) |

7880 is published by compose for Caddy's convenience but should stay closed
at the firewall. SSH should be restricted to known addresses.

## DNS

A records, all to the host's public IP, DNS-only: the apex, `api`, `relay`,
`livekit` and `turn` (the TURN hostname must resolve to `LIVEKIT_NODE_IP`).

## Smoke checks after a deploy

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs livekit --tail 50 | grep -iE "nodeIP|turn"
curl -sf https://api.thewired.app/health
curl -s https://thewired.app/.well-known/assetlinks.json
curl -s -A "iPhone" "https://thewired.app/profile/<pubkey>?section=music" | grep -o "Get soot"
```

The LiveKit log line must show `nodeIP` equal to the host's public IP. Then,
from a client on a different network: join a voice channel (the in-app
`wiredDebug.calls()` console command shows the room state) and play a private
track (proves token minting).

## Desktop client

The desktop app is not deployed here. It ships through GitHub Releases
(`.github/workflows/release.yml`) and the in-app auto-updater; a client-side
change reaches users only with a tagged release.
