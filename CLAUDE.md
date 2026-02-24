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

Infrastructure: PostgreSQL (5432), Redis (6380), Meilisearch (7700) via `docker-compose.yml`.

## Build & Development

```bash
pnpm install              # Install all workspace dependencies (from root)
pnpm dev:client           # Vite dev server (web only, port 1420)
pnpm dev:backend          # Backend service with tsx watch
pnpm dev:gateway          # Go gateway
pnpm dev:relay            # Rust relay
pnpm dev:infra            # Start Postgres + Redis + Meilisearch (Docker)
pnpm dev:services         # Start all Docker services
pnpm build                # Build all packages
pnpm typecheck            # Typecheck all TypeScript packages
```

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
│       └── src/               # nostr.ts, space.ts, profile.ts, api.ts, permissions.ts
├── services/
│   ├── backend/               # @thewired/backend (Fastify + Drizzle + PostgreSQL)
│   │   └── src/               # routes/, services/, workers/, db/, middleware/
│   ├── gateway/               # Go API gateway (NIP-98 + rate limiting)
│   │   └── internal/          # auth/, ratelimit/, proxy/, cors/, logging/
│   └── relay/                 # Rust NIP-29 relay (axum + sqlx)
│       └── src/               # nostr/, protocol/, db/, music/
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
- `features/` -- Feature modules, each self-contained:
  - `chat/` -- Kind:9 real-time chat with optimistic UI
  - `identity/` -- Login, profile card, signer detection
  - `longform/` -- Kind:30023 Markdown article rendering
  - `media/` -- Kind:22 video playback (HLS via hls.js)
  - `profile/` -- Profile display and edit
  - `relay/` -- Relay connection status panel
  - `spaces/` -- NIP-29 spaces, channels, members
- `lib/nostr/` -- Core Nostr protocol layer:
  - `relayManager.ts` -- Multi-relay WebSocket orchestrator (singleton)
  - `relayConnection.ts` -- Single WebSocket wrapper per relay
  - `subscriptionManager.ts` -- REQ/CLOSE/EOSE lifecycle (singleton)
  - `eventPipeline.ts` -- Dedup + validate + verify + dispatch
  - `dedup.ts` -- Bloom filter + LRU deduplication
  - `verifyWorkerBridge.ts` -- Main-thread bridge to Web Worker
  - `signer.ts` -- NostrSigner interface + factory
  - `nip65.ts` -- Relay list discovery
  - `filterBuilder.ts` -- Nostr filter construction
  - `channelRoutes.ts` -- Channel-to-kind mapping
  - `publish.ts` -- Sign + publish to write relays
- `lib/db/` -- IndexedDB persistence (idb wrapper):
  - `database.ts` -- Schema definition, DB open/upgrade
  - `eventStore.ts`, `profileStore.ts`, `subscriptionStore.ts`, `userStateStore.ts`
  - `eviction.ts` -- TTL + LRU cache eviction
- `store/` -- Redux store with slices (identity, relays, spaces, events, feed, ui)
- `types/` -- Client TypeScript types (nostr, profile, space, chat, media, relay)
- `workers/verifyWorker.ts` -- Web Worker for SHA-256 + schnorr verification

## Backend Structure (`services/backend/src/`)

- `routes/` -- Fastify route handlers (spaces, invites, members, permissions, search, feeds, push, analytics, content, profiles, health)
- `services/` -- Business logic (spaceDirectory, invite, permission, push, search, feed, analytics, spam, content, profileCache)
- `workers/` -- Background jobs (relayIngester, trendingComputer, profileRefresher, notificationDispatcher, analyticsAggregator)
- `db/schema/` -- Drizzle ORM table definitions (in `app` PostgreSQL schema)
- `db/migrations/` -- SQL migrations
- `middleware/` -- authContext (X-Auth-Pubkey extraction), errorHandler
- `lib/` -- Redis client, Meilisearch client, Nostr event verifier

## Gateway Structure (`services/gateway/internal/`)

- `auth/` -- NIP-98 (kind:27235) verification + middleware
- `ratelimit/` -- Redis sliding-window per-pubkey rate limiting
- `proxy/` -- Reverse proxy to backend (strips `/api` prefix)
- `cors/` -- CORS middleware
- `logging/` -- Request logging middleware

## Relay Structure (`services/relay/src/`)

- `nostr/` -- Event types, filter matching, schnorr verification, NIP-29 handlers
- `protocol/` -- WebSocket message routing (REQ/EVENT/CLOSE/AUTH), subscription management, NIP-42, NIP-50
- `db/` -- PostgreSQL pool, event store, group store
- `music/` -- Custom music event kind handling

## Key Architecture Patterns

### Singletons (Client)
`relayManager`, `subscriptionManager`, and `verifyBridge` are module-level singletons. Import and use them directly -- do not instantiate new instances.

### Client Event Flow
Relay message -> `relayConnection` -> `relayManager` routes to callbacks -> `subscriptionManager.onEvent` -> `eventPipeline.processIncomingEvent` (dedup -> validate -> Web Worker verify -> Redux dispatch + index)

### Signer Abstraction (Client)
`NostrSigner` interface with two backends:
- `NIP07Signer` -- delegates to `window.nostr` (browser extensions)
- `TauriSigner` -- delegates to Rust IPC commands (OS keychain)

Use `getSigner()` from `loginFlow.ts` to access the current signer. Use `signAndPublish()` from `publish.ts` for the common sign-and-send pattern.

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
Defined in `client/src-tauri/src/keystore.rs`, registered in `client/src-tauri/src/lib.rs`:
- `keystore_get_public_key` -- Get or generate keypair, return hex pubkey
- `keystore_sign_event` -- Sign canonical event JSON, return `{id, sig}`
- `keystore_has_key` -- Check if a key exists
- `keystore_delete_key` -- Remove key from keychain

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
- Event kinds used: 0, 1, 3, 9, 22, 34236, 30023, 30311, 1311, 10000, 10002, 39000-39002
- Bootstrap relays: `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`
- Channel routing is defined in `client/src/lib/nostr/channelRoutes.ts`

## Dependencies of Note

- `bloom-filters` -- uses `BloomFilter.create(capacity, fpr)` static method
- `hls.js` -- check `Hls.isSupported()` before use; Safari has native HLS
- `idb` -- typed IndexedDB wrapper; schema in `client/src/lib/db/database.ts`
- Tailwind v4 -- uses `@import "tailwindcss"` in CSS, NOT `@tailwind` directives
- Vite Web Workers -- use `new Worker(new URL("...", import.meta.url), { type: "module" })`
