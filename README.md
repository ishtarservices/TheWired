# The Wired V1

Decentralized Nostr-native media platform -- streaming, messaging, music, voice/video calls, and long-form content in a desktop app. Built with Tauri v2, React 19, and the Nostr protocol.

Current version: **v0.4.3**. Auto-updating Tauri desktop app with macOS, Windows, and Linux builds.

## Architecture

| Service | Language | Port | Purpose |
|---------|----------|------|---------|
| Client | TypeScript/React/Tauri | 1420 | Desktop app with Nostr relay connections |
| Relay | Rust (axum + sqlx) | 7777 | Custom NIP-29 relay with PostgreSQL storage |
| Backend | Node.js/TypeScript (Fastify + Drizzle) | 3002 | Business logic, RBAC, search, feeds, push, Blossom blobs |
| Gateway | Go | 9080 | NIP-98 auth, rate limiting, request routing |
| Landing | Astro + React | - | Marketing site (`services/landing/`) |
| PostgreSQL | - | 5432 | Shared database (relay + app schemas) |
| Redis | - | 6380 | Rate limits, caching, trending feeds |
| Meilisearch | - | 7700 | Full-text search engine |
| LiveKit | - | 7880 | WebRTC SFU for voice/video channels |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design document.

## Requirements

### System
- **Node.js** >= 22
- **pnpm** >= 10
- **Rust** >= 1.77.2 (with cargo)
- **Go** >= 1.22 (for gateway)
- **Docker** + **Docker Compose** (for infrastructure services)

### Platform-specific (for Tauri client)
- **macOS**: Xcode Command Line Tools
- **Windows**: Visual Studio C++ Build Tools, WebView2
- **Linux**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `libssl-dev`, `libdbus-1-dev`

See [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for full details.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/ishtarservices/TheWired.git
cd TheWired
cp .env.example .env   # Edit .env with your credentials
pnpm install
```

### 2. Start infrastructure

Start PostgreSQL, Redis, and Meilisearch via Docker:

```bash
pnpm dev:infra
```

This runs `docker compose up postgres redis meilisearch -d`. Wait a few seconds for services to become healthy.

### 3. Start the relay

```bash
pnpm dev:relay
```

This starts the custom Rust NIP-29 relay on port 7777. It will run migrations against PostgreSQL on first start.

### 4. Start the backend

```bash
pnpm dev:backend
```

This starts the Fastify backend service on port 3002 with hot reload. The backend connects to PostgreSQL, Redis, Meilisearch, and the relay.

### 5. Start the gateway

```bash
pnpm dev:gateway
```

This starts the Go API gateway on port 9080. It handles NIP-98 authentication and proxies requests to the backend.

### 6. Start the client

```bash
pnpm dev:client
```

This starts the Vite dev server on port 1420. For the full Tauri desktop app with hot reload:

```bash
cd client && pnpm tauri dev
```

### Alternative: Start everything via Docker

To start all services (infrastructure + relay + backend + gateway) in Docker:

```bash
pnpm dev:services
```

Then start the client separately with `pnpm dev:client`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm dev:client` | Vite dev server (web only, port 1420) |
| `pnpm dev:backend` | Backend service with hot reload (port 3002) |
| `pnpm dev:gateway` | Go API gateway (port 9080) |
| `pnpm dev:relay` | Rust NIP-29 relay (port 7777) |
| `pnpm dev:infra` | Start PostgreSQL + Redis + Meilisearch (Docker) |
| `pnpm dev:services` | Start all Docker services |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript check all packages |
| `cd client && pnpm tauri dev` | Full Tauri desktop app with hot reload |
| `cd client && pnpm tauri build` | Production desktop app bundle |

## Testing

The project has a comprehensive test suite covering all four services.

### Quick Start

```bash
# Run all tests that need no infrastructure
pnpm test:client                         # 229 Vitest tests (no deps)
pnpm test:gateway                        # 49 Go tests (no deps)
pnpm test:relay                          # 33 Rust tests (no deps)

# Run everything (backend needs PostgreSQL)
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
pnpm test:e2e               # Run Playwright tests (headless)
pnpm test:e2e:headed        # Run with visible browser

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

No setup required -- inline `#[cfg(test)]` modules with unit tests. Covers event serialization, schnorr signature verification, and filter matching.

### Test Scripts Reference

| Command | Description |
|---------|-------------|
| `pnpm test:client` | Client unit tests (Vitest) |
| `pnpm test:client:watch` | Client tests in watch mode |
| `pnpm test:client:coverage` | Client tests with coverage |
| `pnpm test:backend` | Backend route + service tests (needs PostgreSQL) |
| `pnpm test:gateway` | Gateway Go tests |
| `pnpm test:relay` | Relay Rust tests |
| `pnpm test:all` | Run client + backend + gateway + relay tests |
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
| **Client** | `pnpm test:client` (229 Vitest tests) | None |
| **Gateway** | `go test ./...` (49 Go tests) | None |
| **Relay** | `cargo test` (33 Rust tests) | None |
| **Backend** | `pnpm test:backend` (Fastify inject) | PostgreSQL (service container) |
| **Typecheck** | `pnpm typecheck` | None |

All jobs run in parallel. Backend tests get a fresh PostgreSQL 16 container per run.

## Project Structure

```
TheWiredV1/
├── client/                        # Tauri + React desktop app
│   ├── src/
│   │   ├── app/                   # App root, layout, routing, auth gate
│   │   ├── components/
│   │   │   ├── layout/            # Sidebar, CenterPanel, RightPanel, TopBar, ThemeBackground
│   │   │   └── ui/                # Button, Avatar, Spinner, Modal, PopoverMenu, MagicCard, etc.
│   │   ├── contexts/              # React contexts (theme, toast, etc.)
│   │   ├── features/
│   │   │   ├── calling/           # 1:1 WebRTC DM calls (peer connection, signaling, ringtone)
│   │   │   ├── chat/              # Kind:9 real-time chat, edits, context menu, GIFs, emoji
│   │   │   ├── discover/          # /discover page: spaces, relays, communities, people
│   │   │   ├── dm/                # NIP-17 encrypted DMs, contacts, conversations, friend list
│   │   │   ├── emoji/             # Emoji picker / reactions
│   │   │   ├── friends/           # Friends Feed virtual space (follow list aggregation)
│   │   │   ├── identity/          # Login, multi-account switcher, profile card
│   │   │   ├── listenTogether/    # Synced playback sessions (now playing, vote-skip, DJ transfer)
│   │   │   ├── longform/          # Kind:30023 Markdown article rendering
│   │   │   ├── media/             # Kind:22 video playback (HLS via hls.js)
│   │   │   ├── music/             # Music library, player, upload, revisions, proposals, insights
│   │   │   │   ├── views/         # MusicHome, SongList, AlbumGrid, ArtistDetail, Explore, etc.
│   │   │   │   ├── panel/         # Side panel (Actions, Audio, History, Notes tabs, waveform)
│   │   │   │   └── playbackBar/   # MiniBar, ExpandedBar, NowPlayingOverlay, progress bar
│   │   │   ├── notifications/     # Toast stack, bell dropdown, browser/push, service worker
│   │   │   ├── onboarding/        # Profile wizard, app tour, welcome flow
│   │   │   ├── profile/           # Profile page, edit, follow cards, pinned notes, showcase
│   │   │   ├── relay/             # Relay connection status panel
│   │   │   ├── search/            # Command palette, user/message search
│   │   │   ├── settings/          # Notification preferences, theme picker, account
│   │   │   ├── spaces/            # NIP-29 spaces, channels, members, moderation, settings
│   │   │   │   ├── moderation/    # Ban/mute/kick, member context menu
│   │   │   │   ├── notes/         # Thread view, quoted notes, reply composer
│   │   │   │   └── settings/      # Tabbed Space Settings modal
│   │   │   └── voice/             # LiveKit voice/video channels, screen share, pre-join
│   │   ├── lib/
│   │   │   ├── api/               # Backend API client (22 modules; NIP-98 auth, request queue)
│   │   │   ├── db/                # IndexedDB persistence (events, profiles, music, audio cache)
│   │   │   └── nostr/             # Protocol: relay, subscription, event pipeline, signers,
│   │   │                          #   NIP-44, gift wrap, follow list, signing queue, callSignaling
│   │   ├── store/                 # Redux store + 16 slices
│   │   ├── styles/                # Theme engine presets, color tokens
│   │   ├── types/                 # TypeScript types
│   │   └── workers/               # Web Worker for schnorr verification
│   ├── src-tauri/                 # Rust: OS keychain, NIP-44 v2, keystore IPC, updater
│   ├── e2e/                       # Playwright E2E tests
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── packages/
│   └── shared-types/              # @thewired/shared-types
│       └── src/                   # nostr, space, profile, api, permissions, music
├── services/
│   ├── backend/                   # Node.js/Fastify backend (@thewired/backend)
│   │   └── src/
│   │       ├── routes/            # REST API endpoints (25 route modules)
│   │       ├── services/          # Business logic (21 service modules)
│   │       ├── workers/           # Background jobs (6 workers)
│   │       ├── db/schema/         # Drizzle ORM tables (app schema, 20 tables)
│   │       ├── db/migrations/     # SQL migrations (0001-0019)
│   │       ├── middleware/        # Auth context, error handler
│   │       └── lib/               # Redis, Meilisearch, Nostr utils, MIME, validation
│   ├── gateway/                   # Go API gateway
│   │   ├── cmd/gateway/           # Entry point
│   │   └── internal/              # auth, ratelimit, proxy, cors, logging, config
│   ├── relay/                     # Rust NIP-29 relay
│   │   ├── migrations/            # PostgreSQL schema (relay schema)
│   │   └── src/                   # nostr, protocol, db, music, relay_identity, connection
│   └── landing/                   # Astro marketing site (downloads, features, pricing)
├── config/livekit.yaml            # LiveKit SFU config
├── docker-compose.yml             # Dev infrastructure stack
├── pnpm-workspace.yaml            # Workspace config
├── tsconfig.base.json             # Shared TypeScript config
├── CLAUDE.md                      # Claude Code instructions
├── ARCHITECTURE.md                # Full design document
├── BLOSSOM_IMPLEMENTATION.md      # Blossom blob store design notes
├── VOICE_VIDEO_PLAN.md            # Voice/video implementation plan
├── DISCOVER_REMAINING_PHASES.md   # Discover feature roadmap (phases 4-6)
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
| nostr-tools | 2 | Nostr protocol utilities |

### Backend
| Package | Purpose |
|---------|---------|
| Fastify 5 | HTTP server |
| @fastify/multipart | Multipart form upload handling |
| Drizzle ORM | PostgreSQL queries + schema |
| postgres (postgres.js) | PostgreSQL driver |
| ioredis | Redis client |
| meilisearch | Search engine client |
| web-push | Push notifications |
| zod | Request validation |
| pino | Structured logging |

### Relay (Rust)
| Crate | Purpose |
|-------|---------|
| axum 0.8 | HTTP + WebSocket server |
| tokio | Async runtime |
| sqlx 0.8 | PostgreSQL async driver |
| secp256k1 0.30 | Schnorr signature verification |
| sha2 | SHA-256 for event ID computation |

### Gateway (Go)
| Module | Purpose |
|--------|---------|
| dcrd/secp256k1 | NIP-98 schnorr verification |
| go-redis | Rate limiting with sliding window |

## Nostr Event Kinds Used

| Kind | NIP | Feature |
|------|-----|---------|
| 0 | NIP-01 | User profiles |
| 1 | NIP-01 | Announcements / short text notes |
| 3 | NIP-02 | Follow lists |
| 7 | NIP-25 | Reactions |
| 9 | NIP-C7 | Chat messages |
| 20 | NIP-68 | Picture posts |
| 22 | NIP-71 | Portrait/reel videos |
| 34235 | NIP-71 | Addressable landscape videos |
| 34236 | NIP-71 | Addressable reel videos |
| 30023 | NIP-23 | Long-form articles |
| 30311 | NIP-53 | Live streams |
| 1311 | NIP-53 | Live chat |
| 1059 | NIP-17 | Gift wraps (encrypted DMs, friend requests, call signaling) |
| 13 | NIP-17 | Seals (intermediate encryption layer) |
| 14 | NIP-17 | Rumors (decrypted DM / call signaling content) |
| 10000 | NIP-51 | Mute lists |
| 10002 | NIP-65 | Relay lists |
| 10009 | NIP-51 | User group memberships |
| 10063 | NIP-B7 | Blossom server list |
| 22242 | NIP-42 | Client auth (relay challenge/response) |
| 24242 | BUD-01 | Blossom blob auth tokens |
| 27235 | NIP-98 | HTTP auth (gateway) |
| 39000 | NIP-29 | Group metadata |
| 39001 | NIP-29 | Group admins |
| 39002 | NIP-29 | Group members |
| 9000-9022 | NIP-29 | Group moderation (ban/unban, kick, metadata edits) |
| 31683 | Custom | Music track metadata |
| 33123 | Custom | Music album |
| 30119 | Custom | Music playlist |
| 30000 | NIP-51 | Follow sets (favorite artists) |
| 30003 | NIP-51 | Bookmark sets (liked tracks) |
| 30166 | NIP-66 | Relay monitor data (read-only, discover worker) |
| 34550 | NIP-72 | Moderated communities (discover) |
| 39089 | NIP-51 | Starter packs (discover) |

## Development Phases

### Phase 1: Foundation -- COMPLETE

Core relay connection, chat, basic media playback, identity.

- Tauri + React app shell with sidebar/center/right layout
- NIP-07 login + Tauri native keystore (OS keychain signing in Rust)
- Multi-relay WebSocket manager with NIP-65 relay discovery
- Subscription manager with full REQ/CLOSE/EOSE lifecycle
- Event dedup (Bloom filter + LRU), signature verification (Web Worker)
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
- `@thewired/shared-types` workspace package for shared TypeScript types
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

**Still TODO (deferred to Phase 4+):**
- FFmpeg transcoding workers (multi-bitrate HLS, audio normalization)
- Blossom server integration for decentralized file storage
- NIP-44 encrypted private playlists
- NIP-57 zap integration + NIP-47 Nostr Wallet Connect
- NIP-22 comments on videos/tracks/articles

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
- `VoiceChannel.tsx`, `VideoGrid.tsx`, `VoiceControls.tsx`, `ParticipantTile.tsx`, `ScreenShareView.tsx`
- `useVoiceChannel`, `useMediaDevices`, `useScreenShare`, `useVoiceRoomPresence` hooks
- `PreJoinModal` for device selection before joining
- Keep-alive pattern: voice session persists across channel navigation
- Voice status bar and voice channel preview

**Client -- DM Calls (1:1 WebRTC):**
- `usePeerConnection`, `useCallSignaling` (gift-wrapped call offers over NIP-17)
- `CallController`, `CallControls`, `IncomingCallModal`, `callRingtone`
- Offer/answer handshake with ICE buffering, video capture capped at 640x360

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
- Four tabs: Spaces, Relays, Communities, People
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
- **Saved album versions (`app.saved_album_versions`):** Snapshot/restore album state
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
- **Comprehensive test suite:** 229 client Vitest + 49 gateway Go + 33 relay Rust + backend Fastify-inject + Playwright E2E
- **Path-based CI:** Docker image builds gated on test success, diff against last successful build

### Phase 10: Discovery UX & Polish -- TODO

See [DISCOVER_REMAINING_PHASES.md](./DISCOVER_REMAINING_PHASES.md) for detail.

- **Join from Discover:** Join button on `SpaceCard` with membership state
- **Right panel preview:** Detailed space/relay preview when clicking a card
- **Listing request UI:** Modal for space admins to submit listing requests
- **Meilisearch spaces index:** Replace SQL `ILIKE` with full-text search
- **Relay directory worker:** NIP-66 monitor ingestion + NIP-11 probing
- **`relayIngester`** extensions for kind:10002 (relay usage counts) and kind:34550 (communities)
- **Communities tab:** NIP-72 moderated communities browser
- **People tab:** Starter packs (kind:39089) + suggested follows (2-hop social graph)
- **"Friends Are In"** section: Spaces your follows are members of
- **Command Palette (Cmd+K):** Global search overlay
- **Trending/personalized feed UI** (backend endpoints already exist)
- **NIP-77 Negentropy sync** for efficient reconnection
- **NIP-53 live streaming** + live chat UI
- **Pinned messages panel** per channel
- **Audit log** (moderation/admin action history)
- **Announcement channels** (admin-only posting enforcement on relay)
- **Auto-mod** (keyword filters, spam detection)
- **Anti-raid protection**
- **Custom emoji reactions** per server
- **Forum-style threads**

### Phase 11: Monetization & Ecosystem -- TODO

- **NIP-57 zaps** integration for tracks/videos/articles
- **NIP-47 Nostr Wallet Connect** for in-app payments
- **NIP-22 comments** on tracks, videos, articles
- **NIP-44 encrypted private playlists**
- **FFmpeg transcoding workers** (multi-bitrate HLS, audio normalization to -14 LUFS)
- **NIP-89 app handler registration**
- **Collaborative playlists**
- **Plugin/extension API**
- **Mobile companion app**
- **Monitoring** (Prometheus + Grafana)
- **`spamService` reputation model** and rate anomaly detection

## License

ISC
