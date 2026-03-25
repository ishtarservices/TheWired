import { useMemo } from "react";
import { Music } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useArtistImage } from "../useArtistImage";
import { selectArtistDirectory } from "../musicSelectors";
import type { ArtistEntry } from "@/types/music";

/** Resolve a fallback image from the artist's tracks/albums */
function useArtistFallbackImage(type: "pubkey" | "name", key: string): string | undefined {
  return useAppSelector((s) => {
    const trackIds = type === "pubkey"
      ? s.music.tracksByArtist[key]
      : s.music.tracksByArtistName[key];
    const albumIds = type === "pubkey"
      ? s.music.albumsByArtist[key]
      : s.music.albumsByArtistName[key];

    // Prefer album covers, then track covers (most recent first)
    if (albumIds) {
      for (let i = albumIds.length - 1; i >= 0; i--) {
        const img = s.music.albums[albumIds[i]]?.imageUrl;
        if (img) return img;
      }
    }
    if (trackIds) {
      for (let i = trackIds.length - 1; i >= 0; i--) {
        const img = s.music.tracks[trackIds[i]]?.imageUrl;
        if (img) return img;
      }
    }
    return undefined;
  });
}

function ArtistPubkeyItem({ pubkey, trackCount, albumCount }: { pubkey: string; trackCount: number; albumCount: number }) {
  const dispatch = useAppDispatch();
  const { profile } = useProfile(pubkey);
  const { imageUrl: localImage } = useArtistImage(pubkey);
  const fallbackImage = useArtistFallbackImage("pubkey", pubkey);
  const name =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";
  const total = trackCount + albumCount;

  const avatarSrc = profile?.picture || localImage || fallbackImage;

  return (
    <button
      onClick={() =>
        dispatch(setActiveDetailId({ view: "artist-detail", id: pubkey }))
      }
      className="flex flex-col items-center gap-2 rounded-xl p-3 transition-all hover:bg-surface hover-lift"
    >
      <Avatar src={avatarSrc} alt={name} size="lg" />
      <p className="max-w-full truncate text-sm font-medium text-heading">{name}</p>
      <p className="text-xs text-soft">
        {total} item{total !== 1 ? "s" : ""}
      </p>
    </button>
  );
}

function ArtistNameItem({ entry }: { entry: Extract<ArtistEntry, { type: "name" }> }) {
  const dispatch = useAppDispatch();
  const { imageUrl: localImage } = useArtistImage(`name:${entry.normalizedName}`);
  const fallbackImage = useArtistFallbackImage("name", entry.normalizedName);
  const total = entry.trackCount + entry.albumCount;

  const avatarSrc = localImage || fallbackImage;

  return (
    <button
      onClick={() =>
        dispatch(setActiveDetailId({ view: "artist-detail", id: `name:${entry.normalizedName}` }))
      }
      className="flex flex-col items-center gap-2 rounded-xl p-3 transition-all hover:bg-surface hover-lift"
    >
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt={entry.name}
          className="h-12 w-12 rounded-full object-cover ring-1 ring-border"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-soft">
          <Music size={20} />
        </div>
      )}
      <p className="max-w-full truncate text-sm font-medium text-heading">{entry.name}</p>
      <p className="text-xs text-soft">
        {total} item{total !== 1 ? "s" : ""}
      </p>
    </button>
  );
}

export function ArtistList() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const directory = useAppSelector(selectArtistDirectory);
  const followedArtists = useAppSelector(
    (s) => s.music.library.followedArtists,
  );

  const entries = useMemo(() => {
    if (followedArtists.length > 0) {
      const followedSet = new Set(followedArtists);
      const followed = directory.filter(
        (e) => e.type === "pubkey" && followedSet.has(e.pubkey),
      );
      const rest = directory.filter(
        (e) => !(e.type === "pubkey" && followedSet.has(e.pubkey)),
      );
      return [...followed, ...rest];
    }
    return directory;
  }, [followedArtists, directory]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">No artists yet</p>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
      <h2 className="mb-3 text-lg font-semibold text-heading">Artists</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {entries.map((entry) =>
          entry.type === "pubkey" ? (
            <ArtistPubkeyItem
              key={entry.pubkey}
              pubkey={entry.pubkey}
              trackCount={entry.trackCount}
              albumCount={entry.albumCount}
            />
          ) : (
            <ArtistNameItem key={`name:${entry.normalizedName}`} entry={entry} />
          ),
        )}
      </div>
    </div>
  );
}
