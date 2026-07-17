# The Wired — Mobile (`@thewired/mobile`)

Native iOS/Android client for [The Wired](../../README.md), the decentralized Nostr-native media
platform. Built with **Expo SDK 57 / React Native 0.86 / React 19**, NativeWind v4, Redux Toolkit,
and a shared TypeScript core (`@thewired/core`) extracted from the desktop client.

This is **not** a webview wrapper and not a rewrite: the platform-agnostic protocol/state/crypto
logic is shared with the desktop app behind adapter interfaces, and the UI is fully native
(tabs + stacks + sheets replacing the desktop's three-column shell).

---

## Status

Foundation phase, built in weekly milestones on `feat/mobile-foundation`:

| Milestone | What landed |
|-----------|-------------|
| Phase 1 | RN app foundation, local-key auth, guest browsing (App Store 5.1.1(v)) |
| W1 | Design system — type scale, motion, glass chrome, component primitives |
| W2 | Live protocol — SQLite storage, event verifier, relay pool, live global feed |
| W3 | Social MVP — profiles, threads, spaces directory, note actions |
| W4 | `@thewired/core` Phase-0 extraction (adapters, verify, dedup, profile parser, DM crypto) |
| W5 | NIP-17 DMs — gift-wrap engine, dmSlice + SQLite persistence, send path, conversation UI |
| W6 | Spaces chat (read + post + join, NIP-42 auth) and zaps (NWC tips) |
| W7 | Spaces UI/UX rebuild — rail home, discovery, typed channels, members, video, env-aware endpoints |
| W8 | "signal" redesign — monochrome default preset, JetBrains Mono protocol voice, film grain, floating pill tab bar, SpacesHome horizontal switcher + grouped channels with previews/unread, flat editorial feed |

**Working today:** identity (create/import/guest), live global notes feed, profiles, note threads,
composer, NIP-17 encrypted DMs, spaces discovery/join/leave, space chat (kind 9) with typed channel
feeds (notes / media / articles / music), channel last-message previews + per-channel read state,
role-grouped member lists, zaps via NWC, media lightbox + video playback, runtime theme switching
(monochrome "signal" default), moderation (block/report), offline/background lifecycle handling,
deep links.

**Placeholders (calm empty states, replaced screen-by-screen):** music home/album, AI chat,
article reader, join-via-invite, now playing, incoming call, space thread view.

**Deliberately deferred:** push notifications (Phase 3), native keystore signing + NIP-46 (Phase 4),
voice/video calling (Phase 4), background audio. `src/native/` is empty by design — the foundation
is pure JS/TS over Expo modules; native module bindings land there as they're built.

---

## Getting started

Install from the **monorepo root** (pnpm workspaces):

```bash
pnpm install
```

Start the dev stack (gateway, backend, relay, infra — see the root README) if you want live data
from your own machine, then:

```bash
cd apps/mobile
pnpm start          # Expo dev server (Metro); scan the QR with Expo Go, or press i / a
pnpm start:sim      # iOS-simulator-friendly variant (--localhost + IPv4-first DNS)
pnpm ios            # start + open iOS simulator
pnpm android        # start + open Android emulator
```

Other scripts:

```bash
pnpm test           # Jest (jest-expo) — 49 suites / 314 tests, no running stack needed
pnpm typecheck      # tsc --noEmit (strict)
pnpm prebuild       # expo prebuild (generate native projects)
pnpm generate:grain # regenerate assets/grain.png (deterministic, seeded — commit the result)
```

EAS build profiles are defined in `eas.json` (`development` = dev client, `preview` = internal
distribution, `production` = auto-incrementing store build).

### Endpoints & environment

Endpoint resolution lives in `src/lib/env.ts` and mirrors the desktop client's contract — **no env
file is needed for the default flows**:

| Build | API base | App relay |
|-------|----------|-----------|
| Dev (`expo start`) | `http://<metro-host>:9080/api` | `ws://<metro-host>:7777` |
| Release | `https://api.thewired.app/api` | `wss://relay.thewired.app` |

The dev host is derived from **Metro's `hostUri`**, not a literal `localhost` — so a physical
device on LAN reaches the dev stack running on the same machine as Metro. `__DEV__` is compiled
false in release builds, so a prod bundle can never accidentally target a dev machine.

Overrides (Expo inlines `EXPO_PUBLIC_*` at bundle time — the mobile analog of `VITE_*`; see
`.env.example`):

```bash
EXPO_PUBLIC_API_URL=      # point a dev bundle at prod/staging API
EXPO_PUBLIC_RELAY_URL=    # point a dev bundle at another relay
EXPO_PUBLIC_QA_NSEC=      # dev-only auto-login (compiled out of release builds)
```

The default relay set is the app relay plus `wss://relay.damus.io` and `wss://nos.lol` — a
deliberate **3-socket resting budget** for battery.

---

## Architecture

### Dependency injection, no singletons

Where the desktop client uses module-level singletons (`relayManager`, `subscriptionManager`), the
mobile app builds its object graph **once** in `App.tsx` and threads it explicitly:

```
createMobileAdapters()            src/platform/adapters
        │
        ├──▶ createStore(adapters)          adapters ride as the Redux thunk extraArgument
        │
        └──▶ createNostrEngine({ adapters, dispatch, getState })
                    │
                    └──▶ <EngineProvider engine={…}>   screens reach it via useEngine()
```

`PlatformAdapters` (interface defined in `@thewired/core`, re-exported through
`src/core/adapters`) is the seam between shared logic and the platform:

| Adapter | Mobile implementation |
|---------|----------------------|
| `wsFactory` | React Native's global `WebSocket` |
| `storage` | expo-sqlite key-value stores (see [Storage](#storage)) |
| `secretStore` | expo-secure-store (iOS Keychain / Android Keystore) |
| `verifier` | inline @noble schnorr verify (`verifyEventSync` from core) |
| `signer` | `null` until login, then `LocalNsecSigner` |
| `http` | RN `fetch`; **throws** on `maxRedirections` (RN can't control redirects — a native SSRF-safe fetch closes this later) |
| `push` | explicit `notImplemented` stub (Phase 3) |

Design principle: loud not-implemented stubs beat silent no-ops.

### Event flow

```
relay frame ─▶ relayPool ─▶ engine.routeEvent
                              │  dedup (bounded seen-set)
                              │  verify (fail closed — unverified events are dropped)
                              ├─ kind 1     ─▶ feedSlice (50ms batched) + SQLite write-through
                              ├─ kind 0     ─▶ profilesSlice (parseProfile from core)
                              ├─ kind 9735  ─▶ zapsSlice ({msat, count} aggregates only)
                              └─ kind 1059  ─▶ dmEngine ONLY (ciphertext never enters feed surfaces)
```

### Shared core boundary (`@thewired/core`)

The mobile app consumes from `packages/core`: the **adapter interface surface**, **kind constants**
(13 / 14 / 1059), **NIP-17/NIP-59 crypto** (`buildRumor`, `createGiftWrappedDM`, `createSelfWrap`,
`unwrapGiftWrap`), **profile parsing** (`parseProfile` — hardened against attacker-controlled
kind-0 JSON), and **event verification** (`verifyEventSync`). DM crypto comes *exclusively* from
core — never forked here.

Everything else (relay pool, engine, chat sessions, NIP-98, lightning, API clients, lifecycle) is
currently mobile-local, written to migrate into core at Phase 0b. Low-level protocol types
(`NostrEvent`, `NostrFilter`, …) come from `@thewired/shared-types`.

### Mobile lifecycle (the #1 mobile risk)

iOS kills sockets seconds after backgrounding; the desktop core has no AppState/NetInfo handling at
all. `src/platform/lifecycle/MobileLifecycleController.ts` owns those transitions and drives both
Redux (`lifecycleSlice`) and the engine:

- **Background** → the pool closes sockets gracefully.
- **Foreground** → reconnect + resubscribe with a fresh `since = lastSeenAt − 60s` (clock-skew
  overlap), so nothing is missed across suspension — plus a direct `NetInfo.fetch()` re-check
  (the event stream may have dropped a connectivity change while suspended).
- **Connectivity returns** → `reconnectNow()` cycles **every** socket, including ones whose
  `readyState` still claims OPEN — after a network flap iOS sockets go half-open (dead on the
  wire, never firing error/close), so any socket predating the edge is untrustworthy. Tracked
  REQs replay on open.
- **While offline** → NetInfo's recovery event is unreliable on iOS (especially the simulator),
  so the controller re-probes with `NetInfo.fetch()` every 4s until connectivity returns.

An offline banner (hairline mono pill — status is never a color fill) renders whenever
`lifecycle.isOnline` is false.

---

## Directory map

```
apps/mobile/
├── App.tsx                  # Object-graph wiring, fonts, theme boot, lifecycle, session hydration
├── index.ts                 # Entry — loads polyfills FIRST, then registers App
├── app.json                 # Expo config (bundle id app.thewired.mobile, schemes thewired/nostr)
├── eas.json                 # EAS build profiles
├── metro.config.js          # pnpm-monorepo-aware Metro (workspace watchFolders, single React)
├── tailwind.config.js       # NativeWind theme — same token vocabulary as the desktop client
├── jest.config.js           # jest-expo preset, pnpm-aware transformIgnorePatterns
├── scripts/qaDmPeer.ts      # Headless live-QA DM peer (runs the real engine under Node)
├── scripts/generate-grain.js# Zero-dep seeded PNG generator for the grain overlay tile
└── src/
    ├── auth/                # Key gen/parse (NIP-19), session thunks, LocalNsecSigner
    ├── components/
    │   ├── ui/              # Primitives: Type, Button, Card, Avatar, ActionsSheet, Pill, …
    │   ├── notes/           # NoteCard + useNoteActions (long-press sheet: copy/report/block/zap)
    │   ├── zaps/            # ZapSheet, WalletSection (NWC pairing)
    │   ├── auth/            # SignInGate (guest-mode gate at the action, not the screen)
    │   └── layout/          # Screen (the one place that knows chrome inset math), GrainOverlay, OfflineBanner
    ├── core/adapters/       # Re-export barrel for @thewired/core adapter interfaces
    ├── lib/
    │   ├── nostr/           # engine, relayPool, dmEngine, chatSession, nip98, spaceFeedRoutes, …
    │   ├── lightning/       # lnurl (NIP-57), nwc (NIP-47), zapService (orchestration)
    │   ├── api/             # Backend REST clients: spaces, discovery, spaceCache
    │   └── env.ts, haptics, animated, cn, time
    ├── native/              # (empty) native-module bindings land here — keystore, push, safe fetch
    ├── navigation/          # RootNavigator, TabNavigator, stacks, deep linking, tab reset
    ├── platform/            # Mobile adapters (sqlite, secure-store), polyfills, lifecycle, prefs
    ├── screens/             # auth/ spaces/ messages/ shared/ music/ ai/ you/ + PlaceholderScreen
    ├── store/               # createStore(adapters) + 9 slices (identity, feed, profiles, dm, zaps, moderation, relays, lifecycle, spacePreviews)
    ├── test/                # renderWithTheme, reanimated mock
    └── theme/               # Preset → derived-token engine, typography, motion, nav theme
```

---

## Key subsystems

### Navigation

Five bottom tabs on a **floating glass pill** (`FloatingTabBar` — detached from the screen edges,
icons only, a spring-sliding primary-filled circle marks the active tab; `BlurView` material on
iOS, solid fallback on Android). The custom bar reports its measured height through
`BottomTabBarHeightCallbackContext` — React Navigation does **not** measure custom tab bars, and
`useScreenInsets` depends on the real value. Each tab owns a native stack; re-pressing the focused
tab resets its stack to root:

| Tab | Root | Stack screens |
|-----|------|---------------|
| Spaces | SpacesHome | Discover, Space, Channel, SpaceFeed, SpaceMembers, Thread |
| Music | MusicHome | Album |
| Messages | DMList | DMConversation |
| AI | AIChatList | AIConversation |
| You | You | Settings |

Above the tabs, the root stack carries cross-cutting pushes (`Profile`, `NoteThread`, `Article`),
modals (`JoinSpace`, `NowPlaying`, `Composer`), and full-screen takeovers (`MediaLightbox`,
`VideoPlayer`, `IncomingCall`). Auth screens are conditionally mounted on identity status, so
nothing can navigate back across the login gate; in **guest** mode they're re-exposed as modals so
signing in from a `SignInGate` never loses the browsing session.

**Deep links** — prefixes `thewired://`, `https://thewired.app` (verified app links /
associated domains), and `nostr:`:

- Bare NIP-19 entities: `npub`/`nprofile` → Profile, `note`/`nevent` → NoteThread, `naddr` → Article
- `space/:id`, `space/:id/channel/:id`, `space/:id/members`, `space/:id/feed/:type/:id`
- `dm/:pubkey`, `profile/:pubkey`, `note/:id`, `article/:naddr`, `invite/:code`, `compose`
- Tab roots: `spaces`, `discover`, `music`, `dm`, `ai`, `you`, `settings`

Deep-linked screens mount as single-route stacks (an iOS 26 / react-native-screens workaround), so
`useBackFallback` injects an explicit back affordance that replaces to the logical parent.

### Auth & key custody

- `src/auth/keys.ts` is pure (no storage, no Redux): NIP-19 nsec/npub codecs, key generation,
  forgiving secret parsing (nsec any case, `nostr:` prefix, or 64-hex).
- `src/auth/session.ts` is the **only** place that touches key persistence: nsec goes to
  expo-secure-store (OS keychain), a `LocalNsecSigner` is installed on the adapters, and only
  `pubkey` + `signerType` enter Redux. **Secret keys never touch Redux.**
- **Guest mode** (App Store 5.1.1(v)): all public content is browsable without an account; write
  actions render a `SignInGate` at the point of action. The guest marker persists in SecureStore.
- Custody trade-off is explicit: the nsec enters JS memory to sign (weaker than desktop's
  Tauri-side signing). NIP-46 remote signing and a native keystore module are future
  `SignerAdapter` implementations — nothing downstream changes when they land.

### Protocol engine (`src/lib/nostr/`)

- **`relayPool.ts`** — minimal pool over the `WebSocketFactory` adapter: exponential backoff with
  jitter (ported from the desktop reconnect logic), subscription replay on reconnect, publish
  queueing, NIP-42 `AUTH` (signed kind 22242), and mobile-specific `suspend()` / `resume()` /
  `reconnectNow()`.
- **`engine.ts`** — dedup → verify → route → Redux + SQLite write-through; cold-start hydration
  from SQLite; 50ms-batched feed flushes; one-shot `fetchEvents` (EOSE + grace); optimistic
  `publishNote` with a 10s OK timeout.
- **`chatSession.ts`** — per-screen space chat: dials the space's `hostRelay` **on demand** (its
  own one-socket pool, closed on unmount so the resting set never grows), kind-9 backlog by `#h`
  tag, channel scoping via `["channel", id]` tags, NIP-42 challenge answering for gated groups,
  membership-gated posting.
- **`spaceFeedRoutes.ts`** — authors-mode space feeds (queries members' authors on the read relays,
  chunked ≤500 per filter): notes `[1, 1068]`, media `[20, 21, 22, 34235, 34236]`, articles
  `[30023]`, music `[31683, 33123]`.
- **`nip98.ts`** — signed kind-27235 `Authorization: Nostr <b64>` headers for the gateway.

### DMs (NIP-17)

`dmEngine.ts` owns the persistent kind-1059 gift-wrap subscription (`#p` = self), unwraps via
`@thewired/core` crypto, and persists to per-account SQLite (`dm_messages` / `dm_state`).
Contracts worth knowing:

- **Privacy:** decrypted rumor plaintext exists only in Redux and the local store — never logged,
  never re-published; cleared on logout.
- 3-day gift-wrap lookback (NIP-17 randomizes wrap timestamps up to 2 days back), EOSE watermark
  for cheap resubscribes.
- Publishes its own kind-10050 DM-relay list only if none exists (never clobbers a
  desktop-curated list), and only trusts "empty" when a relay is actually connected.
- Send path: recipient + self wraps to resting relays, plus at most **one** extra one-shot socket
  to the peer's kind-10050 inbox relay (closed after OK). Peer relay URLs are attacker-controlled
  and pass the SSRF guard in `relayUrl.ts` (public `wss://` only — no loopback/private/link-local).
- Blocked peers are dropped at unwrap time (App Store 1.2 moderation).

### Spaces & backend API (`src/lib/api/`)

All GETs are public (guests browse); mutations and personal reads (`joinSpace`, `leaveSpace`,
`fetchMySpaces`) are NIP-98 authenticated. `spaceCache.ts` gives directory→space→channel
click-throughs a 45s promise-dedup cache — membership is deliberately **not** cached so the join
CTA stays correct. Pure, unit-tested parsers under `src/screens/spaces/` translate raw events into
render models (articles, media with imeta, music tracks/albums, chat row grouping, Discord-style
role groups, channel category + type-section grouping).

SpacesHome is a single vertical surface: a horizontal switcher (global feed · discover · joined
spaces), the selected space's header (display-voice name, outlined mode badge, honest
"N active recently" from the backend's daily rollup), and channels grouped by type (live now →
text → music → feeds). Channel rows enrich **only from data the app already fetched** — the
`spacePreviews` slice holds last-message previews and music cover art written by the chat and
feed screens, plus persisted per-channel read state; a bare name+chevron row is the designed
state, never a loading failure. No extra relay subscriptions are opened for previews.

### Zaps & wallet (NIP-57 / NIP-47)

`zapService.sendZap` orchestrates: resolve LNURL from profile lud16/lud06 → sign kind-9734 zap
request → fetch BOLT11 invoice → **amount-tamper guard** (reject any invoice whose decoded amount
≠ requested, before paying) → pay via NWC. Receipts (kind 9735) fold into per-event
`{msat, count}` aggregates in `zapsSlice`.

- Zaps are user-to-user tips only; nothing in the app is gated on them (App Store 3.1.1).
- The NWC pairing URI is a **spending credential**: it lives only in SecureStore, never
  Redux/SQLite, and NWC encrypts with the connection secret from the URI — the identity signer is
  never involved. One on-demand socket per wallet call session, idle-closed.
- Every LNURL URL (untrusted profile data *and* the server-supplied callback) passes an SSRF
  guard: https-only, no loopback/private/link-local/`.onion`.

### Storage

`src/platform/adapters/sqliteStorage.ts` implements the core `StorageAdapter` over expo-sqlite
(WAL mode). Logical stores become `kv_<store>` tables (`key TEXT PRIMARY KEY, value TEXT` JSON).
Two databases mirror the desktop's per-account IndexedDB isolation:

- `thewired_app` — app-global / pre-login / guest cache (also theme preset via `appPrefs.ts`)
- `thewired_<pubkey>` — per-account data (feed snapshots, DMs, user state); opened on login,
  closed on switch

Store handles resolve the account DB **per call**, so a handle obtained pre-login writes to the
account DB post-login.

### Theme & design system

A preset carries three core HSL colors + a font (and optionally `semantics`, `grain`,
`font.displayFamily`); `src/theme/engine.ts` (ported from the desktop `themeEngine`) derives
~24 tokens (background ramp, text ramp, primary variants, borders, semantic, glass extras).
`ThemeContext` maps tokens to CSS variables via NativeWind `vars()` on the root View — so
**preset switching restyles the entire app at runtime, no rebuild**, and the Tailwind class
vocabulary (`bg-panel`, `text-soft`, `bg-primary-dim`, …) matches the desktop 1:1.

- Presets shipped: **`signal` (default)** — pure monochrome (all three core colors achromatic;
  the engine's lightness-only derivation produces a neutral ramp), the accent IS the inversion
  (white fill, near-black text), `semantics: "muted"` (desaturated destructive, near-grey
  success/warning), film-grain canvas overlay (`GrainOverlay`, static seeded tile at 4% opacity)
  — plus `clean-dark`, `wired-black` (true-black OLED), `clean-light`, `neon`.
- **Two-voice typography**: roles are `display` → `micro` plus the protocol voice — `meta` /
  `metaLabel` / `mono` / `monoLg` render in **JetBrains Mono** (timestamps, counts, ids, section
  and mode labels — "the network reporting", not a human speaking); `display`/`title` resolve the
  preset's `displayFamily` (Space Grotesk over Inter body in signal). Inter + Space Grotesk +
  JetBrains Mono load through `@expo-google-fonts`, with system-font fallback until ready.
- **Signal design rules**: at most one primary-filled element per screen (the tab bar's active
  circle owns it on tab roots); liveness/status is expressed through motion, contrast, and mono
  labels — `LiveDot` opacity pulse, hairline-bordered banners — never green/red fills.
- Motion: one `useMotion()` hook, scaled by preset intensity × OS reduce-motion (reduce-motion
  forces everything off).
- Glass chrome (blur) lives **only on chrome** (tab pill, headers); content is always opaque.
  `components/layout/Screen.tsx` is the single place that knows the inset math.

---

## NIPs & event kinds

| NIP | Kinds | Where |
|-----|-------|-------|
| NIP-01 notes/profiles | 1, 0 | `engine.ts`, core `parseProfile` |
| NIP-17/44/59 DMs | 14, 13, 1059, 10050 | `dmEngine.ts` + `@thewired/core` crypto |
| NIP-29-adjacent space chat | 9 (`#h` + `channel` tags) | `chatSession.ts` |
| NIP-42 relay auth | 22242 | `relayPool.ts`, `chatSession.ts` |
| NIP-57 zaps | 9734, 9735 | `zapService.ts`, `engine.ts`, `lnurl.ts` |
| NIP-47 NWC | 13194, 23194, 23195 | `nwc.ts` |
| NIP-98 HTTP auth | 27235 | `nip98.ts` → `lib/api/spaces.ts` |
| NIP-19 entities | nsec/npub/nprofile/note/nevent/naddr | `keys.ts`, `linking.ts` |
| NIP-23 long-form | 30023 | `articleParser.ts`, `spaceFeedRoutes.ts` |
| Media / polls / music | 20, 21, 22, 34235, 34236, 1068, 31683, 33123 | `spaceFeedRoutes.ts` + space parsers |

---

## Testing

```bash
pnpm test        # 49 suites / 314 tests, all pure-logic or RTL — no stack, no device
```

- **Preset:** `jest-expo`, with `transformIgnorePatterns` extended to match pnpm's
  `.pnpm/<pkg>@<ver>/node_modules/` layout (the stock allowlist misses it).
- **Reanimated:** mapped to `src/test/reanimatedMock.js` (the shipped mock needs the worklets
  runtime, which Jest doesn't have) — animations resolve instantly.
- **Theme-dependent components:** render through `src/test/renderWithTheme.tsx`.
- Coverage skews toward pure logic: the nostr engine/pool/DM engine, space parsers, store slices,
  theme engine/typography/motion, lightning (LNURL/NWC/zap orchestration), auth, navigation
  (deep-link resolution, tab reset), SQLite storage, lifecycle controller.

**Live end-to-end QA:** `scripts/qaDmPeer.ts` runs the *real* mobile engine (relay pool + dmEngine
+ core gift-wrap crypto) headless under Node as one side of a two-identity DM exchange — the
desktop client (driven via Playwright) is the other peer. This exercises the mobile send path live,
since the iOS simulator can't be tap-driven headlessly:

```bash
npx tsx scripts/qaDmPeer.ts <mobileSecretHex> <desktopPubkeyHex>
```

---

## Platform gotchas

- **Polyfill order matters.** `index.ts` imports `src/platform/polyfills` before anything else:
  `react-native-get-random-values` (crypto for nostr-tools/@noble), URL polyfill,
  `fast-text-encoding`. Buffer is intentionally **not** polyfilled. Hermes also has no
  `btoa`/`Buffer`, hence the hand-rolled base64 in `nip98.ts`.
- **css-interop × Reanimated (two rules).** With css-interop 0.2.6 × Reanimated 4.5: (1) an
  element may have a Tailwind `className` **or** a Reanimated animated style — never both; (2) the
  css-interop-registered `Animated.View` drops a `useAnimatedStyle` even *without* a className
  (the element renders with no styles at all). `src/lib/animated.ts` exports both halves:
  `AnimatedView` (registered — className + `entering=`) and `AnimatedPlainView` (unregistered —
  the only element type that reliably carries a `useAnimatedStyle`).
- **Metro monorepo config** only *extends* Expo's defaults (SDK 52+ detects monorepos itself);
  hard overrides break `expo-doctor`. The app's `node_modules` resolves first to keep a single
  React instance.
- **RN `fetch` can't control redirects**, so the `http` adapter throws on `maxRedirections`
  rather than silently following — untrusted-URL fetches (LNURL callbacks, Blossom) stay blocked
  until the native SSRF-safe fetch module lands.
- Simulator DNS can be flaky with IPv6 — `pnpm start:sim` pins `--dns-result-order=ipv4first`
  and `--localhost`.

---

## Roadmap

| Phase | Scope |
|-------|-------|
| Core Phase 0b | Move the relay pool / engine / DM orchestration into `@thewired/core` |
| Phase 2+ | Replace placeholder screens (music, AI, articles, invites) with real implementations |
| Phase 3 | Push notifications (APNs/FCM) via the `PushAdapter` |
| Phase 4 | Native keystore signing, NIP-46 remote signer, voice/video calling (CallKit hand-off), account deletion |
