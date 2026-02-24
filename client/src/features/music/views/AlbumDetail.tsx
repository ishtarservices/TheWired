import { useMemo, useState } from "react";
import { ArrowLeft, Play, Shuffle, Disc3, Link2, Heart, Users, UserPlus, X } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setMusicView, addAlbum } from "@/store/slices/musicSlice";
import { TrackRow } from "../TrackRow";
import { useAudioPlayer } from "../useAudioPlayer";
import { useLibrary } from "../useLibrary";
import { buildMusicLink } from "../musicLinks";
import { buildAlbumEvent } from "../musicEventBuilder";
import { copyToClipboard } from "@/lib/clipboard";
import { signAndPublish } from "@/lib/nostr/publish";
import { parseAlbumEvent } from "../albumParser";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";

function CollaboratorRow({
  pubkey,
  isOwner,
  onRemove,
}: {
  pubkey: string;
  isOwner: boolean;
  onRemove?: () => void;
}) {
  const { profile } = useProfile(pubkey);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-card-hover/30">
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <span className="flex-1 truncate text-sm text-body">{name}</span>
      {isOwner && onRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 rounded p-0.5 text-muted hover:text-red-400 transition-colors"
          title="Remove collaborator"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function parsePubkeyInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      return null;
    }
  }
  return null;
}

export function AlbumDetail() {
  const dispatch = useAppDispatch();
  const albumId = useAppSelector((s) => s.music.activeDetailId);
  const album = useAppSelector((s) =>
    albumId ? s.music.albums[albumId] : undefined,
  );
  const tracks = useAppSelector((s) => s.music.tracks);
  const tracksByAlbum = useAppSelector((s) =>
    albumId ? s.music.tracksByAlbum[albumId] : undefined,
  );
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { playQueue } = useAudioPlayer();
  const { saveAlbum, unsaveAlbum, isAlbumSaved } = useLibrary();
  const [copied, setCopied] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const albumTracks = useMemo(() => {
    // Use album's trackRefs first, fallback to indexed tracks
    const refs = album?.trackRefs ?? tracksByAlbum ?? [];
    return refs.map((id) => tracks[id]).filter(Boolean);
  }, [album?.trackRefs, tracksByAlbum, tracks]);

  if (!album) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">Album not found</p>
      </div>
    );
  }

  const queueIds = albumTracks.map((t) => t.addressableId);
  const isOwner = pubkey === album.pubkey;
  const isCollaborator = !!pubkey && album.featuredArtists.includes(pubkey);
  const collaborators = album.featuredArtists;

  const republishAlbum = async (newFeaturedArtists: string[]) => {
    if (!pubkey || !isOwner) return;
    const slug = album.addressableId.split(":").slice(2).join(":");
    const unsigned = buildAlbumEvent(pubkey, {
      title: album.title,
      artist: album.artist,
      slug,
      genre: album.genre || undefined,
      imageUrl: album.imageUrl,
      trackRefs: album.trackRefs.length > 0 ? album.trackRefs : undefined,
      featuredArtists: newFeaturedArtists.length > 0 ? newFeaturedArtists : undefined,
      projectType: album.projectType,
      visibility: album.visibility,
    });
    const signed = await signAndPublish(unsigned);
    if (signed) {
      dispatch(addAlbum(parseAlbumEvent(signed)));
    }
  };

  const handleAddCollaborator = async () => {
    const pk = parsePubkeyInput(addInput);
    if (!pk) {
      setAddError("Invalid npub or hex pubkey");
      return;
    }
    if (pk === album.pubkey) {
      setAddError("Cannot add the project owner");
      return;
    }
    if (collaborators.includes(pk)) {
      setAddError("Already a collaborator");
      return;
    }
    setAddError(null);
    setAddInput("");
    await republishAlbum([...collaborators, pk]);
  };

  const handleRemoveCollaborator = async (pk: string) => {
    await republishAlbum(collaborators.filter((c) => c !== pk));
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="flex items-end gap-6 bg-gradient-to-b from-card-hover/30 to-transparent p-6">
          <button
            onClick={() => dispatch(setMusicView("albums"))}
            className="self-start rounded p-1 text-soft hover:text-heading"
          >
            <ArrowLeft size={20} />
          </button>
          {album.imageUrl ? (
            <img
              src={album.imageUrl}
              alt={album.title}
              className="h-36 w-36 rounded-lg object-cover shadow-lg"
            />
          ) : (
            <div className="flex h-36 w-36 items-center justify-center rounded-lg bg-card">
              <Disc3 size={48} className="text-muted" />
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wider text-soft">{album.projectType === "album" ? "Album" : album.projectType}</p>
            <h1 className="text-2xl font-bold text-heading">{album.title}</h1>
            <p className="text-sm text-soft">
              {album.artist} &middot; {album.trackCount} track
              {album.trackCount !== 1 ? "s" : ""}
              {collaborators.length > 0 && (
                <> &middot; {collaborators.length} collaborator{collaborators.length !== 1 ? "s" : ""}</>
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
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
              {album.visibility !== "local" && (
                <button
                  onClick={async () => {
                    const link = buildMusicLink(album.addressableId);
                    const ok = await copyToClipboard(link);
                    if (ok) {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-edge px-4 py-1.5 text-sm text-soft transition-colors hover:border-heading hover:text-heading"
                >
                  <Link2 size={14} />
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              )}
              {pubkey !== album.pubkey && album.visibility !== "local" && (
                <button
                  onClick={() => {
                    if (isAlbumSaved(album.addressableId)) {
                      unsaveAlbum(album.addressableId);
                    } else {
                      saveAlbum(album.addressableId);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-edge px-4 py-1.5 text-sm text-soft transition-colors hover:border-heading hover:text-heading"
                >
                  <Heart
                    size={14}
                    className={isAlbumSaved(album.addressableId) ? "fill-red-500 text-red-500" : ""}
                  />
                  {isAlbumSaved(album.addressableId) ? "Saved" : "Save"}
                </button>
              )}
              {(isOwner || isCollaborator) && (
                <button
                  onClick={() => setShowMembers((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors ${
                    showMembers
                      ? "border-heading text-heading"
                      : "border-edge text-soft hover:border-heading hover:text-heading"
                  }`}
                >
                  <Users size={14} />
                  Members
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Track list */}
        <div className="px-6 py-4">
          {albumTracks.length > 0 ? (
            albumTracks.map((track, i) => (
              <TrackRow
                key={track.addressableId}
                track={track}
                index={i}
                queueTracks={queueIds}
              />
            ))
          ) : (
            <p className="text-sm text-soft">No tracks in this album yet</p>
          )}
        </div>
      </div>

      {/* Collaborators side panel */}
      {showMembers && (
        <div className="flex w-64 shrink-0 flex-col border-l border-edge">
          <div className="flex h-12 items-center border-b border-edge px-4">
            <Users size={16} className="mr-2 text-soft" />
            <span className="text-sm font-semibold text-body">Members</span>
            <button
              onClick={() => setShowMembers(false)}
              className="ml-auto rounded p-0.5 text-muted hover:text-heading"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {/* Owner */}
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Owner
            </div>
            <CollaboratorRow pubkey={album.pubkey} isOwner={false} />

            {/* Collaborators list */}
            {collaborators.length > 0 && (
              <>
                <div className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Collaborators ({collaborators.length})
                </div>
                {collaborators.map((pk) => (
                  <CollaboratorRow
                    key={pk}
                    pubkey={pk}
                    isOwner={isOwner}
                    onRemove={() => handleRemoveCollaborator(pk)}
                  />
                ))}
              </>
            )}

            {collaborators.length === 0 && (
              <div className="mt-3 px-2 py-3 text-center text-xs text-muted">
                No collaborators yet
              </div>
            )}

            {/* Add collaborator (owner only) */}
            {isOwner && (
              <div className="mt-3 border-t border-edge pt-3 px-1">
                <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  <UserPlus size={10} />
                  Add Collaborator
                </div>
                <div className="flex flex-col gap-1.5">
                  <input
                    type="text"
                    value={addInput}
                    onChange={(e) => {
                      setAddInput(e.target.value);
                      setAddError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCollaborator();
                      }
                    }}
                    placeholder="npub or hex pubkey..."
                    className="w-full rounded-md border border-edge-light bg-field px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
                  />
                  <button
                    onClick={handleAddCollaborator}
                    disabled={!addInput.trim()}
                    className="w-full rounded-md bg-pulse px-3 py-1.5 text-sm font-medium text-white hover:bg-pulse-soft transition-all duration-150 disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                {addError && <p className="mt-1 text-xs text-red-400">{addError}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
