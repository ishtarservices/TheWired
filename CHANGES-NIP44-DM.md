# NIP-44 Encryption & DM Bug Fixes

Summary of all changes made across these sessions. Two major areas: implementing NIP-44 encryption in the Tauri keystore (to unblock DMs for desktop users) and fixing multiple logic bugs in the DM and notification systems.

---

## 1. NIP-44 v2 Encryption in Tauri Keystore

DMs were completely broken in the Tauri desktop app. The TypeScript NIP-44 layer threw "not yet supported in the desktop app" because the Rust keystore only had event signing — no NIP-44 crypto. This blocked all DM send/receive for desktop users.

### New file: `client/src-tauri/src/nip44.rs`

Pure Rust NIP-44 v2 cryptographic module. No Tauri dependencies — all functions are standalone and unit-tested.

| Function | Purpose |
|----------|---------|
| `xonly_to_pubkey(hex)` | Convert 32-byte x-only Nostr pubkey to `secp256k1::PublicKey` (prepend 0x02) |
| `get_conversation_key(sk, pk)` | ECDH via `shared_secret_point` → HKDF-Extract(salt="nip44-v2", IKM=shared_x) |
| `get_message_keys(conv_key, nonce)` | HKDF-Expand(PRK=conv_key, info=nonce, L=76) → (chacha_key, chacha_nonce, hmac_key) |
| `calc_padded_len(len)` | NIP-44 power-of-two padding scheme, min 32 bytes |
| `pad(plaintext)` / `unpad(padded)` | `[u16_be_length][plaintext][zero_padding]` |
| `encrypt(plaintext, conv_key)` | Random nonce → ChaCha20 → HMAC-SHA256(AAD=nonce) → base64 payload |
| `decrypt(payload, conv_key)` | Base64 decode → verify MAC (constant-time, before decryption) → ChaCha20 → unpad |

Unit tests (7 total): padding edge cases, conversation key from NIP-44 test vector, encrypt/decrypt roundtrip, known payload decryption, known nonce encryption match, xonly pubkey conversion.

### Modified: `client/src-tauri/Cargo.toml`

Added dependencies: `chacha20 = "0.9"`, `hkdf = "0.12"`, `hmac = "0.12"`, `base64 = "0.22"`. All compatible with existing `sha2 = "0.10"` (same `digest 0.10` trait ecosystem).

### Modified: `client/src-tauri/src/keystore.rs`

Added two Tauri IPC commands:

```rust
#[tauri::command]
pub fn keystore_nip44_encrypt(recipient_pubkey: String, plaintext: String) -> Result<String, String>

#[tauri::command]
pub fn keystore_nip44_decrypt(sender_pubkey: String, ciphertext: String) -> Result<String, String>
```

Both: `load_secret_key(false)` → `xonly_to_pubkey` → `get_conversation_key` → `encrypt`/`decrypt`. Same pattern as existing `keystore_sign_event`.

### Modified: `client/src-tauri/src/lib.rs`

- Added `mod nip44;`
- Registered `keystore_nip44_encrypt` and `keystore_nip44_decrypt` in `generate_handler![]`

### Modified: `client/src/lib/nostr/tauriSigner.ts`

Added two instance methods to `TauriSigner`:

```typescript
async nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string>
async nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string>
```

### Modified: `client/src/lib/nostr/nip44.ts`

Replaced `throw new Error("NIP-44 encryption is not yet supported...")` stubs with:

```typescript
if (signerType === "tauri_keystore") {
  const { TauriSigner } = await import("./tauriSigner");
  const signer = new TauriSigner();
  return signer.nip44Encrypt(recipientPubkey, plaintext);
}
```

Dynamic import ensures the Tauri module only loads in Tauri context.

---

## 2. DM Bug Fixes

### Bug: Sender sees unread badge for own messages

**Root cause:** `dmSlice.ts` `addDMMessage` incremented `unreadCount` for every message regardless of sender. The reducer had no awareness of which user sent the message.

**Compounding issue:** `DMView.tsx` used route params for display but never synced `activeConversation` in Redux, so the `activeConversation !== partnerPubkey` check was always true when navigating via URL.

**Fix (dmSlice.ts):** Added `myPubkey` to the action payload. Unread count only increments for incoming messages:

```typescript
const isOwnMessage = message.senderPubkey === myPubkey;
// ...
if (!isOwnMessage && state.activeConversation !== partnerPubkey) {
  contact.unreadCount += 1;
}
```

**Fix (DMView.tsx):** Added `useEffect` that syncs `routePubkey` → Redux `activeConversation`:

```typescript
useEffect(() => {
  if (routePubkey && routePubkey !== activeConversation) {
    dispatch(setActiveConversation(routePubkey));
  }
}, [routePubkey, activeConversation, dispatch]);
```

**Fix (eventPipeline.ts):** Passes `myPubkey` in the dispatch payload. Moved `evaluateDMNotification` behind a `dm.sender !== myPubkey` guard (belt-and-suspenders with the existing check in the evaluator).

### Bug: Sender's own DM toast notification

**Root cause:** `eventPipeline.ts:284` called `evaluateDMNotification(dm.sender, dm.content)` for every unwrapped DM including self-wraps. While the evaluator had a `senderPubkey === myPubkey` guard, the unread badge in the sidebar (Bug #1) was the visible symptom.

**Fix:** Added explicit `dm.sender !== myPubkey` check before calling `evaluateDMNotification`.

### Bug: Incorrect timestamps (sender showed random past time)

**Root cause:** `giftWrap.ts` `randomTimestamp()` generates a time between now and 2 days ago for NIP-17 privacy. This was used for the rumor's `created_at`, which flowed through to the display.

**Fix (dmService.ts):** Replaced `processIncomingEvent(selfWrap, "local")` with a direct `store.dispatch(addDMMessage(...))` using `Date.now() / 1000` as the timestamp. The self-wrap arriving from relays later is deduped by `wrapId`.

### Bug: Incorrect timestamps (receiver showed random past time)

**Root cause:** `handleGiftWrap` used `dm.createdAt` (the randomized `rumor.created_at`) for display. The receiver has no way to know the real send time because it's encrypted and deliberately randomized.

**Fix (eventPipeline.ts):** `handleGiftWrap` now uses `Date.now() / 1000` as `displayTimestamp` for all messages arriving through the pipeline. The randomized rumor timestamp is a wire-level privacy feature, not a display feature. This change does NOT affect the on-wire privacy — all three randomized timestamps (rumor, seal, gift wrap) are still generated and encrypted exactly as before.

### Bug: Timestamps never auto-update ("just now" stays forever)

**Root cause:** `DMMessage.tsx` and `DMSidebar.tsx` computed `formatDistanceToNow()` once at render time. No re-render occurred until new state changes.

**Fix:** New `useRelativeTime` hook at `client/src/hooks/useRelativeTime.ts`:

- All hook instances share a **single** `setInterval(60_000)` via module-level subscriber set
- Interval auto-creates when first consumer mounts, auto-clears when last unmounts
- Two formats: compact (`now`, `3m`, `2h`, `1d`) for sidebar, verbose (`just now`, `3 minutes ago`) for message bubbles
- Replaced `date-fns` `formatDistanceToNow` in both `DMMessage.tsx` and `DMSidebar.tsx`

### Bug: All messages reset to "just now" on re-login

**Root cause:** DMs had zero persistence — lived only in Redux memory. Every login/refresh:
1. Redux resets to empty (messages, contacts, processedWrapIds all gone)
2. Relay subscription re-fetches all historical gift wraps
3. Every message goes through `handleGiftWrap` → stamped with `Date.now()` → "just now"

**Fix:** New DM persistence layer following the `notificationPersistence` pattern:

**New file: `client/src/features/dm/dmPersistence.ts`**
- `loadDMState()` — restores messages, contacts, and processedWrapIds from IndexedDB
- `startDMPersistence()` — subscribes to Redux changes, debounce-saves (3s) to IndexedDB
- Storage caps: 200 messages/conversation, 3000 processedWrapIds (prevents unbounded growth)

**Modified: `client/src/store/slices/dmSlice.ts`**
- Added `restoreDMState` reducer for bulk-loading persisted state
- Added secondary message-level dedup (`some(m => m.wrapId)`) as safety net for processedWrapIds rollover

**Modified: `client/src/lib/nostr/loginFlow.ts`**
- `loadDMState()` called **before** the gift wrap subscription so processedWrapIds is populated and relay echoes are deduped
- `startDMPersistence()` starts the auto-save listener

### Bug: Silent gift wrap decryption failures

**Root cause:** `handleGiftWrap` had a bare `catch {}` that swallowed all errors silently, making it impossible to debug decryption issues.

**Fix:** Changed to `catch (err)` with `console.debug("[DM] Gift wrap decryption failed:", ...)`.

### Bug: Recipient may not receive messages (relay issue)

**Root cause:** The app's own relay (`services/relay/`) fully supports kind:1059 events (no kind filtering, accepts ephemeral pubkeys) but was NOT in the bootstrap relay list. Only external relays were configured, and some may reject kind:1059.

**Fix (constants.ts):** Added `APP_RELAY` as the first entry in `BOOTSTRAP_RELAYS`:

```typescript
export const APP_RELAY = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:7777";
export const BOOTSTRAP_RELAYS = [APP_RELAY, ...externalRelays];
```

**Fix (loginFlow.ts):** Gift wrap subscription now explicitly passes `relayUrls: BOOTSTRAP_RELAYS` instead of relying on whatever relays happen to be connected.

---

## Files Changed

### New files (3)
| File | Purpose |
|------|---------|
| `client/src-tauri/src/nip44.rs` | NIP-44 v2 Rust crypto module with 7 unit tests |
| `client/src/hooks/useRelativeTime.ts` | Shared-interval auto-updating relative time hook |
| `client/src/features/dm/dmPersistence.ts` | IndexedDB persistence for DM state |

### Modified files (9)
| File | Changes |
|------|---------|
| `client/src-tauri/Cargo.toml` | Added chacha20, hkdf, hmac, base64 deps |
| `client/src-tauri/src/keystore.rs` | Added `keystore_nip44_encrypt`, `keystore_nip44_decrypt` commands |
| `client/src-tauri/src/lib.rs` | Registered `mod nip44` and new IPC commands |
| `client/src/lib/nostr/tauriSigner.ts` | Added `nip44Encrypt()`, `nip44Decrypt()` methods |
| `client/src/lib/nostr/nip44.ts` | Replaced throw stubs with TauriSigner calls |
| `client/src/lib/nostr/eventPipeline.ts` | Fixed timestamp, sender detection, error logging in `handleGiftWrap` |
| `client/src/lib/nostr/loginFlow.ts` | Added DM persistence load/start, explicit relay URLs for DM sub |
| `client/src/lib/nostr/constants.ts` | Added `APP_RELAY`, put it first in `BOOTSTRAP_RELAYS` |
| `client/src/store/slices/dmSlice.ts` | Added `myPubkey` to payload, `restoreDMState` reducer, secondary dedup |
| `client/src/features/dm/dmService.ts` | Optimistic local dispatch with real timestamp |
| `client/src/features/dm/DMView.tsx` | Sync activeConversation with route param |
| `client/src/features/dm/DMMessage.tsx` | Replaced `formatDistanceToNow` with `useRelativeTime` |
| `client/src/features/dm/DMSidebar.tsx` | Replaced `formatDistanceToNow` with `useRelativeTime` |

---

## Verification

- `cargo check` — zero warnings
- `cargo test` — 7/7 NIP-44 tests pass (including official test vector)
- `pnpm --filter @thewired/client typecheck` — clean
