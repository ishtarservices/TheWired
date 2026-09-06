import type { VoiceParticipant } from "@/types/calling";
import { tileId, type MediaTileModel } from "./types";

export interface LocalTileState {
  muted: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
}

/**
 * Stable participant order: keep previously-seen pubkeys in their existing
 * order, drop leavers, append newcomers. Returns `prev` itself when nothing
 * changed so memoized consumers don't re-render.
 */
export function updateParticipantOrder(
  prev: string[],
  participants: Record<string, VoiceParticipant>,
): string[] {
  const present = new Set(Object.keys(participants));
  const kept = prev.filter((pk) => present.has(pk));
  for (const pk of Object.keys(participants)) {
    if (!kept.includes(pk)) kept.push(pk);
  }
  if (kept.length === prev.length && kept.every((pk, i) => pk === prev[i])) return prev;
  return kept;
}

/**
 * Build the stage tile list: local camera, remotes (in `order`), then
 * screen-share tiles (local first). Speaking is merged in but NEVER sorts.
 * Shared by voice channels and 1:1 calls — both are LiveKit rooms.
 */
export function buildTiles(args: {
  myPubkey: string | null;
  local: LocalTileState;
  participants: Record<string, VoiceParticipant>;
  order: string[];
  activeSpeakers: string[];
}): MediaTileModel[] {
  const { myPubkey, local, participants, order, activeSpeakers } = args;
  const speaking = new Set(activeSpeakers);
  const tiles: MediaTileModel[] = [];

  if (myPubkey) {
    tiles.push({
      id: tileId(myPubkey, "camera"),
      pubkey: myPubkey,
      source: "camera",
      isLocal: true,
      displayName: "You",
      isSpeaking: speaking.has(myPubkey),
      isMuted: local.muted,
      hasVideo: local.videoEnabled,
      handRaised: false,
      connectionQuality: "good",
    });
  }

  for (const pk of order) {
    const p = participants[pk];
    if (!p) continue;
    tiles.push({
      id: tileId(pk, "camera"),
      pubkey: pk,
      source: "camera",
      isLocal: false,
      displayName: p.displayName,
      isSpeaking: speaking.has(pk),
      isMuted: p.isMuted,
      hasVideo: p.hasVideo,
      handRaised: p.handRaised,
      connectionQuality: p.connectionQuality,
    });
  }

  if (myPubkey && local.screenSharing) {
    tiles.push({
      id: tileId(myPubkey, "screenshare"),
      pubkey: myPubkey,
      source: "screenshare",
      isLocal: true,
      displayName: "You",
      isSpeaking: false,
      isMuted: local.muted,
      hasVideo: true,
      handRaised: false,
      connectionQuality: "good",
    });
  }

  for (const pk of order) {
    const p = participants[pk];
    if (!p?.isScreenSharing) continue;
    tiles.push({
      id: tileId(pk, "screenshare"),
      pubkey: pk,
      source: "screenshare",
      isLocal: false,
      displayName: p.displayName,
      isSpeaking: false,
      isMuted: p.isMuted,
      hasVideo: true,
      handRaised: false,
      connectionQuality: p.connectionQuality,
    });
  }

  return tiles;
}
