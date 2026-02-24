import { useMemo } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";

function ArtistItem({ pubkey }: { pubkey: string }) {
  const dispatch = useAppDispatch();
  const { profile } = useProfile(pubkey);
  const name =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";
  const trackCount = useAppSelector(
    (s) => s.music.tracksByArtist[pubkey]?.length ?? 0,
  );

  return (
    <button
      onClick={() =>
        dispatch(setActiveDetailId({ view: "artist-detail", id: pubkey }))
      }
      className="flex flex-col items-center gap-2 rounded-lg p-3 transition-colors hover:bg-card-hover/30"
    >
      <Avatar src={profile?.picture} alt={name} size="lg" />
      <p className="truncate text-sm font-medium text-heading">{name}</p>
      <p className="text-xs text-soft">
        {trackCount} track{trackCount !== 1 ? "s" : ""}
      </p>
    </button>
  );
}

export function ArtistList() {
  const tracksByArtist = useAppSelector((s) => s.music.tracksByArtist);
  const followedArtists = useAppSelector(
    (s) => s.music.library.followedArtists,
  );

  const artistPubkeys = useMemo(() => {
    if (followedArtists.length > 0) return followedArtists;
    return Object.keys(tracksByArtist);
  }, [followedArtists, tracksByArtist]);

  if (artistPubkeys.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">No artists yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="mb-3 text-lg font-semibold text-heading">Artists</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {artistPubkeys.map((pk) => (
          <ArtistItem key={pk} pubkey={pk} />
        ))}
      </div>
    </div>
  );
}
