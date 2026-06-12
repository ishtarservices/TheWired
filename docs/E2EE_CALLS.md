# E2EE for Voice/Video — Design

Status: **design** (not implemented). Tracks the beta-user ask: *"Does the
LiveKit stack have encryption to the SFU on? What about E2EE?"*

## 1. What we have today (the honest answer)

| Path | Transport encryption | Server-blind (E2EE) |
|---|---|---|
| Client ↔ SFU media (voice channels, 1:1 "Relayed") | ✅ always — WebRTC mandates DTLS-SRTP | ❌ the SFU decrypts SRTP and re-encrypts per subscriber; it sees plaintext frames |
| LiveKit signaling WS | ✅ wss in prod (Caddy) | n/a |
| 1:1 P2P calls | ✅ DTLS-SRTP peer-to-peer | ✅ **already E2E** — no middlebox; TURN (if used) sees only ciphertext |
| Call signaling (kind:25050 SDP/ICE) | ✅ NIP-44 to the partner | ✅ |
| Call invites (room secret) | ✅ NIP-17 gift wrap | ✅ |

So "encryption to the SFU" is already on by protocol. The gap is that the SFU
itself (and whoever operates it) can read media frames. LiveKit's frame-level
E2EE (insertable streams: AES-GCM per frame inside a Web Worker, SFU forwards
ciphertext) closes that — the work below.

## 2. What the installed SDK gives us (livekit-client 2.17.3, verified)

- `RoomOptions.e2ee: { keyProvider, worker }` + `room.setE2EEEnabled(bool)` +
  `room.isE2EEEnabled`.
- `ExternalE2EEKeyProvider` — single shared key for the room. `setKey(string)`
  → PBKDF2; `setKey(ArrayBuffer)` → HKDF (we always have key *bytes*, use this).
- `BaseKeyProvider` — subclassable, supports **per-participant keys**
  (`onSetEncryptionKey(key, participantIdentity?, keyIndex?)`) and ratcheting
  (`ratchetKey`, `onKeyRatcheted`, `ratchetWindowSize` auto-ratchet on decrypt
  failure).
- Worker shipped at `livekit-client/e2ee-worker` (Vite: `?worker` import — keep
  it inside the `lib/webrtc/` boundary so the planned lazy-load of the LiveKit
  SDK still excludes it from the main bundle).
- `isE2EESupported()` capability check; events
  `ParticipantEncryptionStatusChanged` and `EncryptionError`.
- Nothing is needed server-side — E2EE is transparent to the SFU.

WebView support: WebView2/Chromium (Windows) uses `createEncodedStreams`;
WKWebView (macOS, Safari ≥15.4) uses `RTCRtpScriptTransform` — both covered by
the SDK worker. Linux webkit2gtk is the open question → always gate on
`isE2EESupported()` and degrade gracefully.

## 3. Our structural advantage: identity = pubkey

The LiveKit participant identity **is** the Nostr pubkey (verified in the
backend token mint and in live logs). NIP-44 + the signer abstraction gives us
an authenticated, encrypted pairwise channel to any participant. That makes
key distribution a solved problem we already ship — no new crypto, no PKI.

A useful corollary for the threat model: key envelopes are NIP-44-encrypted
**to pubkeys**, not to LiveKit identities-as-claimed. A malicious backend/SFU
can mint a token with a spoofed identity and join the room, but without the
corresponding nsec it cannot decrypt the key envelope. Compromised
infrastructure can DoS a call; it cannot listen to one.

## 4. Design

### Phase 1 — 1:1 SFU ("Relayed") calls · size S

The invite already distributes a secret the server never sees:
`roomSecretKey` travels inside the NIP-17 gift wrap, and only its *pubkey*
(the roomId) is visible on the wire. Both peers can therefore derive the frame
key with **zero additional signaling**:

```
frameKey = HKDF-SHA256(ikm = roomSecretKey bytes,
                       salt = "thewired-e2ee",
                       info = "lk-frame-v1:" + roomId,  L = 32 bytes)
```

- `lib/webrtc/e2ee.ts` (new): create the worker + an `ExternalE2EEKeyProvider`,
  `setKey(frameKey /* ArrayBuffer → HKDF path */)`.
- `connectToRoom(url, token, e2ee?)` gains an optional e2ee param;
  `handleP2PFailure` / `upgradeToSfuForListenTogether` pass it for calls.
- **Capability negotiation** (old clients would hear garbage): add
  `caps: { e2ee: true }` to the `call_invite` payload; callee echoes support in
  the `connect` signal's (NIP-44-encrypted) data. Both sides support it → SFU
  fallback connects encrypted. Either side missing it → plaintext SFU exactly
  as today. Deriving from the invite payload means downgrade requires forging
  the gift wrap — which the infrastructure can't do.
- Note: P2P mode needs nothing — it is already E2E. This phase makes the
  *fallback* as private as the primary path.

### Phase 2 — voice/video channels, shared key · size M

Channels have no pre-shared secret and dynamic membership, so a key must be
distributed and rotated.

- **Key**: random 32 bytes, `keyIndex` starts at 0.
- **Envelope**: `{ roomRef, keyIndex, key }` NIP-44-encrypted per recipient
  pubkey, sent over the **LiveKit reliable data channel** (in-band: no relay
  round-trip, arrives exactly when the participant is present; the SFU sees
  ciphertext only). Topic `e2ee-key`. A relay gift-wrap fallback can come later
  for resilience; not in v1.
- **Coordinator** (`lib/webrtc/e2eeKeyCoordinator.ts`): deterministic owner =
  lowest pubkey among connected participants (no election protocol; everyone
  can compute it from the participant list). Owner generates the key, wraps it
  to each `ParticipantConnected`, and **rotates** (keyIndex+1, redistribute) on
  `ParticipantDisconnected` so leavers can't decrypt future frames. Owner
  leaves → next-lowest pubkey notices it is now owner and rotates immediately.
- Joiners get only the current key — past frames (older keyIndex) stay sealed.
- Per-channel setting `e2ee: required | off` in channel config (creator-set,
  backend-stored). `required` + unsupported WebView → block join with a clear
  message rather than silently degrading.

### Phase 3 — per-sender keys + hardening · size M

Shared-key mode trusts every member with one secret and makes rotation a
single-owner job. The durable design is Megolm-style **per-sender keys**:

- Custom `NostrKeyProvider extends BaseKeyProvider`; each *publisher* generates
  their own sender key, wraps it to every other member (on join, and re-keyed
  on any membership change). Decryption looks keys up by participant identity
  — exactly what the worker's per-participant mode does.
- No owner, no handoff, leave-rotation is each sender's local action.
- Wire up `EncryptionError` → auto-`ratchetKey` retry → UI banner if it
  persists; `ratchetWindowSize` ~16 to ride out re-key races.
- Lock badge in `ParticipantTile`/`CallController` from
  `ParticipantEncryptionStatusChanged` + `room.isE2EEEnabled`.

### Phase 4 — adjacent gaps · size S

- LiveKit E2EE covers **media frames only**. Data-channel traffic (Listen
  Together sync today) still transits the SFU readable — wrap LT payloads in
  NIP-44 to room members or accept-and-document (it's music metadata).
- Server-side recording/egress/HLS is fundamentally incompatible with E2EE —
  document that an encrypted room can never be recorded by infra (a feature,
  but say it out loud).
- Metadata is not hidden: who is in the room, when, speaking activity, and
  track on/off remain visible to the SFU. E2EE protects *content*.

## 5. What this does NOT protect against

- A compromised **client** (keys live in the worker; the app sees plaintext).
- Membership manipulation: the backend controls token minting, so it controls
  *who is listed*; E2EE ensures unauthorized members get ciphertext, not that
  the roster is honest. Roster signing could come later via NIP-29 membership
  events.
- Traffic analysis (frame sizes/timing).

## 6. Effort & order

| Phase | Scope | Size | Ships the user-visible claim |
|---|---|---|---|
| 1 | 1:1 SFU calls (HKDF from invite secret) | S (~1–2 days) | "1:1 calls are E2EE in both modes" |
| 2 | Channels, shared key + rotation | M | "E2EE voice channels (opt-in)" |
| 3 | Per-sender keys, badges, required-mode | M | "E2EE by default" |
| 4 | LT data channel, docs | S | — |

Phase 1 first: smallest diff, reuses the existing invite secret, and converts
the most privacy-sensitive surface (1:1 calls) to fully E2E in both transport
modes. Recommended after the current beta call-stack soak, per the public
reply already given to the user.
