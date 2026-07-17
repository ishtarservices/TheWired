// ─── Space channel previews / read state ─────────────────────────────
// Honest-degradation metadata for the SpacesHome channel list: last-message
// previews and unread counts exist ONLY for channels this session has
// actually seen data for (the per-screen chat socket, the space feed's
// one-shot pages) — no extra relay traffic is ever opened to fill a row.
// A row with no entry renders as name + chevron and must look intentional.
//
// previews/musicArtwork are in-memory only; lastReadAt persists through
// store/spacePreviews.ts thunks (user_state storage, moderation.ts pattern).

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface ChannelPreview {
  lastEventAt: number; // unix seconds
  lastSenderPubkey: string;
  lastText: string;
  /** Bounded timestamps of messages seen this session — unread derivation. */
  eventTimestamps: number[];
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

const MAX_TIMESTAMPS = 100;
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
    /** A verified, channel-matched message (chat socket backlog or live).
     *  Callers filter muted authors BEFORE dispatching. */
    channelPreviewUpserted(
      state,
      action: PayloadAction<{
        spaceId: string;
        channelId: string;
        createdAt: number;
        senderPubkey: string;
        content: string;
      }>,
    ) {
      const { spaceId, channelId, createdAt, senderPubkey, content } = action.payload;
      const key = channelKey(spaceId, channelId);
      const existing = state.previews[key];
      if (!existing) {
        state.previews[key] = {
          lastEventAt: createdAt,
          lastSenderPubkey: senderPubkey,
          lastText: truncatePreview(content),
          eventTimestamps: [createdAt],
        };
        return;
      }
      if (createdAt >= existing.lastEventAt) {
        existing.lastEventAt = createdAt;
        existing.lastSenderPubkey = senderPubkey;
        existing.lastText = truncatePreview(content);
      }
      if (!existing.eventTimestamps.includes(createdAt)) {
        existing.eventTimestamps.push(createdAt);
        if (existing.eventTimestamps.length > MAX_TIMESTAMPS) {
          existing.eventTimestamps.sort((a, b) => a - b);
          existing.eventTimestamps.splice(
            0,
            existing.eventTimestamps.length - MAX_TIMESTAMPS,
          );
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
  channelPreviewUpserted,
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
  return preview.eventTimestamps.filter((t) => t > readAt).length;
}

const EMPTY_ARTWORK: string[] = [];

export function selectSpaceMusicArtwork(
  state: WithSpacePreviews,
  spaceId: string,
): string[] {
  return state.spacePreviews.musicArtwork[spaceId] ?? EMPTY_ARTWORK;
}
