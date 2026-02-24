# The Wired V1

Decentralized Nostr-native media platform -- streaming, messaging, and long-form content in a desktop app. Built with Tauri v2, React 19, and the Nostr protocol.

## Architecture

| Service | Language | Port | Purpose |
|---------|----------|------|---------|
| Client | TypeScript/React/Tauri | 1420 | Desktop app with Nostr relay connections |
| Relay | Rust (axum + sqlx) | 7777 | Custom NIP-29 relay with PostgreSQL storage |
| Backend | Node.js/TypeScript (Fastify + Drizzle) | 3002 | Business logic, RBAC, search, feeds, push |
| Gateway | Go | 9080 | NIP-98 auth, rate limiting, request routing |
| PostgreSQL | - | 5432 | Shared database (relay + app schemas) |
| Redis | - | 6380 | Rate limits, caching, trending feeds |
| Meilisearch | - | 7700 | Full-text search engine |

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

## Project Structure

```
TheWiredV1/
├── client/                        # Tauri + React desktop app
│   ├── src/
│   │   ├── app/                   # App root, layout, routing
│   │   ├── components/
│   │   │   ├── layout/            # Sidebar, CenterPanel, RightPanel, TopBar
│   │   │   └── ui/                # Button, Avatar, Spinner
│   │   ├── features/
│   │   │   ├── chat/              # Kind:9 real-time chat with optimistic UI
│   │   │   ├── identity/          # Login, profile card, signer detection
│   │   │   ├── longform/          # Kind:30023 Markdown article rendering
│   │   │   ├── media/             # Kind:22 video playback (HLS via hls.js)
│   │   │   ├── music/             # Music library, player, upload (kinds 31683/33123/30119)
│   │   │   │   └── views/         # MusicHome, SongList, AlbumGrid, ArtistDetail, etc.
│   │   │   ├── profile/           # Profile display and edit
│   │   │   ├── relay/             # Relay connection status panel
│   │   │   └── spaces/            # NIP-29 spaces, channels, members
│   │   ├── lib/
│   │   │   ├── api/               # Backend API client (NIP-98 auth, typed endpoints)
│   │   │   ├── db/                # IndexedDB persistence
│   │   │   └── nostr/             # Protocol: relay, subscription, event pipeline, signer
│   │   ├── store/                 # Redux store + slices
│   │   ├── types/                 # TypeScript types
│   │   └── workers/               # Web Worker for schnorr verification
│   ├── src-tauri/                 # Rust: OS keychain + Tauri commands
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── packages/
│   └── shared-types/              # @thewired/shared-types
│       └── src/                   # nostr, space, profile, api, permissions, music
├── services/
│   ├── backend/                   # Node.js/Fastify backend
│   │   └── src/
│   │       ├── routes/            # REST API endpoints (12 modules)
│   │       ├── services/          # Business logic (11 modules)
│   │       ├── workers/           # Background jobs (5 workers)
│   │       ├── db/schema/         # Drizzle ORM tables (app schema)
│   │       ├── middleware/        # Auth context, error handler
│   │       └── lib/               # Redis, Meilisearch, Nostr utils
│   ├── gateway/                   # Go API gateway
│   │   ├── cmd/gateway/           # Entry point
│   │   └── internal/              # auth, ratelimit, proxy, cors, logging
│   └── relay/                     # Rust NIP-29 relay
│       ├── migrations/            # PostgreSQL schema (relay schema)
│       └── src/                   # nostr, protocol, db, music
├── docker-compose.yml             # Full infrastructure stack
├── pnpm-workspace.yaml            # Workspace config
├── tsconfig.base.json             # Shared TypeScript config
├── CLAUDE.md                      # Claude Code instructions
├── ARCHITECTURE.md                # Full design document
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
| 1 | NIP-01 | Announcements / short text |
| 3 | NIP-02 | Follow lists |
| 7 | NIP-25 | Reactions |
| 9 | NIP-C7 | Chat messages |
| 22 | NIP-71 | Portrait/reel videos |
| 34236 | NIP-71 | Addressable reel videos |
| 30023 | NIP-23 | Long-form articles |
| 30311 | NIP-53 | Live streams |
| 1311 | NIP-53 | Live chat |
| 10000 | NIP-51 | Mute lists |
| 10002 | NIP-65 | Relay lists |
| 27235 | NIP-98 | HTTP auth (gateway) |
| 39000 | NIP-29 | Group metadata |
| 39001 | NIP-29 | Group admins |
| 39002 | NIP-29 | Group members |
| 9000-9022 | NIP-29 | Group moderation |
| 31683 | Custom | Music track metadata |
| 33123 | Custom | Music album |
| 30119 | Custom | Music playlist |
| 30000 | NIP-51 | Follow sets (favorite artists) |
| 30003 | NIP-51 | Bookmark sets (liked tracks) |

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

### Phase 4: Discovery and Scale -- TODO

Ranking UI, search UI, spam filtering, live streaming.

**Client:**
- Trending and personalized feed UI (consuming backend `feedService` endpoints)
- Search UI (local + Meilisearch API + NIP-50 federated relay search)
- NIP-77 Negentropy sync for efficient reconnection
- NIP-53 live streaming + live chat
- Full NIP-29 moderation tools
- Sub-spaces, active members sidebar

**Backend:**
- `spamService` reputation model and rate anomaly detection
- Search ranking and boosting tuning in Meilisearch
- Monitoring (Prometheus + Grafana)

### Phase 5: Ecosystem -- TODO

- NIP-89 app handler registration
- Collaborative playlists
- Artist analytics dashboard
- Mobile companion app
- Plugin/extension API

## License

ISC
