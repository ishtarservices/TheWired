# THE WIRED V1 -- Architecture Document

> Decentralized Nostr-native media platform: streaming, messaging, music libraries.
> Tech Stack: Tauri + React + Redux | Nostr Protocol | Custom Rust Relay | Fastify + PostgreSQL + Redis + Meilisearch | Go API Gateway

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Nostr Event Kind Mapping](#2-nostr-event-kind-mapping)
3. [Client Architecture (Tauri + React + Redux)](#3-client-architecture-tauri--react--redux)
4. [Spaces Architecture](#4-spaces-architecture)
5. [Music Library Architecture](#5-music-library-architecture)
6. [Media Pipeline Architecture](#6-media-pipeline-architecture)
7. [Backend Architecture](#7-backend-architecture)
8. [Event Deduplication Strategy](#8-event-deduplication-strategy)
9. [Feed Ranking and Discovery](#9-feed-ranking-and-discovery)
10. [Infrastructure and Deployment](#10-infrastructure-and-deployment)
11. [Identity and Key Management](#11-identity-and-key-management)
12. [Wallet Integration](#12-wallet-integration)
13. [Phasing Strategy](#13-phasing-strategy)

---

## 1. System Overview

### Full System Diagram

```
+============================================================================+
|                          THE WIRED -- CLIENT LAYER                         |
|                        (Tauri Desktop / React Web)                         |
|                                                                            |
|  +------------------+  +------------------+  +------------------+          |
|  | WebSocket Manager|  | Redux Store      |  | IndexedDB Cache  |          |
|  | (Multi-Relay)    |  | (Normalized)     |  | (Offline)        |          |
|  +--------+---------+  +--------+---------+  +--------+---------+          |
|           |                     |                      |                   |
|  +--------v---------------------v----------------------v---------+         |
|  |              Event Processing Pipeline                        |         |
|  |  [Dedup (Bloom)] -> [Sig Verify] -> [Dispatch] -> [UI Update]|         |
|  +-------------------------------+-------------------------------+         |
|                                  |                                         |
|  +------------------+  +---------v--------+  +------------------+          |
|  | NIP-07 / Tauri   |  | Subscription Mgr |  | Media Player     |          |
|  | Key Signer       |  | (REQ/CLOSE/EOSE) |  | (HLS/DASH)       |          |
|  +------------------+  +------------------+  +------------------+          |
+====================|=====================================================+
                     | WebSocket (wss://)          HTTPS (API + media)
                     |                                 |
     +===============v=================================v=====================+
     |                     SERVICE LAYER                                     |
     |                                                                       |
     |  +--------------------------+   +-------------------------------+     |
     |  | RUST RELAY (port 7777)   |   | GO API GATEWAY (port 9080)   |     |
     |  | axum + tokio + sqlx      |   | NIP-98 auth verification     |     |
     |  |                          |   | Redis rate limiting           |     |
     |  | NIP-01 event store       |   | CORS + reverse proxy         |     |
     |  | NIP-29 group management  |   | X-Auth-Pubkey injection      |     |
     |  | NIP-42 AUTH challenge    |   +---------------+---------------+     |
     |  | NIP-50 search (tsvector) |                   |                     |
     |  | Schnorr sig verify       |   +---------------v---------------+     |
     |  +-----------+--------------+   | FASTIFY BACKEND (port 3002)   |     |
     |              |                  | @thewired/backend              |     |
     |              |  WebSocket       |                                |     |
     |              |  ingestion       | Routes:                        |     |
     |              |                  |  spaces, invites, members,     |     |
     |              |                  |  permissions, search, feeds,   |     |
     |              |                  |  push, analytics, content,     |     |
     |              |                  |  profiles, music, health       |     |
     |              |                  |                                |     |
     |              |                  | Services:                      |     |
     |              |                  |  spaceDirectory, invite,       |     |
     |              |                  |  permission, push, search,     |     |
     |              |                  |  music,                        |     |
     |              |                  |  feed, analytics, spam,        |     |
     |              |                  |  content, profileCache         |     |
     |              |                  |                                |     |
     |              |                  | Workers (background):          |     |
     |              +<-- relayIngester |  relayIngester                 |     |
     |                                 |  trendingComputer              |     |
     |                                 |  profileRefresher              |     |
     |                                 |  notificationDispatcher        |     |
     |                                 |  analyticsAggregator           |     |
     |                                 +---+----------+----------+-----+     |
     |                                     |          |          |           |
     |  +==================================v===+  +===v====+  +==v========+  |
     |  |         POSTGRESQL 16               |  | REDIS 7|  |MEILISEARCH|  |
     |  |                                     |  |        |  | v1.6      |  |
     |  |  relay schema (managed by Rust):    |  | Cache  |  |           |  |
     |  |    events, groups, group_members,   |  | Rate   |  | Full-text |  |
     |  |    group_roles, invite_codes        |  | limits |  | search    |  |
     |  |                                     |  |        |  | indexes   |  |
     |  |  app schema (managed by Drizzle):   |  +--------+  +-----------+  |
     |  |    spaces, invites, members, roles, |                              |
     |  |    permissions, notifications,      |                              |
     |  |    content, profiles, analytics,    |                              |
     |  |    moderation, feeds                |                              |
     |  +-------------------------------------+                              |
     +=======================================================================+
```

### Data Flow Summary

| Flow | Path |
|------|------|
| **Real-time Events (Client)** | Client WS -> Rust Relay -> NIP-01 event stored in PostgreSQL `relay.events` |
| **Event Indexing (Backend)** | `relayIngester` worker -> WS to Rust Relay -> indexes profiles, chat activity, reactions, zap counters, memberships, group metadata into PostgreSQL `app` schema + Redis counters + Meilisearch |
| **Live Broadcasting** | Client EVENT -> Rust Relay stores -> `broadcast::Sender` -> all connected clients' `broadcast::Receiver` -> filter matching -> `["EVENT", sub_id, event]` push |
| **API Queries** | Client `api<T>()` (with NIP-98 header) -> Go Gateway (auth verify + rate limit) -> Fastify backend -> PostgreSQL + Redis (cached feeds) -> Response |
| **Search** | Client -> Gateway -> Fastify `searchService` -> Meilisearch (full-text) + Relay NIP-50 (tsvector) -> merged results |
| **User State** | Login -> NIP-07/Tauri keystore -> Load kind:10002 relay list -> Open relay connections -> Subscribe to spaces -> Hydrate Redux from IndexedDB + relay EOSE |
| **Media Upload** | Client -> Gateway (NIP-98 auth) -> Fastify `contentService` / `musicService` -> storage -> Client signs event -> Published to Rust Relay |

---

## 2. Nostr Event Kind Mapping

### Standard Event Kinds Used

| Feature | Kind | NIP | Type | Description |
|---------|------|-----|------|-------------|
| User Profile | 0 | NIP-01 | Replaceable | `name`, `about`, `picture`, `lud16`, `nip05` in JSON content |
| Chat Message | 9 | NIP-C7 | Regular | `.content` = message text, `h` tag for group routing |
| Follow List | 3 | NIP-02 | Replaceable | `p` tags with followed pubkeys |
| Reaction/Like | 7 | NIP-25 | Regular | `e` tag to target event, `content` = "+" or emoji |
| Picture Post | 20 | NIP-68 | Regular | Picture-first content with `imeta` tags |
| Video (landscape) | 21 | NIP-71 | Regular | Normal video with `imeta` + `title` tags |
| Video (portrait/reel) | 22 | NIP-71 | Regular | Short-form vertical video (reels) |
| Long-form Content | 30023 | NIP-23 | Addressable | Markdown `.content`, `d`/`title`/`image`/`summary` tags |
| Long-form Draft | 30024 | NIP-23 | Addressable | Same as 30023 but for drafts |
| Addressable Video | 34235 | NIP-71 | Addressable | Updatable normal video |
| Addressable Reel | 34236 | NIP-71 | Addressable | Updatable short video |
| File Metadata | 1063 | NIP-94 | Regular | `url`/`m`/`x`/`size`/`dim`/`blurhash` tags |
| Comment | 1111 | NIP-22 | Regular | Replies to videos, articles, tracks |
| Live Stream | 30311 | NIP-53 | Addressable | `streaming` URL (HLS m3u8), `status`, `p` tags with roles |
| Live Chat | 1311 | NIP-53 | Regular | Chat tied to live stream via `a` tag |
| Zap Request | 9734 | NIP-57 | Regular | NOT published to relays; sent to lnurl callback |
| Zap Receipt | 9735 | NIP-57 | Regular | Published by recipient's LN wallet |
| Mute List | 10000 | NIP-51 | Replaceable | `p`/`t`/`word`/`e` tags for spam filtering |
| Bookmarks | 10003 | NIP-51 | Replaceable | Saved events (tracks, articles, videos) |
| User Groups | 10009 | NIP-51 | Replaceable | NIP-29 group memberships |
| Relay List | 10002 | NIP-65 | Replaceable | `r` tags with read/write markers |
| Blossom Server List | 10063 | NIP-B7 | Replaceable | `server` tags for file storage |
| Follow Sets | 30000 | NIP-51 | Addressable | Categorized follow groups ("favorite-artists") |
| Bookmark Sets | 30003 | NIP-51 | Addressable | Categorized bookmarks ("liked-tracks") |
| Curation Sets | 30005 | NIP-51 | Addressable | Video playlists |
| App-specific Data | 30078 | NIP-78 | Addressable | Client settings, preferences |
| NIP-29 Group Meta | 39000 | NIP-29 | Addressable | Group name, picture, about, access flags |
| NIP-29 Group Admins | 39001 | NIP-29 | Addressable | Admin list with roles |
| NIP-29 Group Members | 39002 | NIP-29 | Addressable | Member pubkey list |
| Client Auth | 22242 | NIP-42 | Ephemeral | Challenge-response for relay auth |

### Custom Music Event Kinds (Addressable Range)

Three verified-unused addressable kinds are allocated:

| Kind | Name | `d`-tag Pattern | Description |
|------|------|-----------------|-------------|
| **31683** | Music Track | `<artist-prefix>:<slug>` | Individual track metadata |
| **33123** | Music Album | `<artist-prefix>:<album-slug>` | Album grouping of tracks |
| **30119** | Music Playlist | `<owner-prefix>:<playlist-slug>` | User-created playlists |

#### Kind 31683 -- Music Track Event

```jsonc
{
  "kind": 31683,
  "pubkey": "<artist-pubkey>",
  "content": "<optional description or lyrics>",
  "tags": [
    ["d", "neon-wave:electric-dreams"],
    ["title", "Electric Dreams"],
    ["artist", "NEON_WAVE"],
    ["p", "<artist-pubkey>", "<relay-hint>"],
    ["album", "33123:<artist-pubkey>:neon-wave:synthwave-nights", "<relay-hint>"],
    ["duration", "234.5"],
    ["genre", "Synthwave"],
    ["t", "synthwave"],
    ["t", "electronic"],
    ["published_at", "1708000000"],
    ["license", "CC-BY-SA-4.0"],
    ["imeta",
      "url https://cdn.thewired.app/tracks/abc123.mp3",
      "m audio/mpeg",
      "x a1b2c3d4e5f6...sha256hash",
      "size 5242880",
      "duration 234.5",
      "bitrate 320000",
      "fallback https://blossom.thewired.app/a1b2c3d4e5f6...sha256hash.mp3"
    ],
    ["imeta",
      "url https://cdn.thewired.app/tracks/abc123_128.mp3",
      "m audio/mpeg",
      "x f6e5d4c3b2a1...sha256hash",
      "size 2621440",
      "duration 234.5",
      "bitrate 128000",
      "fallback https://blossom.thewired.app/f6e5d4c3b2a1...sha256hash.mp3"
    ],
    ["image", "https://cdn.thewired.app/covers/abc123.jpg"],
    ["blurhash", "eVF$^OI:${M{o#*0"],
    ["zap", "<artist-pubkey>", "<relay-hint>", "1"]
  ]
}
```

#### Kind 33123 -- Music Album Event

```jsonc
{
  "kind": 33123,
  "pubkey": "<artist-pubkey>",
  "content": "<album description>",
  "tags": [
    ["d", "neon-wave:synthwave-nights"],
    ["title", "Synthwave Nights"],
    ["artist", "NEON_WAVE"],
    ["p", "<artist-pubkey>", "<relay-hint>"],
    ["published_at", "1708000000"],
    ["image", "https://cdn.thewired.app/covers/album123.jpg"],
    ["blurhash", "eVF$^OI:${M{o#*0"],
    ["genre", "Synthwave"],
    ["t", "synthwave"],
    // Ordered track references
    ["a", "31683:<artist-pubkey>:neon-wave:electric-dreams", "<relay-hint>"],
    ["a", "31683:<artist-pubkey>:neon-wave:midnight-drive", "<relay-hint>"],
    ["a", "31683:<artist-pubkey>:neon-wave:neon-city", "<relay-hint>"],
    ["track_count", "3"],
    ["total_duration", "702.8"],
    ["zap", "<artist-pubkey>", "<relay-hint>", "1"]
  ]
}
```

#### Kind 30119 -- Music Playlist Event

```jsonc
{
  "kind": 30119,
  "pubkey": "<user-pubkey>",
  "content": "<NIP-44 encrypted JSON array of private track references, or empty>",
  "tags": [
    ["d", "user123:late-night-vibes"],
    ["title", "Late Night Vibes"],
    ["description", "My favorite tracks for coding at night"],
    ["image", "https://cdn.thewired.app/playlists/pl123.jpg"],
    // Public tracks
    ["a", "31683:<artist1-pubkey>:neon-wave:electric-dreams", "<relay-hint>"],
    ["a", "31683:<artist2-pubkey>:retrowave:sunset-cruise", "<relay-hint>"]
    // Private tracks encrypted in .content via NIP-44
  ]
}
```

### Spaces-to-Kind Routing Table

| Space Channel | Event Kind(s) | Filter Construction |
|---------------|---------------|---------------------|
| `#chat` | 9 | `{"kinds": [9], "#h": ["<group-id>"]}` |
| `#reels` | 22, 34236 | `{"kinds": [22, 34236], "#h": ["<space-tags>"]}` |
| `#long-form` | 30023 | `{"kinds": [30023], "authors": ["<space-members>"]}` |
| `#music` | 31683, 33123 | `{"kinds": [31683, 33123], "#h": ["<space-tags>"]}` |
| `#announcements` | 1 | `{"kinds": [1], "#h": ["<group-id>"], "authors": ["<admin-pubkeys>"]}` |
| `#live` | 30311, 1311 | `{"kinds": [30311], "#h": ["<space-tags>"], "#status": ["live"]}` |

---

## 3. Client Architecture (Tauri + React + Redux)

### 3.1 Multi-Relay WebSocket Connection Manager

```
RelayManager
  |
  +-- RelayConnection[]
  |     |-- url: string
  |     |-- socket: WebSocket
  |     |-- status: 'connecting' | 'connected' | 'disconnected' | 'error'
  |     |-- mode: 'read' | 'write' | 'read+write'  (from NIP-65)
  |     |-- reconnectAttempts: number
  |     |-- subscriptions: Map<subId, Filter[]>
  |     |-- pendingEOSE: Set<subId>
  |     |-- authChallenge: string | null  (NIP-42)
  |     |-- messageQueue: outbound buffer for offline queuing
  |
  +-- connect(url, mode): RelayConnection
  +-- disconnect(url): void
  +-- publish(event, targetRelays?): Promise<Map<url, OK_response>>
  +-- subscribe(filters, opts): Subscription
  +-- loadRelayList(pubkey): kind:10002 -> populate connections
```

**Relay Discovery Flow:**
1. On login, fetch user's kind:10002 event from bootstrap relays (hardcoded: `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`)
2. Parse `r` tags, categorize into read/write sets
3. Open WebSocket connections to all listed relays (typically 4-8)
4. For publishing: send to all `write` relays
5. For fetching mentions: use `read` relays of the target user
6. Maintain connection to at least 2 general-purpose relays as fallback
7. Always connect to the Wired relay (`wss://relay.thewired.app`) for NIP-29 group operations

### 3.2 Subscription Management (REQ/CLOSE Lifecycle)

```typescript
interface Subscription {
  id: string;                          // unique sub ID (max 64 chars per NIP-01)
  filters: Filter[];                   // OR-combined filters
  relayUrls: string[];                 // which relays to subscribe on
  eoseReceived: Map<string, boolean>;  // per-relay EOSE tracking
  onEvent: (event: NostrEvent) => void;
  onEOSE: () => void;                 // fires when ALL relays sent EOSE
  isActive: boolean;
  createdAt: number;
}
```

**EOSE Handling Strategy:**
- Track EOSE per relay per subscription
- Show loading spinner until at least one relay sends EOSE
- Mark subscription "historically loaded" when all relays sent EOSE
- After EOSE, new events are real-time updates with UI animations
- Use `since` parameter on reconnect: `created_at` of most recent cached event minus 60s buffer

### 3.3 Event Deduplication (Client-Side)

```typescript
class EventDeduplicator {
  // Bloom filter: 100,000 capacity, 0.01 FPR = ~120KB memory
  private bloom: BloomFilter;
  // LRU fallback for bloom false positives
  private recentIds: LRUCache<string, true>;  // 10,000 capacity

  isDuplicate(eventId: string): boolean {
    if (this.bloom.has(eventId)) {
      return this.recentIds.has(eventId);
    }
    return false;
  }

  markSeen(eventId: string): void {
    this.bloom.add(eventId);
    this.recentIds.set(eventId, true);
  }

  // Reset bloom filter periodically (every ~50,000 events)
  reset(): void {
    this.bloom = new BloomFilter(100000, 0.01);
  }
}
```

### 3.4 IndexedDB Schema

```
Database: "thewired_v1"

ObjectStore: "events"
  keyPath: "id"
  indexes:
    - "by_kind":      { keyPath: "kind" }
    - "by_pubkey":    { keyPath: "pubkey" }
    - "by_created":   { keyPath: "created_at" }
    - "by_kind_time": { keyPath: ["kind", "created_at"] }
    - "by_group":     { keyPath: "group_id" }
  TTL: 7 days regular events, 30 days addressable/replaceable
  Max entries: 50,000 (LRU eviction)

ObjectStore: "profiles"
  keyPath: "pubkey"
  indexes: "by_nip05", "by_name"
  Data: parsed kind:0 content + relay hints
  TTL: 24 hours

ObjectStore: "subscriptions"
  keyPath: "sub_id"
  Data: last EOSE timestamp per relay, filter snapshot
  Purpose: reconstruct `since` on reconnect

ObjectStore: "user_state"
  keyPath: "key"
  Data: relay_list, follow_list, mute_list, bookmarks, groups, blossom_servers
```

### 3.5 Redux Store Shape

```typescript
interface RootState {
  identity: {
    pubkey: string | null;
    signerType: 'nip07' | 'tauri_keystore' | 'managed';
    profile: Kind0Profile | null;
    relayList: { url: string; mode: 'read' | 'write' | 'read+write' }[];
    followList: string[];
    muteList: MuteEntry[];
    blossomServers: string[];
  };

  relays: {
    connections: Record<string, {
      url: string;
      status: 'connecting' | 'connected' | 'disconnected' | 'error';
      mode: 'read' | 'write' | 'read+write';
      latencyMs: number;
      eventCount: number;
    }>;
    totalConnected: number;
    totalConfigured: number;
  };

  spaces: {
    list: Space[];
    activeSpaceId: string | null;
    activeChannelId: string | null;
    subscriptions: Record<string, string>;  // channelId -> subId
  };

  events: {
    byId: Record<string, NostrEvent>;
    chatMessages: Record<string, string[]>;       // groupId -> eventId[]
    reels: Record<string, string[]>;
    longform: Record<string, string[]>;
    liveStreams: Record<string, string[]>;
    musicTracks: Record<string, string[]>;        // contextId -> eventId[]
    musicAlbums: Record<string, string[]>;        // contextId -> eventId[]
  };

  music: {
    tracks: Record<string, MusicTrack>;        // addressableId → parsed track
    albums: Record<string, MusicAlbum>;        // addressableId → parsed album
    playlists: Record<string, MusicPlaylist>;  // addressableId → parsed playlist
    tracksByArtist: Record<string, string[]>;  // pubkey → trackAddrId[]
    tracksByAlbum: Record<string, string[]>;   // albumAddrId → trackAddrId[]
    library: {
      savedTrackIds: string[];
      savedAlbumIds: string[];
      followedArtists: string[];
      userPlaylists: string[];
    };
    player: {
      currentTrackId: string | null;
      queue: string[];              // addressable IDs
      queueIndex: number;
      position: number;             // seconds
      duration: number;
      isPlaying: boolean;
      volume: number;               // 0-1
      isMuted: boolean;
      repeat: 'none' | 'one' | 'all';
      shuffle: boolean;
      originalQueue: string[];      // pre-shuffle order for toggle-off
    };
    discovery: {
      trendingTrackIds: string[];
      trendingAlbumIds: string[];
      recentlyPlayedIds: string[];
      newReleaseIds: string[];
    };
    activeView: MusicView;          // "home" | "artists" | "albums" | "songs" | etc.
    activeDetailId: string | null;  // pubkey for artist, addrId for album/playlist
    queueVisible: boolean;
    viewMode: 'grid' | 'list';
  };

  media: {
    uploads: Record<string, {
      fileId: string;
      status: 'uploading' | 'processing' | 'ready' | 'error';
      progress: number;
      resultEvent: NostrEvent | null;
    }>;
  };

  wallet: {
    lightning: { balanceSats: number; nwcConnected: boolean };
    pendingZaps: Record<string, ZapState>;
    recentZapReceipts: ZapReceipt[];
  };

  ui: {
    sidebarExpanded: boolean;
    sidebarMode: 'spaces' | 'music';
    activeTab: 'reels' | 'longform' | 'music';
    searchQuery: string;
    searchResults: SearchResult[];
    notifications: Notification[];
    memberListVisible: boolean;
  };
}
```

### 3.6 Signature Verification Pipeline

All event verification runs in a **Web Worker** to avoid blocking the UI thread:

```typescript
// Main thread: fast checks
function processIncomingEvent(event: NostrEvent): void {
  if (deduplicator.isDuplicate(event.id)) return;
  deduplicator.markSeen(event.id);
  if (!isValidEventStructure(event)) return;
  verifyWorker.postMessage({ type: 'verify', event });
}

// verify-worker.js: schnorr verification
// 1. Recompute id = sha256([0, pubkey, created_at, kind, tags, content])
// 2. Verify schnorr signature using noble-secp256k1
// 3. Post back 'verified' or 'invalid'
```

**Optimization:** Skip client-side verification for events received from the backend API (already indexed and verified). Only verify events from direct relay WebSocket connections.

### 3.7 Reconnection Strategy

```
Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (cap)
Jitter: +/- 25% randomization
Max attempts: Infinity (never stop trying)

Reconnect Storm Prevention:
  If 3+ relays disconnect within 5 seconds -> network issue detected
  Apply 10-second global cooldown before reconnecting ANY relay
```

### 3.8 NIP-07 / Tauri Signer Integration

```typescript
interface NostrSigner {
  getPublicKey(): Promise<string>;
  signEvent(unsigned: UnsignedEvent): Promise<NostrEvent>;
  nip44: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

// NIP-07: delegates to window.nostr (Alby, nos2x, etc.)
// Tauri: delegates to Rust via IPC (private key in OS keychain, never in JS)
```

### 3.9 Optimistic UI Updates

```typescript
// Chat: show message immediately with "pending" status, confirm on relay OK
// Zaps: increment counter immediately, rollback on failure
// Reactions: toggle immediately, publish async
// Media uploads: show progress bar, swap placeholder on completion
```

---

## 4. Spaces Architecture

### 4.1 Spaces-to-NIP-29 Mapping

Each Space maps to a NIP-29 relay-based group hosted on the Wired's custom Rust relay:

```
Space "Synthwave Collective"
  Group ID: "synthwave-collective"
  Host Relay: wss://relay.thewired.app (custom Rust relay)
  kind:39000 metadata: name, picture, about, [restricted]

  Channels (virtual, implemented as filter scoping):
    #chat         -> {"kinds": [9], "#h": ["synthwave-collective"]}
    #reels        -> {"kinds": [22, 34236], "#h": ["synthwave-collective"]}
    #long-form    -> {"kinds": [30023], "#h": ["synthwave-collective"]}
    #music        -> {"kinds": [31683, 33123], "#h": ["synthwave-collective"]}
    #announcements -> {"kinds": [1], "#h": [...], "authors": ["<admin-pubkeys>"]}
    #live         -> {"kinds": [30311], "#h": ["synthwave-collective"]}
```

### 4.2 Channel Route Configuration

```typescript
const CHANNEL_ROUTES: Record<string, ChannelRoute> = {
  'chat':          { kinds: [9],           usesHTag: true, pageSize: 50, sortOrder: 'asc'  },
  'reels':         { kinds: [22, 34236],   usesHTag: true, pageSize: 20, sortOrder: 'desc' },
  'long-form':     { kinds: [30023],       usesHTag: true, pageSize: 10, sortOrder: 'desc' },
  'music':         { kinds: [31683,33123], usesHTag: true, pageSize: 30, sortOrder: 'desc' },
  'announcements': { kinds: [1],           usesHTag: true, pageSize: 20, sortOrder: 'desc', adminOnly: true },
  'live':          { kinds: [30311,1311],  usesHTag: true, paginated: false },
};
```

### 4.3 Dynamic Subscription Lifecycle

```
Navigate to Space -> Fetch group metadata (kind:39000, 39001, 39002)
Navigate to Channel -> Open subscription with channel-specific filter
Switch Channel -> CLOSE previous subscription, open new one
Leave Space -> CLOSE all subscriptions for that space
Background -> Keep lightweight notification sub (mentions only)
```

### 4.4 Sub-Spaces

Modeled as NIP-29 groups with prefixed IDs:
- Parent: `synthwave-collective`
- Child: `synthwave-collective:producers`

Client constructs tree from `:` delimiter. Each sub-space has its own kind:39000 metadata.

---

## 5. Music Library Architecture

### 5.1 User Library via NIP-51

**Saved Tracks** -- kind:10003 Bookmarks:

```jsonc
{
  "kind": 10003,
  "content": "<NIP-44 encrypted private bookmarks>",
  "tags": [
    ["a", "31683:<artist-pubkey>:neon-wave:electric-dreams", "<relay-hint>"],
    ["a", "31683:<artist-pubkey>:retrowave:sunset-cruise", "<relay-hint>"]
  ]
}
```

Private tracks use NIP-44 self-encryption in `.content`.

**Artist Following** -- kind:30000 Follow Sets:

```jsonc
{
  "kind": 30000,
  "tags": [
    ["d", "favorite-artists"],
    ["title", "Favorite Artists"],
    ["p", "<artist1-pubkey>", "<relay-hint>"],
    ["p", "<artist2-pubkey>", "<relay-hint>"]
  ]
}
```

Uses dedicated follow sets (not kind:3) to separate music follows from social graph.

### 5.2 Zap Integration for Track Monetization

Full NIP-57 flow per track:

1. Read artist's `lud16` from kind:0 profile
2. Read `zap` tags from track event for split configuration
3. Construct kind:9734 zap request (NOT published to relays)
4. Send to artist's lnurl callback with `nostr` query param
5. Receive bolt11 invoice, pay via NIP-47 NWC or external wallet
6. Artist's lnurl server publishes kind:9735 zap receipt
7. Backend `relayIngester` picks up receipt, updates Redis zap counters

**Redis Keys:**
- `zap_total:a:31683:<pubkey>:<d-tag>` -- sum of sats
- `zap_count:a:31683:<pubkey>:<d-tag>` -- number of zaps

---

## 6. Media Pipeline Architecture

### 6.1 Upload-to-Publish Flow

```
Step 1: UPLOAD
  POST /api/content/upload (multipart/form-data)
  -> Go Gateway verifies NIP-98 auth (kind:27235 event)
  -> Fastify contentService validates file type + size
  -> Store raw file in object storage

Step 2: TRANSCODE (future work)
  Video:
    - Multi-bitrate: 1080p/5Mbps, 720p/2.5Mbps, 480p/1Mbps, 360p/500kbps
    - HLS segmentation: 6-second segments, master playlist
    - Thumbnail: frame at 25% duration
    - Preview clip: first 15s at 480p
  Audio:
    - Normalize to -14 LUFS (EBU R128)
    - 320kbps + 128kbps MP3 variants
    - Waveform data extraction

Step 3: STORE
  -> Primary object storage -> CDN origin
  -> Blossom server upload (NIP-B7) -> SHA-256 addressed
  -> Compute SHA-256 hash for each output

Step 4: CONSTRUCT EVENT
  Client builds kind 21/22 event with imeta tags per NIP-71/NIP-92:
    ["imeta", "dim 1080x1920", "url https://cdn.../1080.mp4", "x abc123...",
     "m video/mp4", "fallback https://blossom.../abc123.mp4",
     "bitrate 5000000", "duration 29.5"]
  Include HLS variant: "m application/x-mpegURL"

Step 5: SIGN AND PUBLISH
  Client signs via NIP-07/Tauri -> Published to relays
  relayIngester picks up event, indexes metadata
```

**Note:** Transcoding (Step 2) is planned for Phase 3. Initial implementation supports direct file upload and passthrough storage without server-side transcoding.

### 6.2 Blossom Integration (NIP-B7)

```
Upload: SHA-256 file -> PUT to user's kind:10063 server list
Discovery: On URL failure, read publisher's kind:10063, try alternate servers
Verify: Downloaded file's SHA-256 must match event's imeta `x` field
```

### 6.3 CDN Caching Strategy

| Pattern | Edge TTL | Notes |
|---------|----------|-------|
| `/v/*/segments/*` | 30 days, immutable | HLS segments are content-addressed |
| `/v/*/master.m3u8` | 1 hour | Manifests may update |
| `/tracks/*` | 30 days, immutable | Audio files |
| `/covers/*` | 7 days, stale-while-revalidate | Album art |
| `/thumbnails/*` | 7 days | Video thumbnails |
| `/avatars/*` | 1 day | User avatars can change |

### 6.4 Adaptive Bitrate Streaming

HLS master playlist with 4 quality tiers. Client uses hls.js (web) or native Tauri media to auto-select based on bandwidth.

---

## 7. Backend Architecture

The backend is a single-process Fastify service with background workers, fronted by a Go API gateway, and backed by a custom Rust NIP-29 relay. All data lives in PostgreSQL, with Redis for caching/rate-limiting and Meilisearch for full-text search.

### 7.1 Custom Rust Relay (`services/relay/`)

Built with **axum + tokio + sqlx**. Handles all Nostr protocol operations:

- **NIP-01:** Event storage (`relay.events` table), subscription management, REQ/CLOSE/EOSE
- **Dynamic query filtering:** `query_events()` builds parameterized SQL from filter fields (ids, authors, kinds, since, until, #h/#p/#e/#d tags) with configurable limit (default 500, max 5000)
- **Live event broadcasting:** `tokio::sync::broadcast` channel (capacity 4096) pushes new events to all connected clients with matching subscriptions via `tokio::select!`
- **NIP-29:** Group management (kinds 9000-9022 for admin actions, 39000-39002 for group metadata). NIP-29 events are stored and broadcast after handler execution.
  - `relay.groups`, `relay.group_members`, `relay.group_roles`, `relay.invite_codes` tables
- **NIP-42:** AUTH challenge/response for authenticated relay access
- **NIP-50:** Full-text search via PostgreSQL `tsvector` columns on event content. `query_events()` delegates to NIP-50 search when the filter has a `search` field.
- **Relay identity:** Configurable keypair (`RELAY_SECRET_KEY` env var, or auto-generated) for signing kind:39000/39001/39002 group metadata events via secp256k1 schnorr
- **Signature verification:** secp256k1 schnorr signature validation on all incoming events

**Key source files:**
- `src/main.rs` -- Entry point, config loading
- `src/server.rs` -- axum router, WebSocket upgrade handler, AppState with broadcast channel + relay identity
- `src/connection.rs` -- Per-client WebSocket handler with `tokio::select!` for WS + broadcast
- `src/relay_identity.rs` -- Relay keypair management and event signing
- `src/nostr/event.rs` -- Event parsing and validation
- `src/nostr/filter.rs` -- Nostr filter matching (used for live subscription filtering)
- `src/nostr/verify.rs` -- Schnorr signature verification
- `src/nostr/nip29/` -- NIP-29 group logic
- `src/protocol/handler.rs` -- WebSocket message routing, broadcast after store
- `src/protocol/subscription.rs` -- Subscription lifecycle with `matching_subs()` for broadcast
- `src/protocol/nip42.rs` -- AUTH challenge/response
- `src/protocol/nip50.rs` -- Full-text search queries
- `src/db/event_store.rs` -- Event persistence with dynamic parameterized query building
- `src/db/group_store.rs` -- Group persistence
- `src/db/pool.rs` -- Connection pool management
- `src/music/kinds.rs` -- Music event kind validation (tag-based: checks `title` and `d` tags)

### 7.2 Go API Gateway (`services/gateway/`)

Lightweight reverse proxy handling cross-cutting concerns before requests reach the Fastify backend:

- **NIP-98 Auth:** Verifies kind:27235 signed events in the `Authorization` header. Validates the event's `u` (URL) and `method` tags match the request. Injects `X-Auth-Pubkey` header for downstream services.
- **Rate Limiting:** Redis sliding-window rate limits per pubkey:
  - 100 reads/min
  - 30 writes/min
  - 10 search/min
- **CORS:** Configurable origin allowlist
- **Reverse Proxy:** Forwards authenticated requests to `http://backend:3002`

**Key source files:**
- `cmd/gateway/` -- Entry point
- `internal/auth/` -- NIP-98 event verification
- `internal/ratelimit/` -- Redis sliding-window implementation
- `internal/cors/` -- CORS middleware
- `internal/proxy/` -- Reverse proxy to backend
- `internal/config/` -- Configuration loading
- `internal/logging/` -- Structured logging

### 7.3 Fastify Backend (`services/backend/`)

Single Node.js/Fastify service (`@thewired/backend`) that handles all API logic, background indexing, and data processing.

**Routes:**

| Route Module | Purpose |
|-------------|---------|
| `spaces` | Space directory listing, creation, metadata |
| `invites` | Invite code generation, redemption |
| `members` | Member listing, role management |
| `permissions` | RBAC permission checks and updates |
| `search` | Full-text search via Meilisearch |
| `feeds` | Trending and personalized feed endpoints |
| `push` | Push notification registration and dispatch |
| `analytics` | View counts, engagement metrics |
| `content` | Media upload handling, content metadata |
| `profiles` | Profile cache and resolution |
| `music` | Audio/cover upload (`POST /music/upload`, `POST /music/upload/cover`) |
| `health` | Health check endpoint |

**Services:**

| Service | Purpose |
|---------|---------|
| `spaceDirectory` | Space discovery, directory listing, featured spaces |
| `inviteService` | Invite code lifecycle (create, validate, redeem) |
| `permissionService` | RBAC checks against `app.permissions` and `app.roles` |
| `pushService` | Push notification delivery |
| `searchService` | Meilisearch index management and query execution |
| `feedService` | Feed composition from precomputed Redis sorted sets |
| `analyticsService` | Event counting, engagement tracking |
| `spamService` | Reputation scoring, rate anomaly detection |
| `contentService` | Upload handling, file metadata management |
| `musicService` | Audio/cover upload with MIME validation, SHA-256, disk storage |
| `profileCacheService` | Profile resolution with Redis caching layer |

**Background Workers:**

| Worker | Schedule/Trigger | Purpose |
|--------|-----------------|---------|
| `relayIngester` | Continuous (WebSocket) | Subscribes to kinds 0/1/7/9/22/30023/34236/9735/9021/9022/39000/31683/33123/30119. Indexes profiles into `cached_profiles` + Meilisearch, tracks space activity + member engagement, updates Redis zap counters, manages space membership, syncs group metadata. Indexes music tracks and albums into Meilisearch `tracks`/`albums` indexes. Tracks `since` for reconnect. |
| `trendingComputer` | Every 5 minutes | Scores events using `(zap_count*10 + reaction_count*3 + view_count + comment_count*5 + log2(zap_sats)*2) * time_decay`. 4 periods (1h/6h/24h/7d), top 100 per period to `trending_snapshots` + Redis sorted sets. Includes music kinds 31683/33123 → `trending:music:tracks` and `trending:music:albums`. |
| `profileRefresher` | Every hour | Finds profiles with `fetched_at > 24h` (limit 50), batch-fetches kind:0 from relay, upserts into `cached_profiles` + Meilisearch. |
| `notificationDispatcher` | Every 30 seconds | Queries unsent `notification_queue` (limit 100), sends via `web-push` with VAPID, removes 410 Gone subscriptions. |
| `analyticsAggregator` | Every 24 hours | Aggregates yesterday's relay events by space into `space_activity_daily`. Rolls up per-member engagement. Updates `spaces.messages_last_24h` and `active_members_24h`. |

### 7.4 PostgreSQL Schema Design

All data lives in a single PostgreSQL 16 database (`thewired`) with two schemas:

**`relay` schema** -- Managed by the Rust relay via sqlx migrations:

```sql
relay.events          -- Raw Nostr events (id, pubkey, kind, created_at, tags, content, sig)
                      -- tsvector column for NIP-50 full-text search
relay.groups          -- NIP-29 group metadata (group_id, name, picture, about, access)
relay.group_members   -- Group membership (group_id, pubkey, joined_at)
relay.group_roles     -- Group roles and permissions (group_id, pubkey, role)
relay.invite_codes    -- Group invite codes (code, group_id, creator, uses_remaining)
```

**`app` schema** -- Managed by the Fastify backend via Drizzle ORM migrations:

```sql
app.spaces            -- Space directory (id, group_id, name, description, featured)
app.invites           -- Application-level invites
app.members           -- Denormalized member data with display info
app.roles             -- RBAC role definitions
app.permissions       -- RBAC permission assignments
app.notifications     -- Notification queue
app.content           -- Content metadata (uploads, transcoding status, URLs)
app.profiles          -- Cached profile data from kind:0 events
app.analytics         -- View counts, engagement metrics, aggregations
app.moderation        -- Moderation actions and reports
app.feeds             -- Precomputed feed entries and metadata
app.music_uploads     -- Uploaded audio/cover files (id, pubkey, sha256, url, mime_type, file_size)
```

### 7.5 Redis Usage

Redis 7 serves two distinct roles:

**Gateway (rate limiting):**
- `rate:{pubkey}:read` -- Sliding window counter (100/min)
- `rate:{pubkey}:write` -- Sliding window counter (30/min)
- `rate:{pubkey}:search` -- Sliding window counter (10/min)

**Backend (caching and precomputed data):**
- `trending:reels` / `trending:tracks` / `trending:longform` -- Sorted sets (ZSET)
- `trending:music:tracks` / `trending:music:albums` -- Music trending sorted sets (ZSET)
- `personalized:{pubkey}:reels` -- Sorted set, 1hr TTL
- `featured:artists` -- Sorted set
- `view_count:{event_id}` / `zap_total:{event_id}` / `zap_count:{event_id}` -- Counters
- `profile:{pubkey}` -- Cached profile JSON, 1hr TTL
- `space:directory` -- Cached space listings

### 7.6 Meilisearch Usage

Meilisearch v1.6 provides full-text search for the API layer:

- **Indexes:** events, profiles, tracks, albums
- **`tracks` index:** searchable (title, artist, genre), filterable (pubkey, genre), sortable (created_at)
- **`albums` index:** searchable (title, artist, genre), filterable (pubkey, genre), sortable (created_at)
- **Boosting:** `title` > `artist_name` > `genre` > `content`
- **Sync:** `relayIngester` worker pushes documents to Meilisearch as it processes events (profiles, articles, music tracks, albums)
- **Relay-level search:** The Rust relay has its own NIP-50 search via PostgreSQL `tsvector`, independent of Meilisearch

### 7.7 Shared Types Package (`packages/shared-types/`)

`@thewired/shared-types` provides TypeScript types shared between the backend and any TypeScript consumers:

- `nostr.ts` -- Nostr event types, unsigned events, filters, event kind constants
- `space.ts` -- Space, channel, member types
- `profile.ts` -- Profile types
- `api.ts` -- API request/response DTOs (includes `TrendingMusicParams`)
- `permissions.ts` -- RBAC permission and role types
- `music.ts` -- Music upload/search DTOs (`MusicUploadResponse`, `MusicSearchResult`)

---

## 8. Event Deduplication Strategy

### Multi-Layer Architecture

| Layer | Location | Mechanism | Capacity |
|-------|----------|-----------|----------|
| 1 | Client | Bloom filter + LRU | 100K events, ~120KB RAM |
| 2 | Rust Relay | PostgreSQL unique constraint on `event.id` | Unlimited (disk) |
| 3 | Backend `relayIngester` | In-memory seen set + PostgreSQL upsert | Bounded by event volume |

For **addressable events** (30000-39999): compare `created_at`, only store the latest per `pubkey + kind + d_tag`. Both the Rust relay and the backend `relayIngester` enforce this.

---

## 9. Feed Ranking and Discovery

### Trending Algorithm

Computed by the `trendingComputer` background worker every 5 minutes. Scores events from the last 7 days. Writes to Redis sorted sets (`trending:reels`, `trending:tracks`, `trending:longform`).

**Trending Score:**
```
score = (zap_count * 10 + reaction_count * 3 + view_count * 1 + comment_count * 5
         + log2(zap_sats) * 2) * time_decay(created_at)

time_decay(t) = 1 / (1 + hours_since(t) / 24)^1.5
```

### Personalized Feed

Computed on demand by `feedService`, cached 1 hour in Redis. Based on follow graph (1 hop), social boost multipliers (6x for follows, 3x for follow-of-follows), mute list exclusion. Falls back to trending if insufficient data.

**Redis Keys:**
- `trending:reels` / `trending:tracks` / `trending:longform` -- ZSET
- `trending:music:tracks` / `trending:music:albums` -- ZSET (music-specific trending)
- `personalized:{pubkey}:reels` -- ZSET, 1hr TTL
- `featured:artists` -- ZSET

### Search

Two complementary search paths:
1. **API search:** Client -> Gateway -> Fastify -> Meilisearch (full-text, typo-tolerant, fast)
2. **Relay NIP-50 search:** Client -> Rust Relay -> PostgreSQL tsvector (protocol-native, for relay-level queries)

Results can be merged and deduplicated by event ID on the client.

---

## 10. Infrastructure and Deployment

### 10.1 Docker Compose (Development and Production)

All infrastructure runs via `docker-compose.yml`:

| Service | Image / Build | Port | Depends On |
|---------|---------------|------|------------|
| `postgres` | `postgres:16-alpine` | 5432 | -- |
| `redis` | `redis:7-alpine` (256MB, allkeys-lru) | 6380 | -- |
| `meilisearch` | `getmeili/meilisearch:v1.6` | 7700 | -- |
| `relay` | Build from `services/relay/Dockerfile` | 7777 | postgres |
| `backend` | Build from `services/backend/Dockerfile` | 3002 | postgres, redis, relay, meilisearch |
| `gateway` | Build from `services/gateway/Dockerfile` | 9080 | backend, redis |

**Volumes:** `pgdata` (PostgreSQL), `meilidata` (Meilisearch)

### 10.2 NIP-77 Negentropy Sync (Future)

Use negentropy-wasm for efficient reconnect. Instead of `since`-based re-fetch (sends thousands of already-seen events), Negentropy computes exact set difference in 1-3 round trips. Trigger on:
- Reconnect after > 5 min offline
- Initial load of space with cached data
- Periodic sync every 30 min for active subscriptions

### 10.3 CDN Edge Caching

See Section 6.3 for full cache rule table. Key principle: media segments are immutable and content-addressed, cache aggressively (30 days). API responses are never edge-cached.

---

## 11. Identity and Key Management

### 11.1 NIP-07 (Browser Extension)

Check `window.nostr`, delegate `getPublicKey()` and `signEvent()`. Support NIP-44 encrypt/decrypt for private lists.

### 11.2 Tauri Native Keystore

Private key stored in OS keychain (macOS Keychain / Windows DPAPI / Linux Secret Service). Signing happens in Rust via Tauri IPC -- private key **never** exposed to JavaScript layer.

### 11.3 NIP-42 Relay Authentication

```
Relay sends ["AUTH", "<challenge>"]
Client constructs kind:22242 event with relay + challenge tags
Client sends ["AUTH", <signed event>]
Relay validates, grants access to restricted operations
```

Used by the custom Rust relay for authenticated NIP-29 group operations.

### 11.4 NIP-98 HTTP Authentication

```
Client constructs kind:27235 event with "u" (URL) and "method" tags
Client sends event as base64 in Authorization header
Go Gateway verifies signature, checks URL + method match, checks expiry
Gateway injects X-Auth-Pubkey header for the backend
```

Used for all API requests through the Go gateway.

---

## 12. Wallet Integration

### 12.1 NIP-57 Zap Flow

```
1. Discover recipient's lnurl (from kind:0 lud16 field)
2. Construct kind:9734 zap request (NOT published)
3. Send to lnurl callback: GET <callback>?amount=<msats>&nostr=<event>&lnurl=<bech32>
4. Receive bolt11 invoice
5. Pay via NIP-47 NWC or webln
6. Recipient's server publishes kind:9735 zap receipt
7. Client validates: 9735 pubkey = recipient's nostrPubkey, amounts match
```

### 12.2 Real-Time Aggregation

Zap receipts flow through the Rust relay -> `relayIngester` worker -> Redis counter updates (atomic pipeline). Client subscribes to kind:9735 on the relay for real-time zap display.

SAT balance: NIP-47 `get_balance` every 60 seconds.

---

## 13. Phasing Strategy

### Phase 1: Foundation -- COMPLETE

**Goal:** Core relay connection, chat, basic media playback, identity.

**Client (done):**
- Tauri + React app shell with sidebar/center/right layout
- NIP-07 login + Tauri native keystore
- Multi-relay WebSocket manager (NIP-65)
- Subscription manager (REQ/CLOSE/EOSE)
- Event dedup (bloom filter), sig verify (Web Worker)
- IndexedDB cache, Redux store
- Kind:0 profile display/edit
- Kind:9 chat (NIP-C7, send/receive/reply)
- Basic Spaces UI (join, channels, NIP-29 scoping)
- Kind:21/22 video playback (HLS via hls.js, no upload)
- Kind:30023 long-form display (Markdown)
- Relay status display, reconnection with backoff + jitter

### Phase 2: Backend Services -- COMPLETE

**Goal:** Custom relay, backend API, gateway, infrastructure.

**What was built:**
- Custom Rust NIP-29 relay (axum + tokio + sqlx) with NIP-01/29/42/50 support
- Relay `query_events()` with dynamic parameterized SQL filtering (ids, authors, kinds, since, until, #h/#p/#e/#d tags)
- Relay live event broadcasting via `tokio::sync::broadcast` channel to all connected subscribers with filter matching
- Relay identity keypair (`RELAY_SECRET_KEY` env var) for signing kind:39000/39001/39002 metadata events
- Node.js/Fastify backend with routes, services, and fully implemented background workers
- Go API gateway with NIP-98 auth, Redis rate limiting, CORS, reverse proxy
- PostgreSQL dual-schema design (`relay` + `app`)
- Redis for caching and rate limiting
- Meilisearch for full-text search with auto-initialized `events` and `profiles` indexes
- Docker Compose for local development (postgres, redis, meilisearch, relay, backend, gateway)
- `@thewired/shared-types` package for shared TypeScript types
- RBAC enforcement on write routes (CREATE_INVITES, PIN_MESSAGES, MANAGE_MESSAGES)
- `relayIngester` worker: full indexing pipeline for kind:0/1/7/9/22/30023/34236/9735/9021/9022/39000/31683/33123/30119 into PostgreSQL + Redis counters + Meilisearch
- `trendingComputer` worker: engagement scoring with time decay across 4 periods (1h/6h/24h/7d), Redis sorted sets
- `profileRefresher` worker: stale profile re-fetch (>24h) from relay, Meilisearch sync
- `notificationDispatcher` worker: WebPush delivery with VAPID auth, expired subscription cleanup
- `analyticsAggregator` worker: daily rollup of space activity and per-member engagement
- `feedService.getPersonalized()`: follow-graph boosting (6x), mute list filtering, Redis ZSET caching (1hr TTL)
- Client API layer (`client/src/lib/api/`): NIP-98 auth header construction, typed `api<T>()` client with 429 retry, endpoint modules for spaces, invites, search, feeds, profiles, push, analytics, content

### Phase 3: Music and Media -- COMPLETE

**Goal:** Music library, playback, upload, search, and discovery.

**Client (~25 new files in `client/src/features/music/`):**
- Types: `MusicTrack`, `MusicAlbum`, `MusicPlaylist`, `MusicView`, `RepeatMode` in `client/src/types/music.ts`
- Event parsers: `trackParser.ts` (reuses `parseImetaTags` from media feature), `albumParser.ts`, `playlistParser.ts`
- Full `musicSlice` Redux state: normalized catalogs (`tracks`, `albums`, `playlists`), artist/album indices, library (saved tracks/albums, followed artists, playlists), player transport (queue, position, volume, repeat, shuffle with Fisher-Yates), discovery feeds, UI state (activeView, detailId, queueVisible, viewMode)
- Event pipeline integration: kinds 31683/33123/30119 parsed and dispatched to musicSlice + eventsSlice indices on receipt
- Event builders: `buildTrackEvent()`, `buildAlbumEvent()`, `buildPlaylistEvent()` for publish flow
- Audio engine (`useAudioPlayer.ts`): module-level `HTMLAudioElement` singleton, Media Session API (metadata + transport handlers), ~4Hz position dispatch, `x^3` volume curve, ended/repeat/shuffle logic
- `PlaybackBar.tsx`: 72px fixed transport bar with track info, shuffle/skip/play/repeat controls, progress slider, volume, queue toggle
- `QueuePanel.tsx`: right-side panel showing queue with remove/double-click-to-play
- `MusicSidebar.tsx`: Home, Recently Added, Artists, Albums, Songs, Playlists navigation + Upload button
- Sidebar mode toggle (`uiSlice.sidebarMode: "spaces" | "music"`) with `LayoutGrid`/`Music2` icons
- `MusicRouter.tsx`: keep-alive routing (CSS `display:none` for inactive, lazy mount via `visitedRef`) matching `ChannelPanel.tsx` pattern
- 9 view pages in `features/music/views/`: MusicHome (trending/recent discovery), SongList, AlbumGrid, ArtistList, PlaylistList, ArtistDetail, AlbumDetail, PlaylistDetail, RecentlyAdded
- Display components: `TrackCard` (grid card with play overlay), `AlbumCard` (grid card), `TrackRow` (table row with hover play icon)
- Memoized selectors (`musicSelectors.ts`) via `createSelector` for all music data access
- Library hook (`useLibrary.ts`): save/unsave tracks, follow/unfollow artists -- local Redux state (NIP-51 publish deferred)
- Search: `useMusicSearch.ts` (debounced, abort controller, parallel track+album queries) + `SearchInput.tsx` in TopBar
- Upload: `UploadTrackModal.tsx`, `CreateAlbumModal.tsx`, `CreatePlaylistModal.tsx` with file upload → event publish
- Space channel: `SpaceMusicView.tsx` for `#music` channel in spaces, registered in `ChannelPanel` and `ChannelList`
- Client API module (`lib/api/music.ts`): `uploadAudio()`, `uploadCoverArt()`, `getTrendingTracks()`, `getTrendingAlbums()`, `searchMusic()`

**Backend:**
- `POST /music/upload` (audio, auth-required, multipart, MIME validation, max 100MB) + `POST /music/upload/cover` (images, max 10MB)
- `musicService`: SHA-256 computation, file disk storage, Drizzle ORM persistence to `app.music_uploads` table
- `@fastify/multipart` registered for multipart form handling
- `relayIngester` expanded: subscribes to kinds 31683/33123/30119, indexes music tracks and albums into Meilisearch `tracks`/`albums` indexes
- `trendingComputer` expanded: scores music events, writes to Redis `trending:music:tracks` / `trending:music:albums`
- Meilisearch: `tracks` and `albums` indexes with searchable (title, artist, genre), filterable (pubkey, genre), sortable (created_at) attributes
- `searchService.searchMusic()` and `GET /search/music` endpoint

**Relay:**
- `music/kinds.rs`: validation changed from content-based JSON parsing to tag-based (`title` and `d` tag presence checks)

**Deferred to future phases:**
- FFmpeg transcoding workers (multi-bitrate HLS, audio normalization)
- Blossom server integration for decentralized file storage
- NIP-44 encrypted private playlists
- NIP-57 zap integration + NIP-47 NWC
- NIP-22 comments on tracks/videos/articles

### Phase 4: Discovery and Scale -- TODO

**Goal:** Ranking UI, search UI, spam filtering, live streaming.

**Client:**
- Trending/personalized feed UI (consuming backend `feedService` endpoints via client API layer)
- Search UI (local + Meilisearch API + NIP-50 federated)
- NIP-77 Negentropy sync
- NIP-53 live streaming + live chat
- Full NIP-29 moderation tools
- Sub-spaces, active members sidebar

**Backend:**
- `spamService` reputation model and anomaly detection
- Search ranking and boosting tuning in Meilisearch
- Monitoring (Prometheus + Grafana)

### Phase 5: Ecosystem -- TODO

- NIP-89 app handler registration
- Collaborative playlists
- Artist analytics dashboard
- Mobile companion app
- Plugin/extension API

---

## Critical First Files

| File | Purpose |
|------|---------|
| `client/src/lib/nostr/relayManager.ts` | Core multi-relay WebSocket manager. Foundation transport layer. |
| `client/src/lib/nostr/subscriptionManager.ts` | REQ/CLOSE/EOSE lifecycle, filter construction, dedup integration. |
| `client/src/store/index.ts` | Redux store with normalized entity shape. All UI reads from here. |
| `services/relay/src/main.rs` | Rust relay entry point. Custom NIP-29 relay for all group operations. |
| `services/relay/src/db/event_store.rs` | PostgreSQL event persistence. Core data layer for the relay. |
| `services/backend/src/server.ts` | Fastify backend entry point. Registers routes, services, workers. |
| `services/backend/src/workers/relayIngester.ts` | WebSocket bridge from Rust relay to backend data pipeline. |
| `services/backend/src/db/schema/` | Drizzle ORM schema definitions for the `app` PostgreSQL schema. |
| `services/gateway/cmd/gateway/` | Go gateway entry point. NIP-98 auth + rate limiting. |
| `packages/shared-types/src/index.ts` | Shared TypeScript types for nostr, spaces, profiles, music, API DTOs. |
| `client/src/store/slices/musicSlice.ts` | Full music state: catalogs, library, player transport, discovery, UI. |
| `client/src/features/music/useAudioPlayer.ts` | Audio engine: HTMLAudioElement singleton, Media Session API, queue logic. |
| `client/src/features/music/MusicRouter.tsx` | Keep-alive router for all music views. |
| `services/backend/src/services/musicService.ts` | Audio/cover upload with MIME validation, SHA-256, disk storage. |
| `docker-compose.yml` | Full local infrastructure: postgres, redis, meilisearch, relay, backend, gateway. |
