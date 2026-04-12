NIP-XX
======

Music Events
------------

`draft` `optional`

This NIP defines three event kinds for publishing music on Nostr: **tracks**, **albums**, and **playlists**. All three are _addressable_ events (parameterized replaceable per [NIP-01](01.md)), deletable per [NIP-09](09.md), and use tag-based metadata consistent with [NIP-94](94.md) file metadata and [NIP-71](71.md) video events.

## Motivation

Music is a natural fit for Nostr's decentralized publishing model, yet no standard exists for representing audio content. Existing approaches either embed metadata in the `content` field as opaque JSON documents or use application-specific kinds without cross-client interoperability.

This NIP follows the precedent set by [NIP-71](71.md) (video) and [NIP-94](94.md) (file metadata): structured metadata lives in **tags**, the `content` field is reserved for human-readable text (descriptions, lyrics), and file references use `imeta` tags that support multiple quality variants.

## Event Kinds

| Kind | Name | Description |
| --- | --- | --- |
| `31683` | Music Track | Individual audio track with file references and metadata |
| `33123` | Music Album | Ordered collection of tracks |
| `30119` | Music Playlist | User-curated list of tracks, optionally with private entries |

All three kinds fall within the addressable event range (`30000`-`39999`) and use a `d` tag as the stable identifier.

---

## Kind 31683: Music Track

A music track event represents a single audio recording. The `content` field MAY contain a human-readable description or lyrics. Metadata MUST be provided via tags.

### Required Tags

| Tag | Description |
| --- | --- |
| `d` | Unique identifier (slug). SHOULD follow the pattern `<artist-prefix>:<track-slug>`, e.g. `neon-wave:electric-dreams`. |
| `title` | Track title. |
| `imeta` | At least one `imeta` tag referencing an audio file (see [File References](#file-references)). |

### Recommended Tags

| Tag | Description |
| --- | --- |
| `artist` | Display name of the primary artist. Useful when the publisher is a label or distributor rather than the artist themselves. |
| `p` | Pubkey of a contributor. The fourth element (index `[3]`) SHOULD specify the role: `"artist"` for the primary creator, `"featured"` for collaborators. See [Artist Attribution](#artist-attribution). |
| `duration` | Total duration in seconds (decimal). |
| `genre` | Primary genre (freeform string, e.g. `"Synthwave"`, `"Hip Hop"`). |
| `image` | URL of cover art. |
| `license` | SPDX license identifier (e.g. `CC-BY-SA-4.0`) or `"all-rights-reserved"`. |
| `published_at` | Unix timestamp of the original release date. |

### Optional Tags

| Tag | Description |
| --- | --- |
| `a` | Album reference in addressable format: `33123:<pubkey>:<d-tag>`. A relay hint MAY be included as the second element. |
| `t` | Hashtags (lowercase, one per tag). |
| `blurhash` | Blurhash of the cover art for placeholder rendering. |
| `zap` | Zap split per [NIP-57](57.md). Format: `["zap", "<pubkey>", "<relay-hint>", "<weight>"]`. |
| `h` | Group/space identifier for scoping the track to a [NIP-29](29.md) group. |
| `visibility` | If set to `"unlisted"`, clients SHOULD NOT surface this track in public discovery feeds. Absence implies public visibility. |
| `sharing` | If set to `"disabled"`, clients SHOULD NOT offer share/repost functionality. |

### Example

```jsonc
{
  "kind": 31683,
  "pubkey": "<artist-pubkey>",
  "content": "A journey through neon-lit city streets at midnight.",
  "tags": [
    ["d", "neon-wave:electric-dreams"],
    ["title", "Electric Dreams"],
    ["artist", "NEON_WAVE"],
    ["p", "<artist-pubkey>", "<relay-hint>", "artist"],
    ["p", "<featured-pubkey>", "<relay-hint>", "featured"],
    ["a", "33123:<artist-pubkey>:neon-wave:synthwave-nights", "<relay-hint>"],
    ["duration", "234"],
    ["genre", "Synthwave"],
    ["t", "synthwave"],
    ["t", "electronic"],
    ["published_at", "1708000000"],
    ["license", "CC-BY-SA-4.0"],
    ["imeta",
      "url https://cdn.example.com/tracks/abc123.mp3",
      "m audio/mpeg",
      "x a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd",
      "size 5242880",
      "duration 234",
      "bitrate 320000",
      "fallback https://blossom.example.com/a1b2c3d4e5f6.mp3"
    ],
    ["imeta",
      "url https://cdn.example.com/tracks/abc123_128.mp3",
      "m audio/mpeg",
      "x f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1efgh",
      "size 2621440",
      "duration 234",
      "bitrate 128000"
    ],
    ["image", "https://cdn.example.com/covers/abc123.jpg"],
    ["blurhash", "eVF$^OI:${M{o#*0"],
    ["zap", "<artist-pubkey>", "<relay-hint>", "1"]
  ]
}
```

---

## Kind 33123: Music Album

An album event groups an ordered set of tracks. The `content` field MAY contain a description or liner notes.

### Required Tags

| Tag | Description |
| --- | --- |
| `d` | Unique identifier (slug). SHOULD follow the pattern `<artist-prefix>:<album-slug>`. |
| `title` | Album title. |

### Recommended Tags

| Tag | Description |
| --- | --- |
| `artist` | Display name of the primary artist. |
| `p` | Contributor pubkeys with role in index `[3]` (`"artist"` or `"featured"`). |
| `a` | Ordered track references. Each tag references a kind `31683` event in addressable format: `31683:<pubkey>:<d-tag>`. **Tag order defines track order.** A relay hint MAY be included as the second element. |
| `image` | Cover art URL. |
| `genre` | Primary genre. |
| `published_at` | Unix timestamp of album release. |

### Optional Tags

| Tag | Description |
| --- | --- |
| `project_type` | One of: `"album"` (default if absent), `"ep"`, `"demo"`, `"mix"`, `"other"`. |
| `track_count` | Number of tracks (string-encoded integer). Clients MAY use this for display before resolving all `a` tags. |
| `total_duration` | Sum of track durations in seconds (string-encoded decimal). |
| `t` | Hashtags (lowercase). |
| `blurhash` | Blurhash of cover art. |
| `license` | SPDX license identifier applying to the album as a whole. Individual tracks MAY override. |
| `zap` | Zap split per [NIP-57](57.md). |
| `h` | [NIP-29](29.md) group scope. |
| `visibility` | `"unlisted"` to hide from discovery feeds. |
| `sharing` | `"disabled"` to suppress sharing. |

### Example

```jsonc
{
  "kind": 33123,
  "pubkey": "<artist-pubkey>",
  "content": "A tribute to the sounds of the 1980s retrofuture.",
  "tags": [
    ["d", "neon-wave:synthwave-nights"],
    ["title", "Synthwave Nights"],
    ["artist", "NEON_WAVE"],
    ["p", "<artist-pubkey>", "<relay-hint>", "artist"],
    ["published_at", "1708000000"],
    ["image", "https://cdn.example.com/covers/album123.jpg"],
    ["blurhash", "eVF$^OI:${M{o#*0"],
    ["genre", "Synthwave"],
    ["t", "synthwave"],
    ["a", "31683:<artist-pubkey>:neon-wave:electric-dreams", "<relay-hint>"],
    ["a", "31683:<artist-pubkey>:neon-wave:midnight-drive", "<relay-hint>"],
    ["a", "31683:<artist-pubkey>:neon-wave:neon-city", "<relay-hint>"],
    ["track_count", "3"],
    ["total_duration", "703"],
    ["zap", "<artist-pubkey>", "<relay-hint>", "1"]
  ]
}
```

---

## Kind 30119: Music Playlist

A playlist is a user-curated, ordered list of tracks. Unlike albums, playlists may contain tracks by different artists and may include private entries.

### Required Tags

| Tag | Description |
| --- | --- |
| `d` | Unique identifier (slug). SHOULD follow the pattern `<owner-prefix>:<playlist-slug>`. |
| `title` | Playlist title. |

### Recommended Tags

| Tag | Description |
| --- | --- |
| `a` | Ordered track references in addressable format: `31683:<pubkey>:<d-tag>`. **Tag order defines track order.** These are the _public_ tracks visible to anyone who can read the event. |
| `image` | Playlist cover art URL. |
| `description` | Short description of the playlist. If absent, clients MAY fall back to reading the `content` field. |

### Optional Tags

| Tag | Description |
| --- | --- |
| `h` | [NIP-29](29.md) group scope. |
| `visibility` | `"unlisted"` to hide from discovery feeds. |

### Private Tracks

If the `content` field is non-empty, it SHOULD be a [NIP-44](44.md) encrypted JSON array of addressable track references (same format as the `a` tags). This allows playlist owners to keep a portion of their playlist private while sharing the rest publicly.

Clients that encounter a non-empty `content` field SHOULD attempt NIP-44 decryption. If decryption succeeds and produces a valid JSON array, the decrypted track references are appended to the public `a` tag references to form the complete playlist.

### Example

```jsonc
{
  "kind": 30119,
  "pubkey": "<user-pubkey>",
  "content": "",
  "tags": [
    ["d", "alice:late-night-vibes"],
    ["title", "Late Night Vibes"],
    ["description", "My favorite tracks for coding at night"],
    ["image", "https://cdn.example.com/playlists/pl123.jpg"],
    ["a", "31683:<artist1-pubkey>:neon-wave:electric-dreams", "<relay-hint>"],
    ["a", "31683:<artist2-pubkey>:retrowave:sunset-cruise", "<relay-hint>"],
    ["a", "31683:<artist3-pubkey>:chillhop:morning-dew", "<relay-hint>"]
  ]
}
```

---

## File References

Audio files are referenced using `imeta` tags as defined in [NIP-94](94.md). Each `imeta` tag represents one quality variant of the audio. Multiple `imeta` tags SHOULD be included when the track is available at multiple bitrates.

### `imeta` Fields

| Field | Required | Description |
| --- | --- | --- |
| `url` | Yes | Direct URL to the audio file. |
| `m` | Yes | MIME type (`audio/mpeg`, `audio/ogg`, `audio/flac`, `audio/wav`, `audio/aac`, `audio/webm`, `application/x-mpegURL`). |
| `x` | Recommended | SHA-256 hash of the file (hex-encoded). Enables content-addressing and integrity verification. |
| `size` | Recommended | File size in bytes (string-encoded integer). |
| `duration` | Recommended | Audio duration in seconds (string-encoded decimal). |
| `bitrate` | Recommended | Bitrate in bits per second (string-encoded integer, e.g. `"320000"` for 320 kbps). |
| `fallback` | Optional | Alternative URL (e.g. a [Blossom](https://github.com/hzrd149/blossom) server URL using the SHA-256 hash). |

### Bitrate Selection

When multiple `imeta` tags are present, clients SHOULD:
1. Prefer HLS (`application/x-mpegURL`) if available and supported.
2. Otherwise, select the highest-bitrate variant that fits the user's network conditions.
3. Fall back to any available variant.

---

## Artist Attribution

Music events support rich attribution through `p` tags with a role field at index `[3]`:

```
["p", "<pubkey>", "<optional-relay-hint>", "<role>"]
```

### Defined Roles

| Role | Meaning |
| --- | --- |
| `artist` | Primary creator of the track or album. There SHOULD be at least one `artist` role per event. |
| `featured` | A collaborating or guest artist. |

If no `p` tags with roles are present, the event publisher (`pubkey`) is assumed to be the sole artist.

The `artist` tag (containing a display name string) is complementary to `p` tags. It provides a human-readable artist name for display purposes, while `p` tags provide verifiable pubkey-based identity. Both SHOULD be included.

### Label and Distributor Use Case

When a label or distributor publishes on behalf of an artist, the event `pubkey` will be the label's key. The actual artist MUST be identified via a `p` tag with `"artist"` role. Clients SHOULD display the artist name from the `p`-tagged profile rather than the publisher's profile.

---

## Addressable ID Format

Each music event has a stable addressable identifier following the standard NIP-01 convention:

```
<kind>:<pubkey>:<d-tag>
```

Examples:
- Track: `31683:ab12cd34:neon-wave:electric-dreams`
- Album: `33123:ab12cd34:neon-wave:synthwave-nights`
- Playlist: `30119:ef56gh78:alice:late-night-vibes`

These identifiers are used in `a` tags for cross-referencing (album referencing tracks, playlist referencing tracks, track referencing album).

---

## Relay Behavior

Relays that wish to validate music events SHOULD at minimum verify:
1. The event has a `d` tag with a non-empty value.
2. The event has a `title` tag with a non-empty value.
3. For kind `31683` (track), at least one `imeta` tag is present.

Relays MAY apply additional validation (e.g. verifying MIME types, enforcing content policies).

As addressable events, relays MUST store only the latest version per `pubkey` + `kind` + `d`-tag combination, replacing older versions on update (standard NIP-01 behavior).

---

## Interaction with Other NIPs

| NIP | Integration |
| --- | --- |
| [NIP-09](09.md) | Tracks, albums, and playlists are deletable via kind `5` events using `a` tags. |
| [NIP-22](22.md) | Kind `1111` comment events can reference music events via `a` tags for reviews or discussion. |
| [NIP-25](25.md) | Kind `7` reactions can reference music events via `e` tags. |
| [NIP-29](29.md) | Music events scoped to a group include an `h` tag with the group id. |
| [NIP-32](32.md) | Labels can be applied to music events for categorization. |
| [NIP-36](36.md) | Content warnings via `content-warning` tag. |
| [NIP-44](44.md) | Playlist `content` field encryption for private track lists. |
| [NIP-51](51.md) | Kind `30003` bookmark sets can collect liked tracks. Kind `30000` follow sets can track favorite artists. |
| [NIP-57](57.md) | Zap splits via `zap` tags enable direct artist payments. |
| [NIP-71](71.md) | Music videos may cross-reference audio tracks via `a` tags. |
| [NIP-94](94.md) | `imeta` tag format for file metadata. |
