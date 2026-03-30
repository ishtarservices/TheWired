import { useMemo, useState } from "react";
import { Mic2, Upload, LayoutGrid, List } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "@/store/hooks";
import { Spinner } from "@/components/ui/Spinner";
import { TrackCard } from "@/features/music/TrackCard";
import { TrackRow } from "@/features/music/TrackRow";
import { AlbumCard } from "@/features/music/AlbumCard";
import { useProfileMusic } from "./useProfileMusic";

type ViewMode = "grid" | "list";

interface ProfileMusicTabProps {
  pubkey: string;
}

export function ProfileMusicTab({ pubkey }: ProfileMusicTabProps) {
  const navigate = useNavigate();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isMe = pubkey === myPubkey;
  const { tracks, albums, collaborations, loading } = useProfileMusic(pubkey);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const trackIds = useMemo(
    () => tracks.map((t) => t.addressableId),
    [tracks],
  );

  if (loading && tracks.length === 0 && albums.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  const isEmpty = tracks.length === 0 && albums.length === 0 && collaborations.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Mic2 size={32} className="text-faint" />
        <p className="text-sm text-muted">
          {isMe ? "You haven't uploaded any music yet" : "No music yet"}
        </p>
        {isMe && (
          <button
            onClick={() => navigate("/music/uploads")}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary-soft px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect"
          >
            <Upload size={14} />
            Upload Your First Track
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* View toggle */}
      {tracks.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            {tracks.length} track{tracks.length !== 1 ? "s" : ""}
            {albums.length > 0 && ` · ${albums.length} project${albums.length !== 1 ? "s" : ""}`}
          </p>
          <div className="flex items-center gap-1 rounded-lg bg-surface p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`rounded-md p-1.5 transition-colors ${
                viewMode === "grid"
                  ? "bg-surface-hover text-heading"
                  : "text-muted hover:text-soft"
              }`}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`rounded-md p-1.5 transition-colors ${
                viewMode === "list"
                  ? "bg-surface-hover text-heading"
                  : "text-muted hover:text-soft"
              }`}
            >
              <List size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Albums */}
      {albums.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-soft">Projects</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {albums.map((album) => (
              <AlbumCard key={album.addressableId} album={album} />
            ))}
          </div>
        </div>
      )}

      {/* Collaborations */}
      {collaborations.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-soft">Collaborations</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {collaborations.map((album) => (
              <AlbumCard key={album.addressableId} album={album} />
            ))}
          </div>
        </div>
      )}

      {/* Tracks */}
      {tracks.length > 0 && (
        <div>
          {(albums.length > 0 || collaborations.length > 0) && (
            <h3 className="mb-2 text-sm font-semibold text-soft">Tracks</h3>
          )}
          {viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {tracks.map((track, i) => (
                <TrackCard
                  key={track.addressableId}
                  track={track}
                  queueTracks={trackIds}
                  queueIndex={i}
                />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[2rem_1fr_1fr_4rem_2rem] gap-4 border-b border-border px-3 pb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                <span>#</span>
                <span>Title</span>
                <span>Genre</span>
                <span className="text-right">Time</span>
                <span />
              </div>
              <div className="mt-1">
                {tracks.map((track, i) => (
                  <TrackRow
                    key={track.addressableId}
                    track={track}
                    index={i}
                    queueTracks={trackIds}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
