# The Wired V1

Decentralized Nostr-native media platform -- streaming, messaging, music, voice/video calls, long-form content, zaps, an AI assistant, and self-hostable spaces in a desktop app. Built with Tauri v2, React 19, and the Nostr protocol.

Current version: **v0.7.2**. Auto-updating Tauri desktop app with macOS, Windows, and Linux builds.

## Architecture

| Service | Language | Port | Purpose |
|---------|----------|------|---------|
| Client | TypeScript/React/Tauri | 1420 | Desktop app; Nostr relay connections, embedded relay, AI assistant, wallet |
| Relay | Rust (axum + sqlx) | 7777 | Custom NIP-29 relay with PostgreSQL storage |
| Backend | Node.js/TypeScript (Fastify + Drizzle) | 3002 | Business logic, RBAC, search, feeds, push, Blossom blobs |
| Gateway | Go | 9080 | NIP-98 auth, rate limiting, request routing |
| Landing | Astro + React | 8080 | Marketing site, legal pages (`services/landing/`) |
| Proxy | Caddy | 80/443 | Production reverse proxy for api / relay / LiveKit / share pages (`services/proxy/`) |
| PostgreSQL | - | 5432 | Shared database (relay + app schemas) |
| Redis | - | 6380 | Rate limits, caching, trending feeds |
| Meilisearch | - | 7700 | Full-text search engine |
| LiveKit | - | 7880 | WebRTC SFU for voice/video channels |
| Embedded Relay | Rust (in-client) | 7787 | Optional self-hosted NIP-29 relay running in-process (SQLite), exposed via Cloudflare tunnel |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design document. Feature deep-dives: [docs/AI_ENGINE.md](./docs/AI_ENGINE.md), [docs/DECENTRALIZED_SPACES.md](./docs/DECENTRALIZED_SPACES.md), [docs/NIP17_GROUP_ROOMS.md](./docs/NIP17_GROUP_ROOMS.md), [docs/DM_WIRE_CONTRACT.md](./docs/DM_WIRE_CONTRACT.md), [docs/E2EE_CALLS.md](./docs/E2EE_CALLS.md), [docs/MEDIA_STORAGE.md](./docs/MEDIA_STORAGE.md), [docs/MUSIC_VISIBILITY.md](./docs/MUSIC_VISIBILITY.md), [docs/MUSIC_LIBRARY_SYNC.md](./docs/MUSIC_LIBRARY_SYNC.md).

## Requirements

### System
- **Node.js** >= 22
- **pnpm** >= 10
- **Rust** >= 1.88 (with cargo; current dependency versions need it)
- **Go** >= 1.22 (for gateway)
- **Docker** + **Docker Compose** (for infrastructure services)
- **LiveKit server** (`brew install livekit`) -- runs natively in dev for voice/video
- **process-compose** -- one-command dev orchestration. Install with `brew install f1bonacc1/tap/process-compose`, or drop a binary from the [releases page](https://github.com/F1bonacc1/process-compose/releases) onto your PATH (it's a single self-contained binary)

### Platform-specific (for Tauri client)
- **macOS**: Xcode Command Line Tools
- **Windows**: Visual Studio C++ Build Tools, WebView2
- **Linux**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `libssl-dev`, `libdbus-1-dev`

See [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for full details.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/ummilabs/TheWired.git
cd TheWired
cp .env.example .env   # Edit .env with your credentials
pnpm install
```

### 2. Start the backend stack

One command brings up the whole backend stack in a single terminal, with one scrollable log pane per
process and health-gated startup ordering (via [process-compose](https://github.com/F1bonacc1/process-compose)):

```bash
pnpm dev
```

This opens the process-compose TUI and starts everything in dependency order:

1. **infra** -- ensures PostgreSQL + Redis + Meilisearch are up (idempotent; a fast no-op if already
   running). Runs detached, so infra **persists when you stop the stack**.
2. **livekit** -- `livekit-server --dev` (native; the SFU for voice/video).
3. **relay** -- Rust NIP-29 relay on 7777 (`RUST_LOG=debug`). Waits for infra.
4. **backend** -- Fastify backend on 3002 with the transcode worker enabled
   (`TRANSCODE_WORKER`/`TRANSCODE_ENQUEUE`). Waits for the relay's `/` to be listening and LiveKit to start.
5. **gateway** -- Go API gateway on 9080. Waits for the backend's `/health` to pass.

**TUI cheatsheet** — arrow keys to switch panes, scroll within a pane. For the selected process:
`F7` start · `Ctrl-S` stop · `Ctrl-R` restart · `Ctrl-X` send signal. `F10` or `Ctrl-C` stops the
whole stack (infra is left running). `F1` shows the full live shortcut list.

> Stop is rebound from the default `F9` to `Ctrl-S` via `process-compose-shortcuts.yaml` (the `dev`
> script passes `--shortcuts`); log-select moves to `Ctrl-Y`. Edit that file to change the bindings.

From another terminal you can bounce or tail one service: `process-compose process stop|start|restart <name>` /
`process-compose process logs <name>` (or `tail -f logs/<name>.log`).

### 3. Start the client

The frontend runs in its own terminal (it's the thing you restart most, and Tauri has its own window):

```bash
pnpm dev:client                # Vite dev server on port 1420
# or, for the full Tauri desktop app with hot reload:
cd client && pnpm tauri dev
```

### Stopping

- `q` / Ctrl-C in the TUI stops the app processes but **leaves infra running** (fast restarts later).
- `pnpm dev:down:infra` stops Postgres/Redis/Meilisearch when you actually want them down.

### Running services individually

The stack is the recommended path, but each service still has its own script for one-off runs:

```bash
pnpm dev:infra      # PostgreSQL + Redis + Meilisearch + LiveKit (Docker, detached)
pnpm dev:relay      # Rust NIP-29 relay (7777); runs migrations on first start
pnpm dev:backend    # Fastify backend (3002, hot reload)
pnpm dev:gateway    # Go API gateway (9080; NIP-98 auth + proxy)
```

### Alternative: Start everything via Docker

To run all services (infrastructure + relay + backend + gateway) in containers instead:

```bash
pnpm dev:services
```

Then start the client separately with `pnpm dev:client`. Note this trades away cargo/tsx/go hot-reload
DX, so `pnpm dev` is preferred for active development.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm dev` | **Start the full backend stack** (process-compose TUI: infra + LiveKit + relay + backend + gateway) |
| `pnpm dev:client` | Vite dev server (web only, port 1420) |
| `pnpm dev:backend` | Backend service with hot reload (port 3002) |
| `pnpm dev:gateway` | Go API gateway (port 9080) |
| `pnpm dev:relay` | Rust NIP-29 relay (port 7777) |
| `pnpm dev:landing` | Astro landing site dev server |
| `pnpm dev:tauri` | Full Tauri desktop app with hot reload (same as `cd client && pnpm tauri dev`) |
| `pnpm dev:tauri:2` / `dev:tauri:3` | Extra Tauri instances with their own Vite port, keychain accounts and embedded-relay data, for multi-user testing on one machine |
| `pnpm dev:infra` | Start PostgreSQL + Redis + Meilisearch + LiveKit (Docker) |
| `pnpm dev:services` | Start all Docker services (includes the landing and Caddy proxy containers) |
| `pnpm dev:down` | Stop the managed app processes (infra stays up) |
| `pnpm dev:down:infra` | Stop Postgres + Redis + Meilisearch |
| `pnpm reports:list` / `show` / `resolve` / `lift` / `restore` | Operator CLI for the user-report queue (same service functions as the admin routes) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript check all packages |
| `cd client && pnpm tauri build` | Production desktop app bundle |

## Testing

The project has a test suite covering every service plus the shared `core` package. Approximate sizes as of v0.7.2:

| Suite | Tests | Needs |
|-------|-------|-------|
| `packages/core` (Vitest) | ~260 | Nothing |
| Client (Vitest) | ~1,950 | Nothing |
| Backend (Vitest + Fastify inject) | ~790 | PostgreSQL |
| Gateway (Go) | 84 | Nothing |
| Relay (Rust) | ~140 unit + ~60 integration | Integration tests need PostgreSQL |
| Client E2E (Playwright) | 11 | Full stack |

### Quick Start

```bash
# Run all tests that need no infrastructure
pnpm test:core
pnpm test:client
pnpm test:gateway

# Run everything (backend and relay integration tests need PostgreSQL)
pnpm test:all
```

### Per-Service Details

#### Client (Vitest + React Testing Library + MSW)

```bash
pnpm test:client            # Run all client unit tests
pnpm test:client:watch      # Watch mode
pnpm test:client:coverage   # With V8 coverage report
```

No setup required -- uses `jsdom`, `fake-indexeddb`, and MSW mocks. Covers:
- Nostr protocol (event builders, dedup, filters, validation, relay list parsing)
- Redux slices (spaces, events, identity, DMs, notifications)
- IndexedDB stores (events, profiles, spaces, user state)
- API client (HTTP, auth headers, retry logic)

#### Client E2E (Playwright)

```bash
pnpm test:e2e                                    # Run Playwright tests (headless)
pnpm --filter @thewired/client test:e2e:headed   # Run with visible browser

# First time: install Playwright browsers
npx playwright install chromium
```

**Requires**: Full stack running (`pnpm dev:infra`, `pnpm dev:relay`, `pnpm dev:backend`, `pnpm dev:gateway`, `pnpm dev:client`).

#### Backend (Vitest + Fastify inject)

```bash
pnpm test:backend           # Run backend tests
```

**Requires**: PostgreSQL running on port 5432. Start with `pnpm dev:infra`.

Uses Fastify's built-in `server.inject()` for zero-network HTTP testing. Redis and Meilisearch are mocked by default (via `ioredis-mock` and `vi.mock`).

To use a different test database:
```bash
TEST_DATABASE_URL=postgres://user:pass@host:5432/thewired_test pnpm test:backend
```

#### Gateway (Go stdlib)

```bash
pnpm test:gateway           # or: cd services/gateway && go test ./...
```

No setup required -- uses Go stdlib `testing` + `net/http/httptest`. Covers NIP-98 auth verification, rate limiter logic, proxy routing, trusted proxy detection.

#### Relay (Rust)

```bash
pnpm test:relay             # or: cd services/relay && cargo test
```

Unit tests (inline `#[cfg(test)]` modules) need no setup. They cover event serialization, schnorr verification, filter matching, the membership / moderation / gift-wrap gates, NIP-42 and the SQLite backend. The integration tests in `services/relay/tests/` need PostgreSQL (default test DB, or `TEST_DATABASE_URL`) and skip with a printed warning when it is unreachable. `db_parity.rs` runs the same operations through the SQLite and Postgres backends and checks they agree; its SQLite half always runs.

#### Core package (Vitest)

```bash
pnpm test:core              # @ishtarservices/core: gift wrap, NIP-17 rooms, file crypto, dedup, negentropy, DM wire, media + music sync
```

### Test Scripts Reference

| Command | Description |
|---------|-------------|
| `pnpm test:core` | `@ishtarservices/core` package tests (Vitest) |
| `pnpm test:client` | Client unit tests (Vitest) |
| `pnpm test:client:watch` | Client tests in watch mode |
| `pnpm test:client:coverage` | Client tests with coverage |
| `pnpm test:backend` | Backend route + service tests (needs PostgreSQL) |
| `pnpm test:gateway` | Gateway Go tests |
| `pnpm test:relay` | Relay Rust tests (integration tests need PostgreSQL) |
| `pnpm test:all` | Run core + client + backend + gateway + relay tests |
| `pnpm test:e2e` | Playwright E2E tests (needs full stack) |

### Test Users

10 dedicated test keypairs are used across the test suite. Each has a specific role (admin, member, invited user, banned user, moderator, etc.) for realistic multi-user scenarios.

**Setup:** Copy `.env.test.example` to `.env.test` and fill in your nsec keys:

```bash
cp .env.test.example .env.test
# Edit .env.test with your test nsec keys
```

If `.env.test` is missing, the test suite auto-generates deterministic keys from user names, so tests always work without it. The `.env.test` file is gitignored.

### CI/CD

Tests run automatically on push and pull request via GitHub Actions (`.github/workflows/test.yml`):

| Job | What runs | Infrastructure |
|-----|-----------|----------------|
| **Client** | `pnpm test:client` + coverage | None |
| **Gateway** | `go test ./... -v -count=1` | None |
| **Relay** | `cargo test` (unit + integration) | PostgreSQL (service container) |
| **Backend** | `pnpm test:backend` (Fastify inject) | PostgreSQL (service container) |
| **Typecheck** | `pnpm typecheck` | None |

All jobs run in parallel. Backend and relay tests get a fresh PostgreSQL 16 container per run. The `core` package tests and Playwright E2E are not in CI yet.

Other workflows: `build-images.yml` (Docker images, built only after Tests pass on `main`), `release.yml` (multi-platform Tauri builds + signed updates on `v*` tags), `linux-smoke-test.yml` (manual AppImage smoke test).

## Project Structure

```
TheWiredV1/
├── client/                        # Tauri + React desktop app
│   ├── src/
│   │   ├── app/                   # App root, layout, routing, auth gate
│   │   ├── components/
│   │   │   ├── layout/            # Sidebar, CenterPanel, RightPanel, TopBar, ThemeBackground
│   │   │   └── ui/                # Button, Avatar, Spinner, Modal, PopoverMenu, MagicCard, etc.
│   │   ├── contexts/              # React contexts (theme)
│   │   ├── hooks/                 # Shared hooks (scroll restore, shortcuts, uploads, updater, …)
│   │   ├── features/
│   │   │   ├── ai/                # Toggleable AI assistant: chat, multi-provider LLM, gated tools, artifacts
│   │   │   ├── calling/           # 1:1 DM calls over a private LiveKit room (invite, controller, ringtone; frame E2EE)
│   │   │   ├── chat/              # Kind:9 real-time chat, edits, context menu, GIFs, emoji
│   │   │   ├── discover/          # /discover page: Spaces, Music, People segments + space preview panel
│   │   │   ├── dm/                # NIP-17 encrypted DMs + group rooms, contacts, typing/receipts, friend list
│   │   │   ├── emoji/             # Emoji picker, custom emoji sets
│   │   │   ├── friends/           # Friends Feed virtual space (follow list aggregation, feed prefs)
│   │   │   ├── identity/          # Login, multi-account switcher, profile card
│   │   │   ├── listenTogether/    # Synced playback sessions (now playing, vote-skip, DJ transfer)
│   │   │   ├── longform/          # Kind:30023 article reader + rich editor (drafts stay local in IndexedDB)
│   │   │   ├── media/             # Video playback (HLS via hls.js) + shared MediaStage tile layout for calls/voice
│   │   │   ├── music/             # Music library, player, upload, revisions, proposals, insights
│   │   │   │   ├── views/         # MusicHome, SongList, AlbumGrid, ArtistDetail, Explore, etc.
│   │   │   │   ├── panel/         # Side panel (Actions, Audio, History, Notes tabs, waveform)
│   │   │   │   ├── playbackBar/   # MiniBar, ExpandedBar, NowPlayingOverlay, progress bar
│   │   │   │   └── sharedKey/     # Co-owned projects: shared project keys (kind-20017 key DMs)
│   │   │   ├── notifications/     # Toast stack, bell dropdown, browser/push, service worker
│   │   │   ├── onboarding/        # Profile wizard, app tour, welcome flow
│   │   │   ├── polls/             # NIP-88 polls (composer, card, voting)
│   │   │   ├── profile/           # Profile page, edit, follow cards, pinned notes, showcase
│   │   │   ├── reactions/         # Reaction toggle / un-react
│   │   │   ├── relay/             # Relay connection status panel
│   │   │   ├── search/            # User/message search panels
│   │   │   ├── settings/          # Profile, relays, notifications, wallet, storage/media servers, features, AI, security
│   │   │   ├── spaces/            # NIP-29 spaces, channels, members, moderation, settings
│   │   │   │   ├── moderation/    # Ban/mute/kick, member context menu, audit log
│   │   │   │   ├── notes/         # Thread view, quoted notes, reply composer
│   │   │   │   └── settings/      # Tabbed Space Settings modal (incl. discovery listing request)
│   │   │   ├── voice/             # LiveKit voice/video channels, screen share, pre-join, device picker
│   │   │   └── wallet/            # NIP-47 NWC wallet + NIP-57 zaps (ZapModal, walletManager, zap totals)
│   │   ├── lib/
│   │   │   ├── api/               # Backend API client (25 modules; NIP-98 auth, request queue)
│   │   │   ├── audio/             # Audio unlock helper (autoplay policies)
│   │   │   ├── cache/             # Image, media-token and video-poster caches
│   │   │   ├── content/           # Rich content parsing (inline markdown, note/music embeds, previews)
│   │   │   ├── db/                # IndexedDB persistence (events, profiles, music, audio cache, AI conversations)
│   │   │   ├── debug/             # wiredDebug gated logger + perf monitors
│   │   │   ├── lightning/         # NIP-57 zaps, LNURL, NIP-47 NWC client
│   │   │   ├── media/             # Upload planning, media-server prefs, media grants, note media parsing
│   │   │   ├── relay/             # Embedded relay control (in-process Tauri relay)
│   │   │   ├── security/          # SSRF guard for untrusted URLs
│   │   │   ├── webrtc/            # LiveKit client wrapper, media prefs, frame E2EE key providers
│   │   │   └── nostr/             # Protocol: relay, subscription, event pipeline, signers (NIP-07 / Tauri / NIP-46),
│   │   │                          #   NIP-44, gift wrap, follow list, signing queue, NIP-17 rooms, negentropy
│   │   ├── store/                 # Redux store (25 slices) + thunks
│   │   ├── styles/                # Theme engine presets, color tokens
│   │   ├── types/                 # TypeScript types
│   │   └── workers/               # Web Worker for schnorr verification
│   ├── src-tauri/                 # Rust: OS keychain, NIP-44 v2, keystore IPC, updater, embedded relay, cloudflared tunnel
│   ├── e2e/                       # Playwright E2E tests
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── packages/
│   ├── core/                      # @ishtarservices/core (published): platform-neutral protocol code
│   │   └── src/                   # crypto (gift wrap, NIP-44, NIP-17 rooms, file crypto), nostr (dedup, negentropy,
│   │                              #   DM wire, music library/folder sync), media, music, listenTogether
│   └── shared-types/              # @ishtarservices/shared-types (published, type-only)
│       └── src/                   # nostr, space, profile, api, permissions, music, dm, listenTogether
├── services/
│   ├── backend/                   # Node.js/Fastify backend (@thewired/backend)
│   │   └── src/
│   │       ├── routes/            # REST API endpoints (34 route modules)
│   │       ├── services/          # Business logic (35 service modules)
│   │       ├── workers/           # Background jobs (9 workers + ingestHandlers)
│   │       ├── db/schema/         # Drizzle ORM tables (app schema, 40+ tables)
│   │       ├── db/migrations/     # SQL migrations (0001-0035)
│   │       ├── middleware/        # Auth context, error handler, Blossom auth
│   │       ├── scripts/           # Operator CLIs (reports) + backfills (transcodes, cover variants)
│   │       └── lib/               # Redis, Meilisearch, Nostr utils, transcode, media tokens, SSRF guard
│   ├── gateway/                   # Go API gateway
│   │   ├── cmd/gateway/           # Entry point
│   │   └── internal/              # auth, ratelimit, proxy, cors, logging, config
│   ├── relay/                     # Rust NIP-29 relay (Postgres server or embedded SQLite)
│   │   ├── migrations/            # PostgreSQL schema (relay schema)
│   │   └── src/                   # nostr, protocol, db (pg + sqlite), music, relay_identity, connection
│   ├── landing/                   # Astro marketing site (downloads, features, legal: privacy/terms/DMCA/guidelines)
│   └── proxy/                     # Caddy production reverse proxy (Caddyfile + Dockerfile)
├── config/livekit.yaml            # LiveKit SFU config
├── docker-compose.yml             # Dev stack (infra + services + landing + proxy)
├── docker-compose.prod.yml        # Production compose reference
├── process-compose.yaml           # `pnpm dev` orchestration (+ process-compose-shortcuts.yaml)
├── pnpm-workspace.yaml            # Workspace config
├── tsconfig.base.json             # Shared TypeScript config
├── CLAUDE.md                      # Claude Code instructions
├── ARCHITECTURE.md                # Full design document
├── docs/                          # Design notes, plans, roadmaps, NIP drafts
└── README.md
```

## Tech Stack

### Client
| Package | Version | Purpose |
|---------|---------|---------|
| React | 19 | UI framework |
| Redux Toolkit | 2 | State management with normalized entities |
| React Router | 7 | Client-side routing |
| Tailwind CSS | 4 | Utility-first styling |
| Vite | 6 | Build tooling + HMR |
| TypeScript | 5 | Type safety |
| Tauri | 2 | Desktop shell + IPC |
| hls.js | 1 | HLS adaptive bitrate video |
| react-markdown | 9 | Markdown rendering (GFM + syntax highlight) |
| @noble/curves | 1 | secp256k1 schnorr verification (Web Worker) |
| idb | 8 | IndexedDB wrapper |
| nostr-tools | 2 | Nostr protocol utilities + NIP-46 BunkerSigner |
| livekit-client | 2 | Voice/video SFU client |
| lru-cache | 11 | Event dedup and other bounded caches |
| Tiptap | 2 | Rich article editor (Markdown round-trip) |
| motion | 12 | Animations |
| marked + highlight.js | 18 / 11 | AI chat markdown + code highlighting |
| recharts | 3 | AI artifact charts (lazy-loaded, code-split) |
| Vitest + MSW + Playwright | 4 / 2 / 1 | Unit, API-mock and E2E testing |

### Backend
| Package | Purpose |
|---------|---------|
| Fastify 5 | HTTP server |
| @fastify/multipart | Multipart form upload handling |
| Drizzle ORM | PostgreSQL queries + schema |
| postgres (postgres.js) | PostgreSQL driver |
| ioredis | Redis client |
| meilisearch | Search engine client |
| BullMQ | Transcode job queue (on Redis) |
| sharp | Cover-art resized variants |
| livekit-server-sdk | Voice/video room tokens + management |
| web-push | Web push notifications |
| zod | Request validation |
| pino | Structured logging |

### Relay (Rust)
| Crate | Purpose |
|-------|---------|
| axum 0.8 | HTTP + WebSocket server |
| tokio | Async runtime |
| sqlx 0.8 | PostgreSQL async driver (SQLite too, behind the `embedded` feature) |
| secp256k1 0.30 | Schnorr signature verification |
| sha2 | SHA-256 for event ID computation |
| negentropy 0.5 | NIP-77 set reconciliation |

### Gateway (Go)
| Module | Purpose |
|--------|---------|
| btcsuite/btcd/btcec/v2 | NIP-98 schnorr verification |
| go-redis/v9 | Rate limiting with sliding window |

## Nostr Event Kinds Used

| Kind | NIP | Feature |
|------|-----|---------|
| 0 | NIP-01 | User profiles |
| 1 | NIP-01 | Announcements / short text notes |
| 3 | NIP-02 | Follow lists |
| 5 | NIP-09 | Deletions (message deletes, un-react) |
| 6 | NIP-18 | Reposts |
| 7 | NIP-25 | Reactions |
| 9 | NIP-C7 | Chat messages (also music shelf posts in space music channels) |
| 20 | NIP-68 | Picture posts |
| 21 | NIP-71 | Landscape videos |
| 22 | NIP-71 | Portrait/reel videos |
| 34235 | NIP-71 | Addressable landscape videos |
| 34236 | NIP-71 | Addressable reel videos |
| 30023 | NIP-23 | Long-form articles |
| 1068 / 1018 | NIP-88 | Polls / poll responses |
| 1111 | NIP-22 | Comments (rendered when embedded; no comment UI yet) |
| 1984 | NIP-56 | Reports (ingested by the backend into the moderation queue) |
| 30311 | NIP-53 | Live streams (indexed; no player UI yet) |
| 1311 | NIP-53 | Live chat (used in voice/video channels) |
| 30312 / 10312 | NIP-53 | Interactive room metadata / room presence (voice channels) |
| 1059 | NIP-17 | Gift wraps (encrypted DMs, friend requests, call invites, group rooms) |
| 13 | NIP-17 | Seals (intermediate encryption layer) |
| 14 / 15 | NIP-17 | Rumors: DM message / encrypted file message |
| 20014 / 20015 | Custom | DM typing indicator / delivered + read receipts (gift-wrapped rumors; see `docs/DM_WIRE_CONTRACT.md`) |
| 20016 | Custom | Call / voice-channel E2EE sender-key envelope (gift-wrapped; see `docs/E2EE_CALLS.md`) |
| 20017 | Custom | Shared music project key (gift-wrapped) |
| 10050 | NIP-17 | DM inbox relays |
| 9734 | NIP-57 | Zap request (sent to LNURL callback, not relays) |
| 9735 | NIP-57 | Zap receipt |
| 13194 | NIP-47 | NWC wallet info / capabilities |
| 23194 | NIP-47 | NWC request (pay_invoice, get_balance, …) |
| 23195 | NIP-47 | NWC response |
| 23196 / 23197 | NIP-47 | NWC notifications (nip04 legacy / nip44_v2) |
| 24133 | NIP-46 | Remote signer (bunker) request/response |
| 30078 | NIP-78 | App data: channel layout + relay-set overlays (decentralized spaces); NIP-44 self-encrypted music library + folder sync |
| 10000 | NIP-51 | Mute lists |
| 10001 | NIP-51 | Pinned notes |
| 10002 | NIP-65 | Relay lists |
| 10009 | NIP-51 | User group memberships |
| 10030 / 30030 | NIP-51 / NIP-30 | User emoji list / custom emoji sets |
| 10063 | NIP-B7 | Blossom server list |
| 22242 | NIP-42 | Client auth (relay challenge/response) |
| 24242 | BUD-01 | Blossom blob auth tokens |
| 27235 | NIP-98 | HTTP auth (gateway) |
| 39000 | NIP-29 | Group metadata |
| 39001 | NIP-29 | Group admins |
| 39002 | NIP-29 | Group members |
| 9000-9022 | NIP-29 | Group moderation (put/remove user, metadata edits, 9005 delete event, create group, invites, join/leave) |
| 20900 | Custom | Backend nudge: a platform space's config changed |
| 31683 | Custom | Music track metadata |
| 33123 | Custom | Music album / project |
| 30119 | Custom | Music playlist (a published folder) |
| 31685 | Custom | Music proposals + listen (access) requests |
| 31686 | Custom | Music track notes (timestamped annotations) |
| 30000 | NIP-51 | Follow sets (favorite artists) |
| 30003 | NIP-51 | Bookmark sets (liked tracks) |

Music kinds are specified in [docs/nips/NIP-XX-Music-Events.md](./docs/nips/NIP-XX-Music-Events.md). NIP-66 relay monitors (30166), NIP-72 communities (34550) and starter packs (39089) are on the roadmap and not used yet.

## Development Phases

### Phase 1: Foundation -- COMPLETE

Core relay connection, chat, basic media playback, identity.

- Tauri + React app shell with sidebar/center/right layout
- NIP-07 login + Tauri native keystore (OS keychain signing in Rust)
- Multi-relay WebSocket manager with NIP-65 relay discovery
- Subscription manager with full REQ/CLOSE/EOSE lifecycle
- Event dedup (Bloom filter + LRU at the time; now a single 100k-entry LRU in `@ishtarservices/core`), signature verification (Web Worker)
- IndexedDB cache with TTL eviction, Redux normalized store
- Kind:0 profile display and edit with publish
- Kind:9 chat (NIP-C7) with optimistic UI, reply threading
- NIP-29 Spaces UI (join, channels, member list)
- Kind:21/22 video playback (HLS via hls.js)
- Kind:30023 long-form article rendering (Markdown + GFM + syntax highlight)
- Relay status display, reconnection with exponential backoff + jitter

### Phase 2: Backend Services -- COMPLETE

Custom relay, backend API, gateway, infrastructure.

- Custom Rust NIP-29 relay (axum + tokio + sqlx) with NIP-01/29/42/50 support
- Relay `query_events()` with dynamic filter-based SQL (ids, authors, kinds, since, until, tag filters)
- Relay live event broadcasting via `tokio::sync::broadcast` to all connected subscribers
- Relay identity keypair for signing kind:39000/39001/39002 group metadata events
- Node.js/Fastify backend with 11 route modules, 10 service modules, 5 background workers
- Go API gateway with NIP-98 auth verification, Redis rate limiting, CORS, reverse proxy
- PostgreSQL dual-schema design (`relay` schema for events/groups, `app` schema for business logic)
- Redis for rate limiting (gateway) and caching/trending (backend)
- Meilisearch for full-text search with auto-initialized `events` and `profiles` indexes
- Docker Compose for local development stack
- `@ishtarservices/shared-types` workspace package for shared TypeScript types
- RBAC permission system with enforcement on write routes (invites, content, push)
- Space directory with pagination, invite system, push notification infrastructure
- `relayIngester` worker: full event indexing pipeline (profiles, chat, reactions, zaps, memberships, group metadata) into PostgreSQL + Redis + Meilisearch
- `trendingComputer` worker: engagement scoring (zaps, reactions, views, comments, time decay) across 4 periods (1h/6h/24h/7d)
- `profileRefresher` worker: stale profile re-fetch from relay every hour
- `notificationDispatcher` worker: WebPush delivery with VAPID auth
- `analyticsAggregator` worker: daily rollup of space activity and member engagement
- `feedService.getPersonalized()`: follow-graph boosting (6x), mute filtering, Redis ZSET caching
- Client API layer (`client/src/lib/api/`): NIP-98 auth header construction, typed endpoint modules for spaces, invites, search, feeds, profiles, push, analytics, content

### Phase 3: Music and Media -- COMPLETE

Full music library, playback, upload, search, and discovery system.

**Client (~25 new files in `client/src/features/music/`):**
- Music event parsers for kinds 31683 (track), 33123 (album), 30119 (playlist) with `imeta` tag reuse
- Full Redux `musicSlice` with normalized catalogs, player transport, library state, discovery feeds
- Event pipeline integration: music kinds indexed on receipt, routed to Redux store
- Event builders for publishing track, album, and playlist events
- HTML5 Audio playback engine: module-level singleton, Media Session API integration, ~4Hz position updates
- Fisher-Yates queue shuffle, repeat modes (none/one/all), volume with x^3 perceptual curve
- PlaybackBar (72px fixed transport bar): track info, shuffle/skip/play/repeat controls, progress slider, volume, queue toggle
- QueuePanel: right-side panel showing current queue with remove/reorder
- MusicSidebar navigation: Home, Recently Added, Artists, Albums, Songs, Playlists, Upload
- Sidebar mode toggle (spaces vs music) with independent navigation
- MusicRouter with keep-alive pattern (CSS display:none for inactive views, lazy mount)
- 9 view pages: MusicHome (trending/recent discovery), SongList, AlbumGrid, ArtistList, PlaylistList, ArtistDetail, AlbumDetail, PlaylistDetail, RecentlyAdded
- Display components: TrackCard (grid), AlbumCard (grid), TrackRow (table row with hover play)
- Memoized selectors via `createSelector` for all music data access
- Library management hook (save/unsave tracks, follow/unfollow artists) -- local Redux state, NIP-51 publish planned
- Music search with debounced input, abort controller, parallel track+album queries
- Upload modals: UploadTrackModal, CreateAlbumModal, CreatePlaylistModal with file upload + event publish
- `#music` space channel integration (SpaceMusicView component)
- Search bar in TopBar (context-aware: music search when in music mode)

**Backend:**
- Music file upload routes: `POST /music/upload` (audio, max 100MB) and `POST /music/upload/cover` (images, max 10MB)
- `musicService` with SHA-256 computation, MIME validation, disk storage, Drizzle ORM persistence
- `music_uploads` table in `app` schema (Drizzle + SQL migration)
- `@fastify/multipart` for multipart form upload handling
- `relayIngester` expanded: subscribes to kinds 31683/33123/30119, indexes tracks and albums into Meilisearch
- `trendingComputer` expanded: scores music tracks and albums, Redis sorted sets `trending:music:tracks` / `trending:music:albums`
- Meilisearch `tracks` and `albums` indexes with searchable (title, artist, genre), filterable (pubkey, genre), sortable (created_at)
- `searchService.searchMusic()` method and `GET /search/music` endpoint

**Relay:**
- Music event validation fixed: tag-based validation (checks `title` and `d` tags) instead of content-based validation

**Deferred from Phase 3 (status as of v0.7.2):**
- FFmpeg transcoding: **shipped for music audio.** BullMQ `transcodeWorker` produces 128k + 256k AAC HLS (fMP4) with single-pass `loudnorm` to -14 LUFS. Still open: video transcoding, two-pass loudness measurement. See Phase 14.
- Blossom storage: **shipped** (Phase 6), plus user-chosen media servers and kind:10063 server lists.
- NIP-44 private playlists: **shipped differently.** Playlists became folders, synced across devices as NIP-44 self-encrypted kind:30078 docs; publishing a folder writes a public kind:30119. Private tracks and albums use NIP-44 content. There's no playlist encrypted to other people yet.
- NIP-57 zaps + NIP-47 NWC: **shipped** (Phase 10). Zap splits are still open (Phase 14).
- NIP-22 comments: **not started.** Track annotations use the custom kind:31686 instead. See Phase 14.

### Phase 4: Spaces, DMs, Notifications & Social -- COMPLETE

Custom channels, roles/permissions, moderation tools, Space Settings UI, encrypted DMs, notification system, friend requests.

**Backend (3 new route modules, 3 new services):**
- Channel CRUD: `spaceChannels` table + `channelService` (list, create, update, delete, reorder, seed defaults)
- Role CRUD: `roleService` (list, create, update, delete, reorder, assign, remove, seed defaults, channel overrides, effective permissions)
- Moderation CRUD: `moderationService` (ban, unban, mute, unmute, kick, list active bans/mutes)
- `permissionService` updated: checks bans (auto-deny all) and mutes (auto-deny SEND_MESSAGES) before role permissions
- Routes registered under `/spaces/:spaceId/channels`, `/spaces/:spaceId/roles`, `/spaces/:spaceId/moderation`
- Design constraint: feed-type channels (notes, media, articles, music) limited to one per space; chat channels allow multiples

**Client -- Channels:**
- Dynamic channel list from backend (replaces hardcoded 5 channels)
- `useSpaceChannels` hook with backend fetch, IndexedDB caching, and offline fallback
- `CreateChannelModal` with type selection (disables existing feed types), admin-only toggle, slow mode
- Redux `spacesSlice` extended with `channels` and `channelsLoading` state
- Event pipeline dual-indexes with both `{spaceId}:{channelId}` and legacy `{spaceId}:{type}` format
- `ChannelPanel` resolves channel type from channels array with legacy fallback
- `ChannelHeader` displays channel label and slow mode badge

**Client -- Roles & Permissions:**
- `spaceConfigSlice` for roles, members, permissions, bans, mutes state
- `usePermissions` hook: fetches effective permissions, `can(permission)` check with admin bypass
- `useRoles` hook: CRUD operations for roles
- `useMemberRoles` hook: assign/remove roles from members
- Permission gating: "+" channel button, settings gear, member management gated by backend permissions with local admin fallback

**Client -- Space Settings Modal:**
- Tabbed modal (General, Channels, Roles, Members, Moderation) with glass-panel styling
- General: edit name, description, picture URL
- Channels: ordered list with inline edit, delete (not defaults), add channel button
- Roles: expandable role cards with name, color picker, permission checkboxes grouped (General/Moderation/Admin)
- Members: list with avatar, filter, role management
- Moderation: active bans (with unban) and active mutes (with unmute)

**Client -- Moderation Tools:**
- `useModeration` hook: ban, unban, mute, unmute, kick with Redux state sync
- `MemberContextMenu` popover: View Profile, Mute (5m/15m/1h/24h), Kick (with confirmation), Ban (with reason + confirmation)
- Member list shows "..." context menu button on hover, admin crown icon
- Slow mode display in channel header

**Encrypted DMs (NIP-17):**
- NIP-44 v2 encryption in Tauri keystore (pure Rust: ECDH, HKDF, ChaCha20, HMAC-SHA256)
- Triple-layer gift wrap: kind:1059 → kind:13 seal → kind:14 rumor
- Self-wraps for sent message persistence across sessions
- DM persistence to IndexedDB (200 msgs/conversation, 3000 processedWrapIds cap)
- Auto-updating relative timestamps via shared-interval `useRelativeTime` hook

**Notification System:**
- Client-side evaluation: checks preferences, space mutes, DND, mute lists before dispatching
- Toast stack (max 5, auto-dismiss 6s), bell dropdown with read/unread state
- Browser notifications (when unfocused), notification settings with per-type toggles + DND
- Backend push pipeline: `relayIngester` → `notification_queue` → `notificationDispatcher` → web-push VAPID
- Unread/mention badges on spaces and channels, cleared on navigation

**Friend Request System:**
- Private friend requests via NIP-17 gift wraps with `["type", "friend_request"]` tag
- Friends = accepted request + mutual follow; accepting auto-follows, unfriending auto-unfollows
- Auto-accept when both users have pending requests to each other
- `removedPubkeys` tracking prevents relay re-delivery from resurrecting cleared state
- Friend buttons on profile page, user popover cards, and DM sidebar
- Accept button in notification toast and bell dropdown

### Phase 5: Voice, Video & Calls -- COMPLETE

Real-time voice and video via LiveKit SFU, plus 1:1 DM WebRTC calls.

**Backend:**
- `livekitService`: token generation, room management
- `/voice` routes: `POST /voice/token` (room join), `GET /voice/rooms/:id/participants`, presence helpers
- LiveKit service added to `docker-compose.yml` (port 7880, TURN on 7881/7882)
- `config/livekit.yaml` for SFU configuration

**Client -- Voice/Video Channels (spaces):**
- `voice` and `video` channel types added to `SpaceChannelType`
- `VoiceChannel.tsx`, `VoiceStage.tsx`, `VoiceControls.tsx` on the shared `features/media/` stage
  (`MediaStage`, fitted `computeGridLayout`, focus/pin, screen-share tiles, stable tile order)
- `useVoiceChannel`, `useVoiceTiles`, `useVoiceRoomPresence` hooks; `devices/` (mic/camera/speaker
  picker, persisted in `lib/webrtc/mediaPrefs.ts`, Settings › Voice & Video)
- Per-user volume / local mute, moderator kick + server mute from the tile toolbar
- Keep-alive pattern: voice session persists across channel navigation
- Voice status bar, voice channel preview, "You're sharing your screen" pill

**Client -- DM Calls (1:1, SFU-first):**
- Invite over NIP-17 gift wrap (`call_invite` with `transport: "sfu"`); both parties join the
  private LiveKit room `dm:<roomId>` — no P2P/ICE negotiation over relays
- `callService` (invite/answer/hangup on the shared room), `CallController` (floating / expanded /
  minimized panel, draggable PiP), `CallControls`, `IncomingCallBanner`, `callRingtone` (ring + ringback)

### Phase 6: Blossom Blob Storage -- COMPLETE

Content-addressed decentralized file storage built into the Fastify backend.

- **BUD-01:** `GET/HEAD /<sha256>` blob retrieval with protected blob access
- **BUD-02:** `PUT /upload`, `DELETE /<sha256>`, `GET /list/<pubkey>`
- **BUD-06:** `HEAD /upload` preflight
- **BUD-11:** Kind 24242 auth tokens (signed Nostr events)
- `app.blossom_blobs` table (migration 0018): SHA-256 keyed, visibility flags, owner pubkey
- Client `lib/api/blossom.ts` + `blossomAuth.ts` for kind-24242 signed uploads
- Music uploads now write through Blossom storage layer (content-addressed)

### Phase 7: Discovery & Onboarding -- COMPLETE

**Discover page (`/discover`):**
- Originally four tabs (Spaces, Relays, Communities, People). Rebuilt in v0.7 as three segments, **Spaces, Music, People**, with a right-panel space preview. The Relays tab was retired and the Communities tab was never populated.
- Featured spaces (horizontal scroll), trending section, category chip filter, browse-all with search
- `app.listing_requests`, `app.space_categories` (11 seeded), `app.relay_directory` tables
- `discoveryService`: browse, featured, categories, listing submission/review, relay directory
- `discoveryScoreComputer` worker (every 15 min): `members*2 + active24h*5 + messages24h + recency` scoring, auto-delist inactive spaces
- `ADMIN_PUBKEYS` bypass, `MIN_LISTING_MEMBERS=5`, auto-approve path for 20+ members & 7+ days
- `GET /discovery/spaces|spaces/featured|categories|relays`, `POST/PATCH /discovery/listing-requests`

**Onboarding:**
- `ProfileWizard` (display name, about, picture)
- `AppTour` guided tour with `tourSteps`
- `WelcomeChecklist` per-space new-member flow
- `app.onboarding_state` table (migration 0016)

**Friends Feed (virtual space):**
- `FRIENDS_FEED_ID` sentinel, subscribes to kind:1/20/21/22/30023 from follow list
- Cross-indexes notes with media URLs into media feed
- Pull-to-refresh and load-more pagination

**Multi-account support:**
- `AddAccountModal` for adding secondary accounts
- Per-pubkey IndexedDB cache isolation
- Account switcher in identity menu

### Phase 8: Music System Overhaul -- COMPLETE

Expanded from basic upload/playback into a full artist + release workflow.

- **Revisions (`app.music_revisions`):** Track-level revision history with release notes
- **Proposals (`app.music_proposals`):** Draft edits submitted for approval (collaborative editing)
- **Saved versions (`app.saved_album_versions`):** The version of a saved track/project a fan has; the ingester flags `has_update` only for a strictly newer event (and records it in `latest_*`), the client derives "Update Available" from saved-vs-newest-known, and a `music_update` notification (toggleable via the `musicUpdates` preference) fires in-app and as a server push to every fan whose saved row was flagged (never the author, one per address per day)
- **Annotations:** Track-anchored comments (like SoundCloud) -- `AnnotationCard`, `AnnotationsPanel`
- **Insights (`/insights`):** Artist dashboard with play counts, listener metrics, chart components
- **Plays tracking (`app.music_plays`, migration 0014):** Per-user listening history
- **Genre taxonomy:** Curated genre list with `GenrePicker` and `GenreCard`
- **Visibility:** Public / private / unlisted per track with `VisibilityPicker`
- **Featured artists:** Multi-artist attribution via `FeaturedArtistsInput`
- **Listen Together:** Synced playback sessions (DJ model, vote-skip, reactions, volume balance)
- **Music-first spaces:** Curated music channels, `SpaceMusicView`, `SpaceAlbumDetail`
- **Music links:** In-chat music embed resolution (`MusicLinkResolver`, `MusicPostModal`)
- **Hashtag support:** `HashtagInput` for track tagging
- **Downloads:** `useDownload` hook + cache layer (`audioCache`)
- **Duplicate detection:** SHA-256 based `DuplicateTrackModal`
- **Waveform rendering:** `useWaveform` hook for progress bar

### Phase 9: Theming, Polish & Infrastructure -- COMPLETE

- **Theme engine:** Preset-based (`styles/` tokens + `ThemeQuickPicker`), background component, runtime switching
- **Native titlebar overlay:** macOS native titlebar for frameless feel
- **Auto-updater:** Tauri updater with branded overlay, runs on startup
- **GitHub Releases CI:** Multi-platform builds (macOS, Windows, Linux ARM/x64) + signed updates
- **NIP-05 identities:** `app.nip05_identities` table (migration 0017), `.well-known/nostr.json` route
- **Custom branding:** Logo assets, landing page (Astro), redesigned with JetBrains Mono
- **Resizable panels:** Drag handles between Sidebar / Center / RightPanel
- **Collapsible sidebar:** Compact + expanded modes
- **Space mode:** `read-write` vs `read` (community vs feed)
- **Saved invite cards:** Invite links persisted and rendered as rich cards in DMs
- **Comprehensive test suite:** 229 client Vitest + 49 gateway Go + 33 relay Rust + backend Fastify-inject + Playwright E2E at the time (see [Testing](#testing) for current sizes)
- **Path-based CI:** Docker image builds gated on test success, diff against last successful build

### Phase 10: Wallet, Zaps & Remote Signing -- COMPLETE

- **NIP-46 remote signing (bunker):** `nip46Signer` over nostr-tools `BunkerSigner`, signer-aware signing queue, NIP-44 DMs routed through the bunker, restore-on-restart (longer signing timeout for manual approval)
- **Wallet & Zaps:** hand-rolled NIP-47 NWC client (`lib/lightning/nwcClient.ts`) + NIP-57 zaps (`lib/lightning/zap.ts`, `lnurl.ts`) wired into every author surface (notes, chat, articles, video, profiles); multi-wallet settings; `walletSlice`; `ZapModal` + live zap totals
- **Multi-account login** (`AddAccountModal`) + shared OS-keychain secret store for bunker URIs and NWC config (new Rust `keystore_*_secret` commands)
- **process-compose dev orchestration** (`pnpm dev`) + native LiveKit
- **`wiredDebug` structured logging** (logger / perfMonitor / profileTracker / NavigationLogger)

### Phase 11: Decentralized & Self-Hosted Spaces -- COMPLETE

Self-hostable NIP-29 spaces across all layers. See [docs/DECENTRALIZED_SPACES.md](./docs/DECENTRALIZED_SPACES.md).

- **Three space modes** side by side, gated by one client predicate: **Platform** (backend-backed), **Decentralized A-lite** (Platform space on a creator-chosen relay), **NIP-29-native** (relay-only, no backend)
- **Embedded SQLite relay** running in-process inside Tauri (`relay_start/stop/status/stats`), loopback by default, stable port **7787**; relay signing identity in the OS keychain
- **Cloudflare tunnels** (`cloudflared` downloaded-on-enable, signature + `codesign` verified): default `<id>.relay.thewired.app` (backend-provisioned), quick `*.trycloudflare.com`, or custom `wss://`; plus LAN-bind
- **NIP-29-native create + import** (`ImportSpaceModal`: `host'groupId` / `naddr` / `nostr:` / deep link); 39000/39001/39002 synthesized into the same Redux slices as the backend path
- **Backend** `relayConnectionManager` (multi-relay ingestion, SSRF guard, tiered discovery) + `ingestHandlers` **replace the single `relayIngester` worker**; `relayRegistrationService` + `cloudflareTunnelService`; routes `spaceRelays` + `relayTunnels`; migrations 0024/0025
- **Relay:** SQLite backend + group store, membership-source abstraction, `is_private` gating, NIP-42 AUTH relaxation for hosted relays, tag-columns migration
- **NIP-17 group rooms** engine (`nip17Room.ts`, now in `@ishtarservices/core`) shipped + tested, and the UI followed with DM wire v1: New DM → Room mode (2–9 people, optional subject), room rendering and typing counts in the DM sidebar and conversation ([docs/NIP17_GROUP_ROOMS.md](./docs/NIP17_GROUP_ROOMS.md))

### Phase 12: AI Engine -- COMPLETE

Toggleable AI assistant (Settings → Features, default off). See [docs/AI_ENGINE.md](./docs/AI_ENGINE.md).

- **AI** tab: conversation sidebar + streaming chat center, per-account IndexedDB conversation store
- **3-tier engine** behind one OpenAI-compatible adapter: detect local (Ollama / LM Studio) · managed `llama-server` (planned) · cloud keys (Claude / OpenAI / OpenRouter / DeepSeek / Kimi)
- **Streaming** SSE normalized to a single `ChatChunk` contract; block-memoized markdown, `<think>` reasoning panel, token usage, copy/regenerate
- **Agentic tool use:** read tools auto-run (results framed untrusted); write tools are human-gated via `PendingWriteCard` (agent never touches the signer); `web_search` tool (BYO Tavily/Brave/Exa key)
- **Artifacts panel:** charts (recharts, lazy), tables, documents — a deterministic projection of message text
- **"Ask AI" context chips** across notes, threads, DMs, profiles, spaces; **publish-out** (note / article / space / DM)
- **Keys never in Redux** — OS keychain + `llmManager` memory only

### Since v0.6.0 (v0.6.1 – v0.7.2) -- COMPLETE

Work that shipped after the phase plan above was written.

**Content & social**
- **Article authoring:** rich Tiptap editor, cover images, local drafts, public or space-exclusive articles
- **NIP-88 polls** in feeds and chat, including polls whose options are tracks
- **Inline note embeds** and a note share menu (copy link, forward to DM, share to space)
- **Reactions + un-react** (kind:5), DM reactions; zaps on every author surface (v0.6.1)

**DMs & calls**
- **DM wire contract v1** ([docs/DM_WIRE_CONTRACT.md](./docs/DM_WIRE_CONTRACT.md)): relay NIP-42 AUTH gate for gift wraps, NIP-40 expiry, **NIP-77 negentropy** inbox sync, typing indicators, delivered/read receipts, sending/sent/failed state, group rooms UI
- Friend-request state syncs across devices
- **Call system overhaul:** SFU-first DM calls in private LiveKit rooms, shared `MediaStage` layout, device selection
- **Frame-level E2EE** for 1:1 calls and voice channels ([docs/E2EE_CALLS.md](./docs/E2EE_CALLS.md))

**Music**
- **One visibility policy** (public / space / private / unlisted / catalog-hidden) across relay, backend and desktop; multi-space music events (read if a member of any listed space, publish only if a member of all) ([docs/MUSIC_VISIBILITY.md](./docs/MUSIC_VISIBILITY.md))
- **Gated playback:** short-lived media tokens for private and space-only blobs and HLS, HTTP range/ETag, resized cover-art variants (`?w=`)
- **Library + folder sync** across devices; folders replace playlists ([docs/MUSIC_LIBRARY_SYNC.md](./docs/MUSIC_LIBRARY_SYNC.md))
- **Co-owned projects** via shared project keys; **listen requests** (request access to locked tracks, owner inbox, grants)
- Space music channels as shelves; trustworthy "Update Available" with a `music_update` push

**Media storage** ([docs/MEDIA_STORAGE.md](./docs/MEDIA_STORAGE.md)): uploads stay on The Wired's own server instead of a third-party host, members-only space media, user-chosen media servers

**Discover & spaces**
- Discover rebuilt around Spaces / Music / People, with zap and people ranking
- Space edits persist and admin changes sync across clients; space admins manage feed sources; moderator deletes (kind:9005) are offered only where peers apply them

**Trust, safety & platform**
- **User reports** (NIP-56 events + in-app), admin review queue, platform suspensions and restores, operator CLI (`pnpm reports:*`)
- **Account deletion**
- Open Graph share pages for music and profile links
- Legal pages on the landing site (privacy, terms, DMCA, community guidelines)
- Shared protocol code published to npm as `@ishtarservices/core` + `@ishtarservices/shared-types`
- Security audit remediation (June 2026), per-request NIP-98 nonces, keystore fallback hardening

### Phase 13: Discovery UX & Polish -- IN PROGRESS

See [DISCOVER_REMAINING_PHASES.md](./docs/DISCOVER_REMAINING_PHASES.md) for the original plan. Status as of v0.7.2:

**Shipped**
- **Right-panel preview:** clicking a space opens a preview with Join / Go to Space (the relay preview went away with the Relays tab)
- **Listing request UI:** Space Settings → General → Discovery (category, submit, pending/listed state). The admin review UI is still missing.
- **Audit log:** moderation actions in the Space Settings Moderation tab. Unmute and role changes are not logged yet.

**Partial**
- **Join from Discover:** only from the preview panel; list rows have no Join button or joined badge
- **People segment:** NIP-05 browse, search and follow. No starter packs (kind:39089) or 2-hop follow suggestions.
- **Trending / personalized feeds:** music trending has UI; the generic `/feeds/trending` and `/feeds/personalized` endpoints have none
- **NIP-77 negentropy:** relay and client support it, but only the DM inbox uses it; channel and feed reconnects don't
- **Announcement channels:** the `admin_only` flag, badge and read filter exist; posting is not enforced on the relay or in the composer
- **Custom emoji per space:** the picker, emoji reactions and emoji tags on send work, but the emoji-set subscription and `EmojiSetManager` are not mounted
- **NIP-53:** live chat runs inside voice/video channels; there's no live-stream channel or player UI

**Not started**
- **Meilisearch spaces index:** space search still uses SQL `ILIKE`
- **Relay directory worker:** NIP-66 monitor ingestion + NIP-11 probing (the table and read route exist; nothing writes to them)
- **`ingestHandlers`** for kind:10002 (relay usage counts) and kind:34550 (communities)
- **Communities:** NIP-72 moderated communities
- **"Friends Are In":** spaces your follows are members of
- **Command palette (Cmd+K):** global search overlay
- **Pinned messages panel:** only a backend `POST /spaces/:id/pin` stub exists
- **Auto-mod:** keyword filters, spam detection
- **Anti-raid protection:** join-rate limits, lockdown. Slow mode is displayed but not enforced.
- **Forum-style threads**

### Phase 14: Monetization & Ecosystem -- TODO

**Done since this list was written**
- **Audio transcoding:** multi-bitrate HLS with -14 LUFS normalization (see Phase 3)
- **Private music collections:** NIP-44 self-encrypted folders and private releases (see Phase 3)

**Remaining**
- **NIP-57 zap splits** and zaps tied to tracks/albums. Music zaps currently go to the artist's profile; with several artists you pick one, and the zap isn't split.
- **NIP-22 comments** on tracks, videos, articles
- **Collaborative / shared playlists.** Co-owned album projects shipped via shared project keys, but folders are single-owner.
- **Video transcoding** and two-pass loudness measurement
- **NIP-89 app handler registration**
- **Plugin/extension API**
- **Monitoring** (Prometheus + Grafana; today there are only health endpoints)
- **`spamService` reputation model** (the table and service exist with no callers) and rate anomaly detection

## License

MIT. See [LICENSE](./LICENSE). The brand assets in `services/landing/soot/` are excluded; see that directory's `NOTICE`.
