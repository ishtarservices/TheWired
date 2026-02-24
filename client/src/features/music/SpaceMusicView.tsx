import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { TrackCard } from "./TrackCard";
import { AlbumCard } from "./AlbumCard";
import { EVENT_KINDS } from "@/types/nostr";

export function SpaceMusicView() {
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const feedEventIds = useAppSelector(
    (s) => (activeChannelId ? s.events.spaceFeeds[activeChannelId] : undefined) ?? [],
  );
  const eventEntities = useAppSelector((s) => s.events.entities);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);

  const { trackItems, albumItems } = useMemo(() => {
    const trackItems: string[] = [];
    const albumItems: string[] = [];

    for (const eventId of feedEventIds) {
      const event = eventEntities[eventId];
      if (!event) continue;

      if (event.kind === EVENT_KINDS.MUSIC_TRACK) {
        const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
        const addrId = `31683:${event.pubkey}:${dTag}`;
        if (tracks[addrId]) trackItems.push(addrId);
      } else if (event.kind === EVENT_KINDS.MUSIC_ALBUM) {
        const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
        const addrId = `33123:${event.pubkey}:${dTag}`;
        if (albums[addrId]) albumItems.push(addrId);
      }
    }

    return { trackItems, albumItems };
  }, [feedEventIds, eventEntities, tracks, albums]);

  const hasContent = trackItems.length > 0 || albumItems.length > 0;

  if (!hasContent) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">No music yet from space members</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {trackItems.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            Tracks
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {trackItems.map((addrId, i) => {
              const track = tracks[addrId];
              if (!track) return null;
              return (
                <TrackCard
                  key={addrId}
                  track={track}
                  queueTracks={trackItems}
                  queueIndex={i}
                />
              );
            })}
          </div>
        </section>
      )}

      {albumItems.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            Albums
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {albumItems.map((addrId) => {
              const album = albums[addrId];
              if (!album) return null;
              return <AlbumCard key={addrId} album={album} />;
            })}
          </div>
        </section>
      )}
    </div>
  );
}
