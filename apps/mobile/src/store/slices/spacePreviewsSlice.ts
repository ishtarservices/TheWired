// ─── Space channel previews / read state ─────────────────────────────
// Honest-degradation metadata for the SpacesHome channel list: last-message
// previews and unread counts exist ONLY for channels this session has
// actually seen data for (the space-signal sub, the per-screen chat socket).
// A row with no entry renders as name + chevron and must look intentional.
//
// previews/musicArtwork are in-memory only; lastReadAt persists through
// store/spacePreviews.ts thunks (user_state storage, moderation.ts pattern).

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface PreviewEntry {
  /** Event id — dedup key (the signal sub and an open ChannelScreen socket
   *  can both deliver the same event). */
  id: string;
  /** created_at, unix seconds. */
  at: number;
}

export interface ChannelPreview {
  lastEventAt: number; // unix seconds
  lastSenderPubkey: string;
  lastText: string;
  /** Bounded evidence of messages seen this session — unread derivation.
   *  Own messages are excluded: they update the preview line but never
   *  count as unread. */
  entries: PreviewEntry[];
}

/** One verified, channel-matched, mute-filtered message for the batch upsert. */
export interface ChannelMessageSeen {
  spaceId: string;
  channelId: string;
  eventId: string;
  createdAt: number;
  senderPubkey: string;
  content: string;
  /** Authored by the active identity. */
  isOwn: boolean;
}

interface SpacePreviewsState {
  /** `${spaceId}/${channelId}` → newest-message preview. */
  previews: Record<string, ChannelPreview>;
  /** `${spaceId}/${channelId}` → last time the user opened the channel. */
  lastReadAt: Record<string, number>;
  lastReadHydrated: boolean;
  /** spaceId → recent music cover-art URLs (≤ 8, https-only upstream). */
  musicArtwork: Record<string, string[]>;
}

const initialState: SpacePreviewsState = {
  previews: {},
  lastReadAt: {},
  lastReadHydrated: false,
  musicArtwork: {},
};

const MAX_ENTRIES = 100;
const MAX_ARTWORK = 8;

export function channelKey(spaceId: string, channelId: string): string {
  return `${spaceId}/${channelId}`;
}

function truncatePreview(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

export const spacePreviewsSlice = createSlice({
  name: "spacePreviews",
  initialState,
  reducers: {
    /** Verified, channel-matched messages (signal sub backfill/live, chat
     *  socket backlog/live). Callers filter muted authors BEFORE dispatching.
     *  Batched: a cold backfill must not be one dispatch per event. */
    channelPreviewsUpserted(state, action: PayloadAction<ChannelMessageSeen[]>) {
      for (const m of action.payload) {
        const key = channelKey(m.spaceId, m.channelId);
        let preview = state.previews[key];
        if (!preview) {
          preview = state.previews[key] = {
            lastEventAt: m.createdAt,
            lastSenderPubkey: m.senderPubkey,
            lastText: truncatePreview(m.content),
            entries: [],
          };
        } else if (m.createdAt >= preview.lastEventAt) {
          preview.lastEventAt = m.createdAt;
          preview.lastSenderPubkey = m.senderPubkey;
          preview.lastText = truncatePreview(m.content);
        }
        if (m.isOwn) continue;
        if (preview.entries.some((e) => e.id === m.eventId)) continue;
        preview.entries.push({ id: m.eventId, at: m.createdAt });
        if (preview.entries.length > MAX_ENTRIES) {
          preview.entries.sort((a, b) => a.at - b.at);
          preview.entries.splice(0, preview.entries.length - MAX_ENTRIES);
        }
      }
    },

    channelMarkedRead(
      state,
      action: PayloadAction<{ spaceId: string; channelId: string; at: number }>,
    ) {
      const { spaceId, channelId, at } = action.payload;
      const key = channelKey(spaceId, channelId);
      state.lastReadAt[key] = Math.max(state.lastReadAt[key] ?? 0, at);
    },

    /** Bulk-restore from storage — keeps the max per key so a mark-read that
     *  raced hydration wins. */
    spaceLastReadHydrated(state, action: PayloadAction<Record<string, number>>) {
      for (const [key, at] of Object.entries(action.payload)) {
        state.lastReadAt[key] = Math.max(state.lastReadAt[key] ?? 0, at);
      }
      state.lastReadHydrated = true;
    },

    /** Cover art seen while the space's music feed loaded (https-only). */
    spaceMusicArtworkSeen(
      state,
      action: PayloadAction<{ spaceId: string; artworks: string[] }>,
    ) {
      const { spaceId, artworks } = action.payload;
      if (artworks.length === 0) return;
      state.musicArtwork[spaceId] = artworks.slice(0, MAX_ARTWORK);
    },

    /** Logout / account switch. */
    spacePreviewsCleared() {
      return initialState;
    },
  },
});

export const {
  channelPreviewsUpserted,
  channelMarkedRead,
  spaceLastReadHydrated,
  spaceMusicArtworkSeen,
  spacePreviewsCleared,
} = spacePreviewsSlice.actions;

// ─── Selectors (RootState is structurally typed to avoid an import cycle
// with store/index.ts) ────────────────────────────────────────────────

interface WithSpacePreviews {
  spacePreviews: SpacePreviewsState;
}

export function selectChannelPreview(
  state: WithSpacePreviews,
  spaceId: string,
  channelId: string,
): ChannelPreview | undefined {
  return state.spacePreviews.previews[channelKey(spaceId, channelId)];
}

/** Unread = messages newer than the persisted lastReadAt. A channel that has
 *  never been opened (no lastReadAt) reports 0 — unknown is not unread. */
export function selectChannelUnreadCount(
  state: WithSpacePreviews,
  spaceId: string,
  channelId: string,
): number {
  const key = channelKey(spaceId, channelId);
  const readAt = state.spacePreviews.lastReadAt[key];
  if (readAt === undefined) return 0;
  const preview = state.spacePreviews.previews[key];
  if (!preview) return 0;
  return preview.entries.filter((e) => e.at > readAt).length;
}

const EMPTY_ARTWORK: string[] = [];

export function selectSpaceMusicArtwork(
  state: WithSpacePreviews,
  spaceId: string,
): string[] {
  return state.spacePreviews.musicArtwork[spaceId] ?? EMPTY_ARTWORK;
}
