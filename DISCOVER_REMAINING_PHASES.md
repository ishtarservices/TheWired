# Discover, Friends Feed & Sidebar — Full Feature Doc

---

## Completed Phases

### Phase 1: Sidebar Foundation

| Feature | Description | Files |
|---------|-------------|-------|
| **Space Favorites** | Right-click a space → "Pin to Favorites". Pinned spaces appear in a dedicated section at the top of the space list. Persisted to IndexedDB. | `uiSlice.ts` (pinnedSpaceIds, togglePinnedSpace), `SpaceContextMenu.tsx` (Pin/Unpin item), `SpaceList.tsx` (Favorites section), `userStateStore.ts` (persistence) |
| **Quick Space Filter** | Search input appears when you have 6+ spaces. Filters by name in real-time. | `SpaceList.tsx` (filter input + logic) |
| **Messages Mode Fix** | The sidebar's Messages mode now renders the full DM sidebar (contacts, friends tab, search) instead of a dead placeholder. The `/dm` route center panel only shows the conversation. | `Sidebar.tsx` (renders DMSidebar), `DMSidebar.tsx` (removed fixed width/border), `DMView.tsx` (removed embedded DMSidebar) |
| **Collapsible Channel Categories** | Channels grouped by `categoryId` with collapsible headers. Collapsed categories show aggregated unread/mention badges. State persisted to localStorage per space. | `ChannelList.tsx` (CategoryHeader, CollapsedUnreadBadge, grouping logic) |
| **Discover Button** | Compass icon in sidebar header (separated from mode toggles by a divider). Navigates to `/discover`. | `Sidebar.tsx` (Compass button), `TopBar.tsx` (location display for /discover) |

### Phase 2: Friends Feed

| Feature | Description | Files |
|---------|-------------|-------|
| **Virtual Space Entry** | "Friends Feed" appears at the top of the space list with a Users icon. It's not a real NIP-29 group — it uses sentinel ID `__friends_feed__`. | `friendsFeedConstants.ts` (FRIENDS_FEED_ID, FRIENDS_FEED_CHANNELS), `SpaceList.tsx` (entry rendering) |
| **Follow List Subscriptions** | When Friends Feed is selected, subscribes to kind:1 (notes), kind:20/21/22 (media), kind:30023 (articles) from all follow list pubkeys on read relays. | `groupSubscriptions.ts` (enterFriendsFeed, switchFriendsFeedChannel, leaveFriendsFeed, refreshFriendsFeed, loadMoreFriendsFeed) |
| **Event Pipeline Indexing** | Events from followed authors are indexed into `__friends_feed__:notes/media/articles` in the events slice. Cross-indexes notes with media URLs into the media feed. | `eventPipeline.ts` (Friends Feed indexing block in indexEventIntoSpaceFeeds) |
| **Feed Pagination** | Pull-to-refresh and load-more work for Friends Feed using the same infrastructure as space feeds. | `useFeedPagination.ts` (Friends Feed branch) |
| **Channel Panel** | `FriendsFeedPanel` reuses existing `NotesFeed`, `MediaFeed`, `LongFormView` with keep-alive rendering pattern. Shows empty state when no follows. | `FriendsFeedPanel.tsx`, `App.tsx` (MainContent routing) |
| **useSpace Integration** | `selectSpace()` handles sentinel ID — leaves previous space, opens Friends Feed subscriptions. `selectChannel()` switches subscriptions. `resolveActiveChannel()` returns hardcoded channels. | `useSpace.ts` (FRIENDS_FEED_ID branches in selectSpace, selectChannel, resolveActiveChannel) |

### Phase 3: Discovery Backend + Frontend

| Feature | Description | Files |
|---------|-------------|-------|
| **Database Migration** | Tables: `listing_requests`, `space_categories` (seeded with 11 categories), `relay_directory`. New columns on `spaces`: `listed`, `listed_at`, `discovery_score`. Indexes for discovery queries. | `0013_discovery.sql` |
| **Drizzle Schema** | Full ORM definitions for all new tables. | `db/schema/discovery.ts`, `db/schema/spaces.ts` (added listed/listedAt/discoveryScore) |
| **Discovery Service** | Business logic: browse listed spaces (category/tag/search/sort), featured spaces, categories with counts, listing request submit/review, relay directory, score computation, auto-delisting. | `services/discoveryService.ts` |
| **Listing Request Flow** | Space admins submit listing requests. **Admin bypass**: `ADMIN_PUBKEYS` can list spaces regardless of member count (for testing). Auto-approve path for 20+ members & 7+ days old. Manual review queue for others. Auto-delist after 30 days inactive. | `services/discoveryService.ts` (submitListingRequest, reviewListingRequest) |
| **API Routes** | 8 endpoints: `GET /discovery/spaces`, `GET /discovery/spaces/featured`, `GET /discovery/categories`, `POST /discovery/listing-requests`, `GET /discovery/listing-requests`, `PATCH /discovery/listing-requests/:id`, `GET /discovery/relays` | `routes/discovery.ts` |
| **Score Worker** | Runs every 15 min. Score = `members*2 + active24h*5 + messages24h + recencyBoost`. Auto-delists inactive spaces (0 messages, 0 active, <3 members, listed 30+ days). | `workers/discoveryScoreComputer.ts` |
| **Config** | `ADMIN_PUBKEYS` (comma-separated hex pubkeys), `MIN_LISTING_MEMBERS` (default 5). | `config.ts` |
| **Client API** | Typed API client with all discovery endpoints. Types: `DiscoverSpace`, `SpaceCategory`, `DiscoverRelay`, `ListingRequest`. | `lib/api/discover.ts` |
| **Discover Page** | Four tabs (Spaces, Relays, Communities, People). Spaces tab: featured section (horizontal scroll), trending section (2-col grid), category chip filters, browse-all with search/pagination. Relays tab: grid of relay cards. Loading skeletons and empty states. | `features/discover/DiscoverPage.tsx` |
| **Route + Navigation** | `/discover` route in App.tsx. TopBar shows "Discover" with Compass icon. RightPanel has `discover` context. | `App.tsx`, `TopBar.tsx`, `uiSlice.ts`, `useRightPanelContext.ts`, `RightPanel.tsx` |

---

## Remaining Phases (4-6)

---

## Phase 4: Discovery Frontend (Interactive Flows)

### 4.1 Join Space from Discover

**What:** Clicking a SpaceCard should let users join the space directly from the discover page.

**How:**
- Add a "Join" button to `SpaceCard` in `client/src/features/discover/DiscoverPage.tsx`
- Three states: "Join" (open group), "Request" (closed), "Joined" (already member)
- Check membership: compare `space.id` against `state.spaces.list` to determine if already joined
- On click: send kind:9021 join request via `signAndPublish()` from `client/src/lib/nostr/publish.ts`
- After join: call `useSpace().joinSpace()` to add to local state, navigate to the space

**Files:**
- `client/src/features/discover/DiscoverPage.tsx` — Add join button to `SpaceCard`
- `client/src/lib/nostr/publish.ts` — Reuse `signAndPublish` for kind:9021

### 4.2 Add Relay from Discover

**What:** Clicking a RelayCard "Add" button should add the relay to the user's connection list.

**How:**
- Add "Add" / "Connected" button to `RelayCard`
- Check connection status: compare `relay.url` against `state.relays.connections`
- On click: call `relayManager.addRelay(url, "read+write")` from `client/src/lib/nostr/relayManager.ts`
- Optionally publish updated kind:10002 relay list event

**Files:**
- `client/src/features/discover/DiscoverPage.tsx` — Add button to `RelayCard`
- `client/src/lib/nostr/relayManager.ts` — Existing `addRelay()` method

### 4.3 Right Panel Discover Preview

**What:** Clicking a space or relay card opens a detail preview in the RightPanel.

**How:**
- Create `client/src/features/discover/DiscoverPreviewPanel.tsx`
- Add Redux state for selected preview: `discoverPreview: { type: "space" | "relay"; id: string } | null`
- Space preview: full description, member list sample, admin names, category, creation date, host relay
- Relay preview: full NIP-11 info, all supported NIPs, connection stats, list of follows using it
- Wire into `RightPanel.tsx` under the `discover` context block (currently shows placeholder)

**Files to create:**
- `client/src/features/discover/DiscoverPreviewPanel.tsx`

**Files to modify:**
- `client/src/components/layout/RightPanel.tsx` — Replace placeholder with `DiscoverPreviewPanel`
- `client/src/store/slices/uiSlice.ts` — Add `discoverPreview` state (or use local state in DiscoverPage)
- `client/src/features/discover/DiscoverPage.tsx` — Dispatch preview selection on card click

### 4.4 Listing Request UI (Space Admins)

**What:** Space admins should be able to request their space be listed in the discover directory.

**How:**
- Add "List in Directory" button to `SpaceInfoPanel` (right panel, Info tab) for space creators/admins
- Opens a modal with category selector, tag input, and reason textarea
- Calls `POST /discovery/listing-requests` via `submitListingRequest()` from `client/src/lib/api/discover.ts`
- Shows status badge for pending/approved/rejected

**Files to create:**
- `client/src/features/discover/ListSpaceModal.tsx`

**Files to modify:**
- `client/src/features/spaces/SpaceInfoPanel.tsx` — Add "List in Directory" button

### 4.5 Meilisearch Spaces Index

**What:** Full-text search for spaces in the discover page should use Meilisearch instead of SQL ILIKE.

**How:**
- Add `spaces` index to `initIndexes()` in `services/backend/src/lib/meilisearch.ts`:
  ```
  searchableAttributes: ["name", "about"]
  filterableAttributes: ["category", "listed", "language"]
  sortableAttributes: ["member_count", "discovery_score", "created_at"]
  ```
- Index spaces into Meilisearch when they are listed/updated
- Update `discoveryService.getListedSpaces()` to use Meilisearch when `search` param is provided

**Files to modify:**
- `services/backend/src/lib/meilisearch.ts` — Add `spaces` index in `initIndexes()`
- `services/backend/src/services/discoveryService.ts` — Use Meilisearch for search queries

---

## Phase 5: Relay & Community Discovery

### 5.1 Relay Directory Worker

**What:** Background worker that populates the `relay_directory` table with relay info from NIP-66 monitors and NIP-11 probes.

**How:**
- Create `services/backend/src/workers/relayDirectoryWorker.ts`
- Runs every 6 hours
- **NIP-66 monitors:** Subscribe to known monitor pubkeys on bootstrap relays for kind:30166 events. Parse `d` tag (relay URL), `rtt-open`/`rtt-read`/`rtt-write` tags, `N` tags (supported NIPs), `T` tags (topics), `R` tag (requirements)
- **NIP-11 probing:** For each relay URL in the directory, HTTP GET with `Accept: application/nostr+json`. Parse JSON response for `name`, `description`, `supported_nips`, `software`, `version`, `limitation`, `fees`
- UPSERT results into `app.relay_directory`
- Seed initial data from hardcoded list of known relays (bootstrap relays + popular relays)

**Known NIP-66 monitor pubkeys** (find current ones from relay monitor lists):
- Query kind:10166 events on bootstrap relays to discover monitors dynamically

**Files to create:**
- `services/backend/src/workers/relayDirectoryWorker.ts`

**Files to modify:**
- `services/backend/src/index.ts` — Start the worker

### 5.2 Extend relayIngester for kind:10002 and kind:34550

**What:** Count how many platform users include each relay in their relay list, and index NIP-72 communities.

**How:**
- Add kind:10002 to the subscription filter in `relayIngester.ts` (around line 63)
- New handler `indexRelayList(event)`: parse `r` tags, for each relay URL call UPSERT on `relay_directory` and increment `user_count`
- Add kind:34550 to the subscription filter
- New handler `indexCommunity(event)`: parse community definition tags (`name`, `description`, `image`, `rules`, `p` moderator tags, relay tags), UPSERT into a `communities` table (create if not exists)
- Consider adding `communities` and `community_tags` tables if NIP-72 communities are needed (migration 0014)

**Files to modify:**
- `services/backend/src/workers/relayIngester.ts` — Add kinds, add handler functions

### 5.3 Relay Tab Enhancements

**What:** Make the Relays tab in the discover page more interactive.

**How:**
- **NIP capability filter:** Row of toggleable NIP badges (NIP-29, NIP-50, NIP-42, NIP-96). Clicking filters relays by that NIP. Uses `nip` query param on `GET /discovery/relays`
- **Connected section:** Show relays the user is currently connected to (from `state.relays.connections`) at the top
- **Recommended section:** Relays used by follows but not by the user. Client-side computation from kind:10002 events (lazy subscription when tab opens)
- **Health indicators:** Green/yellow/red dot based on `rttMs` thresholds (<100ms green, <500ms yellow, else red)

**Files to modify:**
- `client/src/features/discover/DiscoverPage.tsx` — Enhance `DiscoverRelaysTab`

### 5.4 Communities Tab

**What:** Browse NIP-72 moderated communities.

**How:**
- Create `DiscoverCommunitiesTab` component
- Client-side subscription: `{ kinds: [34550], limit: 100 }` on bootstrap relays — one-shot, close after EOSE
- Parse community events: `name` from `name` tag, `description` from `description` tag, `image` from `image` tag, moderators from `p` tags, topics from `t` tags
- Render as grid of `CommunityCard` components (image banner, name, description, moderator count, topic tags)
- Clicking opens the community in a future community view (or shows preview in RightPanel)
- Backend alternative: if `indexCommunity` from 5.2 is done, fetch from `GET /discovery/communities` API instead

**Files to modify:**
- `client/src/features/discover/DiscoverPage.tsx` — Replace communities placeholder

### 5.5 People Tab (Starter Packs + Suggested Follows)

**What:** Discover people to follow via starter packs and social graph suggestions.

**How:**
- **Starter packs (kind:39089):** Client-side subscription on bootstrap relays. Parse: `name`, `description`, `p` tags (included pubkeys). Render as cards with avatar stacks
- **Suggested follows (2nd degree):** Fetch follows-of-follows. Algorithm: get all `p` tags from kind:3 events of your follows, count occurrences, filter out already-followed pubkeys, sort by count. Show top N as suggestions with "X mutual follows" count
- Use `useProfile()` hook for each suggested pubkey to get display info
- "Follow" button calls `signAndPublish` to publish updated kind:3 event

**Files to modify:**
- `client/src/features/discover/DiscoverPage.tsx` — Replace people placeholder

---

## Phase 6: Polish

### 6.1 "Friends Are In" Section

**What:** Show spaces that people you follow are members of, on the discover Spaces tab.

**How:**
- Client-side subscription: `{ kinds: [10009], authors: [followPubkeys], limit: 500 }` on bootstrap relays — one-shot
- Parse each kind:10009 event's `group` tags: `["group", "<group-id>", "<relay-url>", "<optional-name>"]`
- Deduplicate group references, count how many follows are in each group
- For each discovered group, call `POST /spaces/validate` to check which exist in backend
- Display as horizontal scroll row with space card + small avatar stack of follows in that space
- Only fetch when discover page is opened (lazy)

**Files to modify:**
- `client/src/features/discover/DiscoverPage.tsx` — Add section to `DiscoverSpacesTab`

### 6.2 Command Palette (Cmd+K)

**What:** Global search overlay for quick access to spaces, channels, people, and actions.

**How:**
- Create `client/src/features/search/CommandPalette.tsx`
- Register `useEffect` for Cmd+K / Ctrl+K keydown at `Layout.tsx` level
- Search against local Redux state (spaces, channels, profiles) for instant results
- Sections: Spaces, Channels (in current space), People, Actions (Create Space, Browse Discover)
- Selecting a result navigates to the appropriate space/channel/profile
- Escape or clicking outside closes

**Files to create:**
- `client/src/features/search/CommandPalette.tsx`

**Files to modify:**
- `client/src/app/Layout.tsx` — Render `CommandPalette` + register keyboard shortcut

### 6.3 Animation Polish

**What:** Smooth transitions and micro-interactions across the new UI.

**How:**
- Staggered `animate-fade-in-up` on card grids in discover page (delay per-card using CSS `animation-delay`)
- Smooth collapse/expand animation on channel category headers (use `grid-template-rows` transition trick or `max-height`)
- Hover lift effect on space/relay cards (`hover:-translate-y-0.5 hover:shadow-lg`)
- Loading skeleton shimmer effect (existing `animate-pulse` may suffice, consider `animate-shimmer` for more polish)

### 6.4 Responsive/Narrow Adaptations

**What:** Ensure discover page and sidebar changes work well at narrow widths.

**How:**
- SpaceCard grid: `grid-cols-1` below `sm:`, `grid-cols-2` at `sm:`, `grid-cols-3` at `lg:`
- Tab bar horizontal scroll on narrow widths
- Category chips row scrolls horizontally (already done with `overflow-x-auto`)
- RightPanel preview collapses at narrow widths (show in modal instead)

### 6.5 Space Card Join Integration Testing

**What:** End-to-end test that joining a space from discover adds it to the sidebar.

**Verification steps:**
1. Navigate to `/discover`
2. Click "Join" on a listed space
3. Verify kind:9021 event is published to the space's host relay
4. Verify space appears in sidebar SpaceList
5. Verify channels load for the joined space
6. Verify "Join" button changes to "Joined" on the discover card

---

## Nostr Protocol Reference (for implementation)

| Feature | Event Kind | Tags | NIP |
|---------|-----------|------|-----|
| Group metadata | 39000 | `d` (group-id), `name`, `picture`, `about`, `public`/`private`, `open`/`closed` | 29 |
| User's group list | 10009 | `group` (group-id, relay-url, name) | 51 |
| Relay list | 10002 | `r` (relay-url, `read`/`write`) | 65 |
| Relay monitor data | 30166 | `d` (relay-url), `rtt-open`, `rtt-read`, `rtt-write`, `N` (supported NIPs) | 66 |
| Community definition | 34550 | `d` (community-id), `name`, `description`, `image`, `rules`, `p` (moderators) | 72 |
| User's communities | 10004 | `a` (community refs) | 51 |
| Starter packs | 39089 | `name`, `description`, `p` (included pubkeys) | 51 |
| Interest list | 10015 | `t` (hashtags) | 51 |
| Join request | 9021 | `h` (group-id) | 29 |
| Favorite relays | 10012 | `relay` (relay-url) | 51 |
| Relay info | NIP-11 | HTTP JSON at relay URL with `Accept: application/nostr+json` | 11 |

---

## File Index (Already Created)

| File | Purpose |
|------|---------|
| `client/src/features/discover/DiscoverPage.tsx` | Main discover page with tabs, search, cards |
| `client/src/features/friends/friendsFeedConstants.ts` | Sentinel ID + hardcoded channels |
| `client/src/features/friends/FriendsFeedPanel.tsx` | Friends Feed channel panel |
| `client/src/lib/api/discover.ts` | Client API for `/discovery/*` endpoints |
| `services/backend/src/db/schema/discovery.ts` | Drizzle schema for discovery tables |
| `services/backend/src/db/migrations/0013_discovery.sql` | DB migration |
| `services/backend/src/routes/discovery.ts` | API routes |
| `services/backend/src/services/discoveryService.ts` | Business logic |
| `services/backend/src/workers/discoveryScoreComputer.ts` | Score computation worker |

## Files to Create (Phases 4-6)

| File | Phase | Purpose |
|------|-------|---------|
| `client/src/features/discover/DiscoverPreviewPanel.tsx` | 4.3 | Right panel detail preview |
| `client/src/features/discover/ListSpaceModal.tsx` | 4.4 | Modal for listing a space |
| `services/backend/src/workers/relayDirectoryWorker.ts` | 5.1 | NIP-66 + NIP-11 relay crawler |
| `client/src/features/search/CommandPalette.tsx` | 6.2 | Cmd+K global search overlay |
