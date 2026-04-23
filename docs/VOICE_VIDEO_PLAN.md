# Voice & Video Calling for The Wired — Implementation Plan

## Part 1: Current Architecture Analysis

### Spaces (Extension Points)

The spaces feature is well-positioned for voice/video:

- **Channel type system** (`SpaceChannelType` union in `client/src/types/space.ts`) — extensible with `"voice" | "video"` types
- **`SPACE_CHANNEL_ROUTES`** (`client/src/features/spaces/spaceChannelRoutes.ts`) maps channel types to Nostr filter configs — voice/video channels need a different model (real-time P2P, not event-based) but fit the routing pattern
- **Permissions framework** (`client/src/features/spaces/usePermissions.ts`) — already has `MANAGE_CHANNELS`, `SEND_MESSAGES`, etc. Ready for `JOIN_VOICE`, `SPEAK`, `STREAM`, `START_RECORDING`
- **Member system** — active members available from `spaceConfig.members[spaceId]`, roles already tied to members via `useMemberRoles.ts`
- **Moderation** (`client/src/features/spaces/moderation/useModeration.ts`) — ban/mute/kick already works globally, extensible to voice-specific actions (disconnect, server mute)
- **Keep-alive ChannelPanel** (`client/src/features/spaces/ChannelPanel.tsx`) — prevents unmount when switching channels, critical for keeping a voice session alive while browsing other channels (exactly how Discord works). Uses `visitedRef` + CSS `hidden` class pattern.
- **Backend API** — full CRUD for channels, roles, permissions already exists with NIP-98 auth via Gateway

#### Space Data Model (Relevant Fields)

```typescript
// client/src/types/space.ts
interface Space {
  id: string;
  hostRelay: string;
  name: string;
  mode: 'read-write' | 'read'; // Community vs Feed mode
  adminPubkeys: string[];
  memberPubkeys: string[];
  // ...
}

interface SpaceChannel {
  id: string;
  spaceId: string;
  type: SpaceChannelType; // 'chat' | 'notes' | 'media' | 'articles' | 'music' → extend with 'voice' | 'video'
  label: string;
  categoryId?: string;
  position: number;
  isDefault: boolean;
  adminOnly: boolean;
  slowModeSeconds: number;
}
```

#### Existing Backend API Endpoints (Spaces)

```
POST   /spaces                              // Register space
GET    /spaces/:id                          // Get space details
GET    /spaces/:id/members                  // List members
GET    /spaces/:id/channels                 // List channels
POST   /spaces/:id/channels                 // Create channel
PUT    /spaces/:id/channels/:channelId      // Update channel
DELETE /spaces/:id/channels/:channelId      // Delete channel
POST   /spaces/:id/channels/reorder         // Reorder channels
GET    /spaces/:id/roles                    // List roles
POST   /spaces/:id/roles                    // Create role
GET    /spaces/:id/my-permissions           // Get resolved permissions
GET    /spaces/:id/bans                     // List bans
POST   /spaces/:id/bans                     // Ban member
POST   /spaces/:id/mutes                    // Mute member
POST   /spaces/:id/kick/:pubkey             // Kick member
```

### DMs (Extension Points)

The DM system is a natural signaling channel for 1:1 calls:

- **NIP-17 gift wraps** (`client/src/lib/nostr/giftWrap.ts`) — 3-layer encryption (rumor → seal → gift wrap) already handles secure signaling
- **`extraTags` parameter** on `createGiftWrappedDM()` — allows custom payloads like `["type", "call_offer"]`
- **`handleGiftWrap()` in eventPipeline** (`client/src/lib/nostr/eventPipeline.ts`) — already routes by `typeTag` (used for friend requests), can add call-specific handlers
- **DM relay discovery** (`client/src/lib/nostr/dmRelayList.ts`, `kind:10050`) — both parties can already find each other
- **`processedWrapIds` dedup** (`client/src/store/slices/dmSlice.ts`) — prevents duplicate call notifications and ICE candidate processing
- **Friend system** (`client/src/features/dm/useFriends.ts`) — can gate calls to accepted friends only. A "friend" requires both an accepted friend request AND mutual follow.
- **Notification system** (`client/src/store/slices/notificationSlice.ts`) — ready for call ring/miss/hangup events via `pushNotification()`
- **Signing queue** (`client/src/lib/nostr/nip44.ts`) — serializes NIP-44 encrypt/decrypt calls, important for high-throughput ICE candidate exchange

#### DM Message Flow (Reference for Call Signaling)

```
Send: User → createGiftWrappedDM() → publish to recipient DM relays + self-wrap
Receive: Relay → eventPipeline → handleGiftWrap() → unwrap 3 layers → route by typeTag → Redux dispatch
```

---

## Part 2: Nostr Protocol Layer

### Relevant NIPs

| NIP | Kind | Purpose | Status |
|-----|------|---------|--------|
| **NIP-53** | `30312` | Interactive Room (voice/video room definition) | **Merged** |
| **NIP-53** | `10312` | Room Presence (who's in a room, hand raise) | **Merged** |
| **NIP-53** | `1311` | Live Chat Message (text chat in rooms) | **Merged** |
| **NIP-53** | `30311` | Live Streaming Event (live audio/video broadcast) | **Merged** |
| **NIP-53** | `30313` | Conference Event (scheduled meeting in a room) | **Merged** |
| **NIP-RTC** | `25050` | WebRTC Signaling (offer/answer/ICE) — ephemeral range | **Draft** |
| **NIP-44** | — | Encrypted Payloads v2 (ChaCha20, for signaling encryption) | **Merged** |
| **NIP-59** | `1059` | Gift Wrap (private call invitations) | **Merged** |
| **NIP-17** | `14` | Private Direct Messages (call invite delivery) | **Merged** |
| **NIP-98** | `27235` | HTTP Auth (authenticate to SFU service) | **Merged** |
| **NIP-29** | `39000+` | Group Metadata (voice channels in spaces) | **Merged** |
| **NIP-A0** | `1222` | Voice Messages (async voice notes, up to 60s) | **Merged** |

### How Existing Nostr Apps Handle Voice/Video

#### Nostr Nests (Audio Rooms — Best Reference)
- **Architecture**: SFU-based using **LiveKit** (not pure P2P)
- **Stack**: C# backend, TypeScript frontend, Docker deployment
- **Nostr kinds used**:
  - `kind:30312` — Room definition (NIP-53 Interactive Room)
  - `kind:1311` — Room chat messages
  - `kind:10312` — Listener presence with hand-raise flag
- **Auth**: NIP-98 HTTP authentication to obtain access tokens for the LiveKit SFU
- **Streaming URLs**: `wss+livekit://` protocol for LiveKit WebSocket, with HLS fallback
- **Discovery**: Rooms discoverable across multiple Nostr clients via `kind:30312` events
- **Key insight**: Uses Nostr for identity/discovery/chat but delegates actual audio to a centralized SFU

#### Corny Chat (Audio Rooms)
- Fork of **Jam** (open-source Clubhouse alternative) with Nostr + Lightning integration
- SFU architecture via "pantry-sfu" component
- Similar hybrid: Nostr for identity/discovery, centralized SFU for audio

#### 0xchat (1:1 Voice/Video Calls)
- **Architecture**: P2P WebRTC with Nostr relay signaling
- **Signaling**: NIP-100 over Nostr relays for offer/answer/ICE exchange
- **Media**: Audio/video flows through ICE servers (STUN/TURN), not relays
- **Privacy**: Users can self-host both relay and ICE infrastructure
- **Status**: Working product with P2P audio/video calls on mobile

#### nostr_webrtc (Rust Library)
- Pure P2P WebRTC using Nostr for signaling, NIP-44 encryption
- Rust library, 671+ commits, active development
- Good reference for Tauri-side implementation

### Recommended Event Kinds for The Wired

#### Voice/Video Channels in Spaces

```
kind:30312 (Interactive Room) — with h tag binding to NIP-29 group
  tags:
    ["d", "<room-id>"]                          // unique room identifier
    ["h", "<space-id>"]                         // ties room to NIP-29 group
    ["room", "Voice Channel #1"]                // display name
    ["service", "wss+livekit://<sfu-url>"]      // actual media server
    ["status", "open"]                          // open | private | closed
    ["p", "<host-pubkey>", "", "host"]          // host/moderator pubkeys
    ["p", "<mod-pubkey>", "", "moderator"]
    ["relays", "wss://relay.example.com"]       // where to find presence events
    ["current_participants", "5"]               // live count

kind:10312 (Room Presence) — replaceable, one room per user
  tags:
    ["a", "30312:<pubkey>:<room-id>"]           // which room
    ["hand", "1"]                               // hand raised (optional)
    ["muted", "1"]                              // self-muted (optional)

kind:1311 (Live Chat) — text chat within voice channel
  tags:
    ["a", "30312:<pubkey>:<room-id>"]           // which room
  content: "chat message text"
```

#### 1:1 DM Calls (P2P WebRTC via NIP-RTC)

```
kind:25050 (NIP-RTC signaling) — ephemeral, double NIP-44 encrypted
  Five message types:

  1. connect — Broadcast to room
     tags: ["t", "connect"], ["r", "<room_id>"], ["expiration", "<ts>"]

  2. disconnect — Broadcast to room
     tags: ["type", "disconnect"], ["r", "<room_id>"]

  3. offer — Targeted to peer
     tags: ["type", "offer"], ["p", "<recipient>"], ["r", "<room_id>"]
     content (encrypted): { offer: <SDP>, turn: [<TURN servers>] }

  4. answer — Targeted to peer
     tags: ["type", "answer"], ["p", "<recipient>"], ["r", "<room_id>"]
     content (encrypted): { answer: <SDP>, turn: [<TURN servers>] }

  5. candidate — Targeted to peer
     tags: ["type", "candidate"], ["p", "<recipient>"], ["r", "<room_id>"]
     content (encrypted): { candidates: [{ candidate, sdpMid }] }

  Encryption: Double NIP-44 — first with conversation_key(sender_privkey, recipient_pubkey),
  then with conversation_key(room_secret_key, recipient_pubkey)

  Room model: Room created by generating random secret key. Derived pubkey = room ID.

Call invitation — delivered via NIP-17 gift wrap (kind:14 inside kind:1059)
  tags: ["type", "call_invite"]
  content: { roomSecretKey, callType: "audio" | "video", callerName }
```

---

## Part 3: WebRTC Architecture

### The Hybrid Approach (Recommended)

| Scenario | Architecture | Why |
|----------|-------------|-----|
| **1:1 DM calls** | Pure P2P WebRTC | Low latency, no server needed, maximum privacy |
| **Small group (2-6)** | P2P mesh OR SFU | Mesh works, SFU is better quality |
| **Medium group (7-50)** | SFU (LiveKit) | Mesh breaks down, SFU essential |
| **Large room (50-1000+)** | SFU with simulcast/SVC | SFU cascading for geo-distribution |
| **Broadcast/Stage** | SFU + HLS egress | Speakers on SFU, audience on HLS for massive scale |

### Why LiveKit as the SFU

1. **Already proven in Nostr ecosystem** — Nostr Nests uses it
2. **Written in Go** — matches Gateway language, same team expertise
3. **Open source, self-hostable** — aligns with decentralized ethos (Apache 2.0 license)
4. **Horizontally scalable** — handles 100,000+ concurrent users, nodes use peer-to-peer routing via Redis
5. **Embedded TURN server** — no separate coturn deployment needed
6. **Built-in features**: simulcast, SVC (VP9/AV1), dynacast (pause unused tracks), E2EE via Insertable Streams, recording/egress, RTMP/HLS streaming
7. **Client SDKs** — JavaScript (`livekit-client`), React (`@livekit/components-react`), Rust (for Tauri), iOS, Android
8. **NIP-98 auth integration** — users authenticate with Nostr identity to get LiveKit tokens
9. **Single binary deployment** — LiveKit server + Redis is all you need
10. **3+ billion calls annually** in production across 100,000+ developers

### SFU Comparison

| Feature | LiveKit | mediasoup | Janus |
|---------|---------|-----------|-------|
| Language | Go (Pion WebRTC) | C++ (Node.js bindings) | C |
| Scaling | Horizontal (built-in mesh) | Manual sharding | Manual |
| TURN | Embedded | External (coturn) | External (coturn) |
| E2EE | Built-in (Insertable Streams) | Community PR | Community plugin |
| Recording | Built-in (Egress service) | Manual ffmpeg | Recording plugin |
| Client SDKs | JS, React, Rust, Swift, Kotlin | JS only | JS only |
| Self-hosting | Easy (single binary + Redis) | Moderate | Moderate |
| Nostr ecosystem | Proven (Nostr Nests) | None | None |
| Raw performance | Great | Best (2x per CoSMo study) | Good |
| Community | 12k+ GitHub stars, very active | 6k+ stars, mature | 8k+ stars, mature |

**Decision: LiveKit** — mediasoup has better raw performance, but LiveKit's ecosystem, ease of deployment, built-in features, horizontal scaling, and Nostr precedent make it the clear choice.

---

## Part 4: Scaling Strategy

### Discord Reference Architecture

- 850+ voice servers, 13 regions, 30+ data centers
- 2.6M concurrent voice users, 220 Gbps egress, 120 Mpps
- Custom C++ media engine built on WebRTC native library
- SFU architecture — server forwards streams, doesn't mix them
- Elixir for signaling/coordination (handles millions of concurrent connections)
- Sharding by guild for horizontal scaling

### The Wired Scaling Phases

#### Phase A — Single Instance (MVP, 0-1000 concurrent users)
- One self-hosted LiveKit instance
- Handles ~500-1000 concurrent participants on a decent server
- Embedded TURN for NAT traversal
- Redis (already in infra at port 6380) for room coordination
- Estimated server: 4+ CPU cores, 8GB+ RAM

#### Phase B — Multi-Instance (1000-10,000 concurrent users)
- Multiple LiveKit nodes behind load balancer
- Nodes discover each other via Redis pub/sub
- Participants in same room routed to same node
- Separate TURN infrastructure for reliability

#### Phase C — Multi-Region (10,000+ concurrent users)
- LiveKit distributed mesh — instances in multiple regions
- Participants auto-connect to nearest instance
- Inter-region relay over optimized network paths
- Gateway routes SFU token requests to nearest region based on client IP

#### Phase D — Federation (Decentralized at scale)
- Space admins specify their own SFU URL in `kind:30312` `service` tag
- Self-hosters run their own LiveKit instances
- No single point of failure — different spaces can use different SFUs
- Trust model: users trust the space admin's infrastructure (same as trusting a relay)

### Bandwidth Optimization

- **Simulcast**: Publisher sends 3 quality levels (high ~720p/medium ~360p/low ~180p). SFU selects best for each subscriber based on their bandwidth. LiveKit handles this automatically.
- **SVC (VP9/AV1)**: Single stream with layered encoding (temporal + spatial layers) — more efficient than simulcast, less redundant data. SFU peels layers per subscriber.
- **Dynacast**: LiveKit pauses sending tracks that no subscriber is watching (e.g., off-screen participants in a grid view). Saves massive bandwidth in large rooms.
- **Adaptive bitrate**: SFU monitors each subscriber's connection quality and adjusts forwarded quality in real-time. No manual intervention needed.

---

## Part 5: Feature Set

### Core Features (Phase 1 — MVP)

| Feature | Implementation |
|---------|---------------|
| **Voice channels in Spaces** | New channel type `"voice"`, SFU via LiveKit |
| **1:1 DM voice calls** | P2P WebRTC, NIP-RTC signaling via gift wraps |
| **1:1 DM video calls** | Same P2P WebRTC + video track |
| **Mute/deafen self** | Local track control (`track.setEnabled(false)`), state broadcast via `kind:10312` |
| **Active speaker detection** | LiveKit provides `activeSpeakersChanged` events, highlight active speaker |
| **Push-to-talk** | Client-side: unmute only while key held (configurable hotkey) |
| **Screen sharing** | `getDisplayMedia()` API, published as separate track to LiveKit |
| **Voice channel member list** | Real-time presence via `kind:10312` events on Nostr relay |
| **Call ringing UI** | Incoming call modal for DM calls, notification sound, timeout after 30s |
| **Join/leave sounds** | Audio cues when users enter/leave voice channels |
| **Voice status bar** | Floating bar when in voice channel but viewing another channel |
| **Device selection** | Camera/microphone picker in settings + pre-join modal |

### Enhanced Features (Phase 2)

| Feature | Implementation |
|---------|---------------|
| **Video rooms** | Channel type `"video"`, camera tracks + grid/spotlight layout |
| **Noise suppression** | RNNoise via WASM (free, open-source) OR LiveKit's built-in enhanced noise cancellation |
| **Echo cancellation** | WebRTC built-in AEC + LiveKit enhanced processing |
| **Hand raising** | `kind:10312` with `["hand", "1"]` tag (NIP-53 native) |
| **Text chat in voice** | `kind:1311` live chat messages rendered alongside voice UI |
| **Server mute/deafen** | Moderator controls via LiveKit admin API + backend permissions |
| **Channel user limit** | Configurable max participants per voice channel (in channel settings) |
| **Priority speaker** | Role-based: admins/mods get priority audio routing via LiveKit track priority |
| **Connection quality indicator** | LiveKit provides `connectionQualityChanged` events (excellent/good/poor) |
| **Voice activity indicator** | Speaking indicators on avatars in voice channel and in channel list preview |

### Advanced Features (Phase 3)

| Feature | Implementation |
|---------|---------------|
| **E2E encryption** | WebRTC Insertable Streams + SFrame — LiveKit has built-in `E2EEManager` |
| **Recording** | LiveKit Egress service — record room to MP4/HLS file, store in S3/local |
| **Live streaming** | LiveKit Egress — RTMP push to YouTube/Twitch or HLS for in-app audience |
| **Virtual backgrounds** | MediaPipe/TensorFlow.js body segmentation + canvas compositing via `VideoProcessor` |
| **Breakout rooms** | Create temporary sub-rooms within a voice channel, auto-return on close |
| **Stage channels** | Speaker/audience model — speakers on SFU, large audience on HLS stream. Controlled by `kind:30312` roles. |
| **Go Live (screen share to channel)** | Publish screen as a named stream visible to the whole space channel |
| **Picture-in-picture** | Browser PiP API (`requestPictureInPicture()`) for video while browsing |
| **Reactions/emoji** | Animated emoji overlays broadcast via LiveKit data channel (low latency) |
| **Soundboard** | Play audio clips into voice channel via secondary audio track |
| **Voice messages** | NIP-A0 `kind:1222` — async voice notes in DMs and channels (up to 60s) |
| **Group DM calls** | Multi-party calls in DM groups, P2P mesh for ≤4, SFU fallback for >4 |

---

## Part 6: Technical Architecture

### System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     The Wired Architecture                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Client (Tauri + React, port 1420)                          │
│  ├── features/calling/       ← NEW: 1:1 DM call UI & logic │
│  ├── features/voice/         ← NEW: Voice/video channel UI  │
│  ├── lib/webrtc/             ← NEW: WebRTC + LiveKit SDK    │
│  ├── lib/nostr/callSignaling.ts  ← NEW: NIP-RTC impl       │
│  └── lib/nostr/roomPresence.ts   ← NEW: kind:10312 impl    │
│                                                              │
│  Gateway (Go, port 9080)                                    │
│  └── /api/voice/* → proxy to Backend voice endpoints        │
│                                                              │
│  Backend (Fastify, port 3002)                               │
│  ├── routes/voice.ts         ← NEW: Token generation        │
│  ├── services/livekit.ts     ← NEW: LiveKit Server SDK      │
│  └── routes/spaces.ts        ← Extended: voice channel CRUD │
│                                                              │
│  LiveKit SFU (port 7880/7881/7882)     ← NEW SERVICE        │
│  ├── Embedded TURN (port 3478 TCP+UDP, 443 TLS)            │
│  ├── Egress service (recording/streaming) — Phase 3         │
│  └── Redis (shared instance, port 6380)                     │
│                                                              │
│  Nostr Relays                                               │
│  ├── kind:30312 (room metadata — Interactive Room)          │
│  ├── kind:10312 (room presence — who's in voice)            │
│  ├── kind:1311  (live chat in voice rooms)                  │
│  └── kind:25050 (P2P WebRTC signaling for DM calls)         │
│                                                              │
│  Existing Infrastructure (unchanged)                        │
│  ├── PostgreSQL (port 5432)                                 │
│  ├── Redis (port 6380) — shared with LiveKit                │
│  ├── Meilisearch (port 7700)                                │
│  └── Rust Relay (port 7777)                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Auth Flow for Voice Channels (SFU)

```
1. User clicks "Join Voice" on a voice channel in a Space
2. Client sends NIP-98 authenticated request to Backend:
   POST /api/voice/token { spaceId, channelId }

3. Backend verifies:
   a. NIP-98 signature is valid (via Gateway X-Auth-Pubkey header)
   b. User is a member of the space (query spaceConfig.members)
   c. User has JOIN_VOICE permission (query resolved permissions)
   d. User is not banned from the space
   e. Channel exists and is type "voice" or "video"
   f. Channel is not full (if user limit set)

4. Backend generates LiveKit access token using livekit-server-sdk:
   - Room name: "${spaceId}:${channelId}"
   - Participant identity: user's pubkey (hex)
   - Participant name: user's display name (from profile cache)
   - Grants based on permissions:
     - canPublish: true if user has SPEAK permission
     - canPublishData: true (for reactions, text)
     - canSubscribe: true (always, for listening)
     - canPublishSources: ['camera', 'microphone', 'screen_share'] based on perms
   - Token expiry: 24 hours (re-fetch on reconnect)

5. Client receives token + LiveKit server URL
6. Client connects to LiveKit SFU using livekit-client SDK:
   const room = new Room();
   await room.connect(livekitUrl, token);

7. Client publishes kind:10312 (Room Presence) to Nostr relay:
   - Tags: ["a", "30312:<space-creator-pubkey>:<channelId>"]
   - Other clients see presence, render user in voice channel member list

8. On disconnect:
   - room.disconnect()
   - Publish updated kind:10312 without room reference (or delete)
```

### 1:1 DM Call Flow (P2P WebRTC)

```
1. Caller clicks "Call" button on DM conversation
   - Check: callee is an accepted friend (useFriends gate)

2. Client generates random room secret key (32 bytes)
   - Derive room public key = room ID

3. Client sends call invitation via NIP-17 gift wrap:
   createGiftWrappedDM(recipientPubkey, JSON.stringify({
     roomSecretKey,
     callType: "audio" | "video",
     callerName: displayName
   }), [["type", "call_invite"]])

4. Callee receives gift wrap:
   eventPipeline → handleGiftWrap() → typeTag === "call_invite"
   → dispatch setIncomingCall({ callerPubkey, roomSecretKey, callType })
   → Show IncomingCallModal with ring sound (30s timeout)

5. On ACCEPT:
   a. Both parties derive room ID from secret key
   b. Both subscribe to kind:25050 on shared relays filtered by ["r", roomId]
   c. Caller creates RTCPeerConnection + getUserMedia()
   d. Caller creates SDP offer → publish kind:25050 [type:offer]:
      - Content: double NIP-44 encrypted { offer: sdp, turn: turnServers }
      - Tags: ["type", "offer"], ["p", calleeHex], ["r", roomId]
   e. Callee receives offer → setRemoteDescription → creates SDP answer
   f. Callee publishes kind:25050 [type:answer] with encrypted answer SDP
   g. Both exchange kind:25050 [type:candidate] for ICE candidates
   h. WebRTC P2P connection established — media flows directly
   i. Signaling events are ephemeral (relay doesn't store them)

6. On DECLINE:
   Callee sends gift wrap with ["type", "call_decline"]
   Caller sees "Call declined" and cleans up

7. On HANGUP:
   Either party publishes kind:25050 [type:disconnect]
   Close RTCPeerConnection + stop media tracks

8. FALLBACK (P2P fails due to symmetric NAT):
   After ICE gathering timeout (~10s), detect failure
   Upgrade to SFU-assisted call: fetch LiveKit token from backend
   Both connect to LiveKit room instead of direct P2P

9. On TIMEOUT (no answer within 30s):
   Caller sends gift wrap with ["type", "call_missed"]
   Clean up and show "No answer" UI
```

### New Client File Structure

```
client/src/
├── features/
│   ├── calling/                              # NEW — 1:1 DM calls (P2P WebRTC)
│   │   ├── CallController.tsx                # Active call overlay (floating, PiP-capable)
│   │   ├── IncomingCallModal.tsx              # Ring UI with accept/decline buttons
│   │   ├── CallControls.tsx                  # Mute, camera, screenshare, hangup buttons
│   │   ├── useCall.ts                        # Call state machine (idle→ringing→connecting→active→ended)
│   │   ├── useCallSignaling.ts               # NIP-RTC kind:25050 signaling subscription + parsing
│   │   ├── usePeerConnection.ts              # RTCPeerConnection lifecycle management
│   │   ├── callService.ts                    # initiateCall(), answerCall(), rejectCall(), hangup()
│   │   └── callRingtone.ts                   # Audio playback for ring/busy/hangup sounds
│   │
│   ├── voice/                                # NEW — Space voice/video channels (LiveKit SFU)
│   │   ├── VoiceChannel.tsx                  # Voice channel main view (participant tiles)
│   │   ├── VoiceControls.tsx                 # Bottom bar: mute/deafen/screenshare/camera/disconnect
│   │   ├── VoiceParticipant.tsx              # Single participant tile (avatar + speaking indicator + name)
│   │   ├── VoiceChannelPreview.tsx           # Inline in ChannelList: shows connected user avatars
│   │   ├── VoiceStatusBar.tsx                # Floating bar when in voice but viewing another channel
│   │   │                                     # (like Discord's green bar: "Voice Connected - General")
│   │   ├── VideoGrid.tsx                     # Video tile layout with grid/spotlight mode switching
│   │   ├── ScreenShareView.tsx               # Full-width screen share + small speaker tiles sidebar
│   │   ├── PreJoinModal.tsx                  # Camera/mic preview + device selection before joining
│   │   ├── useVoiceChannel.ts                # LiveKit Room connection, track management, state
│   │   ├── useVoiceParticipants.ts           # Track participants, audio levels, speaking state
│   │   ├── useScreenShare.ts                 # getDisplayMedia + publish screen track
│   │   ├── useMediaDevices.ts                # Enumerate + select camera/mic, handle permissions
│   │   ├── voiceService.ts                   # fetchVoiceToken(), joinRoom(), leaveRoom()
│   │   └── voiceSelectors.ts                 # Redux selectors for voice state
│   │
│   ├── spaces/
│   │   ├── ChannelList.tsx                   # MODIFY: render voice channels with VoiceChannelPreview
│   │   ├── CreateChannelModal.tsx            # MODIFY: add voice/video channel type options
│   │   ├── ChannelPanel.tsx                  # MODIFY: route voice/video types to VoiceChannel component
│   │   └── settings/
│   │       └── SpaceSettingsModal.tsx        # MODIFY: voice channel settings (bitrate, user limit, region)
│   │
│   └── dm/
│       ├── DMConversation.tsx                # MODIFY: add call button in header
│       └── DMInput.tsx                       # MODIFY: add voice/video call buttons
│
├── lib/
│   ├── webrtc/                               # NEW — WebRTC utilities
│   │   ├── livekitClient.ts                  # LiveKit SDK initialization + Room factory
│   │   ├── peerConnection.ts                 # RTCPeerConnection factory for P2P DM calls
│   │   ├── mediaDevices.ts                   # getUserMedia/getDisplayMedia wrappers with error handling
│   │   ├── audioProcessing.ts                # Noise suppression setup (RNNoise WASM) — Phase 2
│   │   └── connectionQuality.ts              # Bandwidth estimation + quality metrics display
│   │
│   ├── nostr/
│   │   ├── callSignaling.ts                  # NEW: NIP-RTC kind:25050 create/parse/encrypt/decrypt
│   │   ├── roomPresence.ts                   # NEW: kind:10312 presence publish/subscribe
│   │   ├── roomMetadata.ts                   # NEW: kind:30312 room metadata publish/subscribe
│   │   ├── liveChat.ts                       # NEW: kind:1311 live chat in voice rooms
│   │   ├── eventPipeline.ts                  # MODIFY: add call signaling handler for kind:25050
│   │   └── giftWrap.ts                       # MODIFY: handle call_invite/call_decline/call_missed types
│   │
│   └── api/
│       └── voice.ts                          # NEW: Backend voice API client (token, kick, mute)
│
├── store/slices/
│   ├── callSlice.ts                          # NEW: 1:1 call state
│   │   # State: { activeCall, incomingCall, callHistory, localTracks }
│   │   # Actions: setIncomingCall, acceptCall, rejectCall, endCall,
│   │   #          toggleMute, toggleVideo, setConnectionState
│   │
│   └── voiceSlice.ts                         # NEW: Voice channel state
│       # State: { connectedRoom: { spaceId, channelId, roomName },
│       #          participants: Record<pubkey, VoiceParticipant>,
│       #          localState: { muted, deafened, screenSharing, videoEnabled },
│       #          connectionQuality, activeSpeakers }
│       # Actions: setConnectedRoom, addParticipant, removeParticipant,
│       #          toggleMute, toggleDeafen, setActiveSpeakers
│
├── types/
│   └── calling.ts                            # NEW: Call & voice types
│       # CallState: 'idle' | 'ringing' | 'connecting' | 'active' | 'ended'
│       # CallType: 'audio' | 'video'
│       # CallInvite: { callerPubkey, roomSecretKey, callType, callerName, timestamp }
│       # VoiceParticipant: { pubkey, displayName, isSpeaking, isMuted,
│       #                     isDeafened, hasVideo, isScreenSharing, connectionQuality }
│       # VoiceChannelConfig: { maxParticipants?, bitrate?, region? }
│
└── assets/sounds/                            # NEW: Audio files
    ├── ring.mp3                              # Incoming call ringtone
    ├── call-end.mp3                          # Call ended sound
    ├── join.mp3                              # User joined voice channel
    ├── leave.mp3                             # User left voice channel
    └── hand-raise.mp3                        # Hand raised notification
```

### New Backend Additions

```
services/backend/src/
├── routes/
│   └── voice.ts                              # NEW — Voice API routes
│       # POST /voice/token
│       #   Body: { spaceId, channelId }
│       #   Auth: NIP-98 via X-Auth-Pubkey header
│       #   Returns: { token: string, url: string }
│       #   Logic: verify membership + permissions → generate LiveKit token
│       #
│       # POST /voice/kick
│       #   Body: { spaceId, channelId, targetPubkey }
│       #   Auth: NIP-98, requires MUTE_MEMBERS or MANAGE_VOICE permission
│       #   Logic: call LiveKit removeParticipant API
│       #
│       # POST /voice/mute
│       #   Body: { spaceId, channelId, targetPubkey, trackSource: "microphone"|"camera" }
│       #   Auth: NIP-98, requires MUTE_MEMBERS permission
│       #   Logic: call LiveKit mutePublishedTrack API
│       #
│       # GET /voice/rooms/:spaceId
│       #   Auth: NIP-98, requires space membership
│       #   Returns: [{ channelId, participantCount, participants: [{ pubkey, name }] }]
│       #   Logic: query LiveKit listRooms + listParticipants
│
├── services/
│   └── livekit.ts                            # NEW — LiveKit Server SDK wrapper
│       # generateToken(identity, roomName, grants): string
│       # createRoom(roomName, options): Room
│       # listParticipants(roomName): Participant[]
│       # removeParticipant(roomName, identity): void
│       # muteParticipant(roomName, identity, trackSid, muted): void
│       # listRooms(): Room[]
│
├── lib/
│   └── livekit.ts                            # NEW — LiveKit client initialization
│       # Initialize RoomServiceClient with LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
│
└── db/schema/
    └── voice.ts                              # NEW — Voice channel config table (optional)
        # Table: voice_channel_config
        # Columns: channelId, spaceId, maxParticipants, bitrate, region, createdAt
```

### Docker Infrastructure Additions

```yaml
# Add to docker-compose.yml

livekit:
  image: livekit/livekit-server:latest
  ports:
    - "7880:7880"       # HTTP API + WebSocket signaling
    - "7881:7881"       # WebRTC over TCP
    - "7882:7882/udp"   # WebRTC over UDP (primary media transport)
    - "3478:3478"       # TURN TCP
    - "3478:3478/udp"   # TURN UDP
  environment:
    - LIVEKIT_KEYS=devkey:${LIVEKIT_API_SECRET:-secret}
    - LIVEKIT_LOG_LEVEL=info
  volumes:
    - ./config/livekit.yaml:/etc/livekit.yaml
  command: --config /etc/livekit.yaml
  depends_on:
    - redis
  restart: unless-stopped

# Phase 3 — Recording/streaming (optional):
livekit-egress:
  image: livekit/egress:latest
  environment:
    - EGRESS_CONFIG_FILE=/etc/egress.yaml
  volumes:
    - ./config/egress.yaml:/etc/egress.yaml
    - ./data/recordings:/recordings
  deploy:
    resources:
      limits:
        cpus: '4'
        memory: 4G
  depends_on:
    - livekit
    - redis
  restart: unless-stopped
```

#### LiveKit Config File (`config/livekit.yaml`)

```yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  tcp_port: 7881
  use_external_ip: true
redis:
  address: redis:6380
turn:
  enabled: true
  domain: turn.example.com    # Replace with actual domain
  tls_port: 443
  udp_port: 3478
keys:
  devkey: ${LIVEKIT_API_SECRET:-secret}
logging:
  level: info
room:
  max_participants: 100       # Default per-room limit
  empty_timeout: 300          # Close room after 5 min empty
```

### New Dependencies

```jsonc
// client/package.json — add:
{
  "dependencies": {
    "livekit-client": "^2.x",              // LiveKit JavaScript SDK
    "@livekit/components-react": "^2.x",   // Optional: pre-built React components (can cherry-pick)
  }
}

// services/backend/package.json — add:
{
  "dependencies": {
    "livekit-server-sdk": "^2.x"           // LiveKit Server SDK (token gen, room management)
  }
}
```

### Environment Variables

```bash
# Add to services/backend/.env:
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# Add to client/.env (or runtime config):
VITE_LIVEKIT_URL=ws://localhost:7880
```

### New Permissions

```typescript
// Extend SpacePermission type in shared-types and backend
type VoicePermission =
  | 'JOIN_VOICE'           // Can join voice/video channels
  | 'SPEAK'                // Can unmute and speak (vs listen-only mode)
  | 'USE_VIDEO'            // Can enable camera in video channels
  | 'SCREEN_SHARE'         // Can share screen
  | 'PRIORITY_SPEAKER'     // Voice prioritized (louder) over others
  | 'MUTE_MEMBERS'         // Can server-mute others (extends existing permission)
  | 'MOVE_MEMBERS'         // Can drag users between voice channels
  | 'MANAGE_VOICE'         // Can change voice channel settings (bitrate, limit)
  | 'START_RECORDING'      // Can initiate room recording (Phase 3)
  | 'START_STREAM'         // Can start live stream from room (Phase 3)

// Default role grants: JOIN_VOICE, SPEAK, USE_VIDEO, SCREEN_SHARE
// Admin role grants: all of the above + MUTE_MEMBERS, MOVE_MEMBERS, MANAGE_VOICE
```

---

## Part 7: Implementation Phases

### Phase 1 — Voice Channels in Spaces (MVP)

**Goal**: Users can join voice channels in spaces, talk, and see who's connected.

**Infrastructure**:
1. Add LiveKit to `docker-compose.yml` with config file
2. Add `livekit-server-sdk` to backend, create `/voice/token` endpoint
3. Add `livekit-client` to client dependencies
4. Add Gateway proxy route for `/api/voice/*`

**Backend**:
5. Create `services/backend/src/routes/voice.ts` — token generation with permission checks
6. Create `services/backend/src/services/livekit.ts` — LiveKit Server SDK wrapper
7. Extend channel creation to accept `type: "voice"` and `type: "video"`
8. Add voice permissions to role system

**Client — Types & State**:
9. Create `client/src/types/calling.ts` — VoiceParticipant, VoiceChannelConfig types
10. Create `client/src/store/slices/voiceSlice.ts` — voice state management
11. Extend `SpaceChannelType` in `client/src/types/space.ts` with `"voice" | "video"`

**Client — Nostr Integration**:
12. Create `client/src/lib/nostr/roomPresence.ts` — kind:10312 publish/subscribe
13. Subscribe to kind:10312 for joined spaces (background sub, like chat)

**Client — Core UI**:
14. Create `client/src/features/voice/useMediaDevices.ts` — camera/mic enumeration
15. Create `client/src/features/voice/useVoiceChannel.ts` — LiveKit room connection
16. Create `client/src/features/voice/useVoiceParticipants.ts` — participant tracking
17. Create `client/src/features/voice/voiceService.ts` — token fetch, join/leave
18. Create `client/src/features/voice/VoiceChannel.tsx` — participant grid view
19. Create `client/src/features/voice/VoiceControls.tsx` — mute/deafen/disconnect bar
20. Create `client/src/features/voice/VoiceParticipant.tsx` — single participant tile
21. Create `client/src/features/voice/VoiceChannelPreview.tsx` — shows connected users in channel list
22. Create `client/src/features/voice/VoiceStatusBar.tsx` — floating bar when browsing other channels

**Client — Integration with Spaces**:
23. Modify `ChannelList.tsx` — render voice channels differently (click to join, show previews)
24. Modify `CreateChannelModal.tsx` — add voice/video type options
25. Modify `ChannelPanel.tsx` — route voice/video types to VoiceChannel component
26. Add join/leave sound effects

**Estimated scope**: ~25 files (15 new, 10 modified)

### Phase 2 — 1:1 DM Calls (P2P WebRTC)

**Goal**: Users can voice/video call friends via DMs.

**Client — Signaling**:
1. Create `client/src/lib/nostr/callSignaling.ts` — NIP-RTC kind:25050 create/parse
2. Modify `client/src/lib/nostr/eventPipeline.ts` — handle kind:25050 + call gift wraps
3. Create `client/src/lib/webrtc/peerConnection.ts` — RTCPeerConnection factory

**Client — State**:
4. Create `client/src/store/slices/callSlice.ts` — call state machine

**Client — UI**:
5. Create `client/src/features/calling/useCall.ts` — call state management hook
6. Create `client/src/features/calling/useCallSignaling.ts` — signaling subscription
7. Create `client/src/features/calling/usePeerConnection.ts` — P2P connection lifecycle
8. Create `client/src/features/calling/callService.ts` — initiate/answer/reject/hangup
9. Create `client/src/features/calling/CallController.tsx` — active call overlay
10. Create `client/src/features/calling/IncomingCallModal.tsx` — ring UI
11. Create `client/src/features/calling/CallControls.tsx` — in-call controls
12. Create `client/src/features/calling/callRingtone.ts` — ring/hangup audio
13. Modify `DMConversation.tsx` — add call button in conversation header
14. Add SFU fallback when P2P fails (reuse voice channel infrastructure)

**Estimated scope**: ~15 files (12 new, 3 modified)

### Phase 3 — Video & Screen Sharing

**Goal**: Full video calling + screen sharing in both spaces and DMs.

1. Create `client/src/features/voice/VideoGrid.tsx` — grid/spotlight layout
2. Create `client/src/features/voice/ScreenShareView.tsx` — focused screen share layout
3. Create `client/src/features/voice/useScreenShare.ts` — getDisplayMedia wrapper
4. Create `client/src/features/voice/PreJoinModal.tsx` — camera/mic preview before joining
5. Add video track publishing/subscribing to `useVoiceChannel.ts`
6. Add video toggle to `VoiceControls.tsx` and `CallControls.tsx`
7. Layout switching: grid → spotlight when someone shares screen
8. Handle multiple simultaneous screen shares (tabbed or grid)

**Estimated scope**: ~8 files (5 new, 3 modified)

### Phase 4 — Enhanced Voice Features

**Goal**: Production-quality voice with moderation tools.

1. Noise suppression via RNNoise WASM or LiveKit enhanced noise cancellation
2. Server-side mute/disconnect (backend `/voice/kick` and `/voice/mute` endpoints)
3. Hand raising via kind:10312 `["hand", "1"]` tag
4. Text chat in voice rooms via kind:1311
5. Connection quality indicators
6. Push-to-talk with configurable hotkey
7. Channel user limits
8. Priority speaker for admin roles
9. Voice settings page (input/output device, volume, noise suppression toggle)

### Phase 5 — Advanced Features

**Goal**: Feature parity with Discord + decentralized advantages.

1. E2E encryption (LiveKit `E2EEManager` + Insertable Streams)
2. Recording (deploy LiveKit Egress, backend recording API)
3. Live streaming (RTMP egress to YouTube/Twitch + in-app HLS)
4. Stage channels (speaker/audience model with HLS for large audiences)
5. Virtual backgrounds (MediaPipe body segmentation)
6. Breakout rooms
7. Picture-in-picture
8. Reactions/emoji via data channel
9. Soundboard
10. Voice messages (NIP-A0 kind:1222)

---

## Part 8: Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **SFU** | LiveKit | Open-source, Go-based, Nostr-proven (Nostr Nests), self-hostable, horizontal scaling, embedded TURN, recording/streaming built-in, excellent SDKs |
| **1:1 call transport** | P2P WebRTC with SFU fallback | Maximum privacy for DMs; SFU only when NAT prevents P2P |
| **1:1 signaling** | NIP-RTC (kind:25050) via Nostr relays | E2E encrypted, uses existing relay infrastructure, ephemeral events |
| **Call invitations** | NIP-17 gift wraps | Leverages existing DM encryption, recipient relay discovery, dedup |
| **Group signaling** | NIP-98 → Backend → LiveKit token | Leverages existing auth + permissions infrastructure |
| **Room metadata** | NIP-53 kind:30312 on Nostr relay | Interoperable with other Nostr clients (Nostr Nests, etc.) |
| **Presence** | NIP-53 kind:10312 on Nostr relay | Decentralized, replaceable events, cross-client compatible |
| **TURN** | LiveKit embedded | No separate coturn deployment, integrated auth |
| **Video codec** | VP9 with simulcast (VP8 fallback) | Best SVC support, wide browser compatibility |
| **Audio codec** | Opus | WebRTC standard, excellent quality at low bitrates |
| **Encryption** | DTLS-SRTP (default) + optional E2EE | Balance usability and privacy; E2EE opt-in per room |
| **Federation** | Space admins set SFU URL in kind:30312 | Truly decentralized; anyone can run their own SFU |
| **Noise suppression** | RNNoise WASM (free) with Krisp as upgrade | Open-source default, commercial upgrade path |
| **State management** | New Redux slices (callSlice, voiceSlice) | Consistent with existing architecture |
| **Call gating** | Friends-only for DM calls | Prevents spam calls; uses existing friend system |

---

## Part 9: Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **NAT traversal failures** (~15-20% of connections) | LiveKit embedded TURN as fallback; SFU fallback for P2P calls |
| **LiveKit single point of failure** | Federation: space admins can specify alternate SFUs; Phase C multi-region |
| **Bandwidth costs** | Simulcast + dynacast reduce SFU bandwidth; P2P for 1:1 avoids server entirely |
| **Browser compatibility** | LiveKit SDK handles browser differences; VP8 fallback for older browsers |
| **NIP-RTC not finalized** | It's the most complete draft; can adapt if spec changes since it's ephemeral |
| **Large room performance** | SFU handles routing; simulcast/SVC for quality adaptation; HLS for 100+ audiences |
| **Spam calls** | Friend-gating for DMs; space membership + permissions for channels |
| **Privacy (SFU sees media)** | E2EE via Insertable Streams in Phase 5; P2P for 1:1 calls bypasses SFU |
| **Recording consent** | UI indicator when recording active; permission-gated; notification on start |

---

## Sources & References

### LiveKit
- [LiveKit SFU Architecture](https://docs.livekit.io/reference/internals/livekit-sfu/)
- [LiveKit Distributed Mesh](https://blog.livekit.io/scaling-webrtc-with-distributed-mesh/)
- [LiveKit Self-Hosting](https://docs.livekit.io/transport/self-hosting/)
- [LiveKit Egress (Recording/Streaming)](https://docs.livekit.io/transport/media/ingress-egress/egress/)
- [LiveKit E2EE](https://docs.livekit.io/transport/encryption/)
- [LiveKit Noise Cancellation](https://docs.livekit.io/transport/media/enhanced-noise-cancellation/)
- [LiveKit Simulcast](https://blog.livekit.io/an-introduction-to-webrtc-simulcast-6c5f1f6402eb/)
- [LiveKit GitHub](https://github.com/livekit/livekit)

### WebRTC
- [WebRTC E2EE with Insertable Streams](https://webrtchacks.com/true-end-to-end-encryption-with-webrtc-insertable-streams/)
- [SFrame E2EE](https://medooze.medium.com/sframe-js-end-to-end-encryption-for-webrtc-f9a83a997d6d)
- [getDisplayMedia API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [Screen Capture API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture)
- [WebRTC SVC (W3C Spec)](https://www.w3.org/TR/webrtc-svc/)

### SFU Comparison
- [Janus vs Mediasoup vs LiveKit](https://trembit.com/blog/choosing-the-right-sfu-janus-vs-mediasoup-vs-livekit-for-telemedicine-platforms/)
- [WebRTC Media Server Comparison](https://meetrix.io/blog/webrtc/introduction.html)

### Discord Architecture
- [Discord Voice: 2.5M Concurrent Users](https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc)
- [Discord Stage Channels: 10K People](https://medium.com/@ghimiresarika/how-discord-stage-channels-handle-10-000-people-3facc5e37f89)
- [Discord Voice Stack: Rust + Elixir](https://medium.com/@theopinionatedev/discords-voice-stack-how-rust-elixir-and-webrtc-power-150-million-voices-9c03465aa194)

### Nostr
- [NIP-RTC WebRTC Signaling (Draft)](https://ngengine.org/docs/nip-drafts/nip-RTC/)
- [Nostr Nests (LiveKit + NIP-53)](https://github.com/nostrnests/nests)
- [Corny Chat](https://github.com/vicariousdrama/cornychat)
- [0xchat (P2P Calls)](https://0xchat.com/)
- [nostr_webrtc Rust Library](https://codeberg.org/cipres/nostr_webrtc)
- [Nostr NIPs Repository](https://github.com/nostr-protocol/nips)

### Audio Processing
- [RNNoise / Noise Suppression in WebRTC](https://gcore.com/blog/noise-reduction-webrtc)
- [Krisp Browser SDK](https://sdk-docs.krisp.ai/docs/introduction)
