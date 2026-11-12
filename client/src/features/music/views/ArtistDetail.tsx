import { useMemo, useRef } from "react";
import { ArrowLeft, Music, Camera, UserSquare2, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { useZap } from "@/features/wallet/WalletProvider";
import { goBack, setActiveDetailId } from "@/store/slices/musicSlice";
import { TrackRow } from "../TrackRow";
import { Artwork } from "../Artwork";
import { AlbumCard } from "../AlbumCard";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useProfileMusic } from "@/features/profile/useProfileMusic";
import { useUserPopover } from "@/features/profile/UserPopoverContext";
import { useArtistImage } from "../useArtistImage";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import {
  selectProfileTracks,
  selectProfileAlbums,
  selectArtistNameTracks,
  selectArtistNameAlbums,
} from "../musicSelectors";
import type { MusicTrack, MusicAlbum } from "@/types/music";

interface GroupedCatalog {
  /** Albums with at least one locally loaded track — rendered inline with a track list. */
  withTracks: { album: MusicAlbum; tracks: MusicTrack[] }[];
  /** Albums whose tracks aren't in the store yet — rendered as a compact wrap-grid of cards. */
  moreAlbums: MusicAlbum[];
  /** Loose tracks with no known album. */
  singles: MusicTrack[];
}

/** Group tracks into album sections + a "Singles" section for loose tracks.
 *
 * Albums with the same title are collapsed: when a collaborator edits a
 * shared album, the current save path re-publishes under the collaborator's
 * own pubkey, producing a distinct addressableId at the same title. We pick
 * one canonical entry per title so the profile doesn't show obvious dupes.
 *
 * Returns three buckets so the view can keep "inline album with tracks"
 * blocks contiguous and collapse cards-only albums into a single wrap-grid.
 */
function useGroupedTracks(
  tracks: MusicTrack[],
  albums: MusicAlbum[],
  profilePubkey: string | null = null,
): GroupedCatalog {
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

    // Collect every album candidate (with tracks or empty) before dedup.
    const rawEntries: { album: MusicAlbum; tracks: MusicTrack[] }[] = [];
    for (const [ref, trks] of grouped) {
      const album = albumMap.get(ref)!;
      const refOrder = album.trackRefs;
      trks.sort((a, b) => {
        const ai = refOrder.indexOf(a.addressableId);
        const bi = refOrder.indexOf(b.addressableId);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
      rawEntries.push({ album, tracks: trks });
    }
    for (const a of albums) {
      if (!grouped.has(a.addressableId)) {
        rawEntries.push({ album: a, tracks: [] });
      }
    }

    // Dedupe by lowercased title: prefer more tracks → profile-owned →
    // newest createdAt. Items without a title fall through unmerged.
    const byTitle = new Map<string, { album: MusicAlbum; tracks: MusicTrack[] }>();
    const untitled: { album: MusicAlbum; tracks: MusicTrack[] }[] = [];
    for (const entry of rawEntries) {
      const key = entry.album.title.toLowerCase().trim();
      if (!key) {
        untitled.push(entry);
        continue;
      }
      const existing = byTitle.get(key);
      if (!existing) {
        byTitle.set(key, entry);
        continue;
      }
      const prefer =
        entry.tracks.length !== existing.tracks.length
          ? (entry.tracks.length > existing.tracks.length ? entry : existing)
          : profilePubkey && entry.album.pubkey === profilePubkey && existing.album.pubkey !== profilePubkey
            ? entry
            : profilePubkey && existing.album.pubkey === profilePubkey && entry.album.pubkey !== profilePubkey
              ? existing
              : entry.album.createdAt >= existing.album.createdAt
                ? entry
                : existing;
      byTitle.set(key, prefer);
    }

    const deduped = [...byTitle.values(), ...untitled];
    const withTracks = deduped
      .filter((e) => e.tracks.length > 0)
      .sort((a, b) => b.album.createdAt - a.album.createdAt);
    const moreAlbums = deduped
      .filter((e) => e.tracks.length === 0)
      .map((e) => e.album)
      .sort((a, b) => b.createdAt - a.createdAt);

    singles.sort((a, b) => b.createdAt - a.createdAt);

    return { withTracks, moreAlbums, singles };
  }, [tracks, albums, profilePubkey]);
}

function PubkeyArtistDetail({ pubkey }: { pubkey: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { openUserPopover } = useUserPopover();
  const { openZap } = useZap();
  // Subscribe to this artist's tracks/albums so viewers who don't follow or
  // own their content still see the full public catalog.
  const { loading: musicLoading } = useProfileMusic(pubkey);
  const tracksSelector = useMemo(() => selectProfileTracks(pubkey), [pubkey]);
  const albumsSelector = useMemo(() => selectProfileAlbums(pubkey), [pubkey]);
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
  const { withTracks, moreAlbums, singles } = useGroupedTracks(
    artistTracks,
    artistAlbums,
    pubkey,
  );
  const isEmpty =
    withTracks.length === 0 && moreAlbums.length === 0 && singles.length === 0;

  // Flat queue of all track IDs in render order: with-tracks sections first,
  // then singles. "More albums" are cards only so they don't contribute here.
  const allQueueIds = useMemo(
    () => [
      ...withTracks.flatMap((s) => s.tracks.map((t) => t.addressableId)),
      ...singles.map((t) => t.addressableId),
    ],
    [withTracks, singles],
  );

  // Running index offset for the flat queue
  let trackOffset = 0;

  return (
    <div className={`flex-1 overflow-y-auto ${scrollPaddingClass}`}>
      {/* Header */}
      <div className="flex items-end gap-6 px-8 pb-7 pt-6">
        <button
          onClick={() => dispatch(goBack())}
          className="-ml-2 self-start rounded-md p-1.5 text-soft transition-colors hover:bg-surface-hover hover:text-heading"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
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
              <Avatar src={avatarSrc} alt={name} size="xl" />
            </button>
          ) : (
            <>
              <Avatar src={avatarSrc} alt={name} size="xl" />
              <button
                onClick={pickImage}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60 opacity-0 transition-opacity group-hover:opacity-100"
                title="Set artist image"
              >
                <Camera size={18} className="text-heading" />
              </button>
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="label-caps text-soft">Artist</p>
          <h1 className="mt-2.5 truncate text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-heading">{name}</h1>
          <p className="readout mt-2 text-[11px] uppercase tracking-wider text-muted">
            {artistTracks.length} track{artistTracks.length !== 1 ? "s" : ""}
            {artistAlbums.length > 0 &&
              ` \u00B7 ${artistAlbums.length} album${artistAlbums.length !== 1 ? "s" : ""}`}
          </p>
          {profile?.nip05 && (
            <p className="mt-1 truncate text-xs text-soft">
              {profile.nip05}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              ref={profileBtnRef}
              type="button"
              onClick={() => {
                if (profileBtnRef.current) {
                  openUserPopover(pubkey, profileBtnRef.current);
                }
              }}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading press-effect"
              title="Quick view with follow, message, and more"
            >
              <UserSquare2 size={12} />
              View profile
            </button>
            <button
              type="button"
              onClick={() => navigate(`/profile/${pubkey}`)}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading press-effect"
              title="Open full profile page"
            >
              Open full profile
            </button>
            <button
              type="button"
              onClick={() => openZap({ recipientPubkey: pubkey, displayName: name })}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-warning transition-colors hover:border-warning/40 hover:bg-warning/10 press-effect"
              title="Send a zap"
            >
              <Zap size={12} />
              Zap
            </button>
          </div>
        </div>
      </div>

      {/* Empty / loading state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          {musicLoading ? (
            <>
              <div className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              <p className="text-sm text-soft">Loading catalog…</p>
            </>
          ) : (
            <>
              <Music size={32} className="mb-3 text-muted" />
              <p className="text-sm text-soft">No tracks or albums found for this artist.</p>
            </>
          )}
        </div>
      )}

      {/* Albums with loaded tracks — inline sections */}
      {withTracks.map((section) => {
        const sectionStart = trackOffset;
        trackOffset += section.tracks.length;
        return (
          <section key={section.album.addressableId} className="border-t border-border-light px-5 py-5">
            <div className="mb-2 flex items-center gap-3 px-3">
              {section.album.imageUrl && (
                <button
                  onClick={() =>
                    dispatch(setActiveDetailId({ view: "album-detail", id: section.album.addressableId }))
                  }
                  className="shrink-0 rounded-md transition-opacity hover:opacity-80"
                >
                  <Artwork src={section.album.imageUrl} title={section.album.title} compact className="h-12 w-12 rounded-md" />
                </button>
              )}
              <div>
                <button
                  onClick={() =>
                    dispatch(setActiveDetailId({ view: "album-detail", id: section.album.addressableId }))
                  }
                  className="text-[15px] font-semibold tracking-[-0.01em] text-heading hover:underline"
                >
                  {section.album.title}
                </button>
                {section.album.projectType !== "album" && (
                  <span className="ml-2 font-mono text-[9px] uppercase tracking-wider text-muted">
                    {section.album.projectType}
                  </span>
                )}
              </div>
            </div>
            {section.tracks.map((track, i) => (
              <TrackRow
                key={track.addressableId}
                track={track}
                index={sectionStart + i}
                displayIndex={i + 1}
                queueTracks={allQueueIds}
                context="album"
              />
            ))}
          </section>
        );
      })}

      {/* Albums whose tracks aren't loaded yet — one combined wrap-grid. */}
      {moreAlbums.length > 0 && (
        <section className="border-t border-border-light px-8 py-5">
          <h2 className="mb-3 label-caps">
            More projects
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-5 gap-y-6">
            {moreAlbums.map((album) => (
              <AlbumCard key={album.addressableId} album={album} />
            ))}
          </div>
        </section>
      )}

      {/* Singles last */}
      {singles.length > 0 && (() => {
        const sectionStart = trackOffset;
        trackOffset += singles.length;
        return (
          <section key="__singles__" className="border-t border-border-light px-5 py-5">
            <h2 className="mb-3 px-3 label-caps">
              Singles
            </h2>
            {singles.map((track, i) => (
              <TrackRow
                key={track.addressableId}
                track={track}
                index={sectionStart + i}
                displayIndex={i + 1}
                queueTracks={allQueueIds}
                context="album"
              />
            ))}
          </section>
        );
      })()}
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
  const { withTracks, moreAlbums, singles } = useGroupedTracks(
    artistTracks,
    artistAlbums,
  );
  const isEmpty =
    withTracks.length === 0 && moreAlbums.length === 0 && singles.length === 0;

  const allQueueIds = useMemo(
    () => [
      ...withTracks.flatMap((s) => s.tracks.map((t) => t.addressableId)),
      ...singles.map((t) => t.addressableId),
    ],
    [withTracks, singles],
  );

  let trackOffset = 0;

  return (
    <div className={`flex-1 overflow-y-auto ${scrollPaddingClass}`}>
      {/* Header */}
      <div className="flex items-end gap-6 px-8 pb-7 pt-6">
        <button
          onClick={() => dispatch(goBack())}
          className="-ml-2 self-start rounded-md p-1.5 text-soft transition-colors hover:bg-surface-hover hover:text-heading"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="group relative">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={displayName}
              className="h-24 w-24 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-card text-muted ring-1 ring-border">
              <Music size={28} />
            </div>
          )}
          <button
            onClick={pickImage}
            className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60 opacity-0 transition-opacity group-hover:opacity-100"
            title="Set artist image"
          >
            <Camera size={18} className="text-heading" />
          </button>
        </div>
        <div>
          <p className="label-caps text-soft">Artist</p>
          <h1 className="mt-2.5 text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-heading">{displayName}</h1>
          <p className="readout mt-2 text-[11px] uppercase tracking-wider text-muted">
            {artistTracks.length} track{artistTracks.length !== 1 ? "s" : ""}
            {artistAlbums.length > 0 &&
              ` \u00B7 ${artistAlbums.length} album${artistAlbums.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Music size={32} className="mb-3 text-muted" />
          <p className="text-sm text-soft">No tracks or albums found for this artist.</p>
        </div>
      )}

      {/* Albums with loaded tracks */}
      {withTracks.map((section) => {
        const sectionStart = trackOffset;
        trackOffset += section.tracks.length;
        return (
          <section key={section.album.addressableId} className="border-t border-border-light px-5 py-5">
            <div className="mb-2 flex items-center gap-3 px-3">
              {section.album.imageUrl && (
                <button
                  onClick={() =>
                    dispatch(setActiveDetailId({ view: "album-detail", id: section.album.addressableId }))
                  }
                  className="shrink-0 rounded-md transition-opacity hover:opacity-80"
                >
                  <Artwork src={section.album.imageUrl} title={section.album.title} compact className="h-12 w-12 rounded-md" />
                </button>
              )}
              <div>
                <button
                  onClick={() =>
                    dispatch(setActiveDetailId({ view: "album-detail", id: section.album.addressableId }))
                  }
                  className="text-[15px] font-semibold tracking-[-0.01em] text-heading hover:underline"
                >
                  {section.album.title}
                </button>
                {section.album.projectType !== "album" && (
                  <span className="ml-2 font-mono text-[9px] uppercase tracking-wider text-muted">
                    {section.album.projectType}
                  </span>
                )}
              </div>
            </div>
            {section.tracks.map((track, i) => (
              <TrackRow
                key={track.addressableId}
                track={track}
                index={sectionStart + i}
                displayIndex={i + 1}
                queueTracks={allQueueIds}
                context="album"
              />
            ))}
          </section>
        );
      })}

      {/* Combined cards grid for albums whose tracks aren't loaded */}
      {moreAlbums.length > 0 && (
        <section className="border-t border-border-light px-8 py-5">
          <h2 className="mb-3 label-caps">
            More projects
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-5 gap-y-6">
            {moreAlbums.map((album) => (
              <AlbumCard key={album.addressableId} album={album} />
            ))}
          </div>
        </section>
      )}

      {/* Singles last */}
      {singles.length > 0 && (() => {
        const sectionStart = trackOffset;
        trackOffset += singles.length;
        return (
          <section key="__singles__" className="border-t border-border-light px-5 py-5">
            <h2 className="mb-3 px-3 label-caps">
              Singles
            </h2>
            {singles.map((track, i) => (
              <TrackRow
                key={track.addressableId}
                track={track}
                index={sectionStart + i}
                displayIndex={i + 1}
                queueTracks={allQueueIds}
                context="album"
              />
            ))}
          </section>
        );
      })()}
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
