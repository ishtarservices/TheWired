# Decentralized Spaces — implementation status & remaining work

> Status: **M0–M7 + M9 shipped; M8 (E2EE / Model B) is the remaining milestone.**
> Companion to `PACKAGES_DESIGN.md` §6/§7. The detailed M8 spec lives in
> `docs/NIP17_GROUP_ROOMS.md`.

The Wired runs **three space modes side by side**, gated by one client predicate
(`isBackendBacked`) and one relay authority resolver, so Platform spaces stay
byte-for-byte unchanged:

| Mode | Metadata / roles / channels | Membership authority | Host relay | Backend dep |
|---|---|---|---|---|
| **Platform** (default) | backend `app.*` | `app.space_members` | platform relay | full |
| **Decentralized A-lite** | backend `app.*` | `app.space_members` | creator-chosen | full (BYO relay) |
| **NIP-29-native** | relay events (39000/1/2 + 30078) | relay (`relay.group_members`) | creator-chosen / imported | none |

`space.id` already **is** a NIP-29 group id and chat already targets an arbitrary
`hostRelay`, which is what made this additive rather than a rewrite.

## Shipped milestones

- **M0 — Foundations.** `spaceType` discriminant + helpers (`features/spaces/spaceType.ts`);
  backend `space_mode` / `ingestion_tier` / `external_origin` columns + `app.space_relays`
  registry (migration `0024`); relay R0 prereqs (filter-limit clamp, `spawn_blocking`
  verify, `p_tags`/`e_tags` columns).
- **M1 — Decentralized A-lite.** `RelayPicker` + NIP-11 capability probe; CreateSpaceModal
  Platform/Decentralized control; A-lite is a Platform space on a creator-chosen `hostRelay`
  (no other client change).
- **M2 — NIP-29-native create + import (interop core).** 9007/9002/9021/9022 event builders;
  native create; `ImportSpaceModal` (`host'groupId` / `naddr` / `nostr:` / deep link);
  39000/39001/39002 synthesized into the same Redux slices the backend path writes; the relay
  emits + signs + stores 39xxx (group state author-pinned to the relay key); `loginFlow` purge
  excludes native spaces.
- **M3 — Multi-relay ingestion + registration + tiered discovery.** Backend
  `relayConnectionManager` (desired-set diff, per-relay collapse, SSRF guard, rate cap,
  `allowedSpaceIds` h-tag guard); `POST/GET/DELETE /spaces/:id/relays`; `ingestion_tier`
  none → discovery → full so private decentralized spaces cost zero backend ingestion.
- **M4 — Portable channel layout (kind 30078).** `wired:layout:<groupId>` overlay (and reads
  Obelisk's `obelisk:layout:`), author-authorized + sanitized.
- **M5 — Private / gated spaces.** REQ-AUTH cold-start race fix in `relayConnection.ts`;
  per-group `is_private` enforcement — an anonymous/non-member REQ to a private group gets an
  explicit `CLOSED auth-required` instead of a silent empty EOSE.
- **M6 — Embedded SQLite relay ("host on my machine").** The shared `thewired-relay` crate
  compiled with an `embedded` Cargo feature (`enum Db { Pg | Sqlite }`, parity-tested) runs
  in-process inside `src-tauri` (`relay_start/stop/status/stats/reset`). Loopback by default;
  relay signing identity in the OS keychain; `hosted_only` write policy (owner-only group
  creation, hosted-groups-only writes, per-connection rate cap). Stable port **7787**
  (per-dev-instance offset; falls back to an OS-assigned port if taken) so a space's address
  survives restarts.
- **M7 — Tunneling & naming.** `cloudflared` downloaded-on-enable (Cloudflare-signed +
  `codesign`-verified, as a separate process — no app-bundle signing change). Host-a-Relay
  offers **three public-access tiers**:
  - **Default** — `<id>.relay.thewired.app`, backend-provisioned via `POST /relays/tunnel/provision`
    (NIP-98-authed; calls the Cloudflare API to create the tunnel + CNAME; connector secret is
    generated and held on-device, never stored server-side).
  - **Quick** — `*.trycloudflare.com`, zero-config but ephemeral; the only option that needs no
    platform setup (dev / forks / before the CF token is wired).
  - **Custom** — bring-your-own public `wss://` URL (the user runs their own tunnel/reverse
    proxy; we run no process and just record the address).

  Plus **LAN-bind** (binds `0.0.0.0`, reports a VPN-aware LAN IP — prefers a physical interface
  over a VPN tunnel) and a NIP-42 AUTH relaxation for `hosted_only` relays so private groups
  authenticate over loopback/LAN/tunnel.
- **M9 — Relay sets & mirror coordination.** Single signing **authority** + N transport
  **replicas** under the same group id; kind-30078 `wired:relays:<groupId>` overlay; client
  publishes to all + reads from any (dedup by id). Authority offline ⇒ existing members keep
  reading/posting; only membership/moderation changes freeze until it returns.

## Remaining

### M8 — E2EE / Model B  ← the open milestone

The end-to-end-encrypted tier — the one place message content is hidden from the relay (so
moderation, search, analytics, and push are necessarily off for those rooms; "Model B").

- **NIP-17 gift-wrapped rooms** — the protocol **engine is built + tested**
  (`client/src/lib/nostr/nip17Room.ts`, 7 tests); the **feature integration is the TODO**:
  generalize the 1:1 DM store/receive/send/UI to group rooms. The relay needs **zero changes**
  (kind:1059 routes by `p` tag and bypasses NIP-29 gating).
- **MLS over Nostr** (NIP-EE / "Marmot" / `nostr-mls`) — scalable forward-secret groups; stays
  **tracked behind an audit gate**, not built.

Full step-by-step plan (store `conversationId` keying, eventPipeline receive branch on
`isGroupDM` bypassing the `HEX64` guard, `sendGroupRoomMessage`, multi-recipient create-room +
group UI): **`docs/NIP17_GROUP_ROOMS.md`**.

### Smaller deferred items

- **Embedded mirror-mode sync (M9 tail)** — a mirror relay that subscribes to the set and
  re-serves content; the client fan-out/dedup half is done.
- **cloudflared checksum pinning** — `PINNED_VERSION` / `expected_sha256` in
  `client/src-tauri/src/cloudflared.rs` are unset (the download is TLS- + `codesign`-verified;
  pin a version + hashes before wide release).
- **Custom-tunnel reset UI** — the backend `reset` path exists end-to-end; there's no button yet
  (for a device that lost its keychain-held tunnel secret).
- **kind-9009 invites + pending-join** for closed native groups, and **native-space directory
  listing** — deferred from M2/M3.
