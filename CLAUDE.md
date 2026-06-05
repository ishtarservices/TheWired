# CLAUDE.md -- Project Instructions for Claude Code

## Project Overview

The Wired V1 is a decentralized Nostr-native media platform. The repo is a **pnpm monorepo** with:

| Service | Language | Port | Directory |
|---------|----------|------|-----------|
| Client | TypeScript/React/Tauri | 1420 | `client/` |
| Relay | Rust (axum + tokio + sqlx) | 7777 | `services/relay/` |
| Backend | Node.js/TypeScript (Fastify + Drizzle) | 3002 | `services/backend/` |
| Gateway | Go (NIP-98 auth + rate limiting) | 9080 | `services/gateway/` |
| Shared Types | TypeScript | - | `packages/shared-types/` |
| Landing | Astro + React | - | `services/landing/` |
| Proxy | Caddy (prod) | - | `services/proxy/` |

Infrastructure: PostgreSQL (5432), Redis (6380), Meilisearch (7700), LiveKit (7880) via `docker-compose.yml`.

The Rust relay also compiles to an **embedded SQLite** build (Cargo `embedded` feature) that runs in-process inside the Tauri client (port 7787) for self-hosted spaces — see `client/src-tauri/src/relay.rs`.

## Build & Development

```bash
pnpm install              # Install all workspace dependencies (from root)
pnpm dev                  # PRIMARY: full backend stack via process-compose TUI
                          #   (infra + native LiveKit + relay + backend + gateway, health-gated)
pnpm dev:client           # Vite dev server (web only, port 1420) — run in its own terminal
pnpm dev:backend          # Backend service with tsx watch
pnpm dev:gateway          # Go gateway
pnpm dev:relay            # Rust relay
pnpm dev:infra            # Start Postgres + Redis + Meilisearch + LiveKit (Docker, detached)
pnpm dev:services         # Start all Docker services
pnpm dev:down             # Stop the process-compose app processes (infra stays up)
pnpm build                # Build all packages
pnpm typecheck            # Typecheck all TypeScript packages
```

`pnpm dev` is the recommended path (one scrollable log pane per process, dependency ordering). The
client runs separately (`pnpm dev:client` or `cd client && pnpm tauri dev`). See README §Setup for the
process-compose TUI cheatsheet.

### Client (Tauri)

```bash
cd client && pnpm tauri dev    # Full Tauri desktop app with hot reload
cd client && pnpm tauri build  # Production desktop app bundle
```

### Type Checking

```bash
pnpm typecheck                           # All packages
pnpm --filter @thewired/client typecheck # Client only
pnpm --filter @thewired/backend typecheck # Backend only
```

### Rust (Relay)

```bash
cd services/relay && cargo check   # Check Rust compilation
cd services/relay && cargo build   # Build Rust binary
```

### Rust (Client Tauri)

```bash
cd client/src-tauri && cargo check   # Check Rust compilation
cd client/src-tauri && cargo build   # Build Rust binary
```

**Warning**: `cargo` commands change cwd. Use absolute paths for subsequent commands.

## Monorepo Structure

```
/
├── client/                    # Tauri + React client app
│   ├── src/                   # React source
│   ├── src-tauri/             # Rust Tauri backend
│   ├── package.json           # @thewired/client
│   ├── tsconfig.json          # Extends ../tsconfig.base.json
│   └── vite.config.ts
├── packages/
│   └── shared-types/          # @thewired/shared-types (type-only package)
│       └── src/               # nostr.ts, space.ts, profile.ts, api.ts, permissions.ts, music.ts
├── services/
│   ├── backend/               # @thewired/backend (Fastify + Drizzle + PostgreSQL)
│   │   └── src/               # routes/, services/, workers/, db/, middleware/, lib/
│   ├── gateway/               # Go API gateway (NIP-98 + rate limiting)
│   │   └── internal/          # auth/, ratelimit/, proxy/, cors/, logging/
│   ├── relay/                 # Rust NIP-29 relay (axum + sqlx; pg + embedded sqlite)
│   │   └── src/               # nostr/, protocol/, db/, music/
│   ├── landing/               # Astro marketing site
│   └── proxy/                 # Caddy production proxy config
├── config/livekit.yaml        # LiveKit SFU config
├── docs/                      # Design notes, plans, roadmaps (AI_ENGINE, DECENTRALIZED_SPACES, …)
├── docker-compose.yml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json               # Root workspace scripts
├── CLAUDE.md
└── ARCHITECTURE.md
```

## Client Structure (`client/src/`)

- `app/` -- App root, layout, routing
- `components/layout/` -- Shell components (Sidebar, CenterPanel, RightPanel, TopBar)
- `components/ui/` -- Shared primitives (Button, Avatar, Spinner)
- `features/` -- Feature modules, each self-contained (key ones; see the tree in ARCHITECTURE.md for the full list):
  - `chat/` -- Kind:9 real-time chat with optimistic UI
  - `identity/` -- Login, multi-account switcher, signer detection
  - `dm/` -- NIP-17 encrypted DMs, contacts, friend requests
  - `spaces/` -- NIP-29 spaces, channels, members, moderation; **three space modes** (see below)
  - `music/` -- Music library, player, upload (kinds 31683/33123/30119)
  - `voice/` + `calling/` -- LiveKit voice/video channels + 1:1 DM WebRTC calls
  - `ai/` -- Toggleable AI assistant: engine, providers, gated tools, artifacts (see below)
  - `wallet/` -- NIP-47 NWC wallet + NIP-57 zaps
  - `longform/`, `media/`, `profile/`, `relay/`, `discover/`, `notifications/`, `settings/`, `onboarding/`
- `lib/nostr/` -- Core Nostr protocol layer:
  - `relayManager.ts` -- Multi-relay WebSocket orchestrator (singleton)
  - `relayConnection.ts` -- Single WebSocket wrapper per relay
  - `subscriptionManager.ts` -- REQ/CLOSE/EOSE lifecycle (singleton)
  - `eventPipeline.ts` -- Dedup + validate + verify + dispatch + feature routing
  - `dedup.ts` -- LRU deduplication (100k-entry `lru-cache`, zero false positives, supports `unmarkSeen` for retry)
  - `verifyWorkerBridge.ts` -- Main-thread bridge to Web Worker
  - `signer.ts` / `nip46Signer.ts` -- NostrSigner interface + factory; NIP-46 bunker backend
  - `secretStore.ts` -- transport-secret helpers (bunker URIs, NWC config, LLM keys) over the OS keychain
  - `giftWrap.ts` / `nip44.ts` / `nip17Room.ts` -- NIP-17 gift-wrap crypto (DMs, friend reqs, call signaling, group rooms)
  - `nip65.ts`, `filterBuilder.ts`, `channelRoutes.ts`, `publish.ts`
- `lib/lightning/` -- `zap.ts`, `lnurl.ts` (NIP-57), `nwcClient.ts` (NIP-47 NWC)
- `lib/relay/embeddedRelay.ts` -- Control surface for the in-process Tauri SQLite relay
- `lib/db/` -- IndexedDB persistence (idb wrapper):
  - `database.ts` -- Schema definition, DB open/upgrade (versioned; per-account `thewired_<pubkey>` DBs)
  - `eventStore.ts`, `profileStore.ts`, `subscriptionStore.ts`, `userStateStore.ts`, `aiConversationStore.ts`
  - `eviction.ts` -- TTL + LRU cache eviction
- `store/` -- Redux store with 20 slices (identity, relays, spaces, spaceConfig, events, feed, music, dm, friendRequest, notification, reactions, wallet, ai, features, voice, call, emoji, gif, listenTogether, ui)
- `types/` -- Client TypeScript types (nostr, profile, space, chat, media, relay, ai, …)
- `workers/verifyWorker.ts` -- Web Worker for SHA-256 + schnorr verification

## Backend Structure (`services/backend/src/`)

- `routes/` -- Fastify route handlers (spaces, channels, roles, members, moderation, permissions, invites, search, feeds, discovery, push, notifications, analytics, insights, content, profiles, music, proposals, revisions, onboarding, nip05, blossom, gif, voice, **spaceRelays, relayTunnels**, hls, health)
- `services/` -- Business logic (spaceDirectory, channel, role, moderation, permission, invite, search, feed, discovery, push, notificationEnqueue, analytics, spam, content, music, revision, proposal, onboarding, livekit, gif, profileCache, **relayRegistration, cloudflareTunnel**)
- `workers/` -- Background jobs. **`relayConnectionManager` + `ingestHandlers` replaced the old `relayIngester`** (multi-relay ingestion: platform relay + every registered decentralized-space relay). Plus `trendingComputer`, `profileRefresher`, `notificationDispatcher`, `analyticsAggregator`, `discoveryScoreComputer`, `transcodeWorker`.
- `db/schema/` -- Drizzle ORM table definitions (in `app` PostgreSQL schema)
- `db/migrations/` -- SQL migrations (currently through `0025`)
- `middleware/` -- authContext (X-Auth-Pubkey extraction), errorHandler
- `lib/` -- Redis client, Meilisearch client, Nostr event verifier, `relayUrlGuard` (SSRF guard for BYO relays)

## Gateway Structure (`services/gateway/internal/`)

- `auth/` -- NIP-98 (kind:27235) verification + middleware
- `ratelimit/` -- Redis sliding-window per-pubkey rate limiting
- `proxy/` -- Reverse proxy to backend (strips `/api` prefix)
- `cors/` -- CORS middleware
- `logging/` -- Request logging middleware

## Relay Structure (`services/relay/src/`)

- `nostr/` -- Event types, filter matching, schnorr verification, NIP-29 handlers
- `protocol/` -- WebSocket message routing (REQ/EVENT/CLOSE/AUTH), subscription management, NIP-42, NIP-50
- `db/` -- **Two backends behind a `Db` enum**: PostgreSQL (`event_store.rs`, `group_store.rs`) and embedded SQLite (`sqlite.rs`, `sqlite_groups.rs`, `embedded` Cargo feature). `membership_source.rs` abstracts membership authority (relay-native vs backend). Parity-tested in `tests/db_parity.rs`.
- `music/` -- Custom music event kind handling

## Key Architecture Patterns

### Singletons (Client)
`relayManager`, `subscriptionManager`, and `verifyBridge` are module-level singletons. Import and use them directly -- do not instantiate new instances.

### Client Event Flow
Relay message -> `relayConnection` -> `relayManager` routes to callbacks -> `subscriptionManager.onEvent` -> `eventPipeline.processIncomingEvent` (validate -> dedup -> Web Worker verify -> Redux dispatch + index)

### Signer Abstraction (Client)
`NostrSigner` interface with **three** backends (`signerType: "nip07" | "tauri_keystore" | "nip46" | null`):
- `NIP07Signer` -- delegates to `window.nostr` (browser extensions)
- `TauriSigner` -- delegates to Rust IPC commands (OS keychain)
- `Nip46Signer` -- delegates to a remote bunker over nostr-tools `BunkerSigner` (`nip46Signer.ts`); `connect()` must request a broad perms set (incl. `sign_event:<kind>` per kind) or the bunker prompts per signature; longer signing timeout (90s) for manual approval; restored on restart from the keychain secret store.

All signers serialize through a single **signing queue** (so concurrent publishes don't interleave). Use `getSigner()` from `loginFlow.ts`; use `signAndPublish()` from `publish.ts` for the common sign-and-send pattern. When adding a feature that signs, load the `nostr-publishing` skill.

### Toggleable Features
Optional built-ins (AI, self-hosted spaces) are gated by `featuresSlice` flags (default off, Settings → Features) — NOT downloads. Gate new optional surfaces the same way.

### Three Space Modes
Spaces run in three modes side-by-side, gated by one client predicate (`features/spaces/spaceType.ts` → `isBackendBacked`): **Platform** (backend `app.*`), **Decentralized A-lite** (Platform space on a creator-chosen `hostRelay`), **NIP-29-native** (relay-only, no backend). `space.id` IS a NIP-29 group id and chat targets an arbitrary `hostRelay`. See `docs/DECENTRALIZED_SPACES.md`.

### AI Engine (security contracts — do not break)
Toggleable AI assistant in `features/ai/`. 3-tier engine (detect local Ollama/LM Studio · managed `llama-server` · cloud keys) behind one OpenAI-compatible adapter; every backend normalizes to a `ChatChunk` stream. Load-bearing rules:
- **API keys NEVER touch Redux** — only `llmManager` (singleton) memory + the OS keychain (`secretStore`). The `aiSlice` holds non-secret config only.
- **The agent never signs.** Read tools auto-run (results framed untrusted via `frameUntrustedBlock`); write tools register a `PendingWrite` and are signed ONLY on human Approve in `gate/approveWrite.ts`.
- Untrusted model output: `AIMarkdown` scheme-allowlists URLs, no `rehype-raw`; images are click-to-load. See `docs/AI_ENGINE.md`.

### State Management (Client)
- Redux is the single source of truth for all UI state
- `eventsSlice` uses `createEntityAdapter` keyed by event ID
- Secondary indices (`chatMessages`, `reels`, `longform`, `liveStreams`) are `Record<contextId, string[]>` pointing into the entity adapter
- IndexedDB is the persistence layer -- write-through on event receipt, read-first on startup

### Gateway Auth Flow
Client sends `Authorization: Nostr <base64(signed-kind-27235-event)>` -> Gateway verifies schnorr sig, checks created_at within 60s, validates URL/method tags -> injects `X-Auth-Pubkey` header -> proxies to backend.

### Backend Database
Uses Drizzle ORM with PostgreSQL under the `app` schema. Separate from the relay's `relay` schema (both in same Postgres instance).

### Tauri IPC Commands
Registered in `client/src-tauri/src/lib.rs`. Grouped by module:
- **`keystore.rs`** -- key + signing: `keystore_get_public_key`, `keystore_sign_event`, `keystore_has_key`, `keystore_get_secret_key`, `keystore_delete_key`, `keystore_import_key`, `keystore_generate_key`, `keystore_clear_active`; **multi-account**: `keystore_list_accounts`, `keystore_switch_account`; **NIP-44 v2**: `keystore_nip44_encrypt/_decrypt`; **transport secrets** (bunker URIs / NWC / LLM keys): `keystore_set_secret`, `keystore_get_secret`, `keystore_delete_secret`.
- **`relay.rs`** -- embedded SQLite relay: `relay_start`, `relay_stop`, `relay_status`, `relay_stats`, `relay_reset`.
- **`tunnel.rs` / `cloudflared.rs`** -- Cloudflare tunnel: `tunnel_start`, `tunnel_stop`, `tunnel_status`, `tunnel_named_identity`, `tunnel_set_custom`.

## Coding Conventions

- **TypeScript strict mode** -- `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- **Imports (client)** -- Use `@/*` path alias for `src/*` (configured in tsconfig + vite)
- **Imports (backend)** -- Use `.js` extension for ESM imports
- **Styling** -- Tailwind utility classes, no CSS modules. Dark theme colors from `client/src/styles/theme.ts`
- **Components** -- Named exports, function components, hooks prefixed with `use`
- **Feature modules** -- Each feature in `client/src/features/<name>/` is self-contained with components, hooks, selectors, and parsers
- **No default exports** except `App.tsx` (required by React Router)
- **Nostr types** -- `NostrEvent`, `UnsignedEvent`, `NostrFilter` from `client/src/types/nostr.ts` (or `@thewired/shared-types`)
- **Redux hooks** -- Always use `useAppDispatch` and `useAppSelector` from `client/src/store/hooks.ts`

## Nostr Protocol Notes

- Use the `mcp__nostrbook` tools to look up NIP specs, event kinds, and tag definitions
- Event kinds used: 0, 1, 3, 7, 9, 20, 22, 34235/34236, 30023, 30311, 1311, 1059/13/14 (NIP-17), 9734/9735 (NIP-57 zaps), 13194/23194/23195/23196/23197 (NIP-47 NWC), 24133 (NIP-46), 10000, 10002, 10009, 10063, 22242, 24242, 27235, 30078 (NIP-78 — also decentralized-space layout/relay-set overlays), 31683/33123/30119 (music), 39000-39002 + 9000-9022 (NIP-29). Full table in README/ARCHITECTURE.
- Adding a new kind has many touch-points (`EVENT_KINDS`, routes, filterBuilder, `eventPipeline.indexEvent`, slices, render components) — load the `nostr-kind-rendering` skill; a missed step means the event silently never appears.
- Bootstrap relays: `wss://relay.damus.io`, `wss://nos.lol`
- Channel routing is defined in `client/src/lib/nostr/channelRoutes.ts`

## Dependencies of Note

- `lru-cache` -- event dedup (`dedup.ts`) and other bounded caches; construct with `new LRUCache({ max })`
- `hls.js` -- check `Hls.isSupported()` before use; Safari has native HLS
- `idb` -- typed IndexedDB wrapper; schema in `client/src/lib/db/database.ts`
- `nostr-tools` -- protocol utils + NIP-46 `BunkerSigner`. NOTE: `./nip04`/`./nip47` are not exported subpaths; import `nip04`/`nip47` from the package root.
- `livekit-client` -- voice/video SFU client (`features/voice/`)
- `marked` + `highlight.js` -- AI chat markdown + code highlighting; `recharts` -- AI artifact charts (lazy-loaded, code-split — keep it out of the main bundle)
- Tailwind v4 -- uses `@import "tailwindcss"` in CSS, NOT `@tailwind` directives
- Vite Web Workers -- use `new Worker(new URL("...", import.meta.url), { type: "module" })`
