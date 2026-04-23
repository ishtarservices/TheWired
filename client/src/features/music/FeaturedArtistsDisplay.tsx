import { useProfile } from "@/features/profile/useProfile";
import { useAppDispatch } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";

/** Single artist name resolved from pubkey, clickable to open artist detail */
function ArtistName({ pubkey }: { pubkey: string }) {
  const dispatch = useAppDispatch();
  const { profile } = useProfile(pubkey);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        dispatch(setActiveDetailId({ view: "artist-detail", id: pubkey }));
      }}
      className="hover:text-heading hover:underline"
    >
      {name}
    </button>
  );
}

interface FeaturedArtistsDisplayProps {
  pubkeys: string[];
}

/** Renders "ft. Artist1, Artist2" for featured artists */
export function FeaturedArtistsDisplay({ pubkeys }: FeaturedArtistsDisplayProps) {
  if (pubkeys.length === 0) return null;

  return (
    <span className="text-muted">
      {" ft. "}
      {pubkeys.map((pk, i) => (
        <span key={pk}>
          {i > 0 && ", "}
          <ArtistName pubkey={pk} />
        </span>
      ))}
    </span>
  );
}
