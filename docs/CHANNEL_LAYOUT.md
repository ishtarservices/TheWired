# Channel layout: subfolders (categories) and channel order

A space's channels can be grouped into **subfolders** (categories). This document is the contract every client follows: the data model, the canonical order, the REST API for backend-backed spaces, the permission model, and the kind:30078 event for relay-only spaces.

## Model

- A **category** has a stable `id`, a `name` and a `position` (dense `0..n-1`). Names are unique within a space, ignoring case.
- A **channel** has an optional `categoryId` (null = no subfolder) and a `position`.
- **Ids are opaque.** Never display one, and never resolve a name to an id on the client: show `name`.
  - Ids are unique only within their space.
  - Categories that existed before this model keep their original free-text string as their id. Because of this, a client that still renders `categoryId` as the header (older desktop builds) keeps showing the right text until the folder is renamed.
  - A new category's id is its name at creation when that is safe (trimmed, at most 64 characters, not `.`/`..`, none of `/?#%\`), suffixed `~2`, `~3`… on collision; otherwise a random 12-character id. Renaming never changes the id.

### Canonical order

Every surface renders the same order:

1. Uncategorized channels.
2. Each category in `position` order, followed by its channels in `position` order.

The backend keeps channel `position` as a single space-wide sequence in exactly this order: every write except a delete renumbers it to `0..n-1`. A client that ignores categories and sorts by `position` alone therefore still shows the same order.

Within a category, ties in `position` break on `id`.

## Backend-backed spaces (platform, decentralized A-lite)

### Read

- `GET /spaces/:id/channels/layout` returns `{ revision, categories, channels }`.
  - Its visibility matches `GET /channels`.
  - A 404 means the backend predates this API. Fall back to `GET /channels` and group by the `categoryId` strings.
- `GET /spaces/my-spaces` and the join response (`POST /spaces/:id/members/me`) also carry `categories` and `layoutRevision` per space.
- `GET /spaces/:id/channels` is unchanged (a flat, position-ordered list). Rows gain `permissionsSynced`.

### Write: the layout document

`PUT /spaces/:id/channels/layout` requires MANAGE_CHANNELS. The body:

```json
{
  "baseRevision": 7,
  "uncategorized": ["<channelId>", "..."],
  "categories": [
    { "id": "Text", "name": "Text", "channelIds": ["<channelId>", "..."] },
    { "name": "New folder", "channelIds": [] }
  ]
}
```

The document replaces the whole layout:

- Category order is the array order.
- A category without `id` is **created**.
- An existing category left out is **deleted**. Its channels must appear elsewhere in the same document.
- Every current channel must appear exactly once:
  - A duplicate returns 400.
  - A missing or unknown channel returns 409.
- An `id` that isn't one of the space's categories returns 409 `LAYOUT_STALE`. With a current revision, that means the client assembled its view from reads taken at different moments.
- **New and renamed names** are trimmed, at most 128 characters (clients cap new names at 50), and contain no control, bidi or zero-width-space characters. ZWJ and ZWNJ are allowed, for emoji sequences and Persian/Indic text. Names are unique ignoring case. Violations return 400 with `DUPLICATE_NAME` or `BAD_REQUEST`.
  - An unchanged name is accepted as stored. Legacy folders may predate these rules.
- A space has at most 50 categories. The cap only stops growth: a space with more legacy folders than that can still rearrange them.
- `baseRevision` must equal the current revision, otherwise 409 `LAYOUT_STALE`.
  - Every channel or category write bumps the revision, including channel create, edit, delete and reorder.
  - On 409, refetch and re-apply the user's edit to the fresh layout once. Edits are naturally expressed as id-based moves, so this is safe.
- The response is the saved layout.
- Writes to one space are serialized server-side.

### Channel endpoints (unchanged paths)

- **Create:** `POST /spaces/:id/channels` with `{ type, label, categoryId?, adminOnly?, slowModeSeconds?, temporary?, feedMode? }`.
  - Appends to the end of its category.
  - `temporary` only applies to voice and video channels: the room sweep deletes empty ones.
  - `categoryId` may be an id. For older clients it may also be a category *name*, matched ignoring case and created if it doesn't exist.
  - New clients send ids only. To put a channel in a new folder, create the folder first through the layout document.
- **Update:** `PATCH /spaces/:id/channels/:channelId`.
  - `categoryId` (id or legacy name, `null` for none) moves the channel to the end of that category.
  - A bare `position` is an index within the channel's current category.
- **Legacy reorder:** `POST /spaces/:id/channels/reorder` with `{ orderedIds }` is kept for older clients and normalized into the canonical grouping.
- **Delete:** `DELETE /spaces/:id/channels/:channelId` also deletes the channel's permission overrides.

Every write publishes the kind 20900 space-config nudge with `what=channels`, plus `what=roles` when permission overrides changed. Clients refetch the layout on it.

A database trigger (`trg_space_channels_resolve_category`) gives every writer the same legacy resolution: an older backend after a rollback, replayed seed migrations, or manual SQL. A `category_id` that isn't an id of the space resolves to the folder with that name (ignoring case and surrounding spaces), and a folder is created if none exists. Blank becomes none. So `category_id` always names a real category of the same space.

## Permissions

Category permissions are **templates**. A channel follows its category's template while its `permissionsSynced` is true. Following means the category's overrides are *copied* into the channel's overrides, so permission checks (backend and relay) only ever read channel overrides.

| Action | Effect |
|---|---|
| `PUT /spaces/:id/roles/:roleId/category-override` with `{ categoryId, allow, deny }` (MANAGE_ROLES; the role must be manageable) | Sets one role's template on one category. Empty lists clear it. Every synced channel in that category gets that role's rows rewritten. The category id travels in the body because ids aren't URL-safe. |
| `PUT /spaces/:id/roles/:roleId/category-overrides` with `{ overrides: [{ categoryId, allow, deny }] }` | Replaces all of the role's category templates. Same propagation. |
| `GET /spaces/:id/roles/:roleId/category-overrides` | The role's category templates. |
| `PUT /spaces/:id/roles/:roleId/overrides/:channelId` with `{ allow, deny }` | Sets one role's overrides on one channel. That channel stops following its category if its overrides changed. |
| `PUT /spaces/:id/roles/:roleId/overrides` (legacy whole-role replace) | Compares per channel: only channels whose overrides for that role changed become unsynced. Channel ids must belong to the space. |
| `POST /spaces/:id/channels/:channelId/sync-permissions` (MANAGE_ROLES) | Copies the category's template back onto the channel and marks it synced. Needs authority over every role on either side, and may not add an allow the actor doesn't hold. |

- **Creating a channel in a category** copies the category's template, so the channel starts synced. A new channel has no permissions of its own to protect.
- **Moving a channel with no overrides of its own** into a category applies the category's template, exactly as creating it there would. The one exception: if the template would *add an allow the actor doesn't hold*, the channel moves unsynced and nothing is copied. Otherwise moving a channel into a folder would be a way around the grant rule.
- **Moving a synced channel** (its overrides are a copy of its previous folder's) replaces that copy with the new folder's template. This needs MANAGE_ROLES and authority over every role involved, because it also lifts the old folder's denies. Without that authority the channel keeps its copy and becomes unsynced.
- **A channel with overrides of its own** keeps them when moved, and becomes unsynced.
- **Moving a channel out**, or deleting its category, keeps its current overrides and marks it unsynced.
- **Deleting a category** whose template covers roles the actor can't manage returns 403.
- **Granting:** override writes may only *add* allow-permissions the actor holds. Permissions that were already allowed may be re-sent.

**Evaluation model.** Permission checks use deny-wins: a deny on any of a member's roles beats an allow on another of their roles. This is *not* Discord's precedence, where a role allow can override an @everyone deny. Hiding a channel with VIEW_CHANNEL is enforced client-side only.

## Relay-only spaces (NIP-29-native)

There is no backend. The layout is an addressable kind:30078 event, authored by one of the group's admins (39001), its creator, or the relay key:

```
["d", "wired:layout:<groupId>"]
["h", "<groupId>"]
["alt", "Channel layout for a The Wired space"]
["category", "<categoryId>", "<name>", "<position>"]
["channel", "<channelId>", "<type>", "<label>", "<categoryId or empty>", "<position>", "curated"?]
["default", "<channelId>"]
```

- **The `h` tag.** Only members can read the layout, and hosted-only relays accept it. A non-member preview shows just the main chat.
- **`default`** names the channel that untagged kind-9 messages from other NIP-29 clients land in.
  - Readers fall back to the channel with id `chat`, then to the first chat channel, and only if there is no chat channel at all, to the first channel. The default never just follows whatever was dragged to the top.
  - Clients never delete the default channel.
- **Choosing the binding layout.** Among layouts from authorized authors:
  - ours beats Obelisk's (`obelisk:layout:<relayUrl>`);
  - then the newest `created_at` wins;
  - ties go to the lower event id.

  Re-pick whenever the admin list changes. A layout that arrives before the admin list must not be lost. Subscribe with `authors` pinned to the current admins, creator and relay key.
  - Ignore layouts dated more than 15 minutes ahead.
  - If no authorized layout remains (its author lost admin), fall back to the single main chat.
  - Keep candidates while the space is joined: relays re-deliver the same events on re-entry, and clients deduplicate them.
- **Sanitizing on read.**
  - Ids are capped at 64 characters.
  - Names and labels are capped at 64 characters, with control and invisible characters stripped.
  - At most 50 categories and 200 channels.
  - A wired channel that references a category the event doesn't define is uncategorized.
- **Writing.** A write republishes the whole event.
  - Never publish before the layout subscription has caught up (EOSE). On a fresh device or with a stale cache, writing earlier would replace a layout this client hasn't seen.
  - Set `created_at` strictly after the newest *authorized* layout seen, and at most 15 minutes ahead.
  - New category ids follow the same rule as the backend. New channel ids are random.
