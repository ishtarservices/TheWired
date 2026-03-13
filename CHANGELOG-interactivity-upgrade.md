# Music + Spaces + DMs Interactivity Upgrade

## New Files Created

### `client/src/lib/nostr/naddrEncode.ts`
Utility to build `nostr:naddr1...` reference strings from addressable IDs (e.g. `31683:pubkey:slug`). Uses `nip19.naddrEncode` from nostr-tools. Accepts optional relay hint.

### `client/src/components/sharing/RecipientPickerModal.tsx`
Reusable DM recipient picker modal. Shows DM contacts and accepted friends in a merged list. Includes NIP-50 user search (by name or npub). Displays avatars, names, and truncated pubkeys. Loading spinner while sending.

### `client/src/components/sharing/SpacePickerModal.tsx`
Reusable space picker modal for sharing content to spaces. Lists all writable (`read-write`) spaces with icons, names, and member counts. Search filter when more than 5 spaces exist. Loading state during publish.

### `client/src/components/content/MusicEmbedCard.tsx`
Inline music card rendered inside DMs and notes when a `nostr:naddr1...` reference to a track (kind 31683) or album (kind 33123) is detected. Shows album art, title, artist, and a play/pause button. Tracks current playback state — the button toggles between play and pause, and the card highlights with neon styling when the track is active in the playback bar.

### `client/src/features/music/SpaceAlbumDetail.tsx`
Simplified album detail view for the space context. Shows album header with art, title, artist, and track count. Includes Play All, Shuffle, Save, and Favorite buttons. Renders track list using `TrackRow`. No collaborator panel or history/proposals navigation. Used inline within `SpaceMusicView` instead of navigating away to the global music sidebar.

## Modified Files

### `client/src/components/content/RichContent.tsx`
- `addr-ref` segments for kind 31683 (track) and 33123 (album) now render as `MusicEmbedCard` instead of a plain code badge
- Other addr-ref kinds still render the existing monospace badge

### `client/src/features/music/TrackActionMenu.tsx`
- **Send to DM**: Added in both owner and non-owner menu sections (after Copy Link). Opens `RecipientPickerModal`, sends `nostr:naddr1...` content via `sendDM()`
- **Share to Space**: Added in both owner and non-owner menu sections. Opens `SpacePickerModal` where user picks from their writable spaces. Publishes a kind:1 note with `["h", groupId]` tag containing the naddr reference to the selected space's host relay. Ensures relay connection before publishing
- Removed old `activeSpaceId`/`canShareToSpace` conditional logic that only worked for the currently active space

### `client/src/features/music/AlbumCard.tsx`
- **`onNavigate` prop**: Optional callback that overrides the default `setActiveDetailId` dispatch when clicking the card. Used by `SpaceMusicView` to open inline album detail instead of navigating to the global music sidebar
- **Send to DM**: Menu item after Copy Link, opens `RecipientPickerModal`
- **Share to Space**: Menu item opens `SpacePickerModal` with same publish flow as TrackActionMenu
- Removed old `activeSpaceId`/`canShareToSpace` conditional logic

### `client/src/features/spaces/notes/NoteActionBar.tsx`
- Added optional `onShare` prop and a 5th Share button (forward icon) that appears when the prop is provided
- Button styled consistently with existing action buttons, uses pulse color on hover

### `client/src/features/spaces/NotesFeed.tsx`
- NoteCard now has a Share button wired to `RecipientPickerModal`
- Sharing a note sends a DM containing `nostr:nevent1...` (encoded with `nip19.neventEncode`)

### `client/src/features/music/SpaceMusicView.tsx`
- **Tab bar**: All / Tracks / Albums with item counts
- **Search filter**: Client-side filter on title and artist
- **Sort**: Newest / A-Z / Artist
- **View toggle**: Grid (TrackCard) or List (TrackRow) for tracks
- **Upload button**: Visible for members of read-write spaces. Opens `UploadTrackModal` with visibility defaulting to "space" and the current space pre-selected
- **Empty state**: Music icon with "No music yet" message and upload CTA for members
- **Inline album detail**: Clicking an album card opens `SpaceAlbumDetail` within the space view instead of navigating away. Back button returns to the grid

### `client/src/features/music/TrackRow.tsx`
- Added optional `onAlbumClick` prop. When provided, album name clicks call this callback instead of dispatching `setActiveDetailId`. Used by `SpaceMusicView` to keep navigation within the space context

### `client/src/features/music/UploadTrackModal.tsx`
- Added `defaultVisibility` and `defaultSpaceId` optional props
- Visibility and space ID state now initialize from these props (falls back to "public" and empty string)
- Modal content is now scrollable (`max-h-[90vh]`, `overflow-y-auto`) with a fixed header, fixing the clipped modal issue when opened in space #music channels

## Bug Fixes

### MusicEmbedCard play/pause toggle
The play button in DM music embeds now reflects current playback state. When the embedded track is playing, the button shows a pause icon and the card highlights. Clicking toggles between play and pause instead of always restarting playback.

### Share to Space relay connectivity
Publishing to a space's host relay now explicitly calls `relayManager.connect()` and `await relayManager.waitForConnection()` before `signAndPublish()`. This prevents the silent failure where `relayManager.publish()` would return 0 (no relays sent to) when the host relay URL wasn't in the active connection pool.

### Upload modal overflow in space #music
The upload modal container changed from fixed padding to a flex column layout with `max-h-[90vh]` constraint. The header stays fixed while the form body scrolls, preventing content from being clipped off-screen.
