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
cleartext in both forms. **Any valued `visibility` tag protects** — `private`,
`unlisted`, or an unknown future value — on every layer (relay column, backend
gates, search indexing), so an unrecognised value hides rather than exposes.
A value-less tag (`["h"]`, `["visibility"]`) is ignored everywhere; the mirrored
columns take the first *valued* tag. The relay mirrors `visibility` and `h` into dedicated
`relay.events` columns at insert time (`event_store.rs`), so backend queries can
filter without unpacking JSONB: `h_tags TEXT[]` holds every `h` value in tag
order and the scalar `h_tag` is `h_tags[1]`, with `h_tag IS NULL ⇔ h_tags = '{}'`
(so `h_tag IS NULL` still means "not space-scoped").

## Catalog listing (`catalog:none`)

Orthogonal to visibility. A kind-31683 track may carry `["catalog","none"]`,
meaning: *a real, playable, saveable track its author keeps OFF their catalog;
it lives in the note it was posted with.* Mobile writes it when a user attaches
audio to a plain note. The track is **public** (no `visibility` tag, no `h`
tag) so the note embed can resolve and play it for anyone.

A **listed public** music event is one with no `visibility` tag, no `h` tag,
and no `["catalog","none"]` tag. That is the bar for every public discovery
surface and every author-catalog shelf. The single predicate is
`isListedPublicMusic(tags)` in `services/backend/src/lib/musicListing.ts`
(re-exported from `services/musicVisibility.ts`); desktop and mobile parsers
keep their own one-liner (`MusicTrack.inCatalog` on desktop), as they already
do for `visibility`.

`catalog:none` is **not a visibility state and never gates reads**. It only
removes the event from "this author's discography" and "public discovery":

| Layer | listed public | `catalog:none` (public, unlisted) |
|---|---|---|
| Relay REQ | served | served (it's public; the note embed must resolve) |
| `/music/resolve/*`, `/music/access`, HLS, blobs, insights, proposals | as today | **unchanged**, as today |
| `/music/browse`, `/music/browse/albums`, trending sets | included | **excluded** (trending computer, Meilisearch query filter, route re-check) |
| `/search/music` | indexed + returned | indexed, **filtered out** at query time |
| `/discovery/spaces/music` | included | **excluded** |
| Genre/tag counts | counted | not counted |
| OG track page | full metadata | full metadata (a shared note link should unfurl) |
| OG catalog page (`fetchPublicCatalogByPubkey`) | listed | **excluded** |
| Author shelves (mobile + desktop): profile, artist page, library, showcase picker | shown | **hidden**; the owner re-lists it via edit (desktop keeps it in *My Music* with an "Unlisted" label so it can be found) |

Implementation notes:

- **Meilisearch keeps unlisted tracks in the `tracks` index** with an
  `unlisted: true` field and filters them at query time (`NOT unlisted = true`)
  rather than excluding them from the index, because
  `musicService.getArtistSummary` (insights) enumerates an artist's tracks from
  that index and would otherwise lose the owner's play counts for their own
  clips. Docs indexed before the field existed have no attribute and still
  match the `NOT` clause (verified on Meilisearch 1.6), so a deploy does not
  blank browse/search; already-indexed clips are purged by
  `POST /music/rebuild-counts` (admin), which also resets genre/tag counts to
  listed-only.
- **Postgres surfaces** (trending computer, `getListedSpaceMusic`,
  `fetchPublicCatalogByPubkey`) add `NOT (tags @> '[["catalog","none"]]'::jsonb)`;
  the relay's GIN index on `tags` covers it. No relay column.
- **Republishing must preserve the tag.** Any client that rebuilds a track from
  parsed fields (desktop edit / replace-audio / move / duplicate) threads
  `inCatalog` through, or an edit silently re-lists the clip.
- **Albums (33123) never carry it**; tracks only.
- This is unrelated to the legacy `["visibility","unlisted"]` state, which is
  treated as *private* everywhere server-side and which desktop's
  `parseVisibility` maps to `private`. Do not merge the two concepts: a
  `visibility:unlisted` track is hidden from everyone but its grantees; a
  `catalog:none` track is public to everyone, just not catalogued.

## Multi-space events

Any event — in practice the music kinds 31683/33123/30119/31686 — may carry
several `["h", <spaceId>]` tags. The contract, enforced by the relay and
mirrored by the backend:

- **Read (any-of):** the event is visible to the author, an access-granting
  `p`-tag, or a member of **any** listed space (see §"Who may view" for the
  one policy every layer applies). A `#h` filter matches on any of the tags,
  not just the first. Anonymous readers never see it.
- **Publish (all-of, relay gate):** the author must be a member of **every**
  listed space the relay can resolve (`app.spaces ∪ relay.groups`). Ids the
  relay does not know are ignored (the space may be hosted elsewhere), but at
  least one resolved membership is required — an event whose h tags are all
  unknown is rejected. More than 16 distinct `h` tags is rejected with
  `invalid: too many h tags`. A single-`h` event behaves exactly as before.
- **Zap rollup:** a zap on a multi-space event counts toward each listed
  space (`discoveryService.rollupSpaceZaps` unnests `h_tags`).

## Who may view a non-public event

One policy, evaluated in this order on **every** layer — relay stored REQ and
NIP-50 search (`services/relay/src/nostr/access.rs` → `event_store.rs`,
`nip50.rs`, `sqlite.rs`), relay live broadcast (`connection.rs`), backend
routes (`services/backend/src/services/musicVisibility.ts` `isEventVisibleTo`)
and media (`blobAccess.ts` `authorizeProtectedRef`):

1. No valued `visibility` tag and no valued `h` tag → **public**, anyone.
2. Anonymous (un-AUTHed / no NIP-98) → **denied**.
3. The **author** → allowed.
4. An **access-granting `p` tag** (role table below) → allowed, for every
   protected shape — including a space-scoped release (a grant is how a
   non-member is let into a space exclusive; WIR-76).
5. Any valued `visibility` tag → **denied** (private is private even when it
   also carries `h`: a space never widens a private event to its members).
6. `h` only → allowed iff the reader is a member of **any** listed space.

Membership is the union of both worlds the relay knows
(`services/relay/src/db/membership_source.rs`): `app.space_members` (Platform
and A-lite spaces) **and** `relay.group_members` (NIP-29-native groups hosted
on this relay). The backend queries the same union
(`musicVisibility.spacesMemberOf`), so a native-group member who can read a
track over the relay can also resolve it, mint a token and fetch its media.
The embedded SQLite relay has only the relay-native world.

Removal takes effect immediately on every DB-backed path (publish, REQ, search,
backend). Live broadcast uses a per-connection membership cache refreshed
lazily every 30 s, so a kicked member may receive live events for up to 30 s.

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

| Layer | public | space (`h`) | private/unlisted | public + `catalog:none` |
|---|---|---|---|---|
| Relay query (NIP-01 REQ) | served | relay-gated per NIP-29 membership (any listed space) | relay-gated | served |
| `GET /music/resolve/*` | 200 | 404 unless member/author | 404 unless author/grantee | 200 |
| Album/playlist **child tracks** | included | dropped unless viewer authorized per child | dropped unless authorized | included |
| Browse / search index (Meilisearch, trending) | indexed | **never indexed** (ingest, rebuild, and trending all exclude; a formerly-public version's doc is removed on privatize) | never indexed | indexed with `unlisted: true`; **filtered out** of browse/search/trending/listed-space music; not counted in genre/tag chips |
| Raw blob `GET /<sha>` | 200, immutable cache | 404 without `?tk=` token or authorized NIP-98 pubkey; `no-store` when served | same | 200, immutable cache |
| HLS `/hls/<sha>/…` (master, playlists, segments) | 200 | 404 without valid `?tk=` | same | 200 |
| `GET /music/access` | `{gated:false}` | token minted for authorized viewers only, and only when the blob layer would serve that viewer the sha (see §Blob protection — an author cannot mint for a sha they did not upload) | same | `{gated:false}` |
| `GET /music/insights/*` | 200 | 404 unless member/author/grantee; **404 when no current event exists** (fail closed) | 404 unless author/grantee | 200 |
| `GET /music/revisions/*` | 200 | gated by the **current** version like `/music/resolve`: 404 unless member/author/grantee, 404 when no current event | same | 200 |
| `GET /search` (events index: 1/9/22/30023/34236/30119) | indexed | **never indexed** (the index backs an unauthenticated route) | never indexed | indexed |
| Blossom `GET /list/:pubkey` | owner-only (NIP-98 pubkey must equal `:pubkey`); it enumerates every uploaded sha, including ones whose only protection is the sha itself | | | |
| `GET /music/proposals/:pubkey/:slug` (kind-31685 list) | 200 | 404 unless member/author (same gate as the project itself; a missing project also 404s) | 404 unless author/grantee | 200 |
| OG share pages (`thewired.app/music/*`) | full metadata | generic branded page — **no metadata, indistinguishable from a missing slug** | same | track page: full metadata; **absent from the catalog page** |

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

## Client publishing rules (desktop)

- **Gated events never default to public relays.** `lib/nostr/publish.ts`
  routes any event carrying a valued `h` or `visibility` tag that was published
  without explicit targets to the app relay plus the listed spaces' host relay
  sets (`lib/nostr/gatedTargets.ts`); `features/music/spacePublish.ts` falls
  back to the app relay, never the default write relays, for a space the client
  no longer knows. soot applies the same rule (app relay + host fan-out).
- **Republish paths thread the whole visibility set through**: `spaceIds`,
  `channelId`, `sharingDisabled`, `inCatalog`, and for private events the
  NIP-44 builder with the existing `collaborators`. Replace-audio, project edit
  and collaborator edits were the paths that used to drop them.
- **Only public releases leave their audience**: Repost (kind 6 embeds the
  whole event), Post with Note, and Share to Space (which mirrors the event
  verbatim onto another host) are hidden and refused for `h` / private events.
  Copy Link and Send to DM share only the address and stay available.
- **Listen Together** sends a track's title, cover and media URLs only when
  every listener may see it: public always; space-scoped only inside a voice
  channel of one of its own spaces; private/unlisted/local never
  (`features/listenTogether/listenTogetherService.ts canShareTrackWithListeners`).
- Moving a private track or into/out of a private project is refused until a
  private-aware move exists (the cleartext rebuild would de-encrypt it).

## Known accepted gaps

- Unpublished uploads are public-by-URL until an event references them (see §4
  above).
- Desktop NIP-44 private tracks: the blob URL inside the encrypted content is
  capability-by-obscurity; the backend cannot gate what it cannot see.
- `visibility:unlisted` has no distinct behavior server-side; it is an alias of
  private until a product decision says otherwise.
