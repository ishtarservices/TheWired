# E2EE for Voice/Video — Design & Implementation

Status: **implemented** (desktop 1:1 calls + space voice/video channels; backend
gate; shared contracts for mobile). Answers the beta-user ask: *"Does the LiveKit
stack have encryption to the SFU on? What about E2EE?"*

## 1. What is encrypted where

| Path | Transport encryption | Server-blind (E2EE) |
|---|---|---|
| Client ↔ SFU media (channels, 1:1 calls) | ✅ always — WebRTC mandates DTLS-SRTP | ✅ **frame-level**: AES-GCM per encoded frame inside a Web Worker; the SFU forwards ciphertext |
| LiveKit data channel (Listen Together sync) | ✅ | ✅ each packet is GCM-encrypted with the sender's media key |
| LiveKit signaling WS | ✅ wss in prod (Caddy) | n/a — the SFU still sees *who* is in the room, join/leave times, speaking activity, track on/off, frame sizes |
| Call invites (room secret) + media-key envelopes | ✅ NIP-17 gift wrap | ✅ |

"Encryption to the SFU" was always on by protocol. What changed: the SFU (and
whoever operates it) can no longer read media. There is **no plaintext mode** —
see §6 for how outdated clients are handled.

## 2. Building blocks (livekit-client 2.17.3)

- `RoomOptions.encryption: { keyProvider, worker }` (the older `e2ee` field is
  deprecated; `encryption` is what also enables data-channel encryption).
- `BaseKeyProvider` in **per-participant** mode: keys are looked up by LiveKit
  identity, which the backend mints as the participant's **Nostr pubkey**.
  Key index is one byte (0–255). Subclass: `client/src/lib/webrtc/e2ee/NostrKeyProvider.ts`
  with `{ sharedKey:false, keyringSize:256, ratchetWindowSize:0, failureTolerance:-1 }` —
  we never ratchet locally; fresh keys are distributed explicitly.
- **Key material → AES key, the cross-SDK contract.** The 32 key bytes (derived
  for calls, random for channels) are fed to every SDK as raw key material and
  each derives the AES-GCM-128 key with **PBKDF2-SHA256, salt =
  `LKFrameEncryptionKey` (the ratchet salt), 100000 iterations** — what the
  native FrameCryptor (iOS/Android/RN/Flutter) and the Go SDK do. On the JS side
  this means importing the bytes as **PBKDF2** material
  (`importSenderKeyMaterial`), not the SDK's `createKeyMaterialFromBuffer`,
  which imports HKDF material and derives a different key: the first
  desktop↔mobile call decrypted nothing (`InvalidKey` on every frame) until this
  was aligned.
- Worker: `livekit-client/e2ee-worker` (Vite `?worker` import in `e2eeWorker.ts`, its
  own chunk). Chromium WebView2 uses `createEncodedStreams`, WKWebView uses
  `RTCRtpScriptTransform`; both are inside the SDK worker. `isE2EESupported()`
  gates everything; an unsupported WebView cannot call or join channels.
- Frame format (SDK): codec headers stay in the clear (VP8 10/3 bytes, H.264
  NALU-aware, Opus 1 byte) so the SFU can still do simulcast layer selection;
  trailer = `IV | ivLen | keyIndex`. Audio RED is off under E2EE (LiveKit's own
  reference app does the same); video stays H.264 (AV1/VP9 unsupported by the cryptor).
- Nothing is needed on the LiveKit server. The backend only gates token minting.

## 3. Structural advantage: identity = pubkey

Because the LiveKit identity **is** the Nostr pubkey, NIP-44 + the signer give
an authenticated, encrypted pairwise channel to every participant. A key envelope
is sealed (signed) by its sender and encrypted to the recipient's pubkey. A
malicious backend/SFU can mint a token with a spoofed identity and join a room,
but without the nsec it cannot decrypt anyone's key envelope, and its own
"key" reaches nobody: compromised infrastructure can DoS a room, not listen to it.

## 4. Design (as implemented)

### 4.1 Per-sender keys, two key sources

Every participant encrypts with its **own** key (SFrame/RFC 9605 model; Element
Call and Jitsi do the same). Receivers install one key per sender.

**1:1 DM calls — derived, zero signaling** (`packages/core/src/crypto/mediaKeys.ts`):

```
senderKey(pk) = HKDF-SHA256(ikm  = roomSecretKey bytes,
                            salt = "thewired-e2ee-v1",
                            info = "lk:" + roomId + ":" + pk,   L = 32)
```

Both peers hold `roomSecretKey` (from the invite); each installs its own key
under its own identity and the peer's under theirs, index 0, before `connect()`.
Membership of a 1:1 room is fixed, so nothing rotates. Pinned vectors live in
`mediaKeys.test.ts` — the same function ships to mobile via `@ishtarservices/core`.

**Space voice/video channels — distributed sender keys** (`channelKeys.ts`):

- On join each participant generates a random 32-byte key (index 0), installs it,
  and sends it to every co-participant as a **kind-20016 `media_key` envelope**
  (docs/DM_WIRE_CONTRACT.md §2): NIP-17 gift wrap to the recipient's pubkey via
  their kind-10050 inbox relays (APP_RELAY fallback), no self-wrap, wrap + seal
  `expiration = created_at + 120`. Content:
  `{ v:1, room:"<spaceId>:<channelId>", keys:[{ idx, key:<64 hex> }], ts:<sender ms> }`.
- **Join** → send the current key (and the next one if a rotation is in flight) to the joiner.
- **Leave** → rotate: new random key at `(idx+1) mod 256`, sent to everyone still
  present, then the local encoder switches after `USE_KEY_DELAY_MS` (2 s) so
  receivers hold it first. Leave bursts are debounced (500 ms); a leave during a
  rotation queues another one. Long sessions also rotate every 30 min.
- **Reconnect** → re-install our key locally and re-send it.
- **Repeat** → every hand-over (start fan-out, join, rotation) is sent a
  second time 3 s later with a fresh `ts` (idempotent: newest-wins, wrap-id
  dedupe), so one lost envelope on either side never leaves a participant
  undecryptable until the next rotation. Mobile does the same.
- **Receive** → bound to the session's own room name, dropped when `|now − ts| > 120 s`
  or older than the newest seen from that sender; wrap ids are deduped so a relay
  replay never re-installs a key.

Why Nostr and not the LiveKit data channel: with `encryption` on, data packets
are encrypted with the sender's key — the channel cannot bootstrap its own keys.
Why kind 20016 and not kind 14 + type tag: Amethyst/0xchat render every kind-14
rumor as a message (same reason 20014/20015 exist).

### 4.2 Wiring (`client/src/lib/webrtc/livekitClient.ts`)

Order is load-bearing: `createE2EESession()` (throws `E2EEUnsupportedError` before
any Room exists) → `new Room({ encryption })` → `room.setE2EEEnabled(true)` →
pre-known keys (calls) → `connect()` → `session.start(roster)` (channels: fan-out).
`ParticipantConnected/Disconnected/Reconnected` are forwarded to the session;
`Disconnected` disposes it (worker terminated). `ParticipantEncryptionStatusChanged`
→ `voice.e2ee.active` (local) / `participant.encrypted` (remote); `EncryptionError`
→ debounced banner (5 s per participant, suppressed 8 s after a join — the
key-in-flight race). Data packets with `encryptionType === NONE` are ignored in an
encrypted room. Listen Together's late-joiner re-announce waits 1.5 s after the
key hand-over so the joiner can decrypt it.

### 4.3 UI
Lock on every `MediaTile` and in the `CallController` header; amber open lock on a
participant whose tracks are plaintext in an encrypted room; `VoiceBanners` shows
encryption errors; `CallNotice` toast explains a refused call (outdated peer, with a
one-click DM nudge; or an unsupported device).

## 5. Threat model — what this does and does not protect

Protects media **content** from the SFU, the backend, relays and the network.

Does not hide: who is in a room, when, who is speaking, track on/off, frame
sizes/timing. Does not defend against a compromised **client** (keys live in the
worker; the app sees plaintext) or a dishonest roster: the backend mints tokens,
so it controls who is *listed*; E2EE ensures an unauthorized participant gets
ciphertext, and `/voice/dm-token` additionally binds a `dm:<roomId>` to its first
two parties (403 for anyone else). Server-side recording, egress, HLS,
transcription or agents are **impossible** on encrypted rooms — by design.

## 6. Rollout: mandatory, with a gate and an update path

- The `call_invite` payload carries `caps: { e2ee: true }` (authenticated: it rides
  inside the sealed rumor). An invite **without** it is never rung: the callee
  auto-declines and sees "X's app doesn't support encrypted calls yet" with a
  "Let them know" DM nudge. A partner that joins a call publishing plaintext ends
  the call the same way (fail closed).
- Backend `VOICE_REQUIRE_E2EE` (**on by default**): `/voice/token` and
  `/voice/dm-token` return `409 E2EE_REQUIRED` unless the body has
  `supportsE2EE: true`, so a plaintext build cannot join any room. Every
  client, including the mobile app, implements the media-key protocol before
  it ships voice; set the flag to `false` only to bridge a rollout.
- Unsupported WebViews (no insertable streams / encoded transforms — possibly
  Linux webkit2gtk) are blocked with a clear message rather than joining plaintext.

## 7. Mobile (soot)

Contract-only today (soot has no media stack yet). To interoperate it must:
derive call keys with `deriveCallSenderKey` from `@ishtarservices/core`; send
`caps: { e2ee: true }` on invites and decline invites without it; speak kind-20016
envelopes with the same rotation policy; use `@livekit/react-native`'s
`RNE2EEManager` + `RNKeyProvider` in per-participant mode, passing the raw 32-byte
key material so the native HKDF path matches `createKeyMaterialFromBuffer`.
First interop checkpoint: a desktop ↔ RN encrypted 1:1 call.

## 8. Verification

Unit: `packages/core` (vectors, envelope parser), `client/src/lib/webrtc/e2ee/__tests__`
(provider, call keys, rotation state machine, inbox, session), `livekitClient.test.ts`
(ordering, events, plaintext-packet drop), `callLifecycle.test.ts`, `voiceService.test.ts`,
`callInviteE2EE.test.ts`, backend `voiceDmToken.test.ts` / `voiceGrants.test.ts`.

Manual: two-machine call — lock badges on both tiles, `room.isE2EEEnabled` true,
LiveKit server logs show `encryption: GCM` on tracks; macOS ↔ Windows
(WKWebView `RTCRtpScriptTransform` ↔ WebView2 `createEncodedStreams`); a channel
with three clients where one leaves → key index bump in `wiredDebug.enable("e2ee")`
logs and audio continues.
