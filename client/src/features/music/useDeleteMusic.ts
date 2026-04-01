import { useState, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeTrack, removeAlbum } from "@/store/slices/musicSlice";
import { buildDeletionEvent } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { deleteEvent, deleteAddressableEvent } from "@/lib/db/eventStore";
import { removeLocalEventId, getLocalEventIds, saveMusicLibrary } from "@/lib/db/musicStore";
import { deleteMusic } from "@/lib/api/music";
import { removeCachedAudio } from "@/lib/db/audioCache";
import { store } from "@/store";
import type { MusicTrack, MusicAlbum } from "@/types/music";

/** Persist library state after deletions modify savedTrackIds/savedAlbumIds */
function persistLibraryAfterDelete() {
  const { savedTrackIds, savedAlbumIds, favoritedTrackIds, favoritedAlbumIds, followedArtists, userPlaylists } =
    store.getState().music.library;
  const { recentlyPlayedIds } = store.getState().music.discovery;
  saveMusicLibrary({
    savedTrackIds, savedAlbumIds, favoritedTrackIds, favoritedAlbumIds,
    followedArtists, userPlaylists, recentlyPlayedIds,
  }).catch((err) => console.error("[music] Failed to persist library after delete:", err));
}

/** Extract the d-tag (slug) from an addressable ID like "31683:pubkey:slug" */
function getSlug(addressableId: string): string {
  return addressableId.split(":").slice(2).join(":");
}

export function useDeleteMusic() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const tracks = useAppSelector((s) => s.music.tracks);
  const tracksByAlbum = useAppSelector((s) => s.music.tracksByAlbum);
  const dispatch = useAppDispatch();
  const [deleting, setDeleting] = useState(false);

  const deleteTrack = useCallback(
    async (track: MusicTrack) => {
      if (!pubkey || track.pubkey !== pubkey) return;
      setDeleting(true);
      try {
        const localIds = await getLocalEventIds();
        const isLocal = localIds.has(track.eventId);

        if (isLocal) {
          await deleteEvent(track.eventId);
          await removeLocalEventId(track.eventId);
        } else {
          const unsigned = buildDeletionEvent(pubkey, {
            eventIds: [track.eventId],
            addressableIds: [track.addressableId],
          });
          await signAndPublish(unsigned);

          try {
            await deleteMusic("track", pubkey, getSlug(track.addressableId));
          } catch {
            // Non-fatal: Nostr deletion event is the source of truth
          }
        }

        // Remove ALL versions of this addressable event from IndexedDB + Redux.
        // Addressable events can have multiple IndexedDB entries (different event IDs
        // from past updates). Delete by kind:pubkey:d-tag to catch them all.
        const [, addrPubkey, ...addrDParts] = track.addressableId.split(":");
        await deleteAddressableEvent(31683, addrPubkey, addrDParts.join(":")).catch(() => {});
        removeCachedAudio(track.addressableId).catch(() => {});
        dispatch(removeTrack(track.addressableId));
        persistLibraryAfterDelete();
      } finally {
        setDeleting(false);
      }
    },
    [pubkey, dispatch],
  );

  const deleteAlbum = useCallback(
    async (album: MusicAlbum, cascadeTracks = false) => {
      if (!pubkey || album.pubkey !== pubkey) return;
      setDeleting(true);
      try {
        const localIds = await getLocalEventIds();
        const isLocal = localIds.has(album.eventId);

        // Collect all addressable IDs and event IDs to delete
        const addressableIds = [album.addressableId];
        const eventIds = [album.eventId];

        // Cascade: also delete tracks belonging to this album
        if (cascadeTracks) {
          const albumTrackIds = tracksByAlbum[album.addressableId] ?? [];
          for (const trackAddrId of albumTrackIds) {
            const track = tracks[trackAddrId];
            if (track && track.pubkey === pubkey) {
              addressableIds.push(track.addressableId);
              eventIds.push(track.eventId);
            }
          }
          // Also check trackRefs from the album itself
          for (const ref of album.trackRefs) {
            if (!addressableIds.includes(ref)) {
              const track = tracks[ref];
              if (track && track.pubkey === pubkey) {
                addressableIds.push(track.addressableId);
                eventIds.push(track.eventId);
              }
            }
          }
        }

        if (isLocal) {
          for (const eid of eventIds) {
            await deleteEvent(eid);
            await removeLocalEventId(eid);
          }
        } else {
          // Publish a single deletion event covering album + all its tracks
          const unsigned = buildDeletionEvent(pubkey, {
            eventIds,
            addressableIds,
          });
          await signAndPublish(unsigned);

          // Backend cleanup
          try {
            await deleteMusic("album", pubkey, getSlug(album.addressableId));
          } catch { /* non-fatal */ }

          if (cascadeTracks) {
            for (const addrId of addressableIds) {
              if (addrId === album.addressableId) continue;
              try {
                await deleteMusic("track", pubkey, getSlug(addrId));
              } catch { /* non-fatal */ }
            }
          }
        }

        // Remove ALL versions of each addressable event from IndexedDB + Redux.
        // This catches old event versions that deleteEvent(eventId) would miss.
        for (const addrId of addressableIds) {
          const [kindStr, addrPubkey, ...dParts] = addrId.split(":");
          await deleteAddressableEvent(parseInt(kindStr, 10), addrPubkey, dParts.join(":")).catch(() => {});
        }
        if (cascadeTracks) {
          for (const addrId of addressableIds) {
            if (addrId.startsWith("31683:")) {
              dispatch(removeTrack(addrId));
              removeCachedAudio(addrId).catch(() => {});
            }
          }
        }
        dispatch(removeAlbum(album.addressableId));
        persistLibraryAfterDelete();
      } finally {
        setDeleting(false);
      }
    },
    [pubkey, dispatch, tracks, tracksByAlbum],
  );

  return { deleteTrack, deleteAlbum, deleting };
}
