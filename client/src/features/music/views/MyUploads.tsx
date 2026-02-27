import { useState, useMemo } from "react";
import { Upload, Disc3 } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { selectMyTracks, selectMyAlbums, selectMyCollaborations } from "../musicSelectors";
import { TrackRow } from "../TrackRow";
import { AlbumCard } from "../AlbumCard";
import { UploadTrackModal } from "../UploadTrackModal";
import { CreateAlbumModal } from "../CreateAlbumModal";

export function MyUploads() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const myTracks = useAppSelector(
    useMemo(() => (pubkey ? selectMyTracks(pubkey) : () => []), [pubkey]),
  );
  const myAlbums = useAppSelector(
    useMemo(() => (pubkey ? selectMyAlbums(pubkey) : () => []), [pubkey]),
  );
  const myCollabs = useAppSelector(
    useMemo(() => (pubkey ? selectMyCollaborations(pubkey) : () => []), [pubkey]),
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);

  const queueIds = myTracks.map((t) => t.addressableId);

  if (!pubkey) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">Sign in to see your uploads</p>
      </div>
    );
  }

  const isEmpty = myTracks.length === 0 && myAlbums.length === 0 && myCollabs.length === 0;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-heading">My Music</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setAlbumOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.04] px-3 py-1.5 text-xs text-soft transition-colors hover:border-white/[0.08] hover:text-heading press-effect"
          >
            <Disc3 size={14} />
            Create Project
          </button>
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-pulse to-pulse-soft px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 press-effect"
          >
            <Upload size={14} />
            Upload Track
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Upload size={32} className="text-muted" />
          <p className="text-sm text-soft">You haven't uploaded any music yet</p>
          <button
            onClick={() => setUploadOpen(true)}
            className="rounded-xl bg-gradient-to-r from-pulse to-pulse-soft px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect"
          >
            Upload Your First Track
          </button>
        </div>
      ) : (
        <>
          {myAlbums.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-soft">Projects</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                {myAlbums.map((album) => (
                  <AlbumCard key={album.addressableId} album={album} />
                ))}
              </div>
            </div>
          )}

          {myCollabs.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-soft">Collaborations</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                {myCollabs.map((album) => (
                  <AlbumCard key={album.addressableId} album={album} />
                ))}
              </div>
            </div>
          )}

          {myTracks.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-soft">Tracks</h3>
              <div className="grid grid-cols-[2rem_1fr_1fr_4rem_2rem] gap-4 border-b border-white/[0.04] px-3 pb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                <span>#</span>
                <span>Title</span>
                <span>Genre</span>
                <span className="text-right">Time</span>
                <span />
              </div>
              <div className="mt-1">
                {myTracks.map((track, i) => (
                  <TrackRow
                    key={track.addressableId}
                    track={track}
                    index={i}
                    queueTracks={queueIds}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <UploadTrackModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <CreateAlbumModal open={albumOpen} onClose={() => setAlbumOpen(false)} />
    </div>
  );
}
