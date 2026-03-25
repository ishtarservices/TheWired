import { useMemo, useState } from "react";
import { ArrowLeft, Play, Shuffle, ListMusic, Pencil, Trash2, ChevronUp, ChevronDown, X } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { goBack, setMusicView, removePlaylist, addPlaylist } from "@/store/slices/musicSlice";
import { TrackRow } from "../TrackRow";
import { useAudioPlayer } from "../useAudioPlayer";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { buildPlaylistEvent } from "../musicEventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";

export function PlaylistDetail() {
  const dispatch = useAppDispatch();
  const playlistId = useAppSelector((s) => s.music.activeDetailId);
  const playlist = useAppSelector((s) =>
    playlistId ? s.music.playlists[playlistId] : undefined,
  );
  const tracks = useAppSelector((s) => s.music.tracks);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { playQueue } = useAudioPlayer();
  const { scrollPaddingClass } = usePlaybackBarSpacing();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = pubkey === playlist?.pubkey;

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
  const dTag = playlist.addressableId.split(":").slice(2).join(":");

  const startEditing = () => {
    setEditTitle(playlist.title);
    setEditDesc(playlist.description ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!pubkey || !editTitle.trim() || saving) return;
    setSaving(true);
    try {
      const unsigned = buildPlaylistEvent(pubkey, {
        title: editTitle.trim(),
        description: editDesc || undefined,
        slug: dTag,
        trackRefs: playlist.trackRefs,
        imageUrl: playlist.imageUrl,
        visibility: playlist.visibility,
      });
      await signAndPublish(unsigned);
      setEditing(false);
    } catch {
      // Silently fail
    } finally {
      setSaving(false);
    }
  };

  const republishWithTracks = async (newTrackRefs: string[]) => {
    if (!pubkey) return;
    const unsigned = buildPlaylistEvent(pubkey, {
      title: playlist.title,
      description: playlist.description,
      slug: dTag,
      trackRefs: newTrackRefs,
      imageUrl: playlist.imageUrl,
      visibility: playlist.visibility,
    });
    const published = await signAndPublish(unsigned);
    // Update local state immediately
    dispatch(addPlaylist({
      ...playlist,
      trackRefs: newTrackRefs,
      eventId: published.id,
      createdAt: published.created_at,
    }));
  };

  const moveTrack = async (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= playlist.trackRefs.length) return;
    const newRefs = [...playlist.trackRefs];
    [newRefs[index], newRefs[newIndex]] = [newRefs[newIndex], newRefs[index]];
    await republishWithTracks(newRefs);
  };

  const removeTrack = async (index: number) => {
    const newRefs = playlist.trackRefs.filter((_, i) => i !== index);
    await republishWithTracks(newRefs);
  };

  const handleDelete = async () => {
    if (!pubkey || deleting) return;
    setDeleting(true);
    try {
      // Publish empty playlist to effectively delete (Nostr replaceable event)
      const unsigned = buildPlaylistEvent(pubkey, {
        title: "",
        slug: dTag,
        trackRefs: [],
      });
      unsigned.tags.push(["deleted", "true"]);
      await signAndPublish(unsigned);
      dispatch(removePlaylist(playlist.addressableId));
      dispatch(setMusicView("playlists"));
    } catch {
      // Silently fail
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`flex-1 overflow-y-auto ${scrollPaddingClass}`}>
      {/* Header */}
      <div className="flex items-end gap-6 bg-gradient-to-b from-card-hover/30 to-transparent p-6">
        <button
          onClick={() => dispatch(goBack())}
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
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wider text-soft">Playlist</p>
          {editing ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-field px-3 py-1.5 text-lg font-bold text-heading outline-none focus:border-primary/30"
              />
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
                placeholder="Description (optional)"
              />
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={!editTitle.trim() || saving}
                  className="rounded-lg bg-gradient-to-r from-primary to-primary-soft px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-border px-4 py-1.5 text-sm text-soft hover:text-heading"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
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
                  className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-primary-soft px-4 py-1.5 text-sm font-medium text-white transition-transform hover:scale-105 press-effect disabled:opacity-50"
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
                  className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-border-light hover:text-heading disabled:opacity-50"
                >
                  <Shuffle size={14} />
                  Shuffle
                </button>
                {isOwner && (
                  <>
                    <button
                      onClick={startEditing}
                      className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-soft transition-colors hover:border-border-light hover:text-heading"
                    >
                      <Pencil size={14} />
                    </button>
                    {confirmDelete ? (
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        {deleting ? "Deleting..." : "Confirm"}
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(true)}
                        className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-soft transition-colors hover:border-red-500/30 hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Track list */}
      <div className="px-6 py-4">
        {playlistTracks.length > 0 ? (
          playlistTracks.map((track, i) => (
            <div key={track.addressableId} className="group/row flex items-center gap-1">
              <div className="flex-1">
                <TrackRow
                  track={track}
                  index={i}
                  queueTracks={queueIds}
                />
              </div>
              {isOwner && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                  <button
                    onClick={() => moveTrack(i, -1)}
                    disabled={i === 0}
                    className="rounded p-0.5 text-muted hover:text-heading disabled:opacity-30"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveTrack(i, 1)}
                    disabled={i === playlistTracks.length - 1}
                    className="rounded p-0.5 text-muted hover:text-heading disabled:opacity-30"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    onClick={() => removeTrack(i)}
                    className="rounded p-0.5 text-muted hover:text-red-400"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-soft">
            No tracks in this playlist yet. Add tracks from the context menu on any track.
          </p>
        )}
      </div>
    </div>
  );
}
