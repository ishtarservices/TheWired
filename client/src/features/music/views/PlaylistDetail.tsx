import { useMemo } from "react";
import { ArrowLeft, Play, Shuffle, ListMusic } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setMusicView } from "@/store/slices/musicSlice";
import { TrackRow } from "../TrackRow";
import { useAudioPlayer } from "../useAudioPlayer";

export function PlaylistDetail() {
  const dispatch = useAppDispatch();
  const playlistId = useAppSelector((s) => s.music.activeDetailId);
  const playlist = useAppSelector((s) =>
    playlistId ? s.music.playlists[playlistId] : undefined,
  );
  const tracks = useAppSelector((s) => s.music.tracks);
  const { playQueue } = useAudioPlayer();

  const playlistTracks = useMemo(() => {
    if (!playlist) return [];
    return playlist.trackRefs.map((id) => tracks[id]).filter(Boolean);
  }, [playlist?.trackRefs, tracks]);

  if (!playlist) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">Playlist not found</p>
      </div>
    );
  }

  const queueIds = playlistTracks.map((t) => t.addressableId);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="flex items-end gap-6 bg-gradient-to-b from-card-hover/30 to-transparent p-6">
        <button
          onClick={() => dispatch(setMusicView("playlists"))}
          className="self-start rounded p-1 text-soft hover:text-heading"
        >
          <ArrowLeft size={20} />
        </button>
        {playlist.imageUrl ? (
          <img
            src={playlist.imageUrl}
            alt={playlist.title}
            className="h-36 w-36 rounded-lg object-cover shadow-lg"
          />
        ) : (
          <div className="flex h-36 w-36 items-center justify-center rounded-lg bg-card">
            <ListMusic size={48} className="text-muted" />
          </div>
        )}
        <div>
          <p className="text-xs uppercase tracking-wider text-soft">Playlist</p>
          <h1 className="text-2xl font-bold text-heading">{playlist.title}</h1>
          {playlist.description && (
            <p className="mt-1 text-sm text-soft">{playlist.description}</p>
          )}
          <p className="text-sm text-soft">
            {playlist.trackRefs.length} track
            {playlist.trackRefs.length !== 1 ? "s" : ""}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => playQueue(queueIds, 0)}
              disabled={queueIds.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-heading px-4 py-1.5 text-sm font-medium text-backdrop transition-transform hover:scale-105 disabled:opacity-50"
            >
              <Play size={14} fill="currentColor" />
              Play All
            </button>
            <button
              onClick={() => {
                const shuffled = [...queueIds].sort(() => Math.random() - 0.5);
                playQueue(shuffled, 0);
              }}
              disabled={queueIds.length === 0}
              className="flex items-center gap-1.5 rounded-full border border-edge px-4 py-1.5 text-sm text-soft transition-colors hover:border-heading hover:text-heading disabled:opacity-50"
            >
              <Shuffle size={14} />
              Shuffle
            </button>
          </div>
        </div>
      </div>

      {/* Track list */}
      <div className="px-6 py-4">
        {playlistTracks.length > 0 ? (
          playlistTracks.map((track, i) => (
            <TrackRow
              key={track.addressableId}
              track={track}
              index={i}
              queueTracks={queueIds}
            />
          ))
        ) : (
          <p className="text-sm text-soft">No tracks in this playlist yet</p>
        )}
      </div>
    </div>
  );
}
