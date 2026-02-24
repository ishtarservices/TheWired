import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setMusicView } from "@/store/slices/musicSlice";
import { TrackRow } from "../TrackRow";
import { AlbumCard } from "../AlbumCard";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";

export function ArtistDetail() {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.music.activeDetailId);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const trackIds = useAppSelector(
    (s) => (pubkey ? s.music.tracksByArtist[pubkey] : undefined) ?? [],
  );
  const { profile } = useProfile(pubkey ?? "");

  const artistTracks = useMemo(
    () => trackIds.map((id) => tracks[id]).filter(Boolean),
    [trackIds, tracks],
  );

  const artistAlbums = useMemo(
    () =>
      Object.values(albums)
        .filter((a) => a.pubkey === pubkey)
        .sort((a, b) => b.createdAt - a.createdAt),
    [albums, pubkey],
  );

  const name =
    profile?.display_name || profile?.name || (pubkey?.slice(0, 8) ?? "") + "...";
  const queueIds = artistTracks.map((t) => t.addressableId);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="flex items-end gap-6 bg-gradient-to-b from-card-hover/30 to-transparent p-6">
        <button
          onClick={() => dispatch(setMusicView("artists"))}
          className="self-start rounded p-1 text-soft hover:text-heading"
        >
          <ArrowLeft size={20} />
        </button>
        <Avatar src={profile?.picture} alt={name} size="lg" />
        <div>
          <p className="text-xs uppercase tracking-wider text-soft">Artist</p>
          <h1 className="text-2xl font-bold text-heading">{name}</h1>
          <p className="text-sm text-soft">
            {artistTracks.length} track{artistTracks.length !== 1 ? "s" : ""}
            {artistAlbums.length > 0 &&
              ` \u00B7 ${artistAlbums.length} album${artistAlbums.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Top tracks */}
      {artistTracks.length > 0 && (
        <section className="px-6 py-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            Tracks
          </h2>
          {artistTracks.map((track, i) => (
            <TrackRow
              key={track.addressableId}
              track={track}
              index={i}
              queueTracks={queueIds}
            />
          ))}
        </section>
      )}

      {/* Albums */}
      {artistAlbums.length > 0 && (
        <section className="px-6 py-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            Albums
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {artistAlbums.map((album) => (
              <AlbumCard key={album.addressableId} album={album} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
