# Music Visibility Model

The intended (and, as of the soot-mobile launch fixes, enforced) semantics for
music events — kinds **31683** (track), **33123** (album), **30119** (playlist) —
across every layer that serves them. This is the reference the backend gates are
tested against; if behavior diverges from this document, the behavior is the bug.

## Visibility states

A music event is in exactly one state, derived from its tags:

| State | Tag shape | Written by |
|---|---|---|
| **public** | no `visibility` tag, no `h` tag | both clients |
| **space** | `["h", <spaceId>]` (no `visibility` tag; optional `["channel", <id>]`) | both clients |
| **space (multi)** | several `["h", <spaceId>]` tags — one per space the event is shared into (no `visibility` tag) | desktop (edits/moves preserve the set; the picker itself is single-select) |
| **private** | `["visibility","private"]` | desktop (NIP-44-encrypted content + cleartext `d`/`p` tags), mobile (cleartext metadata tags) |
| **unlisted** | `["visibility","unlisted"]` | treated exactly like private everywhere server-side |
| **local** | never published (desktop-only `signAndSaveLocally`) | desktop |

Both the desktop encrypted form and mobile's cleartext form of `private` must
stay supported: gates key on the *tags* (`visibility`, `h`, `p`), which are
cleartext in both forms. The relay mirrors `visibility` and `h` into dedicated
`relay.events` columns at insert time (`event_store.rs`), so backend queries can
filter without unpacking JSONB: `h_tags TEXT[]` holds every `h` value in tag
order and the scalar `h_tag` is `h_tags[1]`, with `h_tag IS NULL ⇔ h_tags = '{}'`
(so `h_tag IS NULL` still means "not space-scoped").

## Multi-space events

Any event — in practice the music kinds 31683/33123/30119/31686 — may carry
several `["h", <spaceId>]` tags. The contract, enforced by the relay and
mirrored by the backend:

- **Read (any-of):** the event is visible to the author, an access-granting
  `p`-tag, or a member of **any** listed space. A `#h` filter matches on any
  of the tags, not just the first. Anonymous readers never see it.
- **Publish (all-of, relay gate):** the author must be a member of **every**
  listed space the relay can resolve (`app.spaces ∪ relay.groups`). Ids the
  relay does not know are ignored (the space may be hosted elsewhere), but at
  least one resolved membership is required — an event whose h tags are all
  unknown is rejected. More than 16 distinct `h` tags is rejected with
  `invalid: too many h tags`. A single-`h` event behaves exactly as before.
- **Zap rollup:** a zap on a multi-space event counts toward each listed
  space (`discoveryService.rollupSpaceZaps` unnests `h_tags`).

## Who may view a non-public event

Implemented in `services/backend/src/services/musicVisibility.ts`
(`isEventVisibleTo`) and mirrored in `services/blobAccess.ts` for media:

- **space** (`h`): the author, or a member of **any** of its listed spaces
  (`app.space_members`; one membership query over all the event's `h` values).
- **private / unlisted**: the author, or a pubkey with an *access-granting*
  `p` tag on the event.

### p-tag roles

Music p-tags carry a role in the 4th element: `["p", <pubkey>, <relay>, <role>]`.

| Role | Grants access to private content? |
|---|---|
| `collaborator` | yes (project member: viewer) |
| `contributor` | yes (project member: may add their own tracks via kind-31685 proposals) |
| `editor` | yes (project member: may propose any change) |
| `artist` | yes (co-author identity) |
| `featured` | **no** — it is a credit, not a grant |
| any other role | no |
| no role (legacy) | yes (backward compat with pre-role events) |

## The enforcement matrix

| Layer | public | space (`h`) | private/unlisted |
|---|---|---|---|
| Relay query (NIP-01 REQ) | served | relay-gated per NIP-29 membership (any listed space) | relay-gated |
| `GET /music/resolve/*` | 200 | 404 unless member/author | 404 unless author/grantee |
| Album/playlist **child tracks** | included | dropped unless viewer authorized per child | dropped unless authorized |
| Browse / search index (Meilisearch, trending) | indexed | **never indexed** (ingest, rebuild, and trending all exclude; a formerly-public version's doc is removed on privatize) | never indexed |
| Raw blob `GET /<sha>` | 200, immutable cache | 404 without `?tk=` token or authorized NIP-98 pubkey; `no-store` when served | same |
| HLS `/hls/<sha>/…` (master, playlists, segments) | 200 | 404 without valid `?tk=` | same |
| `GET /music/access` | `{gated:false}` | token minted for authorized viewers only | same |
| `GET /music/insights/*` | 200 | 404 unless member/author | 404 unless author/grantee |
| `GET /music/proposals/:pubkey/:slug` (kind-31685 list) | 200 | 404 unless member/author (same gate as the project itself; a missing project also 404s) | 404 unless author/grantee |
| OG share pages (`thewired.app/music/*`) | full metadata | generic branded page — **no metadata, indistinguishable from a missing slug** | same |

## Blob protection: deterministic per-sha semantics

Blobs are content-addressed and deduped, so one sha can be referenced by many
events by many uploaders. `services/blobAccess.ts` decides protection like this:

1. Only events **authored by an uploader of the blob** (`app.blob_owners` ∪
   `app.music_uploads`) count. A third party publishing an event referencing
   someone else's sha can neither protect it (no griefing kill-switch over
   public tracks) nor expose it.
2. If **any** owner-authored referencing event is public → the blob is public
   (that owner published the bytes openly; gating is moot).
3. Otherwise, if owner-authored protected events exist → protected; a viewer
   must be authorized against **at least one** of them (author / granting p-tag
   / space membership).
4. No owner-authored referencing events (just uploaded, or referenced only from
   NIP-44-encrypted tags) → public by URL. In that window the sha itself is the
   capability; desktop's encrypted-private tracks rely on this (the backend
   cannot see their sha to gate it).

## Capability tokens (`?tk=`)

`lib/mediaToken.ts`: HMAC over `<sha>.<exp>`, default TTL 6h. One token unlocks
**every rendition under one sha** (raw blob + full HLS ladder) — it is not bound
to a viewer. Policy (who may mint) lives at `/music/access`; the token is only
the transport for `<audio>`/hls.js, which cannot send NIP-98 headers.

### Design sketch: per-recipient listen grants (P3, not yet implemented)

Mobile wants "share a private WIP so the recipient can actually play it":

- **Grant path (preferred, Nostr-native):** the owner adds
  `["p", <recipient>, "", "collaborator"]` (or a future dedicated `listener`
  role granted access by `pTagGrantsAccess`) and republishes. The recipient then
  mints their own `?tk=` via `/music/access`. No new token machinery; revocation
  is republishing without the tag.
- **Link path (bearer):** extend `mintMediaToken` to a scoped variant
  (sha + longer TTL + optional recipient pubkey baked into the HMAC input) that
  the owner mints via a new `POST /music/access/grant`. Playable-by-link, but a
  leaked link is a leaked capability until expiry; do not exceed ~7d TTL, and
  keep tokens out of logs (the `?tk=` redaction in `server.ts` already covers
  this).

## Known accepted gaps

- Unpublished uploads are public-by-URL until an event references them (see §4
  above).
- Desktop NIP-44 private tracks: the blob URL inside the encrypted content is
  capability-by-obscurity; the backend cannot gate what it cannot see.
- `visibility:unlisted` has no distinct behavior server-side; it is an alias of
  private until a product decision says otherwise.
