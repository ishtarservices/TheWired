// Turn a parsed MusicItem into a react-native-track-player source/track.
// P1 streams the direct imeta URL (a public, header-less GET — see the backend
// serving map). P2 will prefer the backend HLS ladder via
// GET /api/music/variants/:sha, falling back to this URL on any failure.

import { TrackType } from "react-native-track-player";
import type { AddTrack } from "react-native-track-player";

import { safeImageUri } from "@/lib/nostr/noteContent";
import type { MusicItem } from "@/screens/spaces/musicEventParser";

export interface ResolvedSource {
  url: string;
  type: TrackType;
}

/** Resolve the streamable source for a track. Throws when the item has no
 *  playable audio (album, private/NIP-44, or missing imeta url) so the caller
 *  can surface an honest error rather than a silent dead control. */
export async function resolveAudioSource(item: MusicItem): Promise<ResolvedSource> {
  if (item.kind !== "track" || item.visibility === "private" || !item.audioUrl) {
    throw new Error("Track has no playable audio");
  }
  return { url: item.audioUrl, type: TrackType.Default };
}

/** Build the RNTP track for the queue. `id` carries the addressableId so the
 *  active-track event maps back to the catalog; artwork goes through
 *  safeImageUri so a malformed URL never reaches the native image loader. */
export async function toTrack(item: MusicItem): Promise<AddTrack> {
  const source = await resolveAudioSource(item);
  return {
    id: item.addressableId,
    url: source.url,
    type: source.type,
    title: item.title,
    artist: item.artist ?? undefined,
    artwork: safeImageUri(item.artwork),
    duration: item.durationSec,
  };
}
