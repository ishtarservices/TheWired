import type { AppDispatch } from "@/store";
import { store } from "@/store";
import { removeAlbum, removeTrack } from "@/store/slices/musicSlice";
import { deleteAddressableEvent } from "@/lib/db/eventStore";
import { forgetSeenEvents } from "@/lib/nostr/forgetSeen";
import { EVENT_KINDS } from "@/types/nostr";
import type { MusicAlbum, MusicTrack } from "@/types/music";
import { mixExplore, type ExploreItem } from "./exploreMix";

/** Releases shown per space, so one busy space can't fill the row. */
const PER_SPACE = 4;
const SHELF_MAX = 12;

/**
 * Music home's "From your spaces" row: the newest space-only releases from
 * the spaces the viewer is in.
 *
 * Membership is the relay's to enforce and it does (it serves h-tagged events
 * to members only). This filter is the second line: the local event cache is
 * shared by every account on the device and outlives a space the viewer has
 * left, so a release only shows while one of its spaces is in `joined`.
 */
export function spaceShelf(
  albums: Record<string, MusicAlbum>,
  tracks: Record<string, MusicTrack>,
  opts: {
    /** Ids of the spaces the current account is in. */
    joined: ReadonlySet<string>;
    /** Authored by the viewer (their own releases live in the collection). */
    isMine: (pubkey: string) => boolean;
    /** Muted authors. */
    muted?: ReadonlySet<string>;
    /** Ids already on the page (the collection wall). */
    exclude?: ReadonlySet<string>;
  },
): ExploreItem[] {
  const eligible = (m: { visibility: string; spaceIds?: string[]; pubkey: string; addressableId: string }) =>
    m.visibility === "space" &&
    !!m.spaceIds?.some((id) => opts.joined.has(id)) &&
    !opts.isMine(m.pubkey) &&
    !opts.muted?.has(m.pubkey) &&
    !opts.exclude?.has(m.addressableId);

  const mixed = mixExplore(
    Object.values(albums).filter(eligible),
    // A note's attached audio (`catalog:none`) stays with its note.
    Object.values(tracks).filter((t) => eligible(t) && t.inCatalog !== false),
  );

  const perSpace = new Map<string, number>();
  const out: ExploreItem[] = [];
  for (const item of mixed) {
    const m = item.kind === "project" ? item.album : item.track;
    const home = m.spaceIds?.find((id) => opts.joined.has(id));
    if (!home) continue;
    const n = perSpace.get(home) ?? 0;
    if (n >= PER_SPACE) continue;
    perSpace.set(home, n + 1);
    out.push(item);
    if (out.length >= SHELF_MAX) break;
  }
  return out;
}

/**
 * Drop a space's space-only music when the viewer leaves it, is removed, or
 * the space is deleted: from the music slice and from the local event cache.
 *
 * Only releases that live in that space alone, and that the viewer didn't
 * author. A release shared into another space the viewer is still in stays.
 * Audio and covers are gated by the server either way; this removes the
 * titles and credits that were cached while the viewer was a member.
 */
export function purgeSpaceOnlyMusic(spaceId: string, dispatch: AppDispatch): void {
  const state = store.getState();
  const me = state.identity.pubkey;
  const held = state.music.heldProjectKeys ?? {};
  const stillIn = new Set(state.spaces.list.map((s) => s.id).filter((id) => id !== spaceId));

  const gone = (m: { visibility: string; spaceIds?: string[]; pubkey: string }) =>
    m.visibility === "space" &&
    !!m.spaceIds?.includes(spaceId) &&
    !m.spaceIds.some((id) => stillIn.has(id)) &&
    m.pubkey !== me &&
    !(m.pubkey in held);

  const forget = (kind: number, addressableId: string) => {
    const [, pubkey, ...d] = addressableId.split(":");
    if (!pubkey) return;
    deleteAddressableEvent(kind, pubkey, d.join(":")).catch(() => {
      /* best-effort: the render filter still hides it */
    });
  };

  const eventIds: string[] = [];
  for (const track of Object.values(state.music.tracks)) {
    if (!gone(track)) continue;
    dispatch(removeTrack(track.addressableId));
    forget(EVENT_KINDS.MUSIC_TRACK, track.addressableId);
    if (track.eventId) eventIds.push(track.eventId);
  }
  for (const album of Object.values(state.music.albums)) {
    if (!gone(album)) continue;
    dispatch(removeAlbum(album.addressableId));
    forget(EVENT_KINDS.MUSIC_ALBUM, album.addressableId);
    if (album.eventId) eventIds.push(album.eventId);
  }
  // Rejoining in the same session must be able to fetch them again.
  forgetSeenEvents(eventIds);
}
