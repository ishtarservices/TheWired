import { useMemo, useRef } from "react";
import { ArrowLeft, Music, Camera, UserSquare2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { goBack, setActiveDetailId } from "@/store/slices/musicSlice";
import { TrackRow } from "../TrackRow";
import { AlbumCard } from "../AlbumCard";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useUserPopover } from "@/features/profile/UserPopoverContext";
import { useArtistImage } from "../useArtistImage";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import {
  selectArtistTracks,
  selectArtistAlbums,
  selectArtistNameTracks,
  selectArtistNameAlbums,
} from "../musicSelectors";
import type { MusicTrack, MusicAlbum } from "@/types/music";

/** Group tracks into album sections + a "Singles" section for loose tracks */
function useGroupedTracks(
  tracks: MusicTrack[],
  albums: MusicAlbum[],
): { album: MusicAlbum | null; tracks: MusicTrack[] }[] {
  return useMemo(() => {
    // Build album lookup
    const albumMap = new Map<string, MusicAlbum>();
    for (const a of albums) albumMap.set(a.addressableId, a);

    // Group tracks by albumRef
    const grouped = new Map<string, MusicTrack[]>();
    const singles: MusicTrack[] = [];

    for (const t of tracks) {
      if (t.albumRef && albumMap.has(t.albumRef)) {
        const arr = grouped.get(t.albumRef);
        if (arr) arr.push(t);
        else grouped.set(t.albumRef, [t]);
      } else {
        singles.push(t);
      }
    }

    const sections: { album: MusicAlbum | null; tracks: MusicTrack[] }[] = [];

    // Albums first (sorted by newest)
    const albumEntries = [...grouped.entries()]
      .map(([ref, trks]) => ({ album: albumMap.get(ref)!, tracks: trks }))
      .sort((a, b) => b.album.createdAt - a.album.createdAt);

    for (const entry of albumEntries) {
      // Sort tracks within album by their position in album trackRefs
      const refOrder = entry.album.trackRefs;
      entry.tracks.sort((a, b) => {
        const ai = refOrder.indexOf(a.addressableId);
        const bi = refOrder.indexOf(b.addressableId);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
      sections.push(entry);
    }

    // Also include albums that have no tracks loaded yet (just the card)
    for (const a of albums) {
      if (!grouped.has(a.addressableId)) {
        sections.push({ album: a, tracks: [] });
      }
    }

    // Singles last (sorted newest first)
    if (singles.length > 0) {
      singles.sort((a, b) => b.createdAt - a.createdAt);
      sections.push({ album: null, tracks: singles });
    }

    return sections;
  }, [tracks, albums]);
}

function PubkeyArtistDetail({ pubkey }: { pubkey: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { openUserPopover } = useUserPopover();
  const tracksSelector = useMemo(() => selectArtistTracks(pubkey), [pubkey]);
  const albumsSelector = useMemo(() => selectArtistAlbums(pubkey), [pubkey]);
  const artistTracks = useAppSelector(tracksSelector);
  const artistAlbums = useAppSelector(albumsSelector);
  const { profile } = useProfile(pubkey);
  const { imageUrl: localImage, pickImage } = useArtistImage(pubkey);
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);

  const name =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  // Profile picture fallback: nostr profile > local custom > latest album/track cover
  const fallbackImage = useMemo(() => {
    for (const a of [...artistAlbums].sort((a, b) => b.createdAt - a.createdAt)) {
      if (a.imageUrl) return a.imageUrl;
    }
    for (const t of [...artistTracks].sort((a, b) => b.createdAt - a.createdAt)) {
      if (t.imageUrl) return t.imageUrl;
    }
    return undefined;
  }, [artistAlbums, artistTracks]);

  const avatarSrc = profile?.picture || localImage || fallbackImage;
  const sections = useGroupedTracks(artistTracks, artistAlbums);

  // Build a flat queue of all track IDs in section order
  const allQueueIds = useMemo(
    () => sections.flatMap((s) => s.tracks.map((t) => t.addressableId)),
    [sections],
  );

  // Running index offset for TrackRow numbering across sections
  let trackOffset = 0;

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
        <div className="group relative">
          {profile?.picture ? (
            <button
              ref={avatarBtnRef}
              type="button"
              onClick={() => {
                if (avatarBtnRef.current) {
                  openUserPopover(pubkey, avatarBtnRef.current);
                }
              }}
              className="rounded-full focus:outline-none focus:ring-2 focus:ring-primary/40"
              title="View profile"
            >
              <Avatar src={avatarSrc} alt={name} size="lg" />
            </button>
          ) : (
            <>
              <Avatar src={avatarSrc} alt={name} size="lg" />
              <button
                onClick={pickImage}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60 opacity-0 transition-opacity group-hover:opacity-100"
                title="Set artist image"
              >
                <Camera size={16} className="text-heading" />
              </button>
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-soft">Artist</p>
          <h1 className="truncate text-2xl font-bold text-heading">{name}</h1>
          <p className="text-sm text-soft">
            {artistTracks.length} track{artistTracks.length !== 1 ? "s" : ""}
            {artistAlbums.length > 0 &&
              ` \u00B7 ${artistAlbums.length} album${artistAlbums.length !== 1 ? "s" : ""}`}
          </p>
          {profile?.nip05 && (
            <p className="mt-0.5 truncate text-[11px] text-primary/70">
              {profile.nip05}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              ref={profileBtnRef}
              type="button"
              onClick={() => {
                if (profileBtnRef.current) {
                  openUserPopover(pubkey, profileBtnRef.current);
                }
              }}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-soft transition-colors hover:border-border-light hover:text-heading press-effect"
              title="Quick view with follow, message, and more"
            >
              <UserSquare2 size={12} />
              View profile
            </button>
            <button
              type="button"
              onClick={() => navigate(`/profile/${pubkey}`)}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-soft transition-colors hover:border-border-light hover:text-heading press-effect"
              title="Open full profile page"
            >
              Open full profile
            </button>
          </div>
        </div>
      </div>

      {/* Sections grouped by album */}
      {sections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Music size={32} className="mb-3 text-muted" />
          <p className="text-sm text-soft">No tracks or albums found for this artist.</p>
        </div>
      )}
      {sections.map((section) => {
        const sectionStart = trackOffset;
        trackOffset += section.tracks.length;

        if (section.album && section.tracks.length === 0) {
          // Album with no loaded tracks — just show the card
          return (
            <section key={section.album.addressableId} className="px-6 py-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                {section.album.title}
                {section.album.projectType !== "album" && (
                  <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-muted">
                    ({section.album.projectType})
                  </span>
                )}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <AlbumCard album={section.album} />
              </div>
            </section>
          );
        }

        if (section.album) {
          // Album section with tracks
          return (
            <section key={section.album.addressableId} className="px-6 py-4">
              <div className="mb-2 flex items-center gap-3">
                {section.album.imageUrl && (
                  <button
                    onClick={() =>
                      dispatch(setActiveDetailId({ view: "album-detail", id: section.album!.addressableId }))
                    }
                    className="h-10 w-10 shrink-0 overflow-hidden rounded-lg transition-opacity hover:opacity-80"
                  >
                    <img src={section.album.imageUrl} alt="" className="h-full w-full object-cover" />
                  </button>
                )}
                <div>
                  <button
                    onClick={() =>
                      dispatch(setActiveDetailId({ view: "album-detail", id: section.album!.addressableId }))
                    }
                    className="text-sm font-semibold text-heading hover:underline"
                  >
                    {section.album.title}
                  </button>
                  {section.album.projectType !== "album" && (
                    <span className="ml-1.5 text-[10px] text-muted">
                      ({section.album.projectType})
                    </span>
                  )}
                </div>
              </div>
              {section.tracks.map((track, i) => (
                <TrackRow
                  key={track.addressableId}
                  track={track}
                  index={sectionStart + i}
                  queueTracks={allQueueIds}
                />
              ))}
            </section>
          );
        }

        // Singles section
        return (
          <section key="__singles__" className="px-6 py-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted">
              Singles
            </h2>
            {section.tracks.map((track, i) => (
              <TrackRow
                key={track.addressableId}
                track={track}
                index={sectionStart + i}
                queueTracks={allQueueIds}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function NameArtistDetail({ normalizedName }: { normalizedName: string }) {
  const dispatch = useAppDispatch();
  const tracksSelector = useMemo(() => selectArtistNameTracks(normalizedName), [normalizedName]);
  const albumsSelector = useMemo(() => selectArtistNameAlbums(normalizedName), [normalizedName]);
  const artistTracks = useAppSelector(tracksSelector);
  const artistAlbums = useAppSelector(albumsSelector);
  const { imageUrl: localImage, pickImage } = useArtistImage(`name:${normalizedName}`);
  const { scrollPaddingClass } = usePlaybackBarSpacing();

  const displayName = useMemo(() => {
    if (artistTracks.length > 0) return artistTracks[0].artist;
    if (artistAlbums.length > 0) return artistAlbums[0].artist;
    return normalizedName;
  }, [artistTracks, artistAlbums, normalizedName]);

  // Fallback image: local custom > latest album/track cover
  const fallbackImage = useMemo(() => {
    for (const a of [...artistAlbums].sort((a, b) => b.createdAt - a.createdAt)) {
      if (a.imageUrl) return a.imageUrl;
    }
    for (const t of [...artistTracks].sort((a, b) => b.createdAt - a.createdAt)) {
      if (t.imageUrl) return t.imageUrl;
    }
    return undefined;
  }, [artistAlbums, artistTracks]);

  const avatarSrc = localImage || fallbackImage;
  const sections = useGroupedTracks(artistTracks, artistAlbums);

  const allQueueIds = useMemo(
    () => sections.flatMap((s) => s.tracks.map((t) => t.addressableId)),
    [sections],
  );

  let trackOffset = 0;

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
        <div className="group relative">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={displayName}
              className="h-16 w-16 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card text-soft">
              <Music size={28} />
            </div>
          )}
          <button
            onClick={pickImage}
            className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60 opacity-0 transition-opacity group-hover:opacity-100"
            title="Set artist image"
          >
            <Camera size={16} className="text-heading" />
          </button>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-soft">Artist</p>
          <h1 className="text-2xl font-bold text-heading">{displayName}</h1>
          <p className="text-sm text-soft">
            {artistTracks.length} track{artistTracks.length !== 1 ? "s" : ""}
            {artistAlbums.length > 0 &&
              ` \u00B7 ${artistAlbums.length} album${artistAlbums.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Sections grouped by album */}
      {sections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Music size={32} className="mb-3 text-muted" />
          <p className="text-sm text-soft">No tracks or albums found for this artist.</p>
        </div>
      )}
      {sections.map((section) => {
        const sectionStart = trackOffset;
        trackOffset += section.tracks.length;

        if (section.album && section.tracks.length === 0) {
          return (
            <section key={section.album.addressableId} className="px-6 py-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                {section.album.title}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <AlbumCard album={section.album} />
              </div>
            </section>
          );
        }

        if (section.album) {
          return (
            <section key={section.album.addressableId} className="px-6 py-4">
              <div className="mb-2 flex items-center gap-3">
                {section.album.imageUrl && (
                  <button
                    onClick={() =>
                      dispatch(setActiveDetailId({ view: "album-detail", id: section.album!.addressableId }))
                    }
                    className="h-10 w-10 shrink-0 overflow-hidden rounded-lg transition-opacity hover:opacity-80"
                  >
                    <img src={section.album.imageUrl} alt="" className="h-full w-full object-cover" />
                  </button>
                )}
                <div>
                  <button
                    onClick={() =>
                      dispatch(setActiveDetailId({ view: "album-detail", id: section.album!.addressableId }))
                    }
                    className="text-sm font-semibold text-heading hover:underline"
                  >
                    {section.album.title}
                  </button>
                  {section.album.projectType !== "album" && (
                    <span className="ml-1.5 text-[10px] text-muted">
                      ({section.album.projectType})
                    </span>
                  )}
                </div>
              </div>
              {section.tracks.map((track, i) => (
                <TrackRow
                  key={track.addressableId}
                  track={track}
                  index={sectionStart + i}
                  queueTracks={allQueueIds}
                />
              ))}
            </section>
          );
        }

        return (
          <section key="__singles__" className="px-6 py-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted">
              Singles
            </h2>
            {section.tracks.map((track, i) => (
              <TrackRow
                key={track.addressableId}
                track={track}
                index={sectionStart + i}
                queueTracks={allQueueIds}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function ArtistDetail() {
  const activeDetailId = useAppSelector((s) => s.music.activeDetailId);

  if (!activeDetailId) return null;

  if (activeDetailId.startsWith("name:")) {
    const normalizedName = activeDetailId.slice(5);
    return <NameArtistDetail normalizedName={normalizedName} />;
  }

  return <PubkeyArtistDetail pubkey={activeDetailId} />;
}
