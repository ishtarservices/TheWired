# DM wire contract — The Wired desktop ↔ soot mobile ↔ relay ↔ backend

**Contract version:** `wire_version = 1` · **Document version:** 1.0.1 (2026-09-21)
**Owner:** the TheWiredV1 monorepo (server side + `@ishtarservices/core`). soot implements it; it does not change it.
**Ships in:** `@ishtarservices/shared-types@0.2.0`, `@ishtarservices/core@0.2.0`, `thewired-relay` ≥ 0.2.0, backend ≥ migration 0029.

This document is normative. Where it disagrees with older docs (`NIP17_GROUP_ROOMS.md`, `REACTIONS_INTEROP.md`, `docs/nips/NIP-XX-Friend-Requests.md`) it wins; those docs remain accurate for what they cover and are referenced below. MUST / SHOULD / MAY are RFC-2119.

---

## 0. Versioning and the dual-read rule

- Every client MUST **write the spec form** (§2 "write") and MUST **read both** the spec form and the legacy form (§2 "legacy read") for at least the next two minor app releases after it adopts this contract. Legacy *reading* never has to be removed; it is cheap.
- A rumor a client does not understand (unknown kind, unknown `type`) MUST be dropped silently, never rendered as a text bubble.
- The number `wire_version` is not on the wire. It names this contract in code comments, tests and the core package changelog. Bump it only for breaking wire changes.
- `@ishtarservices/core` exports every helper named here. Clients SHOULD call the helpers rather than re-implement tag shapes.

## 1. Envelope (NIP-17 / NIP-59 / NIP-44)

```
rumor  (unsigned; kind per §2; created_at = real send time; id = sha256 of the NIP-01 serialization)
  └─ seal      kind 13, pubkey = real sender, tags = [] (+ ["expiration", ts] when §5 applies),
               content = nip44(sender → recipient, JSON(rumor)), created_at randomized ≤ 2 d back, SIGNED
       └─ wrap kind 1059, pubkey = fresh ephemeral key, tags = [["p", recipient]] (+ ["expiration", ts]),
               content = nip44(ephemeral → recipient, JSON(seal)), created_at randomized ≤ 2 d back, signed by the ephemeral key
```

Receiver MUST (core `unwrapGiftWrap` does all of this; fail closed on any failure):
1. Verify the wrap signature before decrypting (pipeline already does).
2. Decrypt the wrap with `nip44(ephemeral pubkey)`, parse the seal, check `seal.kind === 13`.
3. **Verify the seal's schnorr signature** (`verifyEventSync`). *New in wire_version 1.*
4. Decrypt the seal with `nip44(seal.pubkey)`, parse the rumor, check `rumor.pubkey === seal.pubkey`.
5. **Recompute the rumor id** from `[0, pubkey, created_at, kind, tags, content]`. If the JSON carried an `id` that differs → reject. If absent → fill. *New in wire_version 1.* All anchors (§3) refer to this id.
6. Check `rumor.kind` against the accepted set (§2). Unknown → drop.
7. If the wrap or seal carries `expiration` ≤ now → drop (NIP-40).
8. Never log plaintext.

Sender MUST:
- Produce **two wraps per message** sharing one rumor: recipient wrap (seal to recipient, wrap to recipient) and **self-wrap** (seal to self, wrap to self), except where §5 says "no self-wrap".
- Publish the recipient wrap only to relays in the recipient's **kind 10050** list (NIP-17). Fall back to the sender's own 10050 list, then bootstrap relays, only when the recipient has none.
- Publish the self-wrap to the sender's own 10050 relays.
- Publish wraps **only over a NIP-42-authenticated socket** on relays that advertise NIP 42 (the relay records self-wraps by the authenticated publisher — §7.3). On relays without AUTH, publish anyway.
- Treat a self-wrap publish failure as a **visible warning** on the message ("not synced to your other devices"), not a silent log; retry via the outbox. Negentropy (§7.5) repairs it later.

Rumor `content` for kind 14 is plain text (markdown-ish, client renders). Rumor `p` tags: for 1:1 exactly one `["p", recipient]`; for rooms see §4.

## 2. Rumor kinds

| kind | name | write | legacy read (still accepted) | self-wrap | notes |
|---|---|---|---|---|---|
| 14 | text message | ✅ | — | yes | §3 tags |
| 15 | file message | ✅ | URL pasted into a kind-14 body (old attachments) | yes | AES-256-GCM blob, §3.4 |
| 7 | reaction | ✅ | kind-14 `["type","dm_reaction"]` + `["e", rumorId]`, content = emoji | yes | content = emoji (`""` → `"+"`); tags `["e", targetRumorId]` (NIP-25: the LAST `e` is the target), `["k","14"]` (or `"15"`), `p` = participants as on every rumor (no separate author `p`), optional NIP-30 `["emoji", shortcode, url]` |
| 14 + `["type","dm_reaction_remove"]` | un-react | ✅ (no spec form exists) | same | yes | `["e", targetRumorId]`, content = the emoji removed |
| 14 + `["type","dm_edit"]` | edit | ✅ | same | yes | `["e", originalRumorId]`, content = new text. Advisory window **24 h** (client-side UI only; receivers apply any edit from the original author) |
| 14 + `["type","dm_delete"]` | delete for everyone | ✅ | same | yes | `["e", originalRumorId]`, content `""`. Best-effort |
| 14 + `["type","friend_request"]` / `friend_request_accept` / `friend_request_remove` | friend graph | ✅ | same | yes | unchanged, see `docs/nips/NIP-XX-Friend-Requests.md` |
| 14 + `["type","call_invite"]` / `call_decline` / `call_missed` | call signaling | ✅ | same | invite: yes; others: no | content = JSON payload (unchanged). **Wrap + seal MUST carry `expiration = created_at + 120`** (replaces the 60-s staleness heuristic; receivers still ignore invites older than 120 s) |
| 20014 | typing | ✅ (behind toggle) | — | **no** | content `""`, tags `["p", peer]` (+ `["g", roomId]` in rooms). Wrap + seal `expiration = created_at + 30`. Send at most one per 5 s while the composer has focus; only to friends. Receivers show "typing" for 6 s after the newest one |
| 20015 | receipt | ✅ (behind toggle) | — | **no** | tags: one `["e", rumorId]` per acknowledged message (≤ 50), `["status", "delivered" \| "read"]`, `["p", peer]`. Wrap + seal `expiration = created_at + 7·86400`. Only to friends. `delivered` is sent once on unwrap, `read` once when viewed |
| 444 | Marmot welcome | phase 2 | — | — | §10; core will accept it in the kind set when phase 2 lands |

Accepted rumor kinds in `unwrapGiftWrap` (`DM_RUMOR_KINDS` in core): `[14, 15, 7, 20014, 20015]`. Everything else throws `unsupported rumor kind`.

Why non-14 kinds for typing/receipts: Amethyst/0xchat render every kind-14 rumor as a message, including ones with a `type` tag; they ignore rumor kinds they don't know. Plaintext ephemeral kinds (20001-style) were rejected because they publish "A is typing to B" in the clear.

## 3. Tags on message rumors (kinds 14 and 15)

### 3.1 Anchors are rumor ids, never wrap ids
Wrap ids differ per holder (recipient wrap ≠ self-wrap). Every reference to another message uses the **rumor id** from §1 step 5. Readers MUST resolve rumorId-first and MAY fall back to wrapId for rows written by pre-contract clients.

### 3.2 Reply / quote
- Reply (write): `["e", <parentRumorId>, <relayHint or "">]`. Exactly one `e` tag on a kind 14/15 means "reply to".
- Quote (write): `["q", <quotedRumorId>]` and `nostr:nevent…` or the text in `content`. Quotes are rare in DMs; most clients render `q` like a reply.
- Legacy read: a `q` tag with no `e` tag was how both our clients wrote replies before this contract. **Read: `e` first, then `q`.**

### 3.3 Other tags
| tag | shape | meaning |
|---|---|---|
| `p` | `["p", pubkey]` | recipient(s). Room = all participants except sender (§4) |
| `subject` | `["subject", text]` | conversation title; last one wins per conversation (rooms) |
| `expiration` | `["expiration", unixSeconds]` | on the **seal and wrap** (NIP-17), MAY be mirrored on the rumor. See §5 |
| `emoji` | `["emoji", shortcode, url]` | NIP-30 custom emoji used in content |
| `g` | `["g", roomId]` | explicit room id (§4) |

### 3.4 Kind 15 file message
Blob is encrypted **AES-256-GCM** (12-byte nonce, 128-bit tag appended, no AAD) with a fresh random key per file, uploaded as an opaque blob (`application/octet-stream`) to a Blossom server, and referenced from the rumor:

```
content = <blob URL>
tags:
  ["p", recipient]
  ["file-type", <mime of the plaintext, e.g. image/jpeg>]
  ["encryption-algorithm", "aes-gcm"]
  ["decryption-key", <hex 32 bytes>]
  ["decryption-nonce", <hex 12 bytes>]
  ["x", <sha256 hex of the ENCRYPTED blob>]        # the Blossom hash
  ["ox", <sha256 hex of the plaintext>]
  ["size", <bytes of the encrypted blob>]           # optional
  ["dim", "<w>x<h>"]                                # optional, images/video
  ["blurhash", <blurhash>]                          # optional
  ["thumb", <url of a thumbnail encrypted with the SAME key and nonce>]   # optional
  ["fallback", <url>]…                              # optional mirrors
  ["e", parentRumorId] / ["q", …] / ["expiration", …] / ["emoji", …] as in §3.2–3.3
```
Core: `encryptDMFile(bytes) → { ciphertext, key, nonce, x, ox, size }`, `decryptDMFile(ciphertext, key, nonce) → bytes`, `fileRumorTags(meta)`, and `parseDMWire` returns `{ kind: "file", url, fileType, key, nonce, x, ox, size?, dim?, blurhash? }`.
Receivers MUST verify `sha256(ciphertext) === x` before decrypting and `sha256(plaintext) === ox` after. Upload target: the recipient's Blossom list (kind 10063) if known, else the sender's own backend Blossom (`/blossom` on thewired.app), else the public fallbacks. Caption goes in a separate kind 14 that `e`-replies to the file (or precedes it); kind 15 `content` is the URL only.

Voice notes are kind 15 with `file-type` `audio/mp4` or `audio/ogg` and an optional `["duration", seconds]` tag (our extension, harmless to others).

## 4. Rooms (small groups, ≤ 10)

Unchanged from `NIP17_GROUP_ROOMS.md`; restated so it is in one place:
- One rumor per message, `p`-tagging **every participant except the sender**. Receivers compute participants = `sender ∪ p tags`.
- **conversationId** = `roomIdOf(rumor)`: the `["g", roomId]` value if present, else `roomKeyFromParticipants(participants)` = sorted, de-duplicated pubkeys joined with `,`. For 1:1 (exactly two participants and no `g`) conversationId = the peer pubkey. `conversationIdOf(unwrapped, myPubkey)` in core implements this.
- Named rooms MUST carry a stable `g` (32-byte random hex chosen by the creator) so membership changes do not fork the conversation; ad-hoc rooms MAY omit it.
- N wraps to recipients + 1 self-wrap, all sealing the same rumor (`createGroupMessageWraps`).
- `subject` sets the title. Reactions/edits/deletes/typing/receipts in rooms carry the same `p` set (or the `g` tag) so every member can route them.
- Relay: no changes; wraps route by `p`.

## 5. Expiration (NIP-40) defaults

| what | seal + wrap `expiration` |
|---|---|
| ordinary kind 14 / 15 / 7 / edit / delete / friend_* | none, unless the conversation has a disappearing-messages timer |
| disappearing-messages chat | `rumor.created_at + timer` (timer in read-state `expireAfter`, §6); both sides delete locally at expiry |
| `call_invite`, `call_decline`, `call_missed` | `created_at + 120` |
| typing (20014) | `created_at + 30` |
| receipt (20015) | `created_at + 7·86400` |

Clients MUST ignore expired events on receipt and delete local copies of disappearing messages at expiry. The relay drops expired events on ingest, never serves them, and sweeps them every 5 min (§7.4). Do not send `expiration` to relays that do not list NIP 40 (our relay does; damus/nos.lol do).

## 6. Read-state record (kind 30078, `d = thewired:dm_read_state`)

Content = `nip44(self → self, JSON)`; tags `[["d","thewired:dm_read_state"]]`; published to own DM relays + bootstrap; debounced 10 s.

```jsonc
{
  "v": 2,
  "lastRead":    { "<conversationId>": <unixSeconds> },              // v1 field, unchanged semantics
  "pinned":      { "<conversationId>": <unixSeconds set> },          // presence = pinned; value = when (for ordering + merge)
  "archived":    { "<conversationId>": <unixSeconds set> },
  "muted":       { "<conversationId>": <unixSeconds until, 0 = forever> },
  "expireAfter": { "<conversationId>": { "s": <seconds>, "at": <unixSeconds> } }, // disappearing timer; s = 0 off; at = when set (LWW)
  "updatedAt":   <unixSeconds>
}
```
- v1 records (`{ lastRead }`) MUST still be read.
- `muted` values: a positive stamp is the unix time the mute ENDS (`4102444800` = forever, `MUTED_FOREVER` in core); a negative stamp is an unmute tombstone.
- **Merge, never overwrite.** On load: `merged = mergeDMReadState(local, remote)`. Before publish: merge again with the newest remote seen. Per-key rule: `lastRead` = max; `pinned`/`archived`/`muted`/`expireAfter` = the entry with the larger timestamp wins, where **removal** is encoded as an explicit tombstone `"<conversationId>": -<unixSeconds>` (negative = removed at that time) so a removal beats an older set. Tombstones older than 30 d are dropped on publish.
- Core: `DM_READ_STATE_D_TAG`, `mergeDMReadState`, `encodeDMReadState(codec, rec)`, `decodeDMReadState(codec, content)`.
- `muted` is notification-only (no push, no badge, no toast). Blocking is separate: the public kind-10000 mute list (`p` tag) + local drop of that pubkey's wraps.

## 7. Relay behaviour (thewired-relay ≥ 0.2.0)

### 7.1 NIP-42 AUTH gate on kind 1059
- Stored query: a kind-1059 row is returned only when the connection is authenticated **and** the authenticated pubkey is in the event's `p` tags (or holds the ingest role, §7.3).
- Unauthenticated `REQ` whose filter `kinds` explicitly includes 1059 → `["CLOSED", <subId>, "auth-required: gift wraps are served only to their recipient"]`. The `auth-required:` prefix is the stable contract (NIP-42 machine-readable prefix); the text after it may change. Filters without an explicit 1059 silently exclude wraps.
- Live broadcast: same rule per connection.
- The relay sends `["AUTH", challenge]` on connect. Clients MUST answer it (kind 22242 with `["relay", <url as dialed>]`, `["challenge", …]`) before or immediately after the 1059 REQ and MUST re-send the REQ after `["OK", …, true]` if it was `CLOSED` with the `auth-required:` prefix. Desktop and soot both already answer AUTH; both need the CLOSED → re-REQ step.
- Gate mode is an env on the relay (`RELAY_WRAP_AUTH_GATE=warn|enforce`); prod runs `warn` for one release, then `enforce`. Clients should not depend on the mode.

### 7.2 What AUTH changes for NIP-46 (bunker) users
A bunker prompts for the 22242 signature. Clients MUST request `sign_event:22242` in the NIP-46 connect permissions (desktop does) so it is silent after first approval. Until AUTH completes the DM inbox is empty, not stale — show "connecting".

### 7.3 Self-wrap detection (replaces `POST /push/suppress`)
When an authenticated connection publishes a kind 1059 whose `p` equals the authenticated pubkey, the relay stores it with `self_published = true`. The backend's push planner skips such wraps. Consequently:
- `POST /push/suppress` is **deprecated**: it returns `200 {"data":{"success":true,"deprecated":true}}` and does nothing. Clients SHOULD stop calling it in their next release; it will be removed two releases later.
- A wrap published before the socket is authenticated is not flagged and may produce one "new message" push to the sender's own phone. Hence §1 "publish only on an authenticated socket".

### 7.4 NIP-40
Expired on ingest → `["OK", id, false, "invalid: event expired"]`. Expired rows are never served and are deleted every 5 minutes. `expires_at` is indexed.

### 7.5 NIP-77 negentropy — the inbox sync procedure
Replaces since-window resync on relays that list 77 (ours; also relay.damus.io, nos.lol via strfry).

1. Build local storage: for every wrap you hold **from this relay** (or all wraps if you don't track origin), insert `(wrap.created_at, wrap.id)`. Use the wrap's own (randomized) `created_at`, exactly what the relay has.
2. `["NEG-OPEN", subId, {"kinds":[1059], "#p":[me]}, initialMsgHex]` on an **authenticated** socket. Frame limit 60 000 bytes.
3. Loop on `["NEG-MSG", subId, hex]` via `reconcile(msg, onHave, onNeed)` until it returns `null`, then `["NEG-CLOSE", subId]`.
4. `need` ids (relay has, you don't) → `REQ {"ids":[…]}` in chunks of 100 on the same socket, then decrypt as usual.
5. `have` ids (you have, relay doesn't) that are **self-wraps you published to this relay** → republish them (this repairs silent self-wrap failures). Recipient wraps you sent are never in your own storage, so they are not in `have`.
6. Persist per relay: `lastReconciledAt`. No `since` cursor is needed for relays that reconcile; keep the since-window path only for relays that answer `NEG-ERR` or a `NOTICE` about NEG-*. Our relay (pre-0.2.0) says `unknown message type: NEG-OPEN`; strfry deployments with the feature off (relay.damus.io, nos.lol as of 2026-09) say `ERROR: bad msg: negentropy disabled` — treat any NOTICE mentioning `NEG-` or `negentropy` while a session is open as "unsupported" and stop retrying on that relay for the session.
7. Relay limits: ≤ 4 concurrent NEG sessions per connection, ≤ 20 000 ids per session → `["NEG-ERR", subId, "blocked: too many records"]`; idle sessions are closed after 60 s → `NEG-ERR … "closed"`.

nostr-tools ≥ 2.23 exports `Negentropy` and `NegentropyStorageVector` from `nostr-tools/nip77`; drive the frames with your own socket (the bundled `NegentropySync` wants its `AbstractRelay`).

### 7.6 Rate limits and NIP-11
Per connection: 300 messages / 10 s (then `NOTICE rate limited: slow down`, messages dropped). Per IP: 32 connections. NIP-11: `supported_nips: [1, 2, 9, 11, 17, 29, 40, 42, 44, 50, 59, 77]`, `limitation.max_limit = 500`, `limitation.auth_required = false` (AUTH is required only for 1059), `retention: [{"kinds":[1059], "time": <seconds or null>}]`.

## 8. Push (backend ≥ this contract)

### 8.1 Payload
Sent through the Expo push API to every registered device of the wrap's `p` pubkey, unless the wrap is `self_published`:
```jsonc
{
  "to": "<ExponentPushToken>",
  "title": "soot", "body": "new message",          // content-free, unchanged
  "sound": "default", "priority": "high", "ttl": 3600, "badge": <n>,
  "channelId": "dms",                              // Android
  "categoryId": "dm",
  "mutableContent": true,                          // iOS: wakes the Notification Service Extension
  "data": { "type": "dm", "url": "soot://dm?segment=messages", "eventId": "<wrap id>", "relay": "wss://relay.thewired.app" }
}
```
`collapseKey = dm:<recipient>`, at most one DM push per recipient per 120 s (existing).

### 8.2 iOS Notification Service Extension — what the client needs
The server never learns the sender or text; the extension decrypts on device. Contract for soot:
- **Entitlements** on app + extension: `keychain-access-groups: [$(AppIdentifierPrefix)app.soot.shared]`, `com.apple.security.application-groups: [group.app.soot]`. The app stores the active account's nsec in the shared keychain group (`kSecAttrAccessGroup`) and a small **profile-name cache** (`pubkey → displayName, updatedAt`, JSON, ≤ 5 000 entries) plus the preview preference in the App Group container.
- **Preference** `dmPreview: "none" | "name" | "nameAndText"` (default `name`), also mirrored in `NotificationPreferencesDto` later if we want it server-side (not needed).
- **Extension flow** (budget 25 s of the 30 s iOS allows): read `data.eventId`, `data.relay`; open a WebSocket to `relay`; answer `AUTH` with a 22242 event signed by the nsec; `REQ {"ids":[eventId]}`; on the event: verify wrap sig, unwrap per §1 (seal sig verify, id recompute), parse per §2. Then set `title` = display name from the cache (else `npub…` short form), `body` = per preference: `none` → "new message"; `name` → "new message"; `nameAndText` → kind 14 text (≤ 120 chars) / kind 15 → "sent a photo|file|voice note" / kind 7 → "reacted <emoji>". Typing, receipts and control rumors (`friend_request_*`, `call_decline`, `call_missed`, `dm_edit`, `dm_delete`, `dm_reaction_remove`) SHOULD be demoted: keep the generic "new message" text but set `interruptionLevel = passive` and no sound (iOS does not let an extension drop a notification). The server cannot see kinds, so it pushes for every non-self wrap; the extension is the only place to tell them apart. If decryption fails or times out, deliver the generic content unchanged.
- Set `threadIdentifier = conversationId` so iOS groups per conversation. Write the decrypted rumor to an App Group spool file `inbox/<wrapId>.json` so the app can import it on next launch without a network round trip (optional but recommended).
- Never write plaintext to logs; wipe the spool on logout.
- Decrypt library: rust-nostr's Swift bindings (`NostrSDK`) provide NIP-44 + `unwrapGiftWrap`; or a ~300-line Swift port of core's unwrap over `secp256k1.swift` + CryptoKit ChaCha20-Poly1305. Either satisfies §1.

### 8.3 Android
FCM (via Expo) high-priority data message; expo-notifications background task receives it and runs the same unwrap in JS with the app's normal core; then posts a local notification with the same rules as §8.2.

## 9. Friend requests and message requests
Wire unchanged (`friend_request*` typed rumors, `docs/nips/NIP-XX-Friend-Requests.md`). Client policy, both apps: non-friends land in a **requests** tray; no typing, no receipts, no push preview (the NSE shows the generic text) until accepted; accepting = `friend_request_accept`. Server-side `notification_preferences.friendRequests` is honoured once the planner emits that type (it does not today; tracked separately).

## 10. Phase 2 — Marmot (MLS over Nostr); plan only, nothing ships in wire_version 1

The July-2026 restructure of the spec (`github.com/marmot-protocol/marmot`, `transports/nostr.md`) supersedes the MIP-00/01 kind numbers the analysis quoted (443, 10051). Target the current spec:

| kind | role | shape |
|---|---|---|
| **30443** | KeyPackage (addressable) | content = base64 `MLSMessage(mls_key_package)`; tags `["d", <32-byte hex>]`, `["i", <KeyPackageRef hex>]`, `["mls_protocol_version","1.0"]`, `["mls_ciphersuite", …]`, `["mls_extensions", …]`, `["mls_proposals", …]`, `["app_components", "0x8001", "0x8009", …]`; signed by the account key; published to the account's **kind 10002** write relays. (443 and 10051 are legacy; read 443 for a while if White Noise still publishes it.) |
| **444** | Welcome | rumor (no sig) inside a kind-1059 wrap to the invitee; tags `["e", <keyPackageEventId>]`, `["relays", …]`. Fits §1 unchanged; core's accepted-kinds set gains 444. |
| **445** | Group event | `["h", <nostr_group_id hex>]`, **fresh ephemeral pubkey per event**, content = base64(nonce‖ChaCha20-Poly1305 ciphertext) keyed by `MLS-Exporter("marmot","group-event",32)`. **Our relay must exempt kind 445 from the NIP-29 `h` membership gate** (`nostr/membership_gate.rs`), store it as public-opaque, and serve it by `#h`. |

Plan: (1) on login publish a 30443 with a signing key distinct from the nsec (kept in the keystore); (2) new conversations check the peer's 30443 → start a 2-member MLS group (444 welcome) else NIP-17; (3) rooms > 10 are Marmot-only; (4) each device is its own MLS leaf → "link devices" UX and history transfer are product work, not protocol work; (5) libraries: MDK (Rust, via Tauri command on desktop; UniFFI/native module on mobile) or marmot-ts. Blocked on: the `conversationId` refactor (done in wire_version 1), encrypted media (done), and the audit gate in `NIP17_GROUP_ROOMS.md`.

## 11. Implementation status (monorepo side, 2026-09-21)

| Layer | Status |
|---|---|
| `@ishtarservices/shared-types@0.2.0` | `DM_KINDS`, `DM_RUMOR_KINDS`, `DMControlType`, `DMFileMeta`, `DMReadStateRecordV2`, `DMPushData`, `DM_EXPIRATION_SECONDS`, `DM_EDIT_WINDOW_SECONDS` |
| `@ishtarservices/core@0.2.0` | `unwrapGiftWrap` hardened (seal sig, rumor-id recompute, kind allowlist, expiration); `buildRumor`/wraps take `kind` + `expiration`; `parseDMWire` + `*RumorTags` builders; `conversationIdOf`; `encryptDMFile`/`decryptDMFile`; read-state v2 merge; `Negentropy` client+responder (NIP-77); room wraps take `extraTags`/`kind`/`expiration`/`noSelfWrap` |
| relay 0.2.0 | §7 complete: 1059 gate (`RELAY_WRAP_AUTH_GATE`), ingest role, `self_published`, NIP-40 + sweeper, NIP-77, per-connection + per-IP limits, NIP-11 |
| backend | ingester AUTHs with `INGEST_SECRET_KEY`; self-published wraps never queue; dm push carries `DMPushData` + `mutableContent` + `categoryId`; `/push/suppress` deprecated no-op |
| desktop | writes the spec form (`e` replies, kind 7, kind 15), reads both; typing/receipts (friends, opt-out); pin/archive/mute/disappearing via read-state v2; rooms (≤10, `g` id); block = kind-10000; AUTH `CLOSED` → re-REQ; NIP-77 inbox reconcile every 15 min. Desktop does **not** republish `have` ids (it keeps no wrap ciphertext), so §7.5 step 5 is mobile-only for now. AI summarize/ask gated by a per-session consent dialog for remote providers. |
| iOS NSE | soot's — contract only (§8.2) |
| Marmot | §10 plan only |

## 12. Change log
- **1.0.1 (2026-09-21)** — clarified the stable `auth-required:` prefix and strfry's `negentropy disabled` NOTICE (§7.1, §7.5). No wire change.
- **1.0.0 (2026-09-21)** — initial contract: seal verification + rumor-id recompute, kinds 15/7/20014/20015, `e` replies, expiration table, read-state v2 with merge + tombstones, relay AUTH gate / NIP-40 / NIP-77 / rate limits, `self_published` replaces `/push/suppress`, NSE contract, Marmot kinds corrected to 30443/444/445.
