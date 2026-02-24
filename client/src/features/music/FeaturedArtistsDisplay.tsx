import { useProfile } from "@/features/profile/useProfile";

/** Single artist name resolved from pubkey */
function ArtistName({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey);
  return <>{profile?.display_name || profile?.name || pubkey.slice(0, 8) + "..."}</>;
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
